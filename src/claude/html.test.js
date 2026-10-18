import { expect, it } from "vitest";
import { SUPPORTED_HTML_SAMPLES } from "../editor/extensions.js";
import { extractNoteLinks } from "../lib/text.js";
import { toClaudeHtml, fromClaudeHtml, normalizeBody, parseBody, serializeBody } from "./html.js";
it.each(SUPPORTED_HTML_SAMPLES)("round trips supported editor HTML: %s", (html) => {
  const noteHandles = new Map(extractNoteLinks(html).map((id, index) => [id, `N${index + 1}`]));
  const outgoing = toClaudeHtml(html, { noteHandles });
  expect(fromClaudeHtml(outgoing.html, { ...outgoing, noteHandles }).html).toBe(normalizeBody(html));
});
it("issues one image handle per distinct id in document order", () => {
  const result = toClaudeHtml('<img data-file="b"><img data-file="a"><img data-file="b">', { noteHandles: new Map() });
  expect([...result.imageHandles]).toEqual([["b", "I1"], ["a", "I2"]]);
  expect(result.html.match(/I1/g)).toHaveLength(2);
});
it("drops unknown images, raw ids, unsafe protocols and scripts, keeps table text, and resets link defaults", () => {
  const result = fromClaudeHtml('<img src="https://evil.test/x"><img data-file="real-id"><img data-file="I404"><p><a href="note:raw-id">Raw</a> <a href="note:N1" class="x" target="_self" rel="opener">Known</a><a href="javascript:alert(1)">Bad</a></p><script>alert(1)</script><table><tr><td>Table text</td></tr></table>', { imageHandles: new Map([["real-id", "I1"]]), noteHandles: new Map([["real-note", "N1"]]) });
  expect(result.html).not.toMatch(/<img|src=|javascript|script|alert\(1\)|<table|class="x"|_self|opener"/);
  expect(result.html).toContain('href="note:real-note"'); expect(result.html).toContain("Raw"); expect(result.html).toContain("Table text");
  expect(result.report.filter((item) => item.type === "removed-image")).toHaveLength(2);
  expect(result.report.filter((item) => item.type === "removed-note-link")).toHaveLength(1);
});
it("normalises nested callouts to a schema-valid document or refuses them", () => {
  const input = '<div data-callout="note"><div data-callout="tip"><p>Nested</p></div></div>';
  const result = fromClaudeHtml(input, { imageHandles: new Map(), noteHandles: new Map() });
  expect(serializeBody(parseBody(result.html))).toBe(result.html);
});
it("does not let a removed image leave an invalid empty callout", () => {
  expect(() => fromClaudeHtml('<div data-callout="tip"><img data-file="I404"></div>', { imageHandles: new Map(), noteHandles: new Map() })).toThrow();
});

// Opening a note must never rewrite what Claude's change saved (that would look like an edit
// and make a clean Undo impossible). The editor's first transaction is the reference.
it("normalises whole bodies exactly as the editor stores them", async () => {
  const { Editor } = await import("@tiptap/core");
  const { SUPPORTED_HTML_SAMPLES, extensions: editorExtensions } = await import("../editor/extensions.js");
  const sample = JSON.parse((await import("node:fs")).readFileSync("public/sample-notebook.json", "utf8"));
  const bodies = [...SUPPORTED_HTML_SAMPLES, SUPPORTED_HTML_SAMPLES.join(""), ...sample.notes.map((note) => note.html),
    "<p>a</p><ul><li><p>b</p></li></ul>", "<h2>t</h2>", "<p>a</p><hr>", "<blockquote><p>q</p></blockquote>", '<div data-callout="tip"><p>x</p></div>'];
  for (const html of bodies) {
    const editor = new Editor({ element: document.createElement("div"), extensions: editorExtensions, content: html });
    editor.view.dispatch(editor.state.tr);
    expect(normalizeBody(html), html).toBe(editor.getHTML());
    editor.destroy();
  }
});
