import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Note from "./Note.jsx";
import { noteFixture } from "../test/fixtures.js";
import { stubEditorGeometry } from "../test/editor.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const queue = () => ({ setKnownRev: vi.fn(), onConflict: vi.fn(() => () => {}), schedule: vi.fn(), flush: vi.fn().mockResolvedValue(undefined), onBeforeFlush: vi.fn(() => () => {}) });

it.each([
  ["idle", "Saved"], ["pending", "Saving…"], ["saving", "Saving…"], ["error", "Not saved"],
])("shows %s in the header as %s", (status, label) => {
  render(<Note initialNote={noteFixture()} notes={[]} folders={[]} queue={queue()} status={status} />);
  const saved = screen.getByRole("status");
  expect(saved.textContent).toBe(label);
  expect(saved.classList.contains("text-red-700")).toBe(status === "error");
  expect(saved.classList.contains("font-semibold")).toBe(status === "error");
  expect(saved.classList.contains("text-[var(--color-muted)]")).toBe(status !== "error");
});

it("lists only live backlinks in pinned/recent order, includes folders, and opens outside the editor surface", () => {
  const target = noteFixture();
  const source = (id, extra = {}) => noteFixture({ id, title: id, linkedIds: [target.id], ...extra });
  const open = vi.fn();
  render(<Note initialNote={target} notes={[
    target, source("old", { updatedAt: "2026-10-15" }), source("new", { updatedAt: "2026-10-17" }),
    source("pin", { pinned: true, updatedAt: "2026-10-14", folderId: "f", title: "", text: "Fallback title\nText" }),
    source("trashed", { deletedAt: "2026-10-17" }), source("unrelated", { linkedIds: [] }),
  ]} folders={[{ id: "f", name: "Reading" }]} queue={queue()} onOpenNote={open} />);
  const section = screen.getByRole("region", { name: "Linked from" });
  expect(within(section).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Fallback title", "new", "old"]);
  expect(within(section).getByText("Reading")).toBeTruthy();
  expect(section.closest("[data-editor-surface]")).toBeNull();
  const editor = screen.getByLabelText("Note body").editor;
  const focus = vi.spyOn(editor.commands, "focus");
  fireEvent.click(within(section).getByRole("button", { name: "Fallback title" }));
  expect(open).toHaveBeenCalledExactlyOnceWith("pin");
  expect(focus).not.toHaveBeenCalled();
});

it("omits Linked from when there are no live sources", () => {
  const target = noteFixture();
  render(<Note initialNote={target} notes={[target, noteFixture({ id: "trash", linkedIds: [target.id], deletedAt: "2026-10-17" })]}
    folders={[]} queue={queue()} />);
  expect(screen.queryByRole("heading", { name: "Linked from" })).toBeNull();
});

it("uses one bubble for cursor links and selections; opens notes and removes the complete link mark", async () => {
  const note = noteFixture({ html: '<p><a href="note:target">A <strong>whole</strong> link</a> after</p>' });
  const save = queue(), open = vi.fn();
  render(<Note initialNote={note} notes={[note]} folders={[]} queue={save} onOpenNote={open} />);
  const editor = screen.getByLabelText("Note body").editor;
  stubEditorGeometry(editor);
  act(() => { editor.view.focus(); editor.commands.setTextSelection(5); });
  const menu = await screen.findByRole("toolbar", { name: "Selection formatting" });
  expect(screen.getAllByRole("toolbar", { name: "Selection formatting" })).toHaveLength(1);
  expect(within(menu).getAllByRole("button").slice(0, 2).map((button) => button.textContent)).toEqual(["Open note", "Remove link"]);
  fireEvent.click(within(menu).getByRole("button", { name: "Open note" }));
  expect(open).toHaveBeenCalledExactlyOnceWith("target");
  expect(editor.state.selection.from).toBe(5);
  fireEvent.click(within(menu).getByRole("button", { name: "Remove link" }));
  expect(editor.getHTML()).toBe("<p>A <strong>whole</strong> link after</p>");
  expect(save.schedule).toHaveBeenLastCalledWith(note.id, { html: editor.getHTML() });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Open note" })).toBeNull());
  act(() => editor.commands.setTextSelection({ from: 3, to: 8 }));
  const selection = await screen.findByRole("toolbar", { name: "Selection formatting" });
  expect(within(selection).getByRole("button", { name: "Link to note" })).toBeTruthy();
  fireEvent.click(within(selection).getByRole("button", { name: "Link to note" }));
  expect(screen.getByRole("dialog", { name: "Link to note" })).toBeTruthy();
});

it("hands the editor's held input to the queue before every flush, so a reload or Back cannot drop it", async () => {
  const note = noteFixture({ html: "<p>Original</p>" });
  const real = new (await import("../lib/saveQueue.js")).SaveQueue({ save: vi.fn().mockResolvedValue(undefined) });
  render(<Note initialNote={note} notes={[note]} folders={[]} queue={real} onOpenNote={vi.fn()} />);
  const editor = screen.getByLabelText("Note body").editor;
  const observer = editor.view.domObserver;
  const force = vi.spyOn(observer, "forceFlush");
  const flush = vi.spyOn(observer, "flush");
  await act(() => real.flush());
  expect(force).toHaveBeenCalledTimes(1);
  expect(flush).toHaveBeenCalledTimes(1);
  // The 20 ms Android deletion path: a change ProseMirror is still holding reaches the save.
  act(() => { editor.view.dom.querySelector("p").textContent = "Origina"; });
  observer.flushSoon();
  await act(() => real.flush());
  expect(real.save).toHaveBeenLastCalledWith(note.id, { html: "<p>Origina</p>" }, { expectedRev: note.rev });
  expect(observer.flushingSoon).toBe(-1);
});

it("ends with the creation and last edit dates, and an edit updates them at once", () => {
  const createdAt = new Date(2025, 0, 5, 9, 0).toISOString(), updatedAt = new Date(2025, 1, 6, 9, 0).toISOString();
  render(<Note initialNote={noteFixture({ createdAt, updatedAt })} notes={[]} folders={[]} queue={queue()} />);
  expect(screen.getByText("Created 5 Jan 2025 · Edited 6 Feb 2025")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "A new title" } });
  expect(screen.getByText(/^Created 5 Jan 2025 · Edited today, \d\d:\d\d$/)).toBeTruthy();
});

it("a conflict keeps a persistent notice, locks editing and opens the copy", async () => {
  const note = noteFixture({ html: "<p>Original</p>" }), open = vi.fn();
  const { SaveQueue } = await import("../lib/saveQueue.js");
  const save = vi.fn().mockRejectedValue(new Error("Changed"));
  const real = new SaveQueue({ save, resolveConflict: async () => ({ id: "copy", title: "Original (conflict copy)", rev: 1 }) });
  const known = vi.spyOn(real, "setKnownRev");
  const props = { initialNote: note, notes: [note], folders: [], queue: real, onOpenNote: open };
  const view = render(<Note {...props} />);
  expect(known).toHaveBeenCalledExactlyOnceWith(note.id, note.rev);
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Draft" } });
  await act(() => real.flush());
  expect(screen.getByText('This note was changed in another window, so your edits here were saved in a new note, “Original (conflict copy)”. Nothing was overwritten.')).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Title" }).readOnly).toBe(true);
  expect(screen.getByLabelText("Note body").editor.isEditable).toBe(false);
  for (const name of ["Pin note", "Choose folder", "Edit tags"]) expect(screen.getByRole("button", { name }).matches(":disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Note options" }).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Note options" }));
  expect(screen.getByRole("button", { name: "Copy as text" }).disabled).toBe(false);
  expect(screen.getByRole("button", { name: "Move to Trash…" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  const schedule = vi.spyOn(real, "schedule");
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Must not save" } });
  expect(schedule).not.toHaveBeenCalled();
  view.rerender(<Note {...props} initialNote={{ ...note, rev: 2 }} />);
  expect(known).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Open the copy" }));
  expect(open).toHaveBeenCalledExactlyOnceWith("copy");
});

it.each([
  [["a", "b"], "#a #b"], [[], "+ Tags"],
])("shows tags %j as %s on the compact line", (tags, label) => {
  render(<Note initialNote={noteFixture({ tags })} notes={[]} folders={[]} queue={queue()} />);
  expect(screen.getByRole("button", { name: "Edit tags" }).textContent).toBe(label);
  expect(screen.queryByLabelText("Add tag")).toBeNull();
  expect(screen.queryByRole("button", { name: /Used before/ })).toBeNull();
});

it("focuses tag entry with suggestions open, keeps them after adding, and saves through the queue before Done closes", async () => {
  const note = noteFixture();
  const { SaveQueue } = await import("../lib/saveQueue.js");
  const save = vi.fn().mockResolvedValue(undefined), real = new SaveQueue({ save });
  const schedule = vi.spyOn(real, "schedule");
  render(<Note initialNote={note} notes={[noteFixture({ id: "other", tags: ["Spanish", "vocab"] })]} folders={[]} queue={real} />);
  const opener = screen.getByRole("button", { name: "Edit tags" });
  opener.focus();
  fireEvent.click(opener);
  const sheet = within(screen.getByRole("dialog", { name: "Tags" }));
  expect(document.activeElement).toBe(sheet.getByRole("textbox", { name: "Add tag" }));
  expect(sheet.getByRole("button", { name: "Used before (2)" }).getAttribute("aria-expanded")).toBe("true");
  const suggestions = within(sheet.getByRole("group", { name: "Tag suggestions" }));
  fireEvent.click(suggestions.getByRole("button", { name: "Spanish" }));
  expect(within(sheet.getByRole("group", { name: "Tag suggestions" })).getByRole("button", { name: "vocab" })).toBeTruthy();
  expect(schedule).toHaveBeenCalledExactlyOnceWith(note.id, { tags: ["Spanish"] });
  await act(() => real.flush());
  expect(save).toHaveBeenCalledExactlyOnceWith(note.id, { tags: ["Spanish"] }, { expectedRev: note.rev });
  fireEvent.click(sheet.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(opener.textContent).toBe("#Spanish");
  expect(document.activeElement).toBe(opener);
  expect(schedule).toHaveBeenCalledTimes(1);
});

it("lists exactly Copy as text, Move to Trash… and Cancel in Note options, and Cancel restores focus", () => {
  render(<Note initialNote={noteFixture()} notes={[]} folders={[]} queue={queue()} />);
  const opener = screen.getByRole("button", { name: "Note options" });
  opener.focus();
  fireEvent.click(opener);
  const sheet = within(screen.getByRole("dialog", { name: "Note options" }));
  expect(sheet.getAllByRole("button").map((button) => button.textContent)).toEqual(["Copy as text", "Move to Trash…", "Cancel"]);
  fireEvent.click(sheet.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it("locks an already open Tags sheet when a conflict makes the note read-only", () => {
  const real = queue(), note = noteFixture({ tags: ["a"] });
  render(<Note initialNote={note} notes={[noteFixture({ id: "other", tags: ["b"] })]} folders={[]} queue={real} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit tags" }));
  act(() => real.onConflict.mock.calls[0][0]({ noteId: note.id, copyId: "copy", copyTitle: "Conflict copy" }));
  const sheet = within(screen.getByRole("dialog", { name: "Tags" }));
  const input = sheet.getByRole("textbox", { name: "Add tag" });
  expect(input.matches(":disabled")).toBe(true);
  for (const button of sheet.getAllByRole("button").filter((button) => button.textContent !== "Done")) expect(button.matches(":disabled")).toBe(true);
  fireEvent.change(input, { target: { value: "must not save," } });
  expect(real.schedule).not.toHaveBeenCalled();
  expect(sheet.getByRole("button", { name: "Done" }).disabled).toBe(false);
  fireEvent.click(sheet.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Edit tags" }).textContent).toBe("#a");
});
