import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { SUPPORTED_HTML_SAMPLES } from "../editor/extensions.js";
import { noteFixture } from "../test/fixtures.js";
import { noteToClaudeText } from "./projection.js";

it.each(SUPPORTED_HTML_SAMPLES)("projects supported editor HTML: %s", (html) => {
  const text = noteToClaudeText(html);
  expect(text).toMatchSnapshot();
  expect(noteToClaudeText(html)).toBe(text);
  expect(text.split("\n").every((line) => line === line.trimEnd())).toBe(true);
});
it("keeps one annotation across differently marked link text and resolves live / Trash / missing titles", () => {
  const note = noteFixture({ title: "Target title" });
  const html = `<p><a href="note:${note.id}">my <strong>link</strong></a></p>`;
  expect(noteToClaudeText(html, new Map([[note.id, note]]))).toBe("my link [→ Target title]");
  expect(noteToClaudeText(html, () => ({ ...note, deletedAt: "2026-10-18" }))).toBe("my link [→ a deleted note]");
  expect(noteToClaudeText(html)).toBe("my link [→ a deleted note]");
});
it("preserves nested lists, multiple paragraphs, hard breaks, and quotes", () => {
  expect(noteToClaudeText('<ul><li><p>First<br>line</p><p>Second</p><ol><li><p>Nested</p><ul><li><p>Deep</p></li></ul></li></ol></li></ul><blockquote><p>Quote</p><p>Again</p></blockquote>'))
    .toBe('- First\n  line\n  Second\n  1. Nested\n    - Deep\n\n> Quote\n>\n> Again');
});
it("projects every sample note deterministically with resolved links", () => {
  const sample = JSON.parse(readFileSync(resolve(__dirname, '../../public/sample-notebook.json'), 'utf8'));
  const lookup = new Map(sample.notes.map((note) => [note.id, note]));
  const project = () => sample.notes.map((note) => ({ title: note.title, text: noteToClaudeText(note.html, lookup) }));
  expect(project()).toEqual(project()); expect(project()).toMatchSnapshot();
});
