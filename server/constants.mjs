// Deployed independently of src/. compatibility.test.js prevents these copies drifting.
export const SCHEMA_VERSION = 4;
export const FORMATTING_KEYS = Object.freeze([
  "toolbar", "toolbarLayout", "selectionMenu", "textColors", "highlightColors", "namedStyles",
]);
export const EXPORTED_PREFS = Object.freeze(["lastBackupAt", ...FORMATTING_KEYS]);
export const IMAGE_TYPES = Object.freeze(["image/webp", "image/jpeg", "image/png", "image/gif"]);
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_JSON_BYTES = 32 * 1024 * 1024;
export const MAX_NOTEBOOK_BYTES = 16 * 1024 * 1024;
export const MAX_PROPOSAL_DETAILS_BYTES = 16 * 1024;
export const MAX_PENDING_PROPOSALS = 50;
export const PORT = 8790;
export const PAIRING_WINDOW_MS = 10 * 60 * 1000;
export const MAX_PAIRING_TRIES = 5;
export const CONFIRM_WINDOW_MS = 30 * 60 * 1000;
export const UPLOAD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const SAFE_STRING = /^[^\u0000-\u001f\u007f]{1,512}$/;
export const isSafeId = (value) => typeof value === "string" && SAFE_STRING.test(value) && value.trim().length > 0;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
const ATTRIBUTE = /\s+([^\s=<>/'"]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
function decodeEntities(text) {
  return text.replace(/&(amp|lt|gt|quot|#39|nbsp|#\d+|#x[\da-f]+);/gi, (entity, name) => {
    const key = name.toLowerCase();
    if (Object.hasOwn(ENTITIES, key)) return ENTITIES[key];
    const code = key.startsWith("#x") ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}
export function extractFileIds(html) {
  const ids = new Set();
  for (const [tag] of html.matchAll(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    for (const attr of tag.matchAll(ATTRIBUTE)) {
      if (attr[1].toLowerCase() !== "data-file") continue;
      const id = decodeEntities(attr[2] ?? attr[3] ?? attr[4] ?? "");
      if (isSafeId(id)) ids.add(id);
      break;
    }
  }
  return [...ids];
}

// Kept equal to src/lib/text.js by compatibility.test.js.
const ANCHOR = /<a\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
function noteId(value) {
  const href = decodeEntities(value).trim();
  return /^note:[^\s]+$/i.test(href) ? href.slice(5) : null;
}
export function extractNoteLinks(html) {
  const ids = new Set();
  for (const [tag] of html.matchAll(ANCHOR)) {
    for (const attr of tag.matchAll(ATTRIBUTE)) {
      if (attr[1].toLowerCase() !== "href") continue;
      const id = noteId(attr[2] ?? attr[3] ?? attr[4] ?? "");
      if (id) ids.add(id);
    }
  }
  return [...ids];
}
