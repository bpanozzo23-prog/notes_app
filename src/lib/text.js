import { isSafeId } from "./ids.js";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

function decodeEntities(text) {
  return text.replace(/&(amp|lt|gt|quot|#39|nbsp|#\d+|#x[\da-f]+);/gi, (entity, name) => {
    const key = name.toLowerCase();
    if (Object.hasOwn(ENTITIES, key)) return ENTITIES[key];
    const code = key.startsWith("#x") ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

// These are projections of stored editor HTML, not a renderer or an HTML sanitiser.
export function htmlToText(html) {
  return decodeEntities(html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, (tag) =>
      /^<\/?(?:p|h[1-6]|li|div|blockquote|pre|ul|ol|hr|br)\b/i.test(tag) ? "\n" : "")
    .replace(/\n[\t ]*\n+/g, "\n"))
    .trim();
}

const ANCHOR = /<a\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const ATTRIBUTE = /\s+([^\s=<>/'"]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

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

export function neutralizeNoteLinks(html, ids) {
  return html.replace(ANCHOR, (tag) => tag.replace(ATTRIBUTE, (attr, name, double, single, bare) =>
    name.toLowerCase() === "href" && ids.has(noteId(double ?? single ?? bare ?? "")) ? "" : attr));
}

export function normalize(text) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function firstLine(text) {
  return text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
}

export function extractFileIds(html) {
  const ids = new Set();
  for (const [tag] of html.matchAll(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    for (const attr of tag.matchAll(ATTRIBUTE)) {
      if (attr[1].toLowerCase() !== "data-file") continue;
      const id = decodeEntities(attr[2] ?? attr[3] ?? attr[4] ?? "");
      if (isSafeId(id)) ids.add(id);
      break; // HTML uses the first occurrence of a duplicate attribute.
    }
  }
  return [...ids];
}
