import { fireEvent } from "@testing-library/react";
import { vi } from "vitest";

// jsdom has no text layout. Keep real editor transactions, focus and DOM events;
// substitute only the geometry that ProseMirror and the bubble need from a browser.
export function stubEditorGeometry(editor) {
  vi.spyOn(editor.view, "scrollToSelection").mockImplementation(() => {});
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 0, bottom: 20, left: 0, right: 10 });
}

export function tapEditorLink(link) {
  const editor = link.closest(".ProseMirror").editor;
  const position = editor.view.posAtDOM(link, 0);
  const coords = vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: position, inside: 0 });
  // ProseMirror's handleClick is dispatched on mouseup, after its mousedown bookkeeping.
  fireEvent.mouseDown(link, { button: 0 });
  const allowed = fireEvent.mouseUp(link, { button: 0 });
  coords.mockRestore();
  return allowed;
}
