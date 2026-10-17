// The one rule for ids and names that cross a trust boundary (backup files, history.state):
// a nonblank string without control characters, at most 512 characters. Backups and
// navigation share it so an imported note can always be opened.
export const SAFE_STRING = /^[^\u0000-\u001f\u007f]{1,512}$/;
export const isSafeId = (value) => typeof value === "string" && SAFE_STRING.test(value) && value.trim().length > 0;

// getRandomValues also works on the phone's plain-HTTP development origin.
export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
