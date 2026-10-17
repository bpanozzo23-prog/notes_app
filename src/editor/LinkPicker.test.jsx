import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Note from "../screens/Note.jsx";
import { noteFixture } from "../test/fixtures.js";
import { stubEditorGeometry } from "../test/editor.js";
import { extractNoteLinks } from "../lib/text.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const source = noteFixture({ title: "Source", html: "<p>Before chosen after</p>", text: "Before chosen after" });

function setup(notes) {
  const queue = { schedule: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
  const view = render(<Note initialNote={source} notes={[source, ...notes]} folders={[{ id: "reading", name: "Reading" }]}
    queue={queue} status="idle" />);
  const editor = screen.getByLabelText("Note body").editor;
  stubEditorGeometry(editor);
  return { editor, queue, view };
}

function openPicker() {
  fireEvent.click(within(screen.getByRole("toolbar", { name: "Formatting", exact: true })).getByRole("button", { name: "Link to note" }));
  return screen.getByRole("dialog", { name: "Link to note" });
}

it("filters live alternatives by normalised title/body, displays folder/fallback titles, and sorts by recency", () => {
  setup([
    noteFixture({ id: "old", title: "Árbol", text: "older", pinned: true, updatedAt: "2026-10-15", folderId: "reading" }),
    noteFixture({ id: "new", title: "", text: "Niño\nBody", updatedAt: "2026-10-17" }),
    noteFixture({ id: "trash", title: "Trashed", deletedAt: "2026-10-17" }),
  ]);
  const dialog = openPicker();
  const rows = () => within(dialog).getByRole("list").querySelectorAll("button");
  expect([...rows()].map((row) => row.getAttribute("aria-label"))).toEqual(["Niño", "Árbol"]);
  expect(within(dialog).getByText("Reading")).toBeTruthy();
  expect(within(dialog).getByText("No folder")).toBeTruthy();
  const input = within(dialog).getByRole("textbox");
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: "ARBOL" } });
  expect([...rows()].map((row) => row.getAttribute("aria-label"))).toEqual(["Árbol"]);
  fireEvent.change(input, { target: { value: "NINO" } });
  expect([...rows()].map((row) => row.getAttribute("aria-label"))).toEqual(["Niño"]);
  fireEvent.change(input, { target: { value: "missing" } });
  expect(within(dialog).getByText("No notes match.")).toBeTruthy();
});

it.each([false, true])("inserts a note href and preserves selection text or adds a title and unmarked space (selection: %s)", async (selected) => {
  const target = noteFixture({ id: "target", title: "Title <&>" });
  const { editor, queue } = setup([target]);
  act(() => {
    editor.commands.setTextSelection(selected ? { from: 8, to: 14 } : 1);
    if (!selected) editor.commands.toggleBold();
  });
  const dialog = openPicker();
  fireEvent.click(within(dialog).getByRole("button", { name: target.title }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(editor.view.dom);
  const link = editor.view.dom.querySelector("a");
  expect(link.getAttribute("href")).toBe("note:target");
  expect(link.textContent).toBe(selected ? "chosen" : target.title);
  expect(editor.getText()).toBe(selected ? source.text : `${target.title} ${source.text}`);
  expect(queue.schedule).toHaveBeenLastCalledWith(source.id, { html: editor.getHTML() });
  expect(extractNoteLinks(queue.schedule.mock.calls.at(-1)[1].html)).toEqual([target.id]);
  if (!selected) {
    expect(link.nextSibling.textContent.startsWith(" ")).toBe(true);
    expect(editor.state.doc.firstChild.child(1).marks).toEqual([]);
    act(() => editor.commands.insertContent("plain "));
    expect(editor.getHTML()).toContain("</a> plain Before");
    expect(editor.getHTML()).not.toContain("<strong>");
  } else {
    await waitFor(() => expect(screen.getByRole("toolbar", { name: "Selection formatting" })).toBeTruthy());
  }
});

it.each(["Cancel", "Escape"])("shows an empty state and returns keyboard focus and selection on %s", (close) => {
  const { editor } = setup([]);
  act(() => editor.commands.setTextSelection({ from: 8, to: 14 }));
  const button = within(screen.getByRole("toolbar", { name: "Formatting", exact: true })).getByRole("button", { name: "Link to note" });
  act(() => button.focus());
  const dialog = openPicker();
  expect(within(dialog).getByText("No other notes yet.")).toBeTruthy();
  if (close === "Escape") fireEvent.keyDown(dialog, { key: "Escape" });
  else fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(document.activeElement).toBe(editor.view.dom);
  expect(editor.state.selection).toMatchObject({ from: 8, to: 14 });
  expect(editor.getText()).toBe(source.text);
});
