import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../../App.jsx";
import StyleSettings from "./StyleSettings.jsx";
import StyleEditor from "./StyleEditor.jsx";
import { allPrefs, db, getPref, setPref } from "../../db/db.js";
import { saveNamedStyle, deleteNamedStyle } from "../../db/styles.js";
import { resetDatabase } from "../../test/fixtures.js";
import { DEFAULT_NAMED_STYLES, resolveFormatting } from "../../editor/formatting.js";
import { DEFAULT_TOOLBAR } from "../../editor/actions.js";
import { EMPTY_LOOK } from "../../editor/look.js";

beforeEach(async () => {
  await resetDatabase(); window.history.replaceState(null, "");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(async () => { cleanup(); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); vi.restoreAllMocks(); });
const button = (name, scope = screen) => scope.getByRole("button", { name, exact: true });
const idle = async () => waitFor(() => expect(document.querySelector("main > div[aria-busy]").getAttribute("aria-busy")).toBe("false"));
async function tap(name, scope = screen) { fireEvent.click(button(name, scope)); await idle(); }
const form = () => within(screen.getByRole("dialog"));
async function start() {
  render(<App />);
  await waitFor(() => expect(button("Settings").disabled).toBe(false));
  await tap("Settings"); await tap("Named styles");
}
async function create(name, toolbar = false) {
  await tap("+ New style");
  fireEvent.change(form().getByLabelText("Name"), { target: { value: name } });
  if (toolbar) fireEvent.click(form().getByRole("switch"));
  await tap("Save", form());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  return (await getPref("namedStyles")).find((style) => style.name === name);
}
it("creates with/without a toolbar button, edits, reorders, and removes every toolbar entry when switched off", async () => {
  await start();
  expect(button("Heading")).toBeTruthy();
  expect(await getPref("namedStyles")).toBeUndefined();
  const a = await create("Palabra");
  expect(await getPref("toolbar")).toBeUndefined();
  const b = await create("Ejemplo", true);
  expect(await getPref("toolbar")).toEqual([...DEFAULT_TOOLBAR, `style:${b.id}`]);
  expect((await getPref("namedStyles"))[0]).toEqual(DEFAULT_NAMED_STYLES[0]);
  await tap("Move Ejemplo up");
  expect((await getPref("namedStyles")).map((style) => style.id)).toEqual(["default-heading", b.id, a.id]);
  await tap("Options for Ejemplo"); await tap("Move to top", form());
  expect((await getPref("namedStyles"))[0].id).toBe(b.id);
  await tap("Options for Ejemplo"); await tap("Move to bottom", form());
  expect((await getPref("namedStyles")).at(-1).id).toBe(b.id);
  await tap("Options for Ejemplo"); await tap("Edit", form());
  fireEvent.change(form().getByLabelText("Name"), { target: { value: "  Example  " } });
  fireEvent.click(button("Italic", form()));
  fireEvent.click(form().getByRole("switch"));
  await tap("Save", form());
  expect((await getPref("namedStyles")).at(-1)).toMatchObject({ name: "Example", look: { italic: true } });
  expect(await getPref("toolbar")).toEqual(DEFAULT_TOOLBAR);
});
it("confirms deletion, removes references together, and shows an empty list", async () => {
  const overflow = document.body.style.overflow;
  await setPref("toolbar", ["style:default-heading", "bold", "style:default-heading"]);
  await setPref("selectionMenu", ["style:default-heading", "style:default-heading", "italic"]);
  await start();
  await tap("Options for Heading"); await tap("Delete", form());
  expect(screen.getByText('Delete the style “Heading”? Text already styled with it keeps its look.')).toBeTruthy();
  await tap("Cancel", form()); expect(await getPref("namedStyles")).toBeUndefined();
  await tap("Heading"); await tap("Delete", form());
  const confirmation = within(screen.getByRole("dialog", { name: "Delete style?" }));
  await tap("Delete", confirmation);
  expect(await getPref("namedStyles")).toEqual([]);
  expect(await getPref("toolbar")).toEqual(["bold"]);
  expect(await getPref("selectionMenu")).toEqual(["italic"]);
  expect(screen.getByText("No named styles yet.")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.querySelector("main").parentElement.inert).toBeFalsy();
  expect(document.body.style.overflow).toBe(overflow);
});
it("shows validation errors, accepts Other size and all line choices, and includes hidden current colours", async () => {
  await start(); await tap("+ New style"); await tap("Save", form());
  expect(form().getByRole("alert").textContent).toContain("Enter a name");
  fireEvent.change(form().getByLabelText("Name"), { target: { value: "Custom" } });
  fireEvent.change(form().getByLabelText("Size"), { target: { value: "other" } });
  expect(form().getByText("Custom").style.fontSize).toBe("17pt");
  fireEvent.change(form().getByLabelText("Other size (pt)"), { target: { value: "73" } });
  await tap("Save", form());
  expect(form().getByRole("alert").textContent).toContain("whole number from 6 to 72");
  fireEvent.change(form().getByLabelText("Other size (pt)"), { target: { value: "33" } });
  for (const [label, value] of [["Typeface", "monospace"], ["Spacing", "2"], ["Line", "h3"]]) fireEvent.change(form().getByLabelText(label), { target: { value } });
  fireEvent.click(within(form().getByRole("group", { name: "Colour" })).getByRole("button", { name: "Green" }));
  fireEvent.click(within(form().getByRole("group", { name: "Highlight" })).getByRole("button", { name: "Blue" }));
  await tap("Save", form());
  expect((await getPref("namedStyles")).at(-1)).toMatchObject({ block: "h3", lineHeight: "2", look: { fontSize: "33pt", fontFamily: "monospace", color: "#15803d", highlight: "#bfdbfe" } });
  cleanup();
  const formatting = resolveFormatting(await allPrefs());
  formatting.textColors.forEach((entry) => { entry.hidden = true; }); formatting.highlightColors = [];
  render(<StyleEditor style={formatting.namedStyles.at(-1)} formatting={formatting} onClose={() => {}} />);
  expect(button("#15803d", form())).toBeTruthy(); expect(button("#bfdbfe", form())).toBeTruthy();
});
it("rolls back style save and deletion if a later preference write fails, and keeps the error visible", async () => {
  await setPref("toolbar", ["bold", "style:default-heading", "style:default-heading"]);
  await setPref("selectionMenu", ["style:default-heading"]);
  const before = await allPrefs();
  const put = db.prefs.put.bind(db.prefs);
  const spy = vi.spyOn(db.prefs, "put").mockImplementation((row) => row.key === "selectionMenu" ? Promise.reject(new Error("Storage full")) : put(row));
  await expect(deleteNamedStyle("default-heading")).rejects.toThrow("Storage full");
  expect(await allPrefs()).toEqual(before);
  spy.mockImplementation((row) => row.key === "toolbar" ? Promise.reject(new Error("Storage full")) : put(row));
  await start(); await tap("+ New style");
  fireEvent.change(form().getByLabelText("Name"), { target: { value: "Not saved" } }); fireEvent.click(form().getByRole("switch"));
  await tap("Save", form());
  expect(form().getByRole("alert").textContent).toBe("Storage full");
  expect(await allPrefs()).toEqual(before);
});
it("validates with the shared sanitizer and refuses an overfull toolbar without saving a style", async () => {
  await expect(saveNamedStyle({ id: "invalid", name: "", look: EMPTY_LOOK, block: null, lineHeight: null })).rejects.toThrow("Check the style");
  await setPref("toolbar", Array(100).fill("bold"));
  await expect(saveNamedStyle({ id: "new", name: "New", look: EMPTY_LOOK, block: null, lineHeight: null }, { toolbarChanged: true, inToolbar: true })).rejects.toThrow("toolbar is full");
  expect(await getPref("namedStyles")).toBeUndefined();
});
it("Back and Escape discard the style form without leaving Named styles", async () => {
  await start(); await tap("+ New style");
  fireEvent.change(form().getByLabelText("Name"), { target: { value: "Unsaved" } });
  const stack = window.history.state;
  act(() => window.history.back());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(window.history.state).toEqual(stack));
  expect(await getPref("namedStyles")).toBeUndefined();
  await tap("Heading"); fireEvent.keyDown(form().getByLabelText("Name"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("disables style list and form editing in read-only mode", () => {
  const formatting = resolveFormatting({}), run = vi.fn();
  const view = render(<StyleSettings formatting={formatting} readOnly run={run} />);
  expect(button("Reset").disabled).toBe(true);
  for (const control of screen.getAllByRole("button").filter((button) => button.getAttribute("aria-label") !== "Back")) expect(control.matches(":disabled")).toBe(true);
  view.rerender(<StyleEditor style={formatting.namedStyles[0]} formatting={formatting} readOnly run={run} onClose={() => {}} />);
  for (const control of screen.getByRole("dialog").querySelectorAll("button, input, select")) {
    if (control.textContent === "Cancel") continue;
    expect(control.matches(":disabled")).toBe(true);
  }
  expect(run).not.toHaveBeenCalled();
});

it("confirms Reset, restores default styles and removes every dangling style button atomically", async () => {
  const custom = { ...DEFAULT_NAMED_STYLES[0], id: "custom", name: "Custom" };
  await setPref("namedStyles", [custom]);
  await setPref("toolbar", ["bold", "style:custom", "style:default-heading", "style:gone", "style:custom"]);
  await setPref("selectionMenu", ["style:gone", "italic", "style:default-heading"]);
  const before = await allPrefs();
  await start(); await tap("Reset");
  expect(screen.getByText("Reset named styles to the default? Text already styled keeps its look.")).toBeTruthy();
  await tap("Cancel", form());
  expect(await allPrefs()).toEqual(before);
  await tap("Reset");
  const put = db.prefs.put.bind(db.prefs);
  const spy = vi.spyOn(db.prefs, "put").mockImplementation((row) => row.key === "selectionMenu" ? Promise.reject(new Error("Storage full")) : put(row));
  await tap("Reset", form());
  expect(form().getByRole("alert").textContent).toBe("Storage full");
  expect(await allPrefs()).toEqual(before);
  spy.mockRestore();
  await tap("Reset", form());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(await getPref("namedStyles")).toBeUndefined();
  expect(resolveFormatting(await allPrefs()).namedStyles).toEqual(DEFAULT_NAMED_STYLES);
  expect(button("Heading")).toBeTruthy();
  expect(await getPref("toolbar")).toEqual(["bold", "style:default-heading"]);
  expect(await getPref("selectionMenu")).toEqual(["italic", "style:default-heading"]);
});
