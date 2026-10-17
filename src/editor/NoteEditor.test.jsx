import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import NoteEditor from "./NoteEditor.jsx";
import { ACTIONS, DEFAULT_TOOLBAR, DEFAULT_SELECTION_MENU } from "./actions.js";
import { noteFixture } from "../test/fixtures.js";
import { stubEditorGeometry, tapEditorLink } from "../test/editor.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const currentEditor = () => screen.getByLabelText("Note body").editor;

it("keeps current content on same-id renders and resets content and history on note switch", async () => {
  const changed = vi.fn();
  const a = noteFixture({ html: "<p>First note</p>" });
  const b = noteFixture({ id: "second", html: "<p>Second note</p>" });
  const view = render(<NoteEditor note={a} onChange={changed} />);
  const firstEditor = currentEditor();
  act(() => { firstEditor.commands.insertContent("Typed "); });
  const typed = firstEditor.getHTML();
  expect(changed).toHaveBeenLastCalledWith(typed);
  expect(firstEditor.can().undo()).toBe(true);
  view.rerender(<NoteEditor note={{ ...a, html: "<p>Stale save echo</p>", title: "Title" }} onChange={changed} />);
  expect(currentEditor()).toBe(firstEditor);
  expect(currentEditor().getHTML()).toBe(typed);
  view.rerender(<NoteEditor note={b} onChange={changed} />);
  await waitFor(() => expect(currentEditor()).not.toBe(firstEditor));
  expect(currentEditor().getHTML()).toBe("<p>Second note</p>");
  expect(currentEditor().can().undo()).toBe(false);
  expect(changed).toHaveBeenCalledTimes(1);
});
it("preserves keyboard hints and pointer focus; toolbar state tracks fresh tap-time commands", async () => {
  render(<NoteEditor note={noteFixture()} onChange={() => {}} toolbarIds={["bold", "italic"]} />);
  const body = screen.getByLabelText("Note body");
  for (const [name, value] of [["autocorrect", "on"], ["autocapitalize", "sentences"], ["spellcheck", "true"]]) {
    expect(body.getAttribute(name)).toBe(value);
  }
  const button = screen.getByRole("button", { name: "Bold" });
  expect(fireEvent.pointerDown(button)).toBe(false);
  fireEvent.click(button);
  act(() => { currentEditor().commands.insertContent("Bold "); });
  expect(currentEditor().getHTML()).toContain("<strong>Bold </strong>");
  expect(button.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(button);
  act(() => { currentEditor().commands.insertContent("plain "); });
  expect(currentEditor().getHTML()).toContain("<strong>Bold </strong>plain ");
  expect(button.getAttribute("aria-pressed")).toBe("false");
});
it("keeps both menus as registry ids and delegates the link picker to UI hooks", () => {
  for (const id of [...DEFAULT_TOOLBAR, ...DEFAULT_SELECTION_MENU]) {
    expect(ACTIONS[id].id).toBe(id);
    expect(["toggle", "command", "picker"]).toContain(ACTIONS[id].kind);
    expect(typeof ACTIONS[id].run).toBe("function");
  }
  const ui = { openLinkPicker: vi.fn() };
  const editor = {};
  ACTIONS.link.run({ editor, ui });
  expect(ui.openLinkPicker).toHaveBeenCalledExactlyOnceWith(editor);
});

it("ignores unknown imported toolbar ids, including object member names", () => {
  render(<NoteEditor note={noteFixture()} onChange={() => {}} toolbarIds={["future-action", "__proto__", "constructor", "toString", "bold"]} />);
  expect(screen.getByRole("toolbar").querySelectorAll("button")).toHaveLength(1);
});

it("recognises a colour after saved HTML has normalised it to rgb", () => {
  render(<NoteEditor note={noteFixture({ html: '<p><span style="color: rgb(220, 38, 38)">Red text</span></p>' })}
    onChange={() => {}} toolbarIds={["color:#dc2626"]} />);
  act(() => { currentEditor().commands.setTextSelection(2); });
  expect(screen.getByRole("button", { name: "Red" }).getAttribute("aria-pressed")).toBe("true");
});

it("a tap on the empty body surface focuses the editor at the end", async () => {
  const view = render(<NoteEditor note={noteFixture({ html: "<p>End of note</p>" })} onChange={() => {}} />);
  // jsdom has no Range geometry. Focus and selection are real; visual scrolling is a phone check.
  const scroll = vi.spyOn(currentEditor().view, "scrollToSelection").mockImplementation(() => {});
  act(() => currentEditor().commands.setTextSelection(1));
  fireEvent.click(view.container.querySelector("[data-editor-surface]"));
  await waitFor(() => expect(currentEditor().isFocused).toBe(true));
  expect(currentEditor().state.selection.from).toBe(currentEditor().state.doc.content.size - 1);
  scroll.mockRestore();
});

it("routes a note-link tap through the latest UI hook without changing the browser URL", () => {
  const html = '<p><a href="note:target"><strong>Target</strong></a></p>';
  const oldOpen = vi.fn(), openNote = vi.fn();
  const view = render(<NoteEditor note={noteFixture({ html })} onChange={() => {}} ui={{ openNote: oldOpen }} />);
  view.rerender(<NoteEditor note={noteFixture({ html })} onChange={() => {}} ui={{ openNote }} />);
  const url = window.location.href;
  const open = vi.spyOn(window, "open").mockImplementation(() => {});
  expect(tapEditorLink(screen.getByLabelText("Note body").querySelector("strong"))).toBe(false);
  expect(openNote).toHaveBeenCalledExactlyOnceWith("target");
  expect(oldOpen).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  expect(window.location.href).toBe(url);
});

it.each(["https://example.com", "mailto:fixture@example.com"])("keeps %s taps for editing and opens only from the link bubble", async (href) => {
  const openNote = vi.fn();
  const open = vi.spyOn(window, "open").mockImplementation(() => {});
  render(<NoteEditor note={noteFixture({ html: `<p><a href="${href}">Linked text</a> after</p>` })} onChange={() => {}} ui={{ openNote }} />);
  const editor = currentEditor();
  stubEditorGeometry(editor);
  tapEditorLink(editor.view.dom.querySelector("a"));
  expect(openNote).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  // jsdom cannot position a caret with a pointer. Set it as a browser would after that tap.
  act(() => { editor.view.focus(); editor.commands.setTextSelection(4); });
  const button = await screen.findByRole("button", { name: "Open link" });
  expect(editor.state.selection.empty).toBe(true);
  expect(fireEvent.pointerDown(button)).toBe(false);
  fireEvent.click(button);
  expect(open).toHaveBeenCalledExactlyOnceWith(href, "_blank", "noopener");
  expect(editor.state.selection.from).toBe(4); // Bubble clicks must not focus the end of the note.
});
