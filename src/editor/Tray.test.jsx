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
