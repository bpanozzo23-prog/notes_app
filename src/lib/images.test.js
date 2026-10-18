import { afterEach, expect, it, vi } from "vitest";
import { imageDimensions, processImage, readImageBytes } from "./images.js";
import { MAX_IMAGE_BYTES } from "../db/files.js";
import { makePng } from "../../scripts/image-fixture.mjs";

const buffer = (bytes) => Uint8Array.from(bytes).buffer;
const png = (width = 480, height = 270) => {
  const bytes = new Uint8Array(24), v = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  v.setUint32(16, width); v.setUint32(20, height); return bytes.buffer;
};
const jpeg = (width = 480, height = 270, orientation = 1) => {
  const b = new Uint8Array(50), v = new DataView(b.buffer);
  b.set([255, 216, 255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0]);
  v.setUint16(22, 0x112, true); v.setUint16(24, 3, true); v.setUint32(26, 1, true); v.setUint16(30, orientation, true);
  b.set([255, 192, 0, 10, 8], 38); v.setUint16(43, height); v.setUint16(45, width); return b.buffer;
};
const gif = () => buffer([71, 73, 70, 56, 57, 97, 224, 1, 14, 1]);
const webp = (kind) => {
  const b = new Uint8Array(30), v = new DataView(b.buffer);
  b.set(Buffer.from("RIFF")); v.setUint32(4, 22, true); b.set(Buffer.from("WEBP"), 8); b.set(Buffer.from(kind), 12); v.setUint32(16, 10, true);
  if (kind === "VP8X") { b.set([223, 1, 0], 24); b.set([13, 1, 0], 27); }
  if (kind === "VP8L") { b[20] = 47; v.setUint32(21, 479 | (269 << 14), true); }
  if (kind === "VP8 ") { b.set([157, 1, 42], 23); v.setUint16(26, 480, true); v.setUint16(28, 270, true); }
  return b.buffer;
};
function fake(type = "image/png", bytes = png(), overrides = {}) {
  const file = { type, bytes }, bitmap = { width: 480, height: 270, close: vi.fn() };
  const ctx = { fillRect: vi.fn(), drawImage: vi.fn() }, canvas = { getContext: () => ctx };
  const encoded = { type: "image/webp", size: 10, bytes: new Uint8Array(10).buffer };
  const deps = { read: async (blob) => blob.bytes, decode: vi.fn(async () => bitmap), canvas: vi.fn(() => canvas), encode: vi.fn(async () => encoded), ...overrides };
  return { file, bitmap, ctx, deps, encoded };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each([["image/png", png()], ["image/jpeg", jpeg()], ["image/gif", gif()], ...["VP8X", "VP8L", "VP8 "].map((kind) => ["image/webp", webp(kind)])])("reads %s header dimensions before decode", (type, bytes) => {
  expect(imageDimensions(bytes, type)).toMatchObject({ width: 480, height: 270 });
});
it.each(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"])("rejects unreadable %s headers without decode", async (type) => {
  const { file, deps } = fake(type, buffer([0, 1, 2]));
  await expect(processImage(file, deps)).rejects.toThrow("This image can't be used here."); expect(deps.decode).not.toHaveBeenCalled();
});
it("rejects over 100 MP before decode and permits the exact boundary", async () => {
  const { file, deps } = fake("image/png", png(10001, 10000));
  await expect(processImage(file, deps)).rejects.toThrow("This image is too large to add."); expect(deps.decode).not.toHaveBeenCalled();
  await processImage({ ...file, bytes: png(10000, 10000) }, deps); expect(deps.decode).toHaveBeenCalled();
});
it("requests oriented resize, checks actual dimensions, paints white and closes before encoding", async () => {
  const { file, deps, bitmap, ctx } = fake("image/jpeg", jpeg(6000, 4000, 6));
  bitmap.width = 4000; bitmap.height = 6000; // Browser ignored resizing, but applied orientation.
  deps.encode.mockImplementation(async () => { expect(bitmap.close).toHaveBeenCalledOnce(); return { type: "image/webp", size: 1, bytes: buffer([1]) }; });
  const result = await processImage(file, deps);
  expect(deps.decode).toHaveBeenCalledWith(file, { imageOrientation: "from-image", resizeWidth: 1707, resizeHeight: 2560, resizeQuality: "high" });
  expect(result).toMatchObject({ width: 1707, height: 2560 });
  expect(ctx.fillStyle).toBe("#ffffff"); expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1707, 2560);
  expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1707, 2560); expect(bitmap.close).toHaveBeenCalledOnce();
});
it("does not enlarge small images", async () => {
  const { file, deps } = fake();
  expect(await processImage(file, deps)).toMatchObject({ width: 480, height: 270 });
});
it("falls back to JPEG when WebP returns PNG, using quality .85", async () => {
  const { file, deps, encoded } = fake();
  deps.encode.mockResolvedValueOnce({ ...encoded, type: "image/png" }).mockResolvedValueOnce({ ...encoded, type: "image/jpeg" });
  expect((await processImage(file, deps)).type).toBe("image/jpeg");
  expect(deps.encode.mock.calls.map(([, type, quality]) => [type, quality])).toEqual([["image/webp", .85], ["image/jpeg", .85]]);
});
it.each([null, { type: "image/png", size: 1, bytes: buffer([1]) }])("rejects a null or unsupported fallback result", async (blob) => {
  const { file, deps, bitmap } = fake(); deps.encode.mockResolvedValue(blob);
  await expect(processImage(file, deps)).rejects.toThrow("This image can't be used here."); expect(bitmap.close).toHaveBeenCalledOnce();
});
it("rejects a null JPEG fallback", async () => {
  const { file, deps } = fake(); deps.encode.mockResolvedValueOnce({ type: "image/png" }).mockResolvedValueOnce(null);
  await expect(processImage(file, deps)).rejects.toThrow("This image can't be used here.");
});
it.each([["image/png", png()], ["image/jpeg", jpeg()], ["image/webp", webp("VP8X")]])("keeps smaller, already-small %s originals", async (type, bytes) => {
  const { file, deps, encoded } = fake(type, bytes);
  encoded.size = 100; encoded.bytes = new Uint8Array(100).buffer;
  const result = await processImage(file, deps); expect(result.bytes).toBe(bytes); expect(result.type).toBe(type);
});
it("never keeps a large-dimension original, even if it has fewer bytes", async () => {
  const { file, deps, encoded } = fake("image/png", png(5000, 3000)); encoded.size = 100; encoded.bytes = new Uint8Array(100).buffer;
  expect((await processImage(file, deps)).type).toBe("image/webp");
});
it("always turns GIF into a still image even when the original is smaller", async () => {
  const { file, deps, encoded } = fake("image/gif", gif()); encoded.size = 100; encoded.bytes = new Uint8Array(100).buffer;
  expect((await processImage(file, deps)).type).toBe("image/webp");
});
it("refuses output over 10 MB and accepts the exact boundary", async () => {
  const { file, deps, encoded } = fake("image/gif", gif());
  encoded.size = MAX_IMAGE_BYTES + 1; encoded.bytes = new Uint8Array(encoded.size).buffer;
  await expect(processImage(file, deps)).rejects.toThrow("This image can't be used here.");
  encoded.size = MAX_IMAGE_BYTES; encoded.bytes = new Uint8Array(encoded.size).buffer;
  expect((await processImage(file, deps)).bytes.byteLength).toBe(MAX_IMAGE_BYTES);
});
it.each(["decode", "canvas", "encode"])("shows a safe message for %s failure and closes acquired bitmaps", async (method) => {
  const { file, deps, bitmap } = fake(); deps[method] = vi.fn(() => { throw new Error("Technical details"); });
  await expect(processImage(file, deps)).rejects.toThrow("This image can't be used here.");
  expect(bitmap.close).toHaveBeenCalledTimes(method === "decode" ? 0 : 1);
});
it("rejects non-images and nonsensical decoded dimensions", async () => {
  const { file, deps, bitmap } = fake("text/plain");
  await expect(processImage(file, deps)).rejects.toThrow("This image can't be used here.");
  bitmap.width = 0;
  await expect(processImage({ ...file, type: "image/png" }, deps)).rejects.toThrow("This image can't be used here.");
  expect(bitmap.close).toHaveBeenCalledOnce();
});
it("uses browser bitmap resize fallback only for unsupported options", async () => {
  const { file, deps, bitmap } = fake(); delete deps.decode;
  vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValueOnce(new TypeError("options")).mockResolvedValueOnce(bitmap));
  await processImage(file, deps);
  expect(createImageBitmap).toHaveBeenLastCalledWith(file, { imageOrientation: "from-image" });
});
it("reads generated valid PNG files through the browser FileReader fallback", async () => {
  const bytes = await readImageBytes(new File([makePng()], "fixture.png", { type: "image/png" }));
  expect(imageDimensions(bytes, "image/png")).toMatchObject({ width: 480, height: 270 });
});
