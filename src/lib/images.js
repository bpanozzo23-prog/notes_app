import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "../db/files.js";

const UNUSABLE = "This image can't be used here.";
const TOO_LARGE = "This image is too large to add.";
export const MAX_EDGE = 2560;

// Only headers are inspected here; decoding remains the browser's job.
export function imageDimensions(buffer, type) {
  try {
    const b = new Uint8Array(buffer), v = new DataView(buffer);
    const str = (at, n) => String.fromCharCode(...b.subarray(at, at + n));
    let width, height, orientation = 1;
    if (type === "image/png" && str(0, 8) === "\x89PNG\r\n\x1a\n" && v.getUint32(8) === 13 && str(12, 4) === "IHDR") {
      width = v.getUint32(16); height = v.getUint32(20);
    } else if (type === "image/gif" && ["GIF87a", "GIF89a"].includes(str(0, 6))) {
      width = v.getUint16(6, true); height = v.getUint16(8, true);
    } else if (type === "image/webp" && str(0, 4) === "RIFF" && str(8, 4) === "WEBP") {
      const u24 = (at) => b[at] + b[at + 1] * 256 + b[at + 2] * 65536;
      for (let at = 12; at + 8 <= b.length;) {
        const kind = str(at, 4), size = v.getUint32(at + 4, true), p = at + 8;
        if (p + size > b.length) break;
        if (kind === "VP8X" && size >= 10) { width = u24(p + 4) + 1; height = u24(p + 7) + 1; break; }
        if (kind === "VP8L" && size >= 5 && b[p] === 0x2f) {
          const bits = v.getUint32(p + 1, true);
          width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; break;
        }
        if (kind === "VP8 " && size >= 10 && str(p + 3, 3) === "\x9d\x01\x2a") {
          width = v.getUint16(p + 6, true) & 0x3fff; height = v.getUint16(p + 8, true) & 0x3fff; break;
        }
        at = p + size + (size % 2);
      }
    } else if (type === "image/jpeg" && v.getUint16(0) === 0xffd8) {
      for (let at = 2; at < b.length;) {
        if (b[at++] !== 0xff) break;
        while (b[at] === 0xff) at++;
        const marker = b[at++];
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        const size = v.getUint16(at);
        if (size < 2 || at + size > b.length) break;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && size >= 8) {
          height = v.getUint16(at + 3); width = v.getUint16(at + 5);
        }
        if (marker === 0xe1 && str(at + 2, 6) === "Exif\0\0") {
          // EXIF swaps the displayed axes for quarter-turn camera orientations.
          const t = at + 8, little = str(t, 2) === "II";
          if (["II", "MM"].includes(str(t, 2)) && v.getUint16(t + 2, little) === 42) {
            const dir = t + v.getUint32(t + 4, little);
            if (dir + 2 <= at + size) {
              const count = v.getUint16(dir, little);
              for (let p = dir + 2; p + 12 <= at + size && p < dir + 2 + count * 12; p += 12) {
                if (v.getUint16(p, little) === 0x112 && v.getUint16(p + 2, little) === 3 && v.getUint32(p + 4, little) === 1) orientation = v.getUint16(p + 8, little);
              }
            }
          }
        }
        at += size;
      }
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error(UNUSABLE);
    return { width, height, orientation };
  } catch { throw new Error(UNUSABLE); }
}

export function readImageBytes(blob) {
  if (blob.arrayBuffer) return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reader.onabort = () => reject(new Error(UNUSABLE));
    reader.readAsArrayBuffer(blob);
  });
}
const defaults = {
  read: readImageBytes,
  decode: async (file, options) => {
    try { return await createImageBitmap(file, options); }
    catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return createImageBitmap(file, { imageOrientation: "from-image" });
    }
  },
  canvas: (width, height) => {
    const canvas = typeof OffscreenCanvas === "undefined" ? document.createElement("canvas") : new OffscreenCanvas(width, height);
    canvas.width = width; canvas.height = height;
    return canvas;
  },
  encode: (canvas, type, quality) => canvas.convertToBlob ? canvas.convertToBlob({ type, quality })
    : new Promise((resolve) => canvas.toBlob(resolve, type, quality)),
};
function fit(width, height) {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function processImage(file, deps = {}) {
  const api = { ...defaults, ...deps };
  let bitmap;
  try {
    if (!IMAGE_TYPES.includes(file.type)) throw new Error(UNUSABLE);
    const original = await api.read(file);
    const header = imageDimensions(original, file.type);
    if (header.width * header.height > 100_000_000) throw new Error(TOO_LARGE);
    const rotated = header.orientation >= 5 && header.orientation <= 8;
    const requested = fit(rotated ? header.height : header.width, rotated ? header.width : header.height);
    bitmap = await api.decode(file, { imageOrientation: "from-image", resizeWidth: requested.width, resizeHeight: requested.height, resizeQuality: "high" });
    if (!bitmap || ![bitmap.width, bitmap.height].every((n) => Number.isInteger(n) && n > 0) || bitmap.width * bitmap.height > 100_000_000) throw new Error(UNUSABLE);
    // Browsers may ignore resize options. Always check and fit the actual bitmap.
    const { width, height } = fit(bitmap.width, bitmap.height);
    const canvas = api.canvas(width, height), ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(UNUSABLE);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close(); bitmap = null;
    let blob = await api.encode(canvas, "image/webp", 0.85);
    if (!blob) throw new Error(UNUSABLE);
    if (blob.type !== "image/webp") {
      blob = await api.encode(canvas, "image/jpeg", 0.85);
      if (!blob || blob.type !== "image/jpeg") throw new Error(UNUSABLE);
    }
    const keep = file.type !== "image/gif" && Math.max(header.width, header.height) <= MAX_EDGE && original.byteLength < blob.size;
    const bytes = keep ? original : await api.read(blob);
    if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(UNUSABLE);
    return { type: keep ? file.type : blob.type, bytes, width, height };
  } catch (error) {
    throw new Error(error?.message === TOO_LARGE ? TOO_LARGE : UNUSABLE);
  } finally { bitmap?.close(); }
}
