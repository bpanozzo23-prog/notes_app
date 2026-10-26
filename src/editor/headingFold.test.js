import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import Heading from "@tiptap/extension-heading";
import { Editor } from "@tiptap/core";
import { AllSelection, NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import { undo, redo } from "@tiptap/pm/history";
import { extensions, SUPPORTED_HTML_SAMPLES } from "./extensions.js";
import { headingSections, hidingHeadings, toggleHeading, foldAllHeadings } from "./nodes/HeadingFold.js";
import { toggleCollapsed } from "./nodes/Collapsible.js";
import { FOLD_META } from "./nodes/fold.js";
import { applyBlockType } from "./blockType.js";
import { applyLook, EMPTY_LOOK } from "./look.js";
import { SaveQueue } from "../lib/saveQueue.js";
import { createNote, getNote, updateNote } from "../db/notes.js";
import { resetDatabase } from "../test/fixtures.js";

const editors = [];
function make(content, options = {}) {
  const element = document.body.appendChild(document.createElement("div"));
  const editor = new Editor({ element, extensions, content, ...options });
  editors.push(editor); return editor;
}
beforeEach(resetDatabase);
afterEach(() => { editors.splice(0).forEach((editor) => { editor.view.dom.parentElement?.remove(); editor.destroy(); }); vi.restoreAllMocks(); vi.useRealTimers(); });
const pos = (editor, text, offset = 0) => {
  let found;
  editor.state.doc.descendants((node, at) => { if (found === undefined && node.isText && node.text.includes(text)) found = at + node.text.indexOf(text) + offset; });
  if (found === undefined) throw new Error(`Missing ${text}`);
  return found;
};
const put = (editor, text, offset = 0) => editor.commands.setTextSelection(pos(editor, text, offset));
const section = (editor, text) => headingSections(editor.state.doc).find(({ node }) => node.textContent === text);
const toggle = (editor, text = "Title") => toggleHeading(editor.view, section(editor, text).pos);
const folded = (editor, text = "Title") => section(editor, text).node.attrs.collapsed;
const key = (editor, key) => editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, new KeyboardEvent("keydown", { key })));
const BASIC = '<h2>Title</h2><p>Hidden words</p><h2>Next</h2><p>Visible words</p>';

it.each([1, 2, 3])("H%s saves only true and leaves unfolded HTML byte-identical", (level) => {
  const html = `<h${level} style="line-height: 1.5;"><span style="font-size: 24pt;"><strong>Title</strong></span></h${level}><p>Body</p>`;
  const editor = make(html);
  expect(editor.getHTML()).toBe(html);
  toggle(editor);
  const saved = editor.getHTML();
  expect(saved).toContain('data-collapsed="true"');
  expect(make(saved).getHTML()).toBe(saved);
  toggle(editor); expect(editor.getHTML()).toBe(html);
});
it.each(['<h2 data-collapsed="true">Title</h2>', '<h2 data-collapsed="true">Title</h2><p>Body</p>', '<h2 data-collapsed="true">Title</h2><h1>Next</h1>'])("opening leaves folds and stale marks untouched: %s", (html) => {
  const onUpdate = vi.fn(), editor = make(html, { onUpdate });
  expect(editor.getHTML()).toBe(html); expect(onUpdate).not.toHaveBeenCalled();
});

it.each([1, 2, 3])("sections stop at same-or-bigger headings (H%s)", (level) => {
  const editor = make(`<h${level}>Title</h${level}><p>A</p><hr><h3>Small</h3><p>B</p><h${level}>Same</h${level}><p>C</p><h1>Big</h1><p>D</p>`);
  const s = section(editor, "Title");
  expect(s.blocks.map(({ node }) => node.type.name)).toEqual(level === 3 ? ["paragraph", "horizontalRule"] : ["paragraph", "horizontalRule", "heading", "paragraph"]);
  expect(s.to).toBe(section(editor, level === 3 ? "Small" : "Same").pos);
});
it.each([
  ["callout", (html) => `<div data-callout="note">${html}</div>`],
  ["bullet", (html) => `<ul><li><p>Lead</p>${html}</li><li><p>Outside item</p></li></ul>`],
  ["numbered", (html) => `<ol><li><p>Lead</p>${html}</li></ol>`],
  ["task", (html) => `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Lead</p>${html}</li></ul>`],
  ["quote", (html) => `<blockquote>${html}</blockquote>`],
])("stops at the end of its %s parent", (_kind, wrap) => {
  const editor = make(wrap('<h2>Title</h2><p>Inside</p>') + '<p>Outside</p>');
  toggle(editor);
  expect(hidingHeadings(editor.state.doc.resolve(pos(editor, "Inside")))).toHaveLength(1);
  expect(hidingHeadings(editor.state.doc.resolve(pos(editor, "Outside")))).toHaveLength(0);
});

it("shows no controls without a section, and removes all UI and hiding when read-only", () => {
  const editor = make('<h2>Alone</h2><h1>Last</h1>');
  expect(editor.view.dom.querySelector("button")).toBeNull();
  expect(foldAllHeadings(editor.view, true)).toBe(false);
  const full = make(BASIC); toggle(full);
  const button = full.view.dom.querySelector("button");
  expect(full.view.dom.querySelector(".heading-fold-marker").getAttribute("aria-hidden")).toBe("true");
  full.setEditable(false);
  expect(full.view.dom.querySelector("button, .heading-fold-marker, .fold-hidden")).toBeNull();
  fireEvent.click(button); expect(folded(full)).toBe(true);
  expect(foldAllHeadings(full.view, false)).toBe(false);
  full.setEditable(true); expect(full.view.dom.querySelector(".heading-fold-marker")).not.toBeNull();
  const readonly = make(full.getHTML(), { editable: false });
  expect(readonly.view.dom.querySelector("button, .fold-hidden")).toBeNull();
});
it("keeps hN and contentDOM across toggles and typing; taps never focus or cancel touchstart", () => {
  const editor = make(BASIC), heading = editor.view.dom.querySelector("h2"), wrap = heading.parentElement, button = wrap.querySelector("button");
  // The text sits directly in the <hN>, as in a stock heading; the button is beside it.
  expect(wrap.classList.contains("heading-fold-wrap")).toBe(true); expect(heading.querySelector("button, span")).toBeNull();
  expect(fireEvent.pointerDown(button)).toBe(false); expect(fireEvent.mouseDown(button)).toBe(false); expect(fireEvent.touchStart(button)).toBe(true);
  fireEvent.click(button);
  expect(document.activeElement).not.toBe(editor.view.dom);
  put(editor, "Title", 5); editor.commands.insertContent("s");
  expect(editor.view.dom.querySelector("h2")).toBe(heading); expect(heading.parentElement).toBe(wrap);
  expect(heading.textContent).toBe("Titles"); expect(folded(editor, "Titles")).toBe(true);
  expect(wrap.classList.contains("heading-foldable")).toBe(true);
});
it("accepts composition-shaped DOM input in the heading text without replacing the heading", () => {
  const editor = make(BASIC), heading = editor.view.dom.querySelector("h2"), content = heading;
  put(editor, "Title", 5);
  fireEvent.compositionStart(content);
  content.firstChild.nodeValue = "Titleñ";
  fireEvent.input(content, { inputType: "insertCompositionText", data: "ñ", isComposing: true });
  editor.view.domObserver.flush();
  fireEvent.compositionEnd(content, { data: "ñ" }); editor.view.domObserver.flush();
  expect(editor.state.doc.firstChild.textContent).toBe("Titleñ");
  expect(editor.view.dom.querySelector("h2")).toBe(heading);
});
it("folds are not Undo steps, and typing Undo/Redo leaves the fold in place", () => {
  const editor = make(BASIC); put(editor, "Title", 5); editor.commands.insertContent("s"); toggle(editor, "Titles");
  undo(editor.state, editor.view.dispatch); expect(folded(editor)).toBe(true);
  redo(editor.state, editor.view.dispatch); expect(folded(editor, "Titles")).toBe(true);
});
it("moves a selection out of a newly folded section and opens for text or arrow-key selections", () => {
  const editor = make(BASIC); put(editor, "Hidden", 2); toggle(editor);
  expect(editor.state.selection.from).toBe(pos(editor, "Title", 5));
  // This is the selection produced by an arrow crossing the block boundary.
  editor.view.dispatch(editor.state.tr.setSelection(Selection.findFrom(editor.state.doc.resolve(section(editor, "Title").from), 1, true)));
  expect(folded(editor)).toBe(false);
  toggle(editor); put(editor, "Hidden", 3); expect(folded(editor)).toBe(false);
});
it("opens for a node selection on an image and on Undo into hidden content", () => {
  const editor = make('<h2>Title</h2><img data-file="fixture"><p>End</p>'); toggle(editor);
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, section(editor, "Title").from)));
  expect(folded(editor)).toBe(false);
  put(editor, "End"); editor.commands.insertContent("New "); toggle(editor);
  undo(editor.state, editor.view.dispatch); expect(folded(editor)).toBe(false);
  redo(editor.state, editor.view.dispatch); expect(editor.getText()).toContain("New End");
});
it("select-all deletion removes hidden content, and Undo restores it", () => {
  const editor = make(BASIC); toggle(editor);
  editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)).deleteSelection());
  expect(editor.getText()).toBe("");
  undo(editor.state, editor.view.dispatch); expect(editor.getText()).toContain("Hidden words");
});
it("Backspace joining a boundary heading into hidden text opens the fold", () => {
  const editor = make(BASIC); toggle(editor); put(editor, "Next"); key(editor, "Backspace");
  expect(folded(editor)).toBe(false); expect(editor.getText()).toContain("Hidden wordsNext");
});
it("opens on an edit inside hidden content and clears an emptied section", () => {
  const editor = make(BASIC); toggle(editor);
  editor.commands.insertContentAt(pos(editor, "Hidden"), "New "); expect(folded(editor)).toBe(false);
  toggle(editor);
  const { from, to } = section(editor, "Title"); editor.commands.deleteRange({ from, to });
  expect(folded(editor)).toBe(false); expect(section(editor, "Title").foldable).toBe(false);
});

it.each([0, 2, 5, "selection", "empty"])("Enter behaves normally after opening where needed (%s)", (at) => {
  const editor = make(at === "empty" ? BASIC.replace("Title", "") : BASIC);
  const heading = headingSections(editor.state.doc)[0]; toggleHeading(editor.view, heading.pos);
  const from = 1 + (typeof at === "number" ? at : at === "selection" ? 1 : 0);
  editor.commands.setTextSelection(at === "selection" ? { from, to: from + 2 } : from);
  expect(key(editor, "Enter")).toBe(true);
  expect(editor.getText()).toContain("Hidden words");
  const marks = headingSections(editor.state.doc).filter(({ node }) => node.attrs.collapsed);
  expect(marks).toHaveLength(at === 0 ? 1 : 0);
  if (at === 0) expect(editor.state.doc.firstChild.textContent).toBe("");
  if (at === 2) { expect(editor.state.doc.child(0).textContent).toBe("Ti"); expect(editor.state.doc.child(1).textContent).toBe("tle"); }
  if (at === 5) { expect(editor.state.doc.child(1).type.name).toBe("paragraph"); expect(editor.state.doc.child(2).textContent).toBe("Hidden words"); }
  if (at === "selection") { expect(editor.state.doc.child(0).textContent).toBe("T"); expect(editor.state.doc.child(1).textContent).toBe("le"); }
  undo(editor.state, editor.view.dispatch); expect(editor.getText()).toContain(at === "empty" ? "Hidden words" : "Title");
});
it("level changes recompute the section and a heading-tray block change shows its contents", () => {
  const editor = make('<h2>Title</h2><p>A</p><h3>Small</h3><p>B</p><h2>Next</h2><p>C</p>'); toggle(editor); put(editor, "Title");
  const tr = editor.state.tr; applyBlockType(tr, "h3"); editor.view.dispatch(tr);
  expect(section(editor, "Title").blocks).toHaveLength(1);
  const paragraph = editor.state.tr; applyBlockType(paragraph, "paragraph"); editor.view.dispatch(paragraph);
  expect(editor.view.dom.querySelector(".fold-hidden")).toBeNull();
});
it("named styles retain font size and line height inside contentDOM, and normal text clears folding", () => {
  const editor = make(BASIC); put(editor, "Title"); toggle(editor);
  applyLook(editor, { ...EMPTY_LOOK, bold: true, fontSize: "24pt" }, { block: "h2", lineHeight: "1.5" });
  const heading = editor.view.dom.querySelector("h2");
  expect(folded(editor)).toBe(true);
  expect(heading.style.lineHeight).toBe("1.5"); expect(heading.querySelector('[style*="font-size"]').style.fontSize).toBe("24pt");
  expect(editor.getHTML()).toContain('style="line-height: 1.5;"');
  applyLook(editor, EMPTY_LOOK, { block: "paragraph", lineHeight: null });
  expect(editor.view.dom.querySelector(".fold-hidden")).toBeNull();
});
it("nested folds keep their state and a hidden heading owns its hidden button", () => {
  const editor = make('<h1>Outer</h1><h2>Inner</h2><p>Deep</p><h1>End</h1>');
  toggle(editor, "Inner"); toggle(editor, "Outer");
  const inner = editor.view.dom.querySelector("h2").parentElement;
  expect(inner.classList.contains("fold-hidden")).toBe(true); expect(inner.querySelector("button")).not.toBeNull();
  // Typing into the outer heading must not strip the inner decoration class.
  put(editor, "Outer", 5); editor.commands.insertContent("s"); expect(inner.classList.contains("fold-hidden")).toBe(true);
  toggle(editor, "Outers"); expect(folded(editor, "Inner")).toBe(true);
  expect(inner.classList.contains("fold-hidden")).toBe(false);
});
it("decorates every sibling block type, including images and task lists", () => {
  const editor = make('<h1>Title</h1><p>P</p><ul><li><p>L</p></li></ul><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>T</p></li></ul><div data-callout="note"><p>C</p></div><hr><h2>Small</h2><img data-file="fixture"><p>End</p>');
  toggle(editor);
  const hidden = [...editor.view.dom.children].filter((el) => el.classList.contains("fold-hidden"));
  expect(hidden.map((el) => el.tagName)).toEqual(["P", "UL", "UL", "DIV", "HR", "DIV", "DIV", "P"]);
  expect(hidden[5].firstChild.tagName).toBe("H2");
  expect(hidden[6].classList.contains("note-image")).toBe(true);
});
it("Fold all uses one view transaction, keeps nested folds, and moves the cursor to the outer heading", () => {
  const editor = make('<h1>Outer</h1><h2>Inner</h2><p>Deep</p><h1>Last</h1>');
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos(editor, "Deep"))).setMeta("skipTrailingNode", true));
  const transactions = []; editor.on("transaction", ({ transaction }) => transactions.push(transaction));
  foldAllHeadings(editor.view, true);
  expect(transactions).toHaveLength(1); expect(transactions[0].getMeta(FOLD_META)).toBe(true);
  expect(transactions[0].getMeta("skipTrailingNode")).toBe(true); expect(transactions[0].getMeta("addToHistory")).toBe(false);
  expect(editor.state.selection.from).toBe(pos(editor, "Outer", 5));
  expect(headingSections(editor.state.doc).map(({ node }) => node.attrs.collapsed)).toEqual([true, true, false]);
  foldAllHeadings(editor.view, false); expect(editor.getHTML()).not.toContain("data-collapsed");
});
it("heading and list toggles never unfold each other, even inside each other's hidden ranges", () => {
  const editor = make('<h1>Outer</h1><ul><li data-collapsed="true"><p>List</p><h2>Inner</h2><p>Deep</p></li></ul><p>End</p>');
  toggle(editor, "Outer"); toggle(editor, "Inner");
  const listPos = section(editor, "Outer").from + 1;
  expect(editor.state.doc.nodeAt(listPos).attrs.collapsed).toBe(true);
  toggleCollapsed(editor.view, listPos); expect(folded(editor, "Outer")).toBe(true); expect(folded(editor, "Inner")).toBe(true);
  foldAllHeadings(editor.view, false); toggleCollapsed(editor.view, listPos); foldAllHeadings(editor.view, true);
  expect(editor.state.doc.nodeAt(listPos).attrs.collapsed).toBe(true);
});

describe("real save queue: exact HTML, revision and Edited", () => {
  it.each(["<p>Last</p>", "<ul><li><p>Last</p></li></ul>", "<h3>Last</h3>"])("toggle, unfold and Fold all with ending %s", async (ending) => {
    const html = '<h2>Title</h2><p>Body</p>' + ending;
    const note = await createNote({ html }), queue = new SaveQueue({ save: updateNote }); queue.setKnownRev(note.id, note.rev);
    const editor = make(html, { onUpdate: ({ editor }) => queue.schedule(note.id, { html: editor.getHTML() }) });
    vi.useFakeTimers({ toFake: ["Date"] });
    let rev = note.rev;
    for (const [action, folded] of [[() => toggle(editor), true], [() => toggle(editor), false], [() => foldAllHeadings(editor.view, true), true], [() => foldAllHeadings(editor.view, false), false]]) {
      vi.setSystemTime(Date.now() + 60000);
      action(); await queue.flush(); rev++;
      const expected = folded ? html.replace('<h2>', '<h2 data-collapsed="true">') : html;
      expect(editor.getHTML()).toBe(expected); expect(await getNote(note.id)).toMatchObject({ html: expected, rev, updatedAt: note.updatedAt });
    }
  });
});

it("saved HTML equals the stock heading renderer for every unfolded supported sample", () => {
  const baseline = extensions.filter((extension) => extension.name !== "headingFold").map((extension) => extension.name === "heading" ? Heading.configure({ levels: [1, 2, 3] }) : extension);
  for (const html of SUPPORTED_HTML_SAMPLES.filter((html) => !/<h[1-3] data-collapsed/.test(html))) {
    expect(make(html).getHTML()).toBe(make(html, { extensions: baseline }).getHTML());
  }
});

it("read-only selection can visit all section text without changing the saved fold", () => {
  const html = BASIC.replace('<h2>', '<h2 data-collapsed="true">'), onUpdate = vi.fn();
  const editor = make(html, { editable: false, onUpdate });
  put(editor, "Hidden"); expect(editor.getHTML()).toBe(html); expect(onUpdate).not.toHaveBeenCalled();
});
it("Fold all saves several nested headings in one revision without changing Edited", async () => {
  const html = '<h1>Outer</h1><h2>Inner</h2><p>Body</p><h1>Next</h1><ul><li><p>Last</p></li></ul>';
  const note = await createNote({ html }), queue = new SaveQueue({ save: updateNote }); queue.setKnownRev(note.id, note.rev);
  const editor = make(html, { onUpdate: ({ editor }) => queue.schedule(note.id, { html: editor.getHTML() }) });
  foldAllHeadings(editor.view, true); await queue.flush();
  const expected = html.replaceAll('<h1>', '<h1 data-collapsed="true">').replace('<h2>', '<h2 data-collapsed="true">');
  expect(editor.getHTML()).toBe(expected); expect(await getNote(note.id)).toMatchObject({ html: expected, rev: note.rev + 1, updatedAt: note.updatedAt });
});

it("appended heading and list normalisers share fold metadata and never append a paragraph", () => {
  const html = '<h1 data-collapsed="true">Title</h1><ul><li data-collapsed="true"><p>List</p><p>Deep</p></li></ul><h1>Last</h1>';
  const editor = make(html), appended = [];
  editor.on("transaction", ({ appendedTransactions }) => appended.push(...appendedTransactions));
  put(editor, "Deep");
  expect(editor.getHTML()).toBe(html.replaceAll(' data-collapsed="true"', ''));
  expect(appended).toHaveLength(2);
  for (const tr of appended) {
    expect(tr.getMeta(FOLD_META)).toBe(true); expect(tr.getMeta("addToHistory")).toBe(false); expect(tr.getMeta("skipTrailingNode")).toBe(true);
  }
});

it("Enter on a folded heading opens it and splits in one handled transaction", () => {
  const editor = make(BASIC); toggle(editor); editor.commands.setTextSelection(6);
  const dispatch = vi.spyOn(editor.view, "dispatch");
  expect(key(editor, "Enter")).toBe(true);
  // One dispatch: a separate opening dispatch broke Android Chrome's DOM-change Enter path.
  expect(dispatch).toHaveBeenCalledTimes(1);
  editor.commands.insertContent("New");
  expect(editor.getHTML()).toBe("<h2>Title</h2><p>New</p><p>Hidden words</p><h2>Next</h2><p>Visible words</p>");
  undo(editor.state, editor.view.dispatch);
  undo(editor.state, editor.view.dispatch);
  expect(editor.getHTML()).toBe('<h2 data-collapsed="true">Title</h2><p>Hidden words</p><h2>Next</h2><p>Visible words</p>');
});

it("Android Backspace after a folded section runs the editor's Backspace, joining into the hidden text", () => {
  const editor = make('<h2>Title</h2><p>Body</p><h2>Next</h2><p>End</p>'); toggle(editor);
  put(editor, "Next", 0);
  const event = new InputEvent("beforeinput", { inputType: "deleteContentBackward", bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(editor.getHTML()).toBe("<h2>Title</h2><p>BodyNext</p><p>End</p>");
  // Elsewhere the browser and ProseMirror keep handling Backspace as before.
  put(editor, "End", 0);
  const other = new InputEvent("beforeinput", { inputType: "deleteContentBackward", bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(other);
  expect(other.defaultPrevented).toBe(false);
});
it("the button takes the heading's own line spacing", () => {
  const editor = make('<h2 style="line-height: 2;">Title</h2><p>Body</p>');
  expect(editor.view.dom.querySelector(".heading-fold-toggle").style.lineHeight).toBe("2");
});
it("Android deletes that join a heading run the editor's own command", () => {
  const fire = (editor, inputType) => { const event = new InputEvent("beforeinput", { inputType, bubbles: true, cancelable: true }); editor.view.dom.dispatchEvent(event); return event.defaultPrevented; };
  let editor = make("<h2>Title</h2><p>Body</p><h2>Next</h2><p>End</p>"); put(editor, "Next", 0);
  expect(fire(editor, "deleteContentBackward")).toBe(true);
  expect(editor.getHTML()).toBe("<h2>Title</h2><p>BodyNext</p><p>End</p>");
  editor = make("<h2>Title</h2><p>Body</p><h2>Next</h2><p>End</p>"); put(editor, "Body", 4);
  expect(fire(editor, "deleteContentForward")).toBe(true);
  expect(editor.getHTML()).toBe("<h2>Title</h2><p>BodyNext</p><p>End</p>");
  editor = make("<h2>Title</h2><p>Body</p><h2>Next</h2><p>End</p>");
  editor.commands.setTextSelection({ from: pos(editor, "Body", 2), to: pos(editor, "Next", 2) });
  expect(fire(editor, "deleteContentBackward")).toBe(true);
  expect(editor.getHTML()).toBe("<h2>Title</h2><p>Boxt</p><p>End</p>");
  // Inside one line, or a non-cancellable (composing) delete, stays with the browser.
  put(editor, "Boxt", 2); expect(fire(editor, "deleteContentBackward")).toBe(false);
  editor = make("<h2>Title</h2><p>Body</p>"); put(editor, "Title", 0);
  expect(fire(editor, "deleteContentBackward")).toBe(false);
  const composing = new InputEvent("beforeinput", { inputType: "deleteContentBackward", bubbles: true, cancelable: false });
  editor = make("<h2>Title</h2><p>Body</p><h2>Next</h2><p>End</p>"); put(editor, "Next", 0); editor.view.dom.dispatchEvent(composing);
  expect(editor.getHTML()).toBe("<h2>Title</h2><p>Body</p><h2>Next</h2><p>End</p>");
});

