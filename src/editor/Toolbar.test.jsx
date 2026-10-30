import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Toolbar from "./Toolbar.jsx";
import NoteEditor from "./NoteEditor.jsx";
import Note from "../screens/Note.jsx";
import { resolveFormatting } from "./formatting.js";
import { noteFixture } from "../test/fixtures.js";
import { stubEditorGeometry } from "../test/editor.js";

let resize, width;
beforeEach(() => {
  width = 375;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function () { return this.classList.contains("toolbar-inner") ? width : 0; });
  vi.stubGlobal("ResizeObserver", class { constructor(callback) { resize = callback; } observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const tap = (button) => { expect(fireEvent.pointerDown(button)).toBe(false); fireEvent.pointerUp(button); fireEvent.click(button); };

it("continues a bullet on a touch tap, keeps nested items, and reopens with the break intact", () => {
  const formatting = resolveFormatting({ toolbar: ["lineBreak"] });
  const note = noteFixture({ html: "<ul><li><p>Point</p><ul><li><p>Detail</p></li></ul></li><li><p>Next</p></li></ul>" });
  const view = render(<NoteEditor note={note} formatting={formatting} onChange={() => {}} />);
  const body = screen.getByLabelText("Note body"), editor = body.editor;
  stubEditorGeometry(editor);
  act(() => { editor.view.focus(); editor.commands.setTextSelection(8); });
  const button = screen.getByRole("button", { name: "Line break", exact: true });
  fireEvent.pointerDown(button, { pointerType: "touch" });
  fireEvent.pointerUp(button, { pointerType: "touch" });
  fireEvent.pointerLeave(button, { pointerType: "touch" });
  fireEvent.click(button);
  expect(document.activeElement).toBe(body);
  act(() => { editor.commands.insertContent("Continuation"); });
  const saved = editor.getHTML();
  expect(saved).toContain("<ul><li><p>Point<br>Continuation</p><ul><li><p>Detail</p></li></ul></li><li><p>Next</p></li></ul>");
  // Ordinary Enter still starts a sibling bullet after the continuation.
  fireEvent.keyDown(body, { key: "Enter", code: "Enter" });
  expect(editor.state.doc.firstChild.childCount).toBe(3);
  view.unmount();
  render(<NoteEditor note={{ ...note, html: saved }} formatting={formatting} onChange={() => {}} />);
  expect(screen.getByLabelText("Note body").editor.getHTML()).toBe(saved);
});

it("measures the actual toolbar width, skips unknown slots, and updates the inert preview on resize", () => {
  const capacity = vi.fn();
  const ids = ["unknown", "constructor", ...Array(21).fill("bold")];
  render(<Toolbar ids={ids} layout="rows" onCapacity={capacity} />);
  const toolbar = screen.getByRole("toolbar", { name: "Toolbar preview" });
  expect(capacity).toHaveBeenLastCalledWith(8);
  expect(within(toolbar).getAllByRole("button")).toHaveLength(16);
  expect(within(toolbar).getAllByRole("button").at(-1).getAttribute("aria-label")).toBe("More");
  expect(within(toolbar).getAllByRole("button").every((button) => button.disabled)).toBe(true);
  width = 672;
  act(() => resize());
  expect(capacity).toHaveBeenLastCalledWith(16); // jsdom has no stylesheet padding; browser shots cover the 16 px inset.
  expect(within(toolbar).getAllByRole("button")).toHaveLength(21);
  expect(within(toolbar).queryByRole("button", { name: "More" })).toBeNull();
});

it("keeps editor focus and selection through opening a tray and applying its action, and closes on repeat/Escape/note switch", () => {
  const formatting = resolveFormatting({ toolbar: ["bold", "italic", "underline", "color:none", "h1", "h2", "highlight", "strike", "link"], toolbarLayout: "more" });
  const note = noteFixture({ html: "<p>Chosen words</p>" });
  const view = render(<NoteEditor note={note} formatting={formatting} onChange={() => {}} />);
  const body = screen.getByLabelText("Note body"), editor = body.editor;
  stubEditorGeometry(editor);
  act(() => { editor.view.focus(); editor.commands.setTextSelection({ from: 1, to: 7 }); });
  const selection = editor.state.selection.toJSON();
  const more = within(screen.getByRole("toolbar", { name: "Formatting", exact: true })).getByRole("button", { name: "More" });
  tap(more);
  expect(document.activeElement).toBe(body);
  expect(editor.state.selection.toJSON()).toEqual(selection);
  const tray = screen.getByRole("region", { name: "More tray" });
  expect(tray.closest('[role="dialog"]')).toBeNull();
  expect(tray.style.maxHeight).toBe(`${window.innerHeight * 0.4}px`);
  tap(within(tray).getByRole("button", { name: "Strikethrough" }));
  expect(editor.getHTML()).toBe("<p><s>Chosen</s> words</p>");
  expect(document.activeElement).toBe(body);
  expect(editor.state.selection.toJSON()).toEqual(selection);
  expect(screen.queryByRole("region", { name: "More tray" })).toBeNull();
  tap(more); tap(more);
  expect(screen.queryByRole("region", { name: "More tray" })).toBeNull();
  tap(more); fireEvent.keyDown(body, { key: "Escape" });
  expect(screen.queryByRole("region", { name: "More tray" })).toBeNull();
  tap(more);
  view.rerender(<NoteEditor note={noteFixture({ id: "next" })} formatting={formatting} onChange={() => {}} />);
  expect(screen.queryByRole("region", { name: "More tray" })).toBeNull();
});

it("closes the tray before a link dialog opens and keeps the selected range for the link", () => {
  const note = noteFixture();
  render(<Note initialNote={note} notes={[note, noteFixture({ id: "target", title: "Target" })]} folders={[]}
    formatting={resolveFormatting({ toolbarLayout: "more" })}
    queue={{ setKnownRev() {}, onConflict: () => () => {}, schedule() {}, flush: () => Promise.resolve(), onBeforeFlush: () => () => {} }} />);
  const editor = screen.getByLabelText("Note body").editor;
  stubEditorGeometry(editor);
  act(() => { editor.view.focus(); editor.commands.setTextSelection({ from: 1, to: 6 }); });
  tap(within(screen.getByRole("toolbar", { name: "Formatting", exact: true })).getByRole("button", { name: "More" }));
  tap(within(screen.getByRole("region", { name: "More tray" })).getByRole("button", { name: "Link to note" }));
  expect(screen.queryByRole("region", { name: "More tray" })).toBeNull();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Target" }));
  expect(editor.getHTML()).toContain('href="note:target">Hello</a>');
  expect(document.activeElement).toBe(editor.view.dom);
});

it("limits the selection menu to two rows and opens its own overflow in the shared tray", async () => {
  const formatting = resolveFormatting({ selectionMenu: [...Array(30).fill("bold"), "h3"], toolbar: [] });
  render(<NoteEditor note={noteFixture()} formatting={formatting} onChange={() => {}} />);
  const editor = screen.getByLabelText("Note body").editor;
  stubEditorGeometry(editor);
  act(() => { editor.view.focus(); editor.commands.setTextSelection({ from: 1, to: 6 }); });
  const menu = await screen.findByRole("toolbar", { name: "Selection formatting" });
  expect(menu.querySelectorAll(".action-row")).toHaveLength(2);
  tap(within(menu).getByRole("button", { name: "More" }));
  const tray = screen.getByRole("region", { name: "More tray" });
  expect(within(tray).getByRole("button", { name: "Heading 3" })).toBeTruthy();
  tap(within(tray).getByRole("button", { name: "Heading 3" }));
  expect(editor.state.doc.firstChild.type.name).toBe("heading");
  expect(editor.state.doc.firstChild.attrs.level).toBe(3);
  expect(editor.state.doc.firstChild.textContent).toBe("Hello");
});

it("caps the tray against the visual viewport and follows keyboard resize without taking focus", () => {
  const viewport = Object.assign(new EventTarget(), { width: 375, height: 450, offsetTop: 50, offsetLeft: 0 });
  vi.stubGlobal("visualViewport", viewport);
  vi.stubGlobal("innerHeight", 800);
  render(<NoteEditor note={noteFixture()} formatting={resolveFormatting({ toolbarLayout: "more" })} onChange={() => {}} />);
  const editor = screen.getByLabelText("Note body").editor;
  stubEditorGeometry(editor);
  act(() => editor.view.focus());
  const toolbar = screen.getByRole("toolbar", { name: "Formatting", exact: true });
  tap(within(toolbar).getByRole("button", { name: "More" }));
  expect(screen.getByRole("region", { name: "More tray" }).style.maxHeight).toBe("180px");
  expect(toolbar.parentElement.style.bottom).toBe("300px");
  act(() => { viewport.height = 300; viewport.offsetTop = 100; viewport.dispatchEvent(new Event("resize")); });
  expect(screen.getByRole("region", { name: "More tray" }).style.maxHeight).toBe("120px");
  expect(toolbar.parentElement.style.bottom).toBe("400px");
  expect(document.activeElement).toBe(editor.view.dom);
});

it("shows Indent as unavailable outside a list without taking focus, and indents inside one", () => {
  const formatting = resolveFormatting({ toolbar: ["bold", "indent", "outdent"] });
  const note = noteFixture({ html: "<p>Plain</p><ul><li><p>One</p></li><li><p>Two</p></li></ul>" });
  render(<NoteEditor note={note} formatting={formatting} onChange={() => {}} />);
  const body = screen.getByLabelText("Note body"), editor = body.editor;
  stubEditorGeometry(editor);
  act(() => { editor.view.focus(); editor.commands.setTextSelection(3); });
  const toolbar = screen.getByRole("toolbar", { name: "Formatting", exact: true });
  const indent = within(toolbar).getByRole("button", { name: "Indent" });
  expect(indent.disabled).toBe(false);
  expect(indent.getAttribute("aria-disabled")).toBe("true");
  const before = editor.getHTML();
  tap(indent);
  expect(editor.getHTML()).toBe(before);
  expect(document.activeElement).toBe(body);
  let two = null;
  editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === "Two") two = pos + 1; });
  act(() => { editor.commands.setTextSelection(two); });
  expect(indent.getAttribute("aria-disabled")).toBeNull();
  tap(indent);
  expect(editor.getHTML()).toContain("<li><p>One</p><ul><li><p>Two</p></li></ul></li>");
  expect(document.activeElement).toBe(body);
});
