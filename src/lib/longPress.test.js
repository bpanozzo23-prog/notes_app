import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLongPress } from "./longPress.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
const pointer = (button, type, extra = {}) => fireEvent(button, new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: 20, clientY: 30, ...extra }));
function setup(options = {}) {
  const onTap = vi.fn(), onLongPress = vi.fn();
  function Harness() { return createElement("button", useLongPress({ onTap, onLongPress, ...options }), "Add"); }
  const view = render(createElement(Harness));
  return { ...view, button: screen.getByRole("button"), onTap, onLongPress };
}
it("fires at 500 ms, captures the pointer without cancelling focus, and swallows the click", () => {
  const { button, onTap, onLongPress } = setup();
  button.setPointerCapture = vi.fn();
  expect(pointer(button, "pointerdown")).toBe(true);
  expect(button.setPointerCapture).toHaveBeenCalledWith(1);
  act(() => vi.advanceTimersByTime(499)); expect(onLongPress).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1)); expect(onLongPress).toHaveBeenCalledOnce();
  pointer(button, "pointerup"); fireEvent.click(button); expect(onTap).not.toHaveBeenCalled();
  fireEvent.click(button); expect(onTap).toHaveBeenCalledOnce();
});
it("taps on release at 499 ms and supports keyboard clicks", () => {
  const { button, onTap, onLongPress } = setup();
  pointer(button, "pointerdown"); act(() => vi.advanceTimersByTime(499));
  pointer(button, "pointerup"); fireEvent.click(button);
  act(() => vi.advanceTimersByTime(500));
  expect(onTap).toHaveBeenCalledOnce(); expect(onLongPress).not.toHaveBeenCalled();
  fireEvent.click(button); expect(onTap).toHaveBeenCalledTimes(2);
});
it.each(["pointermove", "pointercancel"])("cancels both actions on %s", (type) => {
  const { button, onTap, onLongPress } = setup();
  pointer(button, "pointerdown"); pointer(button, type, { clientX: 31 });
  act(() => vi.advanceTimersByTime(500)); pointer(button, "pointerup"); fireEvent.click(button);
  expect(onTap).not.toHaveBeenCalled(); expect(onLongPress).not.toHaveBeenCalled();
});
it("ends the hold when the pointer leaves, but leaves the click to the browser", () => {
  const { button, onTap, onLongPress } = setup();
  pointer(button, "pointerdown"); pointer(button, "pointerout");
  act(() => vi.advanceTimersByTime(500)); expect(onLongPress).not.toHaveBeenCalled();
  pointer(button, "pointerup"); fireEvent.click(button); expect(onTap).toHaveBeenCalledOnce();
});
it("still taps when touch fires pointerleave between pointerup and click", () => {
  const { button, onTap, onLongPress } = setup();
  pointer(button, "pointerdown"); act(() => vi.advanceTimersByTime(200));
  pointer(button, "pointerup"); pointer(button, "pointerout"); fireEvent.click(button);
  expect(onTap).toHaveBeenCalledOnce(); expect(onLongPress).not.toHaveBeenCalled();
});
it("uses custom delay/tolerance, ignores secondary buttons, and prevents the context menu", () => {
  const { button, onLongPress } = setup({ delay: 200, moveTolerance: 5 });
  expect(fireEvent.contextMenu(button)).toBe(false);
  pointer(button, "pointerdown", { button: 2 }); act(() => vi.advanceTimersByTime(500));
  expect(onLongPress).not.toHaveBeenCalled();
  pointer(button, "pointerdown"); pointer(button, "pointermove", { clientX: 23, clientY: 34 });
  act(() => vi.advanceTimersByTime(200)); expect(onLongPress).toHaveBeenCalledOnce();
});
it("clears its pending timer on unmount", () => {
  const { button, onLongPress, unmount } = setup();
  pointer(button, "pointerdown"); unmount(); act(() => vi.advanceTimersByTime(500));
  expect(onLongPress).not.toHaveBeenCalled();
});
