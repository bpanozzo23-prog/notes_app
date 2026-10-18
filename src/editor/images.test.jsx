import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { extensions } from "./extensions.js";
import { createImageInserter, reserveImagePosition, imagePosition } from "./imageInsertion.js";
import { clearFileUrls } from "./fileUrls.js";
import { SaveQueue } from "../lib/saveQueue.js";
import { createNote, getNote, updateNote } from "../db/notes.js";
import { addImageFile, getFile } from "../db/files.js";
import { db } from "../db/db.js";
import { extractFileIds } from "../lib/text.js";
import { noteFixture, resetDatabase } from "../test/fixtures.js";
import { stubEditorGeometry } from "../test/editor.js";
import NoteEditor from "./NoteEditor.jsx";
import { ACTIONS, availableActions, DEFAULT_TOOLBAR } from "./actions.js";
import { OverlayNavigation } from "../lib/overlays.jsx";
import { DialogLock } from "../components/Dialog.jsx";

const editors = [], queues = [];
const open = (html = "<p>Before after</p>", onUpdate) => {
  const editor = new Editor({ extensions, content: html, ...(onUpdate ? { onUpdate } : {}) });
  editors.push(editor); stubEditorGeometry(editor); return editor;
};
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const image = () => ({ type: "image/png", bytes: new Uint8Array([1, 2, 3]).buffer, width: 480, height: 270 });
const queue = (save = vi.fn()) => { const q = new SaveQueue({ save }); queues.push(q); return q; };
beforeEach(resetDatabase);
afterEach(async () => { cleanup(); editors.splice(0).forEach((editor) => editor.destroy()); for (const q of queues.splice(0)) await q.flush(); clearFileUrls(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("round-trips all image attributes semantically and never serializes view URLs", async () => {
  const id = await addImageFile(image());
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:fixture"), revokeObjectURL: vi.fn() });
  const editor = open(`<p>Before</p><img data-file="${id}" width="480" height="270" alt="Example"><p>After</p>`);
  await waitFor(() => expect(editor.view.dom.querySelector("img").src).toBe("blob:fixture"));
  const html = editor.getHTML(); expect(html).not.toMatch(/src=|blob:/);
  const again = open(html); const node = again.state.doc.child(1);
  expect(node.type.name).toBe("image"); expect(node.attrs).toEqual({ file: id, width: 480, height: 270, alt: "Example" });
  expect(again.getHTML()).toBe(html); expect(editor.schema.nodes.image.spec.draggable).toBe(false);
});
it.each(['<img src="https://example.com/a.png">', '<img data-file="">', '<img data-file="bad&#10;id">', '<img data-file=" ">', `<img data-file="${"x".repeat(513)}">`])("drops unsafe or absent references: %s", (html) => {
  expect(open(html).getHTML()).not.toContain("img");
});
it("sanitizes dimensions and keeps missing-image nodes", async () => {
  const editor = open('<img data-file="missing" width="-2" height="2.5">');
  expect(editor.state.doc.firstChild.attrs).toEqual({ file: "missing", width: null, height: null, alt: "" });
  await waitFor(() => expect(editor.view.dom.textContent).toContain("Image not found"));
  expect(editor.getHTML()).toContain('data-file="missing"');
});
it.each(["files", "fileData"])("shows Image not found and preserves the image node when %s is missing", async (table) => {
  const id = await addImageFile(image());
  await db[table].delete(id);
  vi.stubGlobal("URL", { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });
  const editor = open(`<img data-file="${id}" width="480" height="270">`);
  await waitFor(() => expect(editor.view.dom.textContent).toContain("Image not found"));
  expect(editor.getHTML()).toContain(`data-file="${id}"`);
  expect(editor.state.doc.firstChild.attrs).toMatchObject({ file: id, width: 480, height: 270 });
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it("tracks processing, maps the placeholder through typing, writes bytes first and flushes the inserted HTML", async () => {
  const note = await createNote({ html: "<p>Before after</p>" }), q = queue(updateNote);
  const editor = open(note.html, ({ editor }) => q.schedule(note.id, { html: editor.getHTML() }));
  editor.commands.setTextSelection(8);
  const pending = deferred(), process = vi.fn(() => pending.promise);
  const store = vi.fn(async (image) => { expect(editor.getHTML()).not.toContain("<img"); return addImageFile(image); });
  const insert = createImageInserter({ editor, queue: q, process, store });
  const id = reserveImagePosition(editor);
  const operation = insert.insert([{}], id);
  editor.commands.insertContentAt(1, "Typed ");
  expect(imagePosition(editor, id)).toBe(14);
  expect(q.status).toBe("pending");
  let done = false; const flushing = q.flush().then(() => { done = true; });
  await Promise.resolve(); expect(done).toBe(false);
  pending.resolve(image()); await operation; await flushing;
  expect(store).toHaveBeenCalledOnce();
  expect(editor.getHTML()).toMatch(/<p>Typed Before <\/p><img.*<p>after<\/p>/);
  const saved = await getNote(note.id); expect(saved.html).toBe(editor.getHTML());
  expect(await getFile(extractFileIds(saved.html)[0])).toBeDefined(); expect(q.status).toBe("idle");
});
it("uses the end if the placeholder's spot was deleted, and inserts batches serially in order", async () => {
  const editor = open("<p>Erase me</p><p>Keep me</p>"), q = queue(), pending = deferred();
  editor.commands.setTextSelection(4);
  const process = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(image());
  let next = 0; const store = vi.fn(async () => `file-${++next}`);
  const insert = createImageInserter({ editor, queue: q, process, store });
  const first = insert.insert([{}, {}]); const second = insert.insert([{}]);
  await Promise.resolve(); expect(process).toHaveBeenCalledTimes(1);
  editor.commands.deleteRange({ from: 0, to: 10 });
  pending.resolve(image()); await first; await second;
  expect(extractFileIds(editor.getHTML())).toEqual(["file-1", "file-2", "file-3"]);
  expect(editor.getHTML().indexOf("Keep me")).toBeLessThan(editor.getHTML().indexOf("<img"));
  expect(editor.state.selection.empty).toBe(true);
  expect(editor.state.selection.from).toBeGreaterThan(editor.state.doc.content.size - 3);
});
it("reports each failed image, inserts no failed nodes, and continues the batch", async () => {
  const editor = open(), q = queue(), report = vi.fn();
  const process = vi.fn().mockRejectedValueOnce(new Error("This image is too large to add.")).mockResolvedValue(image());
  const store = vi.fn().mockRejectedValueOnce(Object.assign(new Error("Full"), { name: "QuotaExceededError" })).mockResolvedValueOnce("good");
  const insert = createImageInserter({ editor, queue: q, process, store, report });
  await insert.insert([{}, {}, {}]); await q.flush();
  expect(extractFileIds(editor.getHTML())).toEqual(["good"]);
  expect(report.mock.calls.flat()).toEqual(["This image is too large to add.", "There isn't enough storage space to add this image."]);
  expect(q.status).toBe("idle");
});
it.each(["destroy", "replace", "read-only"])("leaves a stored row unreferenced when %s interrupts processing", async (reason) => {
  const editor = open(), q = queue(), pending = deferred(); let allowed = true;
  const store = vi.fn(addImageFile);
  const insert = createImageInserter({ editor, queue: q, process: () => pending.promise, store, canInsert: () => allowed });
  const operation = insert.insert([{}]); await Promise.resolve();
  if (reason === "destroy") editor.destroy();
  else if (reason === "replace") allowed = false;
  else editor.setEditable(false);
  pending.resolve(image()); await operation;
  const id = await store.mock.results[0].value;
  expect(await getFile(id)).toBeDefined(); if (!editor.isDestroyed) expect(editor.getHTML()).not.toContain("<img");
});
it("read-only insertion does not process or write", async () => {
  const editor = open(), process = vi.fn(); editor.setEditable(false);
  await createImageInserter({ editor, queue: queue(), process }).insert([{}]);
  expect(process).not.toHaveBeenCalled();
});
it("image action is available in Insert and absent from the default toolbar", () => {
  expect(ACTIONS.image.group).toBe("Insert"); expect(availableActions().map((a) => a.id)).toContain("image");
  expect(DEFAULT_TOOLBAR).not.toContain("image"); const openImagePicker = vi.fn(); ACTIONS.image.run({ ui: { openImagePicker } }); expect(openImagePicker).toHaveBeenCalledOnce();
});
it("image selection offers View/Delete, viewer registers Back and Escape, Delete is undoable", async () => {
  let closeOverlay; const registerOverlay = vi.fn((close) => { closeOverlay = close; return () => {}; });
  render(<OverlayNavigation value={{ registerOverlay }}><NoteEditor note={noteFixture({ html: '<img data-file="missing" width="480" height="270"><p>After</p>' })} onChange={() => {}} /></OverlayNavigation>);
  const editor = screen.getByLabelText("Note body").editor; stubEditorGeometry(editor);
  act(() => { editor.view.focus(); editor.commands.setNodeSelection(0); });
  expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  fireEvent.click(await screen.findByRole("button", { name: "View" }));
  expect(screen.getByRole("dialog")).toBeDefined(); expect(registerOverlay).toHaveBeenCalled();
  await waitFor(() => expect(screen.getAllByText("Image not found").length).toBe(2));
  fireEvent.click(screen.getByRole("button", { name: "Actual size" })); expect(screen.getByRole("button", { name: "Actual size" }).getAttribute("aria-pressed")).toBe("true");
  act(() => closeOverlay()); expect(screen.queryByRole("dialog")).toBeNull();
  act(() => { editor.view.focus(); editor.commands.setNodeSelection(0); });
  fireEvent.click(await screen.findByRole("button", { name: "View" }));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); expect(screen.queryByRole("dialog")).toBeNull();
  act(() => { editor.view.focus(); editor.commands.setNodeSelection(0); });
  fireEvent.click(await screen.findByRole("button", { name: "Delete image" })); expect(editor.getHTML()).not.toContain("<img");
  act(() => editor.commands.undo()); expect(editor.getHTML()).toContain('data-file="missing"');
});
it.each(["readonly", "locked"])("disables picker, paste and drop image insertion when %s", (mode) => {
  render(<DialogLock value={mode === "locked"}><NoteEditor note={noteFixture()} readOnly={mode === "readonly"} onChange={() => {}} toolbarIds={["image"]} /></DialogLock>);
  expect(screen.getByRole("button", { name: "Image" }).disabled).toBe(true);
  const editor = screen.getByLabelText("Note body").editor;
  const file = new File(["generated"], "fixture.png", { type: "image/png" });
  expect(editor.options.editorProps.handlePaste(editor.view, { clipboardData: { files: [file] } })).toBe(true);
  expect(editor.options.editorProps.handleDrop(editor.view, { dataTransfer: { files: [file] } })).toBe(true);
  expect(editor.getHTML()).toBe("<p>Hello</p>");
  expect(editor.options.editorProps.handlePaste(editor.view, { clipboardData: { files: [] } })).toBe(false);
});

it("copy and cut serialize durable references for pasting into another note", () => {
  const a = open('<p>Before</p><img data-file="shared" width="480" height="270" alt=""><p>After</p>');
  a.commands.setNodeSelection(8);
  const copied = a.view.serializeForClipboard(a.state.selection.content()).dom.innerHTML;
  expect(copied).toContain('data-file="shared"'); expect(copied).not.toMatch(/src=|blob:/);
  a.commands.deleteSelection();
  const b = open("<p>Destination</p>"); b.commands.insertContent(copied);
  expect(extractFileIds(a.getHTML())).toEqual([]); expect(extractFileIds(b.getHTML())).toEqual(["shared"]);
  a.commands.undo(); expect(extractFileIds(a.getHTML())).toEqual(["shared"]);
});

it("picker cancellation removes its decoration without changing note HTML", () => {
  render(<NoteEditor note={noteFixture()} onChange={() => {}} toolbarIds={["image"]} />);
  const editor = screen.getByLabelText("Note body").editor;
  fireEvent.click(screen.getByRole("button", { name: "Image" }));
  expect(editor.view.dom.querySelector(".image-placeholder")).not.toBeNull();
  fireEvent(screen.getByLabelText("Add images"), new Event("cancel", { bubbles: true }));
  expect(editor.view.dom.querySelector(".image-placeholder")).toBeNull(); expect(editor.getHTML()).toBe("<p>Hello</p>");
});
