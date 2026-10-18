import ColourSettings from "./ColourSettings.jsx";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../../App.jsx";
import ToolbarSettings from "./ToolbarSettings.jsx";
import PopupSettings from "./PopupSettings.jsx";
import { db, getPref, notebookAccess, setPref } from "../../db/db.js";
import { createNote } from "../../db/notes.js";
import { buildBackup, importBackup, validateBackup } from "../../db/backup.js";
import { resetDatabase } from "../../test/fixtures.js";
import { resolveFormatting } from "../../editor/formatting.js";
import { DEFAULT_TOOLBAR, DEFAULT_SELECTION_MENU } from "../../editor/actions.js";
import { activeEntry, NAVIGATION_KEY } from "../../lib/navigation.js";

beforeEach(async () => {
  await resetDatabase();
  window.history.replaceState(null, "");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("innerWidth", 375);
});
afterEach(async () => {
  cleanup();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function idle() { await waitFor(() => expect(document.querySelector("main > div[aria-busy]")?.getAttribute("aria-busy")).toBe("false")); }
async function start(screenName = "Toolbar") {
  render(<App />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Settings", exact: true }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Settings", exact: true }));
  await screen.findByRole("heading", { name: "Formatting", exact: true });
  await idle();
  fireEvent.click(screen.getByRole("button", { name: screenName, exact: true }));
  await screen.findByRole("heading", { name: screenName, exact: true });
  await idle();
}
async function click(name, scope = screen) {
  await waitFor(() => expect(scope.getByRole("button", { name, exact: true }).disabled).toBe(false));
  const key = activeEntry(window.history.state[NAVIGATION_KEY]).key;
  fireEvent.click(scope.getByRole("button", { name, exact: true }));
  if (name === "Back") await waitFor(() => expect(activeEntry(window.history.state[NAVIGATION_KEY]).key).not.toBe(key));
  await idle();
}
const list = (name = "Toolbar buttons") => within(screen.getByRole("list", { name }));
const values = async (key, expected) => waitFor(async () => expect(await getPref(key)).toEqual(expected));

it("saves layout, reorder, long-distance moves, removals and additions immediately; the preview and note agree", async () => {
  await createNote({ title: "Fixture note" });
  await setPref("toolbar", ["bold", "unknown", "italic", "h3"]);
  await start();
  const preview = screen.getByRole("toolbar", { name: "Toolbar preview" });
  expect(within(preview).getAllByRole("button").map((button) => button.title)).toEqual(["Bold", "Italic", "Heading 3"]);
  const unavailable = screen.getByText("Unavailable button").closest("li");
  expect(within(unavailable).getAllByRole("button").map((button) => button.textContent)).toEqual(["Remove"]);
  await click("Remove", within(unavailable));
  await values("toolbar", ["bold", "italic", "h3"]);
  await click("Move Heading 3 up");
  await values("toolbar", ["bold", "h3", "italic"]);
  await click("Options for Italic");
  await click("Move to top", within(screen.getByRole("dialog")));
  await values("toolbar", ["italic", "bold", "h3"]);
  await click("Options for Italic");
  await click("Move to bottom", within(screen.getByRole("dialog")));
  await values("toolbar", ["bold", "h3", "italic"]);
  await click("Options for Heading 3");
  await click("Remove", within(screen.getByRole("dialog")));
  await values("toolbar", ["bold", "italic"]);
  await click("+ Add buttons");
  const sheet = within(screen.getByRole("dialog"));
  expect(document.activeElement).toBe(sheet.getByRole("heading", { name: "Text" }));
  expect(sheet.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["Text", "Colours", "Size & font", "Lines & blocks", "Insert", "Tools"]);
  expect(sheet.getByRole("button", { name: "Added Bold" }).disabled).toBe(true);
  await click("Add Heading 3", sheet);
  await values("toolbar", ["bold", "italic", "h3"]);
  expect(sheet.getByRole("button", { name: "Added Heading 3" }).disabled).toBe(true);
  expect(screen.getByRole("dialog")).toBeTruthy();
  await click("Add Divider", sheet);
  await click("Done", sheet);
  fireEvent.click(screen.getByRole("radio", { name: "One row + More" }));
  await values("toolbarLayout", "more");
  await idle();
  await click("Back"); // Settings
  await click("Back"); // Notes
  fireEvent.click(screen.getByRole("button", { name: "Fixture note" }));
  await screen.findByLabelText("Note body");
  const toolbar = screen.getByRole("toolbar", { name: "Formatting", exact: true });
  expect(within(toolbar).getAllByRole("button").map((button) => button.title)).toEqual(["Bold", "Italic", "Heading 3", "Divider"]);
});

it("uses the preview capacity to place More's divider after visible known buttons, keeping duplicates", async () => {
  await setPref("toolbar", ["future", ...Array(16).fill("bold"), "h3"]);
  await setPref("toolbarLayout", "rows");
  await start();
  const rows = list().getAllByRole("listitem");
  expect(rows[16].textContent).toBe("Below this line: in ⋯ More");
  expect(rows[17].textContent).toBe("Bold");
  expect(within(screen.getByRole("toolbar", { name: "Toolbar preview" })).getAllByRole("button")).toHaveLength(16);
  fireEvent.click(screen.getByRole("radio", { name: "One row, swipe" }));
  await values("toolbarLayout", "scroll");
  await waitFor(() => expect(screen.queryByText("Below this line: in ⋯ More")).toBeNull());
});

it("preserves an empty toolbar and resets by removing both preference keys, leaving the pop-up alone", async () => {
  await setPref("toolbar", []);
  await setPref("toolbarLayout", "rows");
  await setPref("selectionMenu", ["h3"]);
  await start();
  expect(screen.getByText("Your toolbar is empty. Add buttons below.")).toBeTruthy();
  await click("Reset");
  expect(screen.getByRole("dialog").textContent).toContain("Reset the toolbar to the default buttons and layout?");
  await click("Cancel", within(screen.getByRole("dialog")));
  expect(await getPref("toolbar")).toEqual([]);
  await click("Reset");
  await click("Reset", within(screen.getByRole("dialog")));
  await values("toolbar", undefined);
  expect(await getPref("toolbarLayout")).toBeUndefined();
  expect(await getPref("selectionMenu")).toEqual(["h3"]);
  expect(list().getAllByRole("listitem")).toHaveLength(DEFAULT_TOOLBAR.length);
  expect(screen.getByRole("radio", { name: "One row, swipe" }).checked).toBe(true);
});

it("edits and resets the selection list independently and warns when it exceeds one row", async () => {
  await setPref("toolbar", ["italic"]);
  await setPref("selectionMenu", ["bold"]);
  await start("Selection pop-up");
  expect(screen.queryByRole("radio")).toBeNull();
  expect(screen.getByText("Shows when you select text. About 8 buttons fit in one row; up to two rows, then ⋯ More.")).toBeTruthy();
  await click("+ Add buttons");
  for (const label of ["Italic", "Underline", "Strikethrough", "Highlight", "Red", "Green", "Blue", "Heading 3"]) {
    await click(`Add ${label}`, within(screen.getByRole("dialog")));
  }
  await click("Done", within(screen.getByRole("dialog")));
  expect(screen.getByText(/These buttons take more than one row/)).toBeTruthy();
  await click("Move Heading 3 up");
  expect((await getPref("selectionMenu")).at(-2)).toBe("h3");
  await click("Reset");
  await click("Reset", within(screen.getByRole("dialog")));
  await values("selectionMenu", undefined);
  expect(list("Selection pop-up buttons").getAllByRole("listitem")).toHaveLength(DEFAULT_SELECTION_MENU.length);
  expect(await getPref("toolbar")).toEqual(["italic"]);
});

it("surfaces a failed guarded preference write in the existing error and retains the saved list", async () => {
  await setPref("toolbar", ["bold"]);
  await start();
  const put = vi.spyOn(db.prefs, "put").mockRejectedValueOnce(new Error("Storage full"));
  await click("+ Add buttons");
  await click("Add Heading 3", within(screen.getByRole("dialog")));
  expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe("Storage full");
  expect(await getPref("toolbar")).toEqual(["bold"]);
  expect(list().getAllByRole("listitem")).toHaveLength(1);
  put.mockRestore();
  await click("Add Heading 3", within(screen.getByRole("dialog")));
  await values("toolbar", ["bold", "h3"]);
});

it("uses the generation guard for preference writes and leaves another window's replacement intact", async () => {
  await setPref("toolbar", ["bold"]);
  await start();
  await db.prefs.put({ key: "notebookGeneration", value: "fixture-replacement" });
  await click("+ Add buttons");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add Heading 3" }));
  await screen.findAllByText(/The notebook was replaced in another window/);
  expect(await getPref("toolbar")).toEqual(["bold"]);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("rolls back both toolbar reset keys on failure and keeps the confirmation open", async () => {
  await setPref("toolbar", ["h3"]);
  await setPref("toolbarLayout", "rows");
  await start();
  vi.spyOn(db.prefs, "bulkDelete").mockImplementationOnce(async () => {
    await db.prefs.delete("toolbar");
    throw new Error("Reset failed");
  });
  await click("Reset");
  await click("Reset", within(screen.getByRole("dialog")));
  expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe("Reset failed");
  expect(await getPref("toolbar")).toEqual(["h3"]);
  expect(await getPref("toolbarLayout")).toBe("rows");
});

it.each([ToolbarSettings, PopupSettings])("disables every editing control in read-only formatting screens", (Component) => {
  const run = vi.fn();
  render(<Component formatting={resolveFormatting({ toolbar: ["bold", "unknown"], selectionMenu: ["italic", "unknown"] })} readOnly run={run} />);
  for (const control of screen.getAllByRole("button").filter((button) => button.getAttribute("aria-label") !== "Back")) expect(control.matches(":disabled")).toBe(true);
  for (const radio of screen.queryAllByRole("radio")) expect(radio.matches(":disabled")).toBe(true);
  expect(run).not.toHaveBeenCalled();
});

it("restores Settings scroll and closes the Add sheet on Back without removing its history visit", async () => {
  render(<App />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Settings", exact: true }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Settings", exact: true }));
  await screen.findByRole("heading", { name: "Formatting" }); await idle();
  vi.stubGlobal("scrollY", 190);
  fireEvent(window, new Event("scroll"));
  await click("Toolbar");
  await click("+ Add buttons");
  const stack = window.history.state[NAVIGATION_KEY];
  act(() => window.history.back());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await idle();
  expect(window.history.state[NAVIGATION_KEY]).toEqual(stack);
  expect(screen.getByRole("heading", { name: "Toolbar", exact: true })).toBeTruthy();
  act(() => window.history.back());
  await screen.findByRole("heading", { name: "Settings", exact: true });
  expect(window.scrollTo).toHaveBeenLastCalledWith(0, 190);
  expect(activeEntry(window.history.state[NAVIGATION_KEY]).screen).toBe("settings");
});

it("round-trips UI choices through the existing schema-3 backup preferences", async () => {
  await start();
  fireEvent.click(screen.getByRole("radio", { name: "Two rows" }));
  await values("toolbarLayout", "rows"); await idle();
  await click("+ Add buttons");
  await click("Add Heading 3", within(screen.getByRole("dialog")));
  await click("Done", within(screen.getByRole("dialog")));
  const backup = await buildBackup();
  expect(backup.schemaVersion).toBe(3);
  expect(backup.preferences.toolbarLayout).toBe("rows");
  expect(backup.preferences.toolbar.at(-1)).toBe("h3");
  cleanup();
  const validated = validateBackup(JSON.stringify(backup));
  expect(validated.ok).toBe(true);
  await setPref("toolbar", []);
  await importBackup(validated.envelope);
  await notebookAccess.load();
  expect(await getPref("toolbar")).toEqual([...DEFAULT_TOOLBAR, "h3"]);
  expect(await getPref("toolbarLayout")).toBe("rows");
});

it("edits each palette immediately: reorder, hide, add, duplicate/show, delete custom and reset", async () => {
  await start("Colours");
  await click("Move Red down");
  expect((await getPref("textColors"))[1].name).toBe("Red");
  await click("Options for Red");
  expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Delete" })).toBeNull();
  await click("Move to bottom", within(screen.getByRole("dialog")));
  expect((await getPref("textColors")).at(-1).name).toBe("Red");
  await click("Options for Red");
  await click("Move to top", within(screen.getByRole("dialog")));
  await click("Hide Red");
  expect((await getPref("textColors"))[0].hidden).toBe(true);
  expect(screen.getByText("Red (hidden)")).toBeTruthy();
  await click("+ Add a colour");
  let sheet = within(screen.getByRole("dialog"));
  expect(sheet.getByRole("button", { name: "Add colour" }).disabled).toBe(true);
  fireEvent.change(sheet.getByLabelText("Name"), { target: { value: "Duplicate" } });
  fireEvent.change(sheet.getByLabelText("Colour"), { target: { value: "#dc2626" } });
  await click("Add colour", sheet);
  expect(sheet.getByText("That colour is already in the list")).toBeTruthy();
  await click("Show Red", sheet);
  expect((await getPref("textColors"))[0].hidden).toBe(false);
  await click("+ Add a colour");
  sheet = within(screen.getByRole("dialog"));
  fireEvent.change(sheet.getByLabelText("Name"), { target: { value: "  Ink  " } });
  fireEvent.change(sheet.getByLabelText("Colour"), { target: { value: "#123456" } });
  await click("Add colour", sheet);
  expect((await getPref("textColors")).at(-1)).toEqual({ color: "#123456", name: "Ink", hidden: false, custom: true });
  await click("Options for Ink");
  await click("Delete", within(screen.getByRole("dialog")));
  expect(screen.getByRole("dialog").textContent).toContain("Delete Ink from this palette?");
  await click("Cancel", within(screen.getByRole("dialog")));
  expect((await getPref("textColors")).at(-1).name).toBe("Ink");
  await click("Options for Ink"); await click("Delete", within(screen.getByRole("dialog")));
  await click("Delete", within(screen.getByRole("dialog")));
  expect((await getPref("textColors")).some((entry) => entry.name === "Ink")).toBe(false);
  await click("Highlight");
  await click("Hide Yellow");
  expect((await getPref("highlightColors"))[0].hidden).toBe(true);
  await click("Reset"); await click("Reset", within(screen.getByRole("dialog")));
  expect(await getPref("highlightColors")).toBeUndefined();
  expect(await getPref("textColors")).toBeDefined();
  await click("Text"); await click("Reset"); await click("Reset", within(screen.getByRole("dialog")));
  expect(await getPref("textColors")).toBeUndefined();
});

it("keeps a failed palette write visible without changing the palette", async () => {
  await start("Colours");
  vi.spyOn(db.prefs, "put").mockRejectedValueOnce(new Error("Palette storage full"));
  await click("Hide Red");
  expect(screen.getByRole("alert").textContent).toContain("Palette storage full");
  expect(await getPref("textColors")).toBeUndefined();
  expect(screen.getByRole("button", { name: "Hide Red" })).toBeTruthy();
});


it("disables palette edits in read-only mode while allowing the two palettes to be viewed", () => {
  const run = vi.fn();
  render(<ColourSettings formatting={resolveFormatting({})} readOnly run={run} />);
  for (const control of screen.getAllByRole("button")) {
    if (["Back", "Text", "Highlight"].includes(control.getAttribute("aria-label") ?? control.textContent)) continue;
    expect(control.disabled).toBe(true);
  }
  fireEvent.click(screen.getByRole("button", { name: "Highlight", exact: true }));
  expect(screen.getByRole("button", { name: "Hide Yellow" }).disabled).toBe(true);
  expect(run).not.toHaveBeenCalled();
});
