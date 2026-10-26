import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { Editor } from "@tiptap/core";
import { extensions } from "./extensions.js";
import { documentRanges, revealSearchMatch, searchState, setSearch } from "./nodes/SearchHighlight.js";
import { queryWords } from "../lib/searchMatch.js";
import { SaveQueue } from "../lib/saveQueue.js";
import { createNote, getNote, updateNote } from "../db/notes.js";
import { resetDatabase } from "../test/fixtures.js";

const editors = [];
function make(content, options = {}) {
  const element = document.body.appendChild(document.createElement("div"));
  const editor = new Editor({ element, extensions, content, ...options });
  editors.push(editor);
  return editor;
}
beforeEach(resetDatabase);
afterEach(() => { editors.splice(0).forEach((editor) => { editor.view.dom.parentElement?.remove(); editor.destroy(); }); vi.restoreAllMocks(); });

it.each(["<ul><li><p>match</p></li></ul>", "<h2>match</h2>", '<div data-callout="note"><p>match</p></div>'])("search never dispatches, updates, queues or stores changes: %s", async (html) => {
  const note = await createNote({ html }), save = vi.fn(updateNote), queue = new SaveQueue({ save });
  queue.setKnownRev(note.id, note.rev);
  const onUpdate = vi.fn(({ editor }) => queue.schedule(note.id, { html: editor.getHTML() }));
  const editor = make(html, { onUpdate }), original = editor.getHTML(), selection = editor.state.selection;
  const dispatch = vi.spyOn(editor.view, "dispatch");
  setSearch(editor, "match");
  expect(editor.view.dom.querySelector(".search-match-current").textContent).toBe("match");
  setSearch(editor, "match", 0);
  setSearch(editor, "");
  expect(editor.view.dom.querySelector(".search-match")).toBeNull();
  expect(editor.getHTML()).toBe(original);
  expect(editor.state.selection).toBe(selection);
  expect(dispatch).not.toHaveBeenCalled();
  expect(onUpdate).not.toHaveBeenCalled();
  expect(queue.status).toBe("idle");
  await queue.flush();
  expect(save).not.toHaveBeenCalled();
  expect(await getNote(note.id)).toEqual(note);
});
it("matches across bold and links, never across blocks, hard breaks or inline atoms", () => {
  const editor = make('<p>ca<strong>fé</strong> ni<a href="https://example.com">ño</a></p><p>ca<br>fe</p><p>ca</p><p>fe</p>');
  const ranges = documentRanges(editor.state.doc, queryWords("cafe nino"));
  expect(ranges.map(({ from, to }) => editor.state.doc.textBetween(from, to))).toEqual(["café", "niño"]);
  // The application's image is a block atom, also a boundary.
  const image = make('<p>ca</p><img data-file="fixture"><p>fe</p>');
  expect(documentRanges(image.state.doc, ["cafe"])).toEqual([]);
  const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" }, atom: { inline: true, group: "inline", atom: true } } });
  const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("ca"), schema.node("atom"), schema.text("fe")])]);
  expect(documentRanges(doc, ["cafe"])).toEqual([]);
});
it("recomputes marks on edits and keeps the cache on a redraw", () => {
  const editor = make("<p>cat dog cat</p>");
  setSearch(editor, "cat", 1);
  const ranges = searchState(editor).ranges;
  editor.view.setProps({});
  expect(searchState(editor).ranges).toBe(ranges);
  editor.commands.insertContentAt(1, "cat ");
  expect(searchState(editor).ranges).toHaveLength(3);
  expect(editor.view.dom.querySelectorAll(".search-match")).toHaveLength(3);
  editor.commands.setContent("<p>none</p>");
  expect(searchState(editor).ranges).toHaveLength(0);
  expect(editor.view.dom.querySelector(".search-match")).toBeNull();
});
const folded = '<ul><li data-collapsed="true"><p>visible</p><ul><li data-collapsed="true"><p>middle</p><ul><li><p>deep</p></li></ul></li></ul></li><li data-collapsed="true"><p>unrelated</p><p>other</p></li></ul><p>End</p>';
it("opens only hiding ancestors through nested folds, never the visible first line", () => {
  const editor = make(folded), selection = editor.state.selection;
  setSearch(editor, "visible");
  expect(revealSearchMatch(editor, searchState(editor).ranges[0], true)).toBe(false);
  expect(editor.getHTML()).toBe(folded);
  setSearch(editor, "deep");
  revealSearchMatch(editor, searchState(editor).ranges[0], true);
  expect(editor.view.dom.querySelectorAll('[data-collapsed="true"]')).toHaveLength(1);
  expect(editor.view.dom.querySelector('[data-collapsed="true"]').textContent).toContain("unrelated");
  expect(editor.state.selection.eq(selection)).toBe(true);
});
it.each(["locked", "read-only"])("never unfolds when %s", (kind) => {
  const editor = make(folded, { editable: kind !== "read-only" });
  setSearch(editor, "deep");
  expect(revealSearchMatch(editor, searchState(editor).ranges[0], false)).toBe(kind === "locked");
  expect(editor.getHTML()).toBe(folded);
});
it("keeps checklist ticks and saves unfolding with a new revision but unchanged Edited", async () => {
  const html = '<ul data-type="taskList"><li data-type="taskItem" data-checked="true" data-collapsed="true"><p>Parent</p><p>match</p></li></ul><p>End</p>';
  const editor = make(html);
  const note = await createNote({ html: editor.getHTML() });
  const queue = new SaveQueue({ save: updateNote });
  queue.setKnownRev(note.id, note.rev);
  editor.on("update", () => queue.schedule(note.id, { html: editor.getHTML() }));
  setSearch(editor, "match");
  revealSearchMatch(editor, searchState(editor).ranges[0], true);
  await queue.flush();
  expect(editor.state.doc.firstChild.firstChild.attrs.checked).toBe(true);
  expect(await getNote(note.id)).toMatchObject({ rev: note.rev + 1, updatedAt: note.updatedAt });
});

it.each(["", "<h2>Last heading</h2>"])("unfolding never appends a trailing paragraph or moves Edited (ending %s)", async (ending) => {
  const html = '<ul><li data-collapsed="true"><p>Parent</p><p>match</p></li></ul>' + ending;
  const editor = make(html), note = await createNote({ html: editor.getHTML() });
  const queue = new SaveQueue({ save: updateNote });
  queue.setKnownRev(note.id, note.rev);
  editor.on("update", () => queue.schedule(note.id, { html: editor.getHTML() }));
  setSearch(editor, "match");
  revealSearchMatch(editor, searchState(editor).ranges[0], true);
  expect(editor.getHTML()).toBe(html.replace(' data-collapsed="true"', ""));
  await queue.flush();
  expect(await getNote(note.id)).toMatchObject({ rev: note.rev + 1, updatedAt: note.updatedAt });
});

const headingFolds = '<h1 data-collapsed="true">Outer</h1><div data-callout="note"><h2 data-collapsed="true">Middle</h2><ul><li data-collapsed="true"><p>List</p><h3 data-collapsed="true">Inner</h3><p>match</p></li></ul></div><h1 data-collapsed="true">Unrelated</h1><p>Elsewhere</p>';
it("reveals a search through nested heading and list folds without touching unrelated folds", () => {
  const editor = make(headingFolds), selection = editor.state.selection;
  setSearch(editor, "match"); revealSearchMatch(editor, searchState(editor).ranges[0], true);
  expect(editor.getHTML()).toBe(headingFolds.replaceAll(' data-collapsed="true"', '').replace('<h1>Unrelated', '<h1 data-collapsed="true">Unrelated'));
  expect(editor.state.selection.eq(selection)).toBe(true);
  expect(editor.view.dom.querySelector('.search-match-current').closest('.fold-hidden')).toBeNull();
});
it.each(["locked", "read-only"])("leaves heading folds untouched when %s", (kind) => {
  const editor = make(headingFolds, { editable: kind !== "read-only" }); setSearch(editor, "match");
  expect(revealSearchMatch(editor, searchState(editor).ranges[0], false)).toBe(kind === "locked");
  expect(editor.getHTML()).toBe(headingFolds);
});
