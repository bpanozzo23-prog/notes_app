import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_TOOLBAR, DEFAULT_SELECTION_MENU } from "./actions.js";
import { DEFAULT_FORMATTING, DEFAULT_NAMED_STYLES, FORMATTING_KEYS, STARTER_TEXT_COLORS, STARTER_HIGHLIGHT_COLORS, sanitizePreference, resolveFormatting } from "./formatting.js";

afterEach(() => vi.restoreAllMocks());
const color = (extra = {}) => ({ color: "#ABCDEF", name: "  Sky  ", hidden: false, custom: true, ...extra });
const style = (extra = {}) => ({ ...structuredClone(DEFAULT_NAMED_STYLES[0]), ...extra });
const sanitize = (key, value) => sanitizePreference(key, value);

it("fills all defaults without writing preferences and returns independent values", () => {
  expect(resolveFormatting({})).toEqual(DEFAULT_FORMATTING);
  expect(resolveFormatting(null)).toEqual(DEFAULT_FORMATTING);
  expect(resolveFormatting({}).toolbar).toEqual(DEFAULT_TOOLBAR);
  expect(resolveFormatting({}).selectionMenu).toEqual(DEFAULT_SELECTION_MENU);
  const first = resolveFormatting({});
  first.namedStyles[0].look.bold = false;
  expect(resolveFormatting({}).namedStyles[0].look.bold).toBe(true);
  for (const key of FORMATTING_KEYS) expect(sanitize(key, undefined)).toEqual({ value: undefined, warnings: [] });
});

function contrast(hex, background = "#ffffff") {
  const luminance = (value) => {
    const rgb = value.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const values = [luminance(hex), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
it("starts with the legacy four text colours and provides accessible starter palettes", () => {
  expect(STARTER_TEXT_COLORS).toHaveLength(12);
  expect(STARTER_TEXT_COLORS.slice(0, 4).map((entry) => entry.color)).toEqual(["#dc2626", "#15803d", "#2563eb", "#7c3aed"]);
  for (const entry of STARTER_TEXT_COLORS) expect(contrast(entry.color)).toBeGreaterThanOrEqual(4.5);
  expect(STARTER_HIGHLIGHT_COLORS).toHaveLength(8);
  expect(STARTER_HIGHLIGHT_COLORS[0].name).toBe("Yellow");
  for (const entry of STARTER_HIGHLIGHT_COLORS) expect(contrast(entry.color, "#111827")).toBeGreaterThanOrEqual(4.5);
  for (const entry of [...STARTER_TEXT_COLORS, ...STARTER_HIGHLIGHT_COLORS]) expect(entry).toMatchObject({ hidden: false, custom: false });
});

it.each(FORMATTING_KEYS)("uses the default for an invalid %s value and warns once on read", (key) => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const result = sanitize(key, null);
  expect(result.value).toBeUndefined();
  expect(result.warnings.length).toBeGreaterThan(0);
  expect(resolveFormatting({ [key]: null })[key]).toEqual(DEFAULT_FORMATTING[key]);
  expect(warn).toHaveBeenCalledTimes(1);
});
it.each(["scroll", "rows", "more"])("keeps toolbar layout %s", (value) => {
  expect(sanitize("toolbarLayout", value)).toEqual({ value, warnings: [] });
});
it.each(["toolbar", "selectionMenu"])("keeps safe unknown and duplicate %s ids; drops unsafe entries individually", (key) => {
  const ids = ["bold", "future:action", "constructor", "bold", "x".repeat(100)];
  expect(sanitize(key, [...ids, 3, null, " ", "bad\n", "bad\u007f", "x".repeat(101)]).value).toEqual(ids);
  expect(sanitize(key, [null]).value).toBeUndefined();
});
it.each([["toolbar", 100], ["selectionMenu", 40], ["textColors", 60], ["highlightColors", 60], ["namedStyles", 50]])(
  "limits %s to %i usable entries, with a warning", (key, limit) => {
    const entries = Array.from({ length: limit + 1 }, (_, i) => key === "namedStyles" ? style({ id: `style-${i}` })
      : key.endsWith("Colors") ? color({ color: `#${i.toString(16).padStart(6, "0")}` }) : `action-${i}`);
    const result = sanitize(key, entries);
    expect(result.value).toHaveLength(limit);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(`first ${limit}`);
    expect(sanitize(key, [])).toEqual({ value: [], warnings: [] });
  });

it.each(["textColors", "highlightColors"])("normalises %s, trims names, removes extras and keeps the first duplicate colour", (key) => {
  const result = sanitize(key, [color({ extra: "ignored" }), color({ color: "#abcdef", name: "Duplicate" }), color({ color: "#123456" })]);
  expect(result.value).toEqual([color({ color: "#abcdef", name: "Sky" }), color({ color: "#123456", name: "Sky" })]);
  expect(result.warnings).toHaveLength(1);
});
it("measures the 40-character name limit after trimming", () => {
  const padded = `${" ".repeat(600)}${"x".repeat(40)} `;
  expect(sanitize("textColors", [color({ name: padded })]).value[0].name).toBe("x".repeat(40));
  expect(sanitize("namedStyles", [style({ name: padded })]).value[0].name).toBe("x".repeat(40));
});
it.each([
  null, [], {}, color({ color: "#abc" }), color({ color: "red" }), color({ color: null }),
  color({ hidden: 1 }), color({ custom: undefined }), color({ name: "" }), color({ name: " " }),
  color({ name: "a".repeat(41) }), color({ name: "bad\n" }), color({ name: "bad\u0085" }), color({ name: 1 }),
])("drops an invalid palette entry %j without losing its neighbour", (invalid) => {
  const result = sanitize("textColors", [invalid, color()]);
  expect(result.value).toEqual([color({ color: "#abcdef", name: "Sky" })]);
  expect(result.warnings.length).toBeGreaterThan(0);
});

it("normalises style colours and names, strips unknown fields and keeps the first id", () => {
  const first = style({ name: "  Heading  ", extra: 3 });
  first.look.color = "#AABBCC"; first.look.highlight = "#DDEEFF"; first.look.extra = true;
  const result = sanitize("namedStyles", [first, style(), style({ id: "second" })]);
  expect(result.value).toEqual([style({ look: { ...style().look, color: "#aabbcc", highlight: "#ddeeff" } }), style({ id: "second" })]);
  expect(result.warnings).toHaveLength(1);
});
it.each([
  ["id", ""], ["id", "bad\n"], ["id", "x".repeat(513)], ["name", " "], ["name", "x".repeat(41)], ["look", null],
  ["block", "h4"], ["block", undefined], ["lineHeight", "1.2"], ["lineHeight", 1],
])("rejects a style's invalid %s=%j", (key, value) => {
  expect(sanitize("namedStyles", [style({ [key]: value })]).value).toBeUndefined();
});
it.each([
  ["bold", 1], ["italic", undefined], ["underline", null], ["strike", "false"], ["color", "red"], ["highlight", "#abc"],
  ["fontSize", "5pt"], ["fontSize", "73pt"], ["fontSize", "17.5pt"], ["fontSize", "17px"], ["fontSize", "06pt"],
  ["fontFamily", "Arial"], ["fontFamily", undefined],
])("rejects an invalid look %s=%j", (key, value) => {
  const entry = style(); entry.look[key] = value;
  expect(sanitize("namedStyles", [entry]).value).toBeUndefined();
});
it("accepts every allowed style block, line height, typeface and size boundary", () => {
  for (const block of [null, "paragraph", "h1", "h2", "h3"]) for (const lineHeight of [null, "1", "1.15", "1.5", "2"])
    for (const fontFamily of [null, "serif", "sans-serif", "monospace"]) for (const fontSize of [null, "6pt", "9pt", "10pt", "69pt", "70pt", "72pt"]) {
      const entry = style({ block, lineHeight }); Object.assign(entry.look, { fontFamily, fontSize, color: null, highlight: null });
      expect(sanitize("namedStyles", [entry])).toEqual({ value: [entry], warnings: [] });
    }
});
it("never throws on an unreadable stored key, warns once per invalid key, and preserves good neighbours", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const prefs = { toolbar: ["bold", null, 1], selectionMenu: [false], toolbarLayout: "rows", get namedStyles() { throw new Error("Unreadable"); } };
  expect(resolveFormatting(prefs)).toEqual({ ...DEFAULT_FORMATTING, toolbar: ["bold"], toolbarLayout: "rows" });
  expect(warn).toHaveBeenCalledTimes(3);
  expect(sanitize("constructor", "x")).toEqual({ value: undefined, warnings: ["Preference constructor is not recognised and will be ignored."] });
});
