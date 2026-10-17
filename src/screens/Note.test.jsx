import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Note from "./Note.jsx";
import { noteFixture } from "../test/fixtures.js";
import { stubEditorGeometry } from "../test/editor.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const queue = () => ({ schedule: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) });

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
