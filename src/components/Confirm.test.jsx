import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Confirm from "./Confirm.jsx";

afterEach(cleanup);
it("focuses Cancel, traps Tab in both directions, cancels on Escape and restores the opener", () => {
  const action = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Open</button>{open && <Confirm title="Delete?" confirmLabel="Delete" onConfirm={action} onCancel={() => setOpen(false)}>Cannot undo.</Confirm>}</>;
  }
  const view = render(<Harness />);
  const opener = screen.getByRole("button", { name: "Open" });
  opener.focus(); fireEvent.click(opener);
  const cancel = screen.getByRole("button", { name: "Cancel" });
  const confirm = screen.getByRole("button", { name: "Delete" });
  expect(document.activeElement).toBe(cancel);
  expect(view.container.inert).toBe(true);
  expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
  fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(confirm);
  fireEvent.keyDown(confirm, { key: "Tab" });
  expect(document.activeElement).toBe(cancel);
  fireEvent.keyDown(cancel, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(view.container.inert).toBeFalsy();
  expect(action).not.toHaveBeenCalled();
});
it("disables both actions and Escape while confirmation is being applied", () => {
  const cancel = vi.fn();
  render(<Confirm title="Replace?" busy onCancel={cancel} onConfirm={() => {}}>Working</Confirm>);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(cancel).not.toHaveBeenCalled();
  for (const button of screen.getAllByRole("button")) expect(button.disabled).toBe(true);
});
