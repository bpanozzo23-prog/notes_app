// Validate without allocating decoded bytes. Reject noncanonical padding and trailing bits.
export function base64Size(data) {
  if (typeof data !== "string" || data.length % 4 || /[^A-Za-z0-9+/=]/.test(data)) return null;
  const end = data.indexOf("=");
  const padding = end < 0 ? 0 : data.length - end;
  if (padding > 2 || (end >= 0 && !/^=+$/.test(data.slice(end)))) return null;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if (padding && (alphabet.indexOf(data[end - 1]) & (padding === 2 ? 15 : 3))) return null;
  return data.length / 4 * 3 - padding;
}

export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.toBase64) return bytes.toBase64();
  const parts = [];
  // Multiples of three let each chunk be encoded separately without internal padding.
  for (let start = 0; start < bytes.length; start += 24576) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(start, start + 24576))));
  }
  return parts.join("");
}

export function fromBase64(data) {
  const size = base64Size(data);
  if (size === null) throw new Error("Invalid image data.");
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(data).buffer;
  const bytes = new Uint8Array(size);
  for (let start = 0, offset = 0; start < data.length; start += 32768) {
    const chunk = atob(data.slice(start, start + 32768));
    for (let i = 0; i < chunk.length; i++) bytes[offset++] = chunk.charCodeAt(i);
  }
  return bytes.buffer;
}
