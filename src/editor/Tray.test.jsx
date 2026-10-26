import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import NoteEditor from "./NoteEditor.jsx";
import { resolveFormatting } from "./formatting.js";
import { trayOptions, TRAYS } from "./Tray.jsx";
import { noteFixture } from "../test/fixtures.js";
import { stubEditorGeometry } from "../test/editor.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const tap = (button) => { expect(fireEvent.pointerDown(button)).toBe(false); fireEvent.pointerUp(button); fireEvent.click(button); };

it.each(Object.keys(TRAYS).filter((name) => name !== "more" && name !== "styles"))("every %s option applies through ActionButton and closes with editor focus and selection intact", (name) => {
  const formatting = resolveFormatting({ toolbar: [name], selectionMenu: [] });
  const bodyHtml = '<p>Chosen words</p>';
  render(<NoteEditor note={noteFixture({ html: bodyHtml })} formatting={formatting} onChange={() => {}} />);
  const body = screen.getByLabelText("Note body"), editor = body.editor;
  stubEditorGeometry(editor);
  const options = trayOptions(name, editor, formatting);
  for (const option of options) {
    act(() => {
      editor.commands.setContent(bodyHtml);
      editor.commands.setTextSelection({ from: 1, to: 7 });
      editor.view.focus();
    });
    const selection = editor.state.selection.toJSON();
    tap(within(screen.getByRole("toolbar", { name: "Formatting", exact: true })).getByRole("button"));
    expect(document.activeElement).toBe(body);
    expect(editor.state.selection.toJSON()).toEqual(selection);
    const tray = within(screen.getByRole("region", { name: `${TRAYS[name].label} tray` }));
    expect(tray.getByRole("button", { name: option.label, exact: true }).hasAttribute("aria-pressed")).toBe(true);
    tap(tray.getByRole("button", { name: option.label, exact: true }));
    expect(screen.queryByRole("region")).toBeNull();
    expect(document.activeElement).toBe(body);
    editor.state.doc.check();
    if (name === "divider") {
      const dividers = [];
      editor.state.doc.descendants((node) => { if (node.type.name === "horizontalRule") dividers.push(node.attrs.dividerStyle); });
      expect(dividers).toEqual([option.dividerStyle]);
    } else {
      expect(option.isActive(editor)).toBe(true);
      expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe("Chosen");
      if (name !== "callout") expect(editor.state.selection.toJSON()).toEqual(selection);
    }
  }
});

it("shows the current callout and removes it through the same tray", () => {
  render(<NoteEditor note={noteFixture({ html: '<div data-callout="tip"><p>Chosen words</p></div>' })}
    formatting={resolveFormatting({ toolbar: ["callout"], selectionMenu: [] })} onChange={() => {}} />);
  const body = screen.getByLabelText("Note body"), editor = body.editor;
  stubEditorGeometry(editor);
  act(() => { editor.commands.setTextSelection(3); editor.view.focus(); });
  tap(screen.getByRole("button", { name: "Callout", exact: true }));
  expect(screen.getByRole("button", { name: "Tip callout" }).getAttribute("aria-pressed")).toBe("true");
  tap(screen.getByRole("button", { name: "Remove callout" }));
  expect(editor.getHTML()).toBe('<p>Chosen words</p>');
  expect(document.activeElement).toBe(body);
});

it.each([
  ['<div data-callout="tip"><h2>word</h2></div>', "Heading 2"],
  ['<div data-callout="tip"><p>word</p></div>', "Normal text"],
  ['<blockquote><h2>word</h2></blockquote><p></p>', "Heading 2"],
  ['<blockquote><p>word</p></blockquote><p></p>', "Normal text"],
  ['<ul><li><p>first</p><h2>word</h2></li></ul><p></p>', "Heading 2"],
  ['<ul><li><p>word</p></li></ul><p></p>', "Normal text"],
])("repeating %s / %s keeps the containing structure", (html, label) => {
  render(<NoteEditor note={noteFixture({ html })} onChange={() => {}} />);
  const editor = screen.getByLabelText("Note body").editor;
  stubEditorGeometry(editor);
  act(() => {
    editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === "word") editor.commands.setTextSelection(pos + 1); });
  });
  const before = editor.getJSON(), selection = editor.state.selection.toJSON();
  for (let i = 0; i < 2; i++) {
    act(() => trayOptions("heading", editor).find((option) => option.label === label).run({ editor }));
    expect(editor.getJSON()).toEqual(before);
    expect(editor.state.selection.toJSON()).toEqual(selection);
  }
});

it("changes every eligible selected line without lifting, preserving spacing and skipping a list's first paragraph", () => {
  render(<NoteEditor note={noteFixture({ html: '<div data-callout="tip"><h2 style="line-height: 2">callout</h2><ul><li><p>first</p><p>second</p></li></ul></div>' })} onChange={() => {}} />);
  const editor = screen.getByLabelText("Note body").editor;
  stubEditorGeometry(editor);
  act(() => {
    editor.commands.selectAll();
    trayOptions("heading", editor).find((option) => option.label === "Heading 3").run({ editor });
  });
  expect(editor.getHTML()).toBe('<div data-callout="tip"><h3 style="line-height: 2;">callout</h3><ul><li><p>first</p><h3>second</h3></li></ul></div>');
  editor.state.doc.check();
});

it("the heading tray changes a folded heading in place and normal text reveals the section", () => {
  render(<NoteEditor note={noteFixture({ html: '<h2 data-collapsed="true">Section</h2><p>Body</p>' })} formatting={resolveFormatting({ toolbar: ["heading"], selectionMenu: [] })} onChange={() => {}} />);
  const body = screen.getByLabelText("Note body"), editor = body.editor; stubEditorGeometry(editor);
  act(() => { editor.commands.setTextSelection(2); editor.view.focus(); });
  tap(within(screen.getByRole("toolbar", { name: "Formatting", exact: true })).getByRole("button", { name: "Heading", exact: true }));
  tap(within(screen.getByRole("region", { name: "Heading tray" })).getByRole("button", { name: "Heading 3" }));
  expect(body.querySelector("h3").textContent).toBe("Section");
  expect(editor.state.doc.firstChild.attrs.collapsed).toBe(true);
  tap(within(screen.getByRole("toolbar", { name: "Formatting", exact: true })).getByRole("button", { name: "Heading", exact: true }));
  tap(within(screen.getByRole("region", { name: "Heading tray" })).getByRole("button", { name: "Normal text" }));
  expect(body.querySelector(".fold-hidden")).toBeNull(); expect(editor.state.doc.firstChild.type.name).toBe("paragraph");
});
