import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ActionButton from "./ActionButton.jsx";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const pointer = (button, type, extra = {}) => fireEvent(button, new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: 20, clientY: 30, ...extra }));

it.each(["touch", "pen", "mouse"])("labels a 500 ms %s press and suppresses its click", (pointerType) => {
  const action = vi.fn();
  render(<ActionButton label="Heading 3" onAction={action}>H3</ActionButton>);
  const button = screen.getByRole("button");
  expect(button.title).toBe("Heading 3");
  expect(pointer(button, "pointerdown", { pointerType })).toBe(false);
  act(() => vi.advanceTimersByTime(499));
  expect(screen.queryByRole("tooltip")).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole("tooltip").textContent).toBe("Heading 3");
  pointer(button, "pointerup", { pointerType });
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.click(button);
  expect(action).not.toHaveBeenCalled();
  pointer(button, "pointerdown", { pointerType });
  act(() => vi.advanceTimersByTime(100));
  pointer(button, "pointerup", { pointerType });
  fireEvent.click(button);
  expect(action).toHaveBeenCalledOnce();
});

it.each(["pointermove", "pointercancel"])("cancels a label and tap after %s", (event) => {
  const action = vi.fn();
  render(<ActionButton label="Bold" onAction={action}>B</ActionButton>);
  const button = screen.getByRole("button");
  pointer(button, "pointerdown", { pointerType: "touch" });
  act(() => vi.advanceTimersByTime(200));
  pointer(button, event, { clientX: 31, pointerType: "touch" });
  act(() => vi.advanceTimersByTime(500));
  expect(screen.queryByRole("tooltip")).toBeNull();
  pointer(button, "pointerup");
  fireEvent.click(button);
  expect(action).not.toHaveBeenCalled();
});

it("allows small movement, expires the label, and cancels a short press timer", () => {
  const action = vi.fn();
  render(<ActionButton label="Bold" onAction={action}>B</ActionButton>);
  const button = screen.getByRole("button");
  pointer(button, "pointerdown");
  pointer(button, "pointermove", { clientX: 26, clientY: 34 });
  act(() => vi.advanceTimersByTime(500));
  expect(screen.getByRole("tooltip")).toBeTruthy();
  act(() => vi.advanceTimersByTime(1500));
  expect(screen.queryByRole("tooltip")).toBeNull();
  pointer(button, "pointerup"); fireEvent.click(button);
  expect(action).not.toHaveBeenCalled();
  pointer(button, "pointerdown"); pointer(button, "pointerup"); fireEvent.click(button);
  act(() => vi.advanceTimersByTime(500));
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(action).toHaveBeenCalledOnce();
});

it("labels pen hover after 300 ms and cancels it on leaving", () => {
  render(<ActionButton label="Bold">B</ActionButton>);
  const button = screen.getByRole("button");
  pointer(button, "pointerover", { pointerType: "pen", buttons: 0 });
  act(() => vi.advanceTimersByTime(300));
  expect(screen.getByRole("tooltip")).toBeTruthy();
  pointer(button, "pointerout", { pointerType: "pen" });
  expect(screen.queryByRole("tooltip")).toBeNull();
});
