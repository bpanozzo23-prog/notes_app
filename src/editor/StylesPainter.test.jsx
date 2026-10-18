import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import NoteEditor from "./NoteEditor.jsx";
import { DialogLock } from "../components/Dialog.jsx";
import { resolveFormatting } from "./formatting.js";
import { captureLook, EMPTY_LOOK } from "./look.js";
import { noteFixture } from "../test/fixtures.js";
import { stubEditorGeometry } from "../test/editor.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const formatting = resolveFormatting({ toolbar: ["styles", "painter", "style:default-heading"], selectionMenu: [] });
const note = noteFixture({ html: '<p><strong><span style="color: #15803d">source</span></strong> target</p><p></p>' });
const editor = () => screen.getByLabelText("Note body").editor;
const button = (name) => screen.getByRole("button", { name, exact: true });
const tap = (name) => { const control = button(name); expect(fireEvent.pointerDown(control)).toBe(false); fireEvent.pointerUp(control); fireEvent.click(control); };
function select(from, to = from) { act(() => { editor().commands.setTextSelection({ from, to }); editor().view.focus(); }); }
function start(props = {}) {
  const view = render(<NoteEditor note={note} formatting={formatting} onChange={() => {}} {...props} />);
  stubEditorGeometry(editor()); select(3);
  return view;
}

it.each(["toolbar", "popup"])("arms at the cursor and applies once from the %s without applying on selection change", async (surface) => {
  start();
  const copied = captureLook(editor().state);
  tap("Format painter");
  expect(button("Format painter").getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText("Format copied. Select text, then tap Apply format.")).toBeTruthy();
  const before = editor().getHTML();
  select(8, 14);
  expect(editor().getHTML()).toBe(before);
  await screen.findByRole("button", { name: "Apply format" });
  const selection = editor().state.selection.toJSON();
  tap(surface === "toolbar" ? "Format painter" : "Apply format");
  expect(captureLook(editor().state)).toEqual(copied);
  expect(editor().state.selection.toJSON()).toEqual(selection);
  expect(button("Format painter").getAttribute("aria-pressed")).toBe("false");
  expect(screen.queryByText("Format copied. Select text, then tap Apply format.")).toBeNull();
  expect(screen.queryByRole("button", { name: "Apply format" })).toBeNull();
});
it("cancels with an empty-selection tap and with the hint Cancel; copying a selection works", () => {
  start();
  const before = editor().getHTML();
  tap("Format painter"); tap("Format painter");
  expect(button("Format painter").getAttribute("aria-pressed")).toBe("false");
  select(2, 5); tap("Format painter"); tap("Cancel");
  expect(editor().getHTML()).toBe(before);
  expect(button("Format painter").getAttribute("aria-pressed")).toBe("false");
});
it("disarms on note switch, read-only and lock, and disables painter", () => {
  const view = start();
  tap("Format painter");
  view.rerender(<NoteEditor note={{ ...note, id: "other" }} formatting={formatting} onChange={() => {}} />);
  expect(button("Format painter").getAttribute("aria-pressed")).toBe("false");
  tap("Format painter");
  view.rerender(<NoteEditor note={{ ...note, id: "other" }} formatting={formatting} onChange={() => {}} readOnly />);
  expect(button("Format painter").disabled).toBe(true);
  expect(button("Format painter").getAttribute("aria-pressed")).toBe("false");
  view.rerender(<NoteEditor note={note} formatting={formatting} onChange={() => {}} />);
  tap("Format painter");
  view.rerender(<DialogLock value={true}><NoteEditor note={note} formatting={formatting} onChange={() => {}} /></DialogLock>);
  expect(button("Format painter").disabled).toBe(true);
  expect(screen.queryByText(/Format copied/)).toBeNull();
});
it("applies ordered tray styles and toolbar snapshots; closing the tray retains selection", () => {
  start();
  select(8, 14);
  const selection = editor().state.selection.toJSON();
  tap("Named styles");
  const tray = within(screen.getByRole("region", { name: "Named styles tray" }));
  fireEvent.click(tray.getByRole("button", { name: "Heading", exact: true }));
  expect(screen.queryByRole("region")).toBeNull();
  expect(editor().state.selection.toJSON()).toEqual(selection);
  expect(captureLook(editor().state)).toEqual(formatting.namedStyles[0].look);
  select(2); tap("Heading");
  select(3);
  expect(captureLook(editor().state)).toEqual(formatting.namedStyles[0].look);
});
it("Save this look prefills look, heading and spacing from the cursor, and Escape discards it", async () => {
  start({ note: noteFixture({ html: '<h3 style="line-height: 1.5"><em><mark><span style="font-size: 23pt; color: #123456; font-family: serif">Source</span></mark></em></h3>' }) });
  tap("Named styles"); tap("Save this look as a style…");
  expect(screen.queryByRole("region")).toBeNull();
  const form = within(screen.getByRole("dialog"));
  expect(form.getByLabelText("Name").value).toBe("");
  expect(form.getByRole("button", { name: "Italic" }).getAttribute("aria-pressed")).toBe("true");
  expect(form.getByRole("button", { name: "#123456" }).getAttribute("aria-pressed")).toBe("true");
  expect(form.getByLabelText("Other size (pt)").value).toBe("23");
  expect(form.getByLabelText("Typeface").value).toBe("serif");
  expect(form.getByLabelText("Line").value).toBe("h3");
  expect(form.getByLabelText("Spacing").value).toBe("1.5");
  fireEvent.keyDown(form.getByLabelText("Name"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(captureLook(editor().state)).toMatchObject({ ...EMPTY_LOOK, italic: true, highlight: "#fde68a", color: "#123456", fontSize: "23pt", fontFamily: "serif" });
});
it("clears an armed painter when a lock or busy operation arrives without remounting the note", () => {
  const props = { note, formatting, onChange: () => {} };
  const view = render(<DialogLock value={false}><NoteEditor {...props} /></DialogLock>);
  stubEditorGeometry(editor()); select(3); tap("Format painter");
  const original = editor();
  view.rerender(<DialogLock value={true}><NoteEditor {...props} /></DialogLock>);
  expect(editor()).toBe(original);
  expect(button("Format painter").disabled).toBe(true);
  view.rerender(<DialogLock value={false}><NoteEditor {...props} /></DialogLock>);
  expect(button("Format painter").getAttribute("aria-pressed")).toBe("false");
  tap("Format painter");
  view.rerender(<DialogLock value={false}><NoteEditor {...props} busy /></DialogLock>);
  expect(button("Format painter").disabled).toBe(true);
  view.rerender(<DialogLock value={false}><NoteEditor {...props} /></DialogLock>);
  expect(button("Format painter").getAttribute("aria-pressed")).toBe("false");
});
it("disables a painter button stored in the pop-up when the note locks", async () => {
  const prefs = resolveFormatting({ toolbar: [], selectionMenu: ["painter"] });
  const props = { note, formatting: prefs, onChange: () => {} };
  const view = render(<DialogLock value={false}><NoteEditor {...props} /></DialogLock>);
  stubEditorGeometry(editor()); select(1, 4);
  expect((await screen.findByRole("button", { name: "Format painter" })).disabled).toBe(false);
  view.rerender(<DialogLock value={true}><NoteEditor {...props} /></DialogLock>);
  expect(screen.getByTitle("Format painter").disabled).toBe(true);
});
