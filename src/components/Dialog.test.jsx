import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Dialog from "./Dialog.jsx";
import { OverlayNavigation } from "../lib/overlays.jsx";

afterEach(() => { cleanup(); document.body.style.overflow = ""; });

it("leaves routed dialog Back to history but still closes on Escape", () => {
  const registerOverlay = vi.fn(), onClose = vi.fn();
  render(<OverlayNavigation value={{ registerOverlay }}><Dialog title="Routed" routed onClose={onClose}>Content</Dialog></OverlayNavigation>);
  expect(registerOverlay).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
});

it.each(["together", "outer first", "inner first"])("restores background locks when nested dialogs close %s", (order) => {
  document.body.style.overflow = "auto";
  const view = render(<button>Background</button>);
  const originalInert = view.container.inert;
  const opener = screen.getByRole("button"); opener.focus();
  const dialogs = (outer, inner) => <><button>Background</button>
    {outer && <Dialog title="Outer" onClose={() => {}}><button>Open inner</button></Dialog>}
    {inner && <Dialog title="Inner" onClose={() => {}}><button>Close inner</button></Dialog>}
  </>;
  view.rerender(dialogs(true, false));
  const outerLayer = screen.getByRole("dialog", { name: "Outer" }).parentElement;
  const outerButton = within(screen.getByRole("dialog")).getByRole("button");
  outerButton.focus();
  view.rerender(dialogs(true, true));
  expect(view.container.inert).toBe(true);
  expect(outerLayer.inert).toBe(true);
  if (order !== "together") {
    view.rerender(dialogs(order === "inner first", order === "outer first"));
    expect(view.container.inert).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("dialog").parentElement.inert).toBeFalsy();
    if (order === "inner first") expect(document.activeElement).toBe(outerButton);
  }
  view.rerender(dialogs(false, false));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(view.container.inert).toBe(originalInert);
  expect(document.body.style.overflow).toBe("auto");
});

it("keeps a background that was already inert and its original overflow", () => {
  const view = render(<div />);
  view.container.inert = true;
  document.body.style.overflow = "scroll";
  view.rerender(<Dialog title="Example" onClose={() => {}}>Content</Dialog>);
  view.rerender(null);
  expect(view.container.inert).toBe(true);
  expect(document.body.style.overflow).toBe("scroll");
});
