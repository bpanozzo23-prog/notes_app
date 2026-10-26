import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import QuickAddSheet from "./QuickAddSheet.jsx";
import { getPref, setPref } from "../db/db.js";
import { noteFixture, resetDatabase } from "../test/fixtures.js";
import { dayMonth } from "../lib/dates.js";

beforeEach(resetDatabase);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const notes = [noteFixture({ id: "recent", title: "Recent", quickAdd: true, updatedAt: "2026-10-26" }),
  noteFixture({ id: "pinned", title: "Pinned", quickAdd: true, pinned: true }),
  noteFixture({ id: "old", title: "Old", quickAdd: true, updatedAt: "2026-10-01", addDate: true }), noteFixture({ title: "Off" })];
function setup(extra = {}) {
  const props = { notes, onClose: vi.fn(), onAdd: vi.fn().mockResolvedValue(true), onDraft: vi.fn(), ...extra };
  const view = render(<QuickAddSheet {...props} />);
  return { ...view, props };
}
it("orders chips pinned then recent, preselects the saved chip, and focuses the text box", async () => {
  await setPref("quickAddLast", "old"); setup();
  expect(screen.getByRole("radiogroup", { name: "Add to" })).toBeTruthy();
  expect(screen.getAllByRole("radio").map((chip) => chip.textContent)).toEqual(["Pinned", "Recent", "Old"]);
  await waitFor(() => expect(screen.getByRole("radio", { name: "Old" }).getAttribute("aria-checked")).toBe("true"));
  expect(document.activeElement).toBe(screen.getByLabelText("Text to add"));
  expect(screen.getByLabelText("Text to add").placeholder).toBe(`${dayMonth(new Date())} — …`);
  fireEvent.click(screen.getByRole("radio", { name: "Recent" }));
  expect(screen.getByLabelText("Text to add").placeholder).toBe("What do you want to add?");
});
it("falls back to the first chip when the remembered note is gone or turned off", async () => {
  await setPref("quickAddLast", "missing"); const { rerender, props } = setup();
  await waitFor(() => expect(screen.getByRole("radio", { name: "Pinned" }).getAttribute("aria-checked")).toBe("true"));
  rerender(<QuickAddSheet {...props} notes={notes.map((note) => note.id === "pinned" ? { ...note, quickAdd: false } : note)} />);
  expect(screen.queryByRole("radio", { name: "Pinned" })).toBeNull();
  expect(screen.getByRole("radio", { name: "Recent" }).getAttribute("aria-checked")).toBe("true");
});
it("shows the empty explanation with only Cancel", () => {
  const { props } = setup({ notes: [] });
  expect(screen.getByText("Turn on Quick add in a note's ⋯ menu to list it here.")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull(); expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(props.onClose).toHaveBeenCalledOnce();
});
it("enables Add only for nonblank text, reports draft transitions, and remembers a successful choice", async () => {
  const { props, unmount } = setup();
  const input = screen.getByLabelText("Text to add"), add = screen.getByRole("button", { name: "Add" });
  expect(add.disabled).toBe(true);
  fireEvent.change(input, { target: { value: " \n" } }); expect(add.disabled).toBe(true);
  fireEvent.change(input, { target: { value: " First " } }); expect(add.disabled).toBe(false);
  fireEvent.change(input, { target: { value: " First line " } });
  expect(props.onDraft.mock.calls).toEqual([[false], [true]]);
  fireEvent.click(add);
  await waitFor(() => expect(props.onAdd).toHaveBeenCalledWith("pinned", " First line "));
  await waitFor(async () => expect(await getPref("quickAddLast")).toBe("pinned"));
  expect(props.onDraft).toHaveBeenLastCalledWith(false);
  fireEvent.change(input, { target: { value: "Unsent" } }); unmount();
  expect(props.onDraft).toHaveBeenLastCalledWith(false);
});
it("retains a failed add and shows its error", async () => {
  const { props } = setup({ onAdd: vi.fn().mockResolvedValue(false), error: "Disk full" });
  fireEvent.change(screen.getByLabelText("Text to add"), { target: { value: "Keep me" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(props.onAdd).toHaveBeenCalled());
  expect(screen.getByLabelText("Text to add").value).toBe("Keep me");
  expect(screen.getByRole("alert").textContent).toBe("Disk full");
  expect(await getPref("quickAddLast")).toBeUndefined();
});
it("disables input and Add in read-only mode but permits Cancel", () => {
  setup({ readOnly: true });
  expect(screen.getByLabelText("Text to add").disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Add" }).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Cancel" }).disabled).toBe(false);
  expect(screen.getByText("Your notes are read-only right now, so nothing can be added.")).toBeTruthy();
});
it("disables every control while busy", () => {
  setup({ busy: true });
  for (const control of [...screen.getAllByRole("radio"), ...screen.getAllByRole("button"), screen.getByRole("textbox")]) expect(control.disabled).toBe(true);
});
