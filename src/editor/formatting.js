import { DEFAULT_TOOLBAR, DEFAULT_SELECTION_MENU } from "./actions.js";
import { isSafeId } from "../lib/ids.js";

const palette = (entries) => entries.map(([color, name]) => ({ color, name, hidden: false, custom: false }));
export const STARTER_TEXT_COLORS = palette([
  ["#dc2626", "Red"], ["#15803d", "Green"], ["#2563eb", "Blue"], ["#7c3aed", "Purple"],
  ["#111827", "Black"], ["#4b5563", "Grey"], ["#92400e", "Brown"], ["#9a3412", "Orange"],
  ["#0f766e", "Teal"], ["#0e7490", "Cyan"], ["#4338ca", "Indigo"], ["#be185d", "Pink"],
]);
export const STARTER_HIGHLIGHT_COLORS = palette([
  ["#fde68a", "Yellow"], ["#fed7aa", "Orange"], ["#fecaca", "Red"], ["#fbcfe8", "Pink"],
  ["#ddd6fe", "Purple"], ["#bfdbfe", "Blue"], ["#a7f3d0", "Green"], ["#e5e7eb", "Grey"],
]);
export const DEFAULT_NAMED_STYLES = [{
  id: "default-heading", name: "Heading",
  look: { bold: true, italic: false, underline: true, strike: false, color: "#15803d",
    highlight: null, fontSize: "17pt", fontFamily: null },
  block: "h2", lineHeight: null,
}];
export const DEFAULT_FORMATTING = {
  toolbar: DEFAULT_TOOLBAR, toolbarLayout: "scroll", selectionMenu: DEFAULT_SELECTION_MENU,
  textColors: STARTER_TEXT_COLORS, highlightColors: STARTER_HIGHLIGHT_COLORS, namedStyles: DEFAULT_NAMED_STYLES,
};
export const FORMATTING_KEYS = Object.keys(DEFAULT_FORMATTING);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hex = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const name = (value) => {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return;
  const trimmed = value.trim();
  return isSafeId(trimmed) && trimmed.length <= 40 ? trimmed : undefined;
};
const nullableColor = (value) => value === null || hex(value);

function colorEntry(entry) {
  if (!object(entry) || !hex(entry.color) || !name(entry.name) ||
      typeof entry.hidden !== "boolean" || typeof entry.custom !== "boolean") return;
  return { color: entry.color.toLowerCase(), name: name(entry.name), hidden: entry.hidden, custom: entry.custom };
}
function namedStyle(entry) {
  if (!object(entry) || !isSafeId(entry.id) || !name(entry.name) || !object(entry.look)) return;
  const look = entry.look;
  if (["bold", "italic", "underline", "strike"].some((key) => typeof look[key] !== "boolean") ||
      !nullableColor(look.color) || !nullableColor(look.highlight) ||
      !(look.fontSize === null || typeof look.fontSize === "string" && /^(?:[6-9]|[1-6]\d|7[0-2])pt$/.test(look.fontSize)) ||
      ![null, "serif", "sans-serif", "monospace"].includes(look.fontFamily) ||
      ![null, "paragraph", "h1", "h2", "h3"].includes(entry.block) ||
      ![null, "1", "1.15", "1.5", "2"].includes(entry.lineHeight)) return;
  return { id: entry.id, name: name(entry.name), look: {
    bold: look.bold, italic: look.italic, underline: look.underline, strike: look.strike,
    color: look.color?.toLowerCase() ?? null, highlight: look.highlight?.toLowerCase() ?? null,
    fontSize: look.fontSize, fontFamily: look.fontFamily,
  }, block: entry.block, lineHeight: entry.lineHeight };
}

export function sanitizePreference(key, input) {
  const warnings = [];
  const warn = (reason) => warnings.push(`Preference ${key}: ${reason}.`);
  if (!FORMATTING_KEYS.includes(key)) return { value: undefined, warnings: [`Preference ${key} is not recognised and will be ignored.`] };
  if (input === undefined) return { value: undefined, warnings };
  if (key === "toolbarLayout") {
    if (["scroll", "rows", "more"].includes(input)) return { value: input, warnings };
    warn("invalid layout; using the default");
    return { value: undefined, warnings };
  }
  if (!Array.isArray(input)) {
    warn("expected a list; using the default");
    return { value: undefined, warnings };
  }
  const limit = { toolbar: 100, selectionMenu: 40, textColors: 60, highlightColors: 60, namedStyles: 50 }[key];
  const seen = new Set();
  const value = [];
  for (const entry of input) {
    const clean = key === "namedStyles" ? namedStyle(entry) : key.endsWith("Colors") ? colorEntry(entry)
      : isSafeId(entry) && entry.length <= 100 ? entry : undefined;
    if (clean === undefined) { warn("invalid entry ignored"); continue; }
    const unique = key === "namedStyles" ? clean.id : key.endsWith("Colors") ? clean.color : null;
    if (unique !== null && seen.has(unique)) { warn("duplicate entry ignored"); continue; }
    if (unique !== null) seen.add(unique);
    value.push(clean);
  }
  if (value.length > limit) { value.length = limit; warn(`only the first ${limit} entries kept`); }
  // An explicitly empty list is a customisation; an entirely invalid list uses the default.
  return { value: input.length && !value.length ? undefined : value, warnings };
}

export function resolveFormatting(prefs) {
  return Object.fromEntries(FORMATTING_KEYS.map((key) => {
    let value;
    try {
      const result = sanitizePreference(key, prefs?.[key]);
      value = result.value;
      if (result.warnings.length) console.warn(result.warnings.join(" "));
    } catch {
      console.warn(`Preference ${key}: could not read the value; using the default.`);
    }
    return [key, value ?? structuredClone(DEFAULT_FORMATTING[key])];
  }));
}
