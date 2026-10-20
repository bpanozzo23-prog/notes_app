import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { OverlayNavigation } from "../../lib/overlays.jsx";
import NewNoteRow from "./NewNoteRow.jsx";
import TrashRow from "./TrashRow.jsx";
import KeepBothSheet from "./KeepBothSheet.jsx";

afterEach(cleanup);
const model = { title: "Recipes", html: '<p>Good <strong>food</strong></p>', tags: ["cooking"], folder: { action: "create", name: "Recipes" },
  audit: ["1 script"], effects: [{ type: "note-link-added", href: "note:target" }, { type: "web-link-added", href: "https://example.com/full/path" }], titles: new Map([["target", "Target title"]]) };
const navigation = () => {
  const stack = [];
  return { stack, registerOverlay: (fn) => { stack.push(fn); return () => { stack.splice(stack.indexOf(fn), 1); }; } };
};
it("new-note row has one keyboard tick, title editing, green body, tag chips, folder and full link destinations", async () => {
  const user = userEvent.setup(), nav = navigation();
  function Row() {
    const [checked, setChecked] = useState(true), [title, setTitle] = useState(model.title);
    return <NewNoteRow model={model} title={title} onEdit={setTitle} titles={model.titles} error={title.length > 200 ? "Too long" : ""} checked={checked} onToggle={() => setChecked(!checked)} />;
  }
  const { container } = render(<OverlayNavigation.Provider value={nav}><Row /></OverlayNavigation.Provider>);
  const tick = screen.getByRole("checkbox", { name: "New note · 2 words" });
  expect(screen.getAllByRole("checkbox")).toHaveLength(1); await user.tab(); expect(document.activeElement).toBe(tick);
  await user.keyboard(" "); expect(tick.checked).toBe(false); await user.keyboard(" "); expect(tick.checked).toBe(true);
  expect(screen.getByText("Recipes (new folder)")).toBeTruthy(); expect(screen.getByText("+ cooking").className).toContain("--color-ins-bg");
  expect(screen.getByText("Links to: Target title · https://example.com/full/path")).toBeTruthy();
  expect(container.querySelector(".claude-preview").parentElement.className).toContain("--color-ins-ink");
  expect(container.querySelector(".ProseMirror strong").textContent).toBe("food");
  fireEvent.click(screen.getByRole("button", { name: "Edit" })); const input = screen.getByRole("textbox", { name: "Proposed title" });
  expect(document.activeElement).toBe(input); fireEvent.change(input, { target: { value: "x".repeat(201) } }); expect(input.getAttribute("aria-invalid")).toBe("true");
  fireEvent.change(input, { target: { value: "My title" } }); expect(container.querySelector("ins").textContent).toContain("My title");
  fireEvent.click(screen.getByRole("button", { name: "Edit" })); expect(screen.queryByRole("textbox", { name: "Proposed title" })).toBeNull(); expect(nav.stack).toHaveLength(0);
});
it("Trash row has one keyboard tick, a red label, backlink explanation and folded current body", async () => {
  const user = userEvent.setup(), toggle = vi.fn();
  const { container } = render(<TrashRow model={{ html: "<p>Current body</p>", backlinks: ["A", "B"] }} checked onToggle={toggle} />);
  const tick = screen.getByRole("checkbox", { name: "Move to Trash" }); await user.tab(); expect(document.activeElement).toBe(tick); await user.keyboard(" "); expect(toggle).toHaveBeenCalledOnce();
  expect(screen.getByText("Move to Trash").className).toContain("--color-del-ink");
  expect(screen.getByText("It stays in Trash for 30 days. Undo, or Restore in Trash, brings it back.")).toBeTruthy();
  expect(screen.getByText("Linked from: A, B (their links stay)")).toBeTruthy(); expect(container.querySelector(".ProseMirror")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show the note" })); expect(screen.getByText("Current body")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Hide the note" })); expect(container.querySelector(".ProseMirror")).toBeNull();
});
it("Keep both sheet shows exactly the copy, audit, links and only Add and Cancel actions", () => {
  const onAdd = vi.fn(), onClose = vi.fn();
  const view = render(<KeepBothSheet model={model} onAdd={onAdd} onClose={onClose} />);
  expect(screen.getByRole("dialog", { name: "Keep both" })).toBeTruthy(); expect(screen.getByText("Removed by the editor: 1 script.")).toBeTruthy();
  expect(screen.getByText("Links to: Target title · https://example.com/full/path")).toBeTruthy();
  expect(screen.queryByRole("checkbox")).toBeNull(); expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add as a new note" })); expect(onAdd).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(onClose).toHaveBeenCalledOnce();
  view.rerender(<KeepBothSheet model={model} onAdd={onAdd} onClose={onClose} busy />);
  expect(screen.getByRole("button", { name: "Add as a new note" }).disabled).toBe(true);
});
