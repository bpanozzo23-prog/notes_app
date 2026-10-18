import { afterEach, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { extensions } from "./extensions.js";
import { applyLook, captureLook, EMPTY_LOOK } from "./look.js";
import { resolveFormatting, sanitizePreference } from "./formatting.js";
import { resolveAction } from "./actions.js";

const editors = [];
const open = (content) => { const editor = new Editor({ extensions, content }); editors.push(editor); return editor; };
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
const green = { ...EMPTY_LOOK, bold: true, color: "#15803d", fontSize: "17pt" };
const position = (editor, text) => { let found; editor.state.doc.descendants((node, pos) => { if (node.isText && node.text.includes(text)) found = pos + node.text.indexOf(text); }); return found; };

it.each([false, true])("captures every look field from %s (selection vs cursor), dropping inline spacing", (cursor) => {
  const editor = open('<p><strong><em><u><s><mark data-color="#ABC"><span style="color: rgb(21,128,61); font-size: 22px; font-family: Georgia, serif, monospace; line-height: 2">Look</span></mark></s></u></em></strong></p>');
  editor.commands.setTextSelection(cursor ? 2 : { from: 1, to: 5 });
  const look = captureLook(editor.state);
  expect(look).toEqual({ bold: true, italic: true, underline: true, strike: true, color: "#15803d", highlight: "#aabbcc", fontSize: "17pt", fontFamily: "serif" });
  expect(sanitizePreference("namedStyles", [{ id: "fixture", name: "Fixture", look, block: null, lineHeight: null }]).warnings).toEqual([]);
});
it("prefers stored marks, including an explicitly empty stored mark set", () => {
  const editor = open('<p><strong>Bold</strong></p>');
  editor.commands.setTextSelection(2);
  editor.view.dispatch(editor.state.tr.setStoredMarks([editor.schema.marks.italic.create()]));
  expect(captureLook(editor.state)).toEqual({ ...EMPTY_LOOK, italic: true });
  editor.view.dispatch(editor.state.tr.setStoredMarks([]));
  expect(captureLook(editor.state)).toEqual(EMPTY_LOOK);
});
it.each([
  [{ color: "#ABCDEF", fontSize: "12.6pt", fontFamily: "Arial, sans-serif, serif" }, { color: "#abcdef", fontSize: "13pt", fontFamily: "sans-serif" }],
  [{ color: "#ABC", fontSize: "2px", fontFamily: "'monospace', serif" }, { color: "#aabbcc", fontSize: "6pt", fontFamily: "monospace" }],
  [{ fontSize: "200pt", backgroundColor: "rgb(253, 230, 138)" }, { fontSize: "72pt", highlight: "#fde68a" }],
  [{ fontSize: "200px" }, { fontSize: "72pt" }],
  [{ fontSize: "2pt" }, { fontSize: "6pt" }],
  [{ color: "red", fontSize: "1.2em", fontFamily: "Georgia", lineHeight: "2" }, {}],
  [{ fontSize: "100%", fontFamily: "not-serif, serif-like" }, {}],
])("normalises raw stored attributes %j", (attrs, expected) => {
  const editor = open("<p></p>");
  editor.view.dispatch(editor.state.tr.setStoredMarks([editor.schema.marks.textStyle.create(attrs)]));
  expect(captureLook(editor.state)).toEqual({ ...EMPTY_LOOK, ...expected });
});
it("plain highlights use yellow and override pasted span backgrounds", () => {
  const editor = open('<p><mark><span style="background-color: #bfdbfe">Word</span></mark></p>');
  editor.commands.setTextSelection(2);
  expect(captureLook(editor.state).highlight).toBe("#fde68a");
});
it("selection skips inline and block code and uses the first eligible text, or an empty look", () => {
  const editor = open('<pre><code>code</code></pre><p><code>inline</code><em>word</em><strong>last</strong></p>');
  editor.commands.selectAll();
  expect(captureLook(editor.state)).toEqual({ ...EMPTY_LOOK, italic: true });
  editor.commands.setTextSelection({ from: 1, to: position(editor, "word") });
  expect(captureLook(editor.state)).toEqual(EMPTY_LOOK);
});
it("styles only the selection, replacing marks but keeping links and its exact endpoints", () => {
  const editor = open('<p>Before <a href="https://example.com"><em><u><s><mark>word</mark></s></u></em></a> after</p>');
  const start = position(editor, "word");
  editor.commands.setTextSelection({ from: start + 4, to: start });
  const selection = editor.state.selection.toJSON();
  applyLook(editor, green);
  expect(editor.state.selection.toJSON()).toEqual(selection);
  expect(captureLook(editor.state)).toEqual(green);
  expect(editor.getHTML()).toContain('href="https://example.com"');
  expect(editor.getHTML()).not.toMatch(/<em>|<u>|<s>|<mark/);
  expect(editor.state.doc.firstChild.firstChild.marks).toEqual([]);
});
it("styles the whole cursor line while leaving other lines and its cursor unchanged", () => {
  const editor = open('<p><em>whole</em> line</p><p>other</p>');
  editor.commands.setTextSelection(3);
  applyLook(editor, green);
  expect(editor.state.selection.from).toBe(3);
  expect(editor.state.doc.firstChild.childCount).toBe(1);
  expect(editor.state.doc.firstChild.firstChild.marks.map((mark) => mark.type.name)).toEqual(["textStyle", "bold"]);
  expect(editor.state.doc.lastChild.firstChild.marks).toEqual([]);
});
it("sets an empty line's stored marks, block and spacing for the next typed text", () => {
  const editor = open('<p></p>');
  applyLook(editor, green, { block: "h2", lineHeight: "1.5" });
  expect(captureLook(editor.state)).toEqual(green);
  editor.commands.insertContent("Typed");
  expect(captureLook(editor.state)).toEqual(green);
  expect(editor.state.doc.firstChild.attrs).toMatchObject({ level: 2, lineHeight: "1.5" });
});
it.each(["2", null])("spacing %s preserves the bold green 17 pt look prepared for typing", (spacing) => {
  const editor = open('<p></p>');
  editor.chain().setBold().setColor("#15803d").setFontSize("17pt").setLineHeight("1.5").run();
  if (spacing === null) editor.commands.unsetLineSpacing();
  else editor.commands.setLineSpacing(spacing);
  editor.commands.insertContent("Typed");
  expect(captureLook(editor.state)).toEqual(green);
  expect(editor.state.doc.firstChild.attrs.lineHeight).toBe(spacing);
  expect(editor.state.doc.firstChild.firstChild.marks.find((mark) => mark.type.name === "textStyle").attrs.lineHeight).toBeNull();
});
it("leaves code entirely unchanged and styles eligible text on either side", () => {
  const editor = open('<p>left <code>inline</code> right</p><pre><code>block</code></pre><p>end</p>');
  editor.commands.selectAll();
  applyLook(editor, green, { block: "h3", lineHeight: "2" });
  expect(editor.getHTML()).toContain('<code>inline</code>');
  expect(editor.getHTML()).toContain('<pre><code>block</code></pre>');
  for (const text of ["left", "right", "end"]) {
    editor.commands.setTextSelection(position(editor, text) + 1);
    expect(captureLook(editor.state)).toEqual(green);
  }
});
it("skips an invalid list heading but applies marks and spacing; headings inside callouts work", () => {
  const editor = open('<ul><li><p>item</p><p>second</p></li></ul><div data-callout="note"><p>callout</p></div>');
  editor.commands.selectAll();
  applyLook(editor, green, { block: "h2", lineHeight: "1.5" });
  editor.state.doc.check();
  const listItem = editor.state.doc.firstChild.firstChild;
  expect(listItem.firstChild.type.name).toBe("paragraph");
  expect(listItem.firstChild.attrs.lineHeight).toBe("1.5");
  expect(listItem.child(1).type.name).toBe("heading");
  expect(editor.state.doc.child(1).firstChild.type.name).toBe("heading");
  editor.commands.setTextSelection(position(editor, "item") + 1);
  expect(captureLook(editor.state)).toEqual(green);
});
it("applies spacing to whole touched lines, removes legacy inline spacing and undoes everything once", () => {
  const editor = open('<p style="line-height: 2"><span style="line-height: 2; color: #dc2626">before chosen after</span></p><p>second</p>');
  editor.commands.setTextSelection({ from: position(editor, "chosen"), to: position(editor, "second") + 3 });
  const before = editor.getJSON(), selection = editor.state.selection.toJSON();
  let transactions = 0;
  editor.on("transaction", ({ transaction }) => { if (transaction.docChanged) transactions++; });
  applyLook(editor, { ...green, highlight: "#bfdbfe", fontFamily: "serif" }, { block: "h1", lineHeight: "1" });
  expect(transactions).toBe(1);
  expect(editor.state.selection.toJSON()).toEqual(selection);
  editor.state.doc.descendants((node) => {
    if (node.type.name === "heading") expect(node.attrs.lineHeight).toBe("1");
    for (const mark of node.marks) if (mark.type.name === "textStyle") expect(mark.attrs.lineHeight).toBeNull();
  });
  editor.commands.undo();
  expect(editor.getJSON()).toEqual(before);
});
it("omitted spacing leaves block spacing alone; an explicit Default clears it", () => {
  const editor = open('<h2 style="line-height: 2">word</h2>');
  applyLook(editor, green);
  expect(editor.state.doc.firstChild.attrs.lineHeight).toBe("2");
  applyLook(editor, green, { block: "paragraph", lineHeight: null });
  expect(editor.state.doc.firstChild.type.name).toBe("paragraph");
  expect(editor.state.doc.firstChild.attrs.lineHeight).toBeNull();
});
it("resolves and applies a named style snapshot, and skips a deleted id", () => {
  const formatting = resolveFormatting({});
  const editor = open('<p><em>word</em></p>');
  const style = formatting.namedStyles[0], action = resolveAction(`style:${style.id}`, formatting);
  expect(action.label).toBe(style.name);
  action.run({ editor });
  expect(captureLook(editor.state)).toEqual(style.look);
  expect(editor.state.doc.firstChild.attrs.level).toBe(2);
  formatting.namedStyles = [];
  expect(resolveAction(`style:${style.id}`, formatting)).toBeNull();
});
it("each style tap is its own undo event, separate from preceding typing", () => {
  const editor = open('<p>word</p>');
  editor.commands.setTextSelection(5);
  editor.commands.insertContent(" typed");
  const typed = editor.getJSON();
  applyLook(editor, green);
  const firstStyle = editor.getJSON();
  applyLook(editor, { ...EMPTY_LOOK, italic: true });
  editor.commands.undo();
  expect(editor.getJSON()).toEqual(firstStyle);
  editor.commands.undo();
  expect(editor.getJSON()).toEqual(typed);
  editor.commands.undo();
  expect(editor.getHTML()).toBe('<p>word</p>');
});
it("replaces marks on hard breaks too, and does nothing to a cursor in a code block", () => {
  const editor = open('<p><em>one<br>two</em></p><pre><code>code</code></pre>');
  editor.commands.setTextSelection({ from: 1, to: 8 });
  applyLook(editor, green);
  const br = editor.state.doc.firstChild.child(1);
  expect(br.type.name).toBe("hardBreak");
  expect(br.marks.some((mark) => mark.type.name === "bold")).toBe(true);
  expect(br.marks.some((mark) => mark.type.name === "italic")).toBe(false);
  editor.commands.setTextSelection(position(editor, "code") + 1);
  const before = editor.getJSON();
  applyLook(editor, green, { block: "h1", lineHeight: "2" });
  expect(editor.getJSON()).toEqual(before);
});
