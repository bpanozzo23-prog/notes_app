import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import App from "../App.jsx";
import SyncReview from "./SyncReview.jsx";
import SyncSettings from "./settings/SyncSettings.jsx";
import SyncBar from "../components/SyncBar.jsx";
import { db, notebookAccess } from "../db/db.js";
import { createNote, updateNote } from "../db/notes.js";
import { resetDatabase } from "../test/fixtures.js";
import { proposalFixture } from "../sync/inbox-fixtures.js";
import { syncSession } from "../sync/session.js";
import { appendOutbox, readOutbox } from "../sync/prefs.js";
import { STALE_XPS } from "../sync/inbox.js";
import { NAVIGATION_KEY } from "../lib/navigation.js";

const props = () => ({ run: async (task) => { await task(); return true; }, queue: { flush: vi.fn(async () => {}) },
  refresh: vi.fn(async () => {}), onBack: vi.fn(), busy: false });
const button = (name) => screen.getByRole("button", { name, exact: true });
const idle = () => waitFor(() => expect(document.querySelector("main > div[aria-busy]")?.getAttribute("aria-busy")).toBe("false"));
let a, b, versions;
beforeEach(async () => {
  await resetDatabase(); syncSession.reset();
  a = await createNote({ title: "First note", html: "<p>Old wording</p>" });
  b = await createNote({ title: "Second note" });
  versions = [proposalFixture(a, { title: "Clear title", body: "<p>New wording</p>" }), proposalFixture(b, { sequence: 2, tags: ["class"] })];
  window.history.replaceState(null, "");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(async () => {
  cleanup();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  syncSession.reset(); vi.restoreAllMocks();
});
it("shows an empty screen after reload and fills from the next sync state", async () => {
  render(<SyncReview {...props()} />);
  await screen.findByText("No suggestions waiting.");
  act(() => syncSession.update({ proposals: versions }));
  await screen.findByText("2 notes · from Claude Code on the XPS");
  expect(screen.queryByText("No suggestions waiting.")).toBeNull();
});
it("shows the approved shared rows, quoted reason, audit, selection and title validation", async () => {
  versions[0].body += '<script>bad()</script><p style="text-align: right">Added line</p>';
  syncSession.update({ proposals: versions });
  render(<SyncReview {...props()} />);
  await screen.findByText("2 notes · from Claude Code on the XPS");
  expect(screen.getAllByText("“Make the fixture clearer.”")).toHaveLength(2);
  expect(screen.getByText("Nothing changes until you tap Apply. Undo works afterwards.")).toBeTruthy();
  expect(screen.getByText(/Removed by the editor: 1 script; 1 style the app doesn't support/)).toBeTruthy();
  expect(screen.getAllByRole("checkbox").every((box) => box.checked)).toBe(true);
  fireEvent.click(button("Edit"));
  fireEvent.change(screen.getByLabelText("Proposed title"), { target: { value: "x".repeat(201) } });
  expect(screen.getByRole("button", { name: /^Apply/ }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Proposed title"), { target: { value: "My title" } });
  expect(screen.getByRole("button", { name: /^Apply/ }).disabled).toBe(false);
  const first = screen.getByRole("article", { name: a.title });
  fireEvent.click(within(first).getByRole("button", { name: "Untick all" }));
  expect(within(first).getAllByRole("checkbox").every((box) => !box.checked)).toBe(true);
  expect(button("Apply 1 change to 1 note").disabled).toBe(false);
  for (const card of screen.getAllByRole("article")) {
    const untick = within(card).queryByRole("button", { name: "Untick all" });
    if (untick) fireEvent.click(untick);
  }
  expect(button("Nothing ticked").disabled).toBe(true);
  fireEvent.click(within(first).getByRole("button", { name: "Tick all" }));
  expect(within(first).getAllByRole("checkbox").every((box) => box.checked)).toBe(true);
});
it("partially applies two notes and offers the xps Undo label and working Undo", async () => {
  syncSession.update({ proposals: versions }); const shared = props();
  render(<SyncReview {...shared} />);
  await screen.findByRole("button", { name: "Apply 3 changes to 2 notes" });
  fireEvent.click(screen.getByRole("checkbox", { name: /^Title:/ }));
  fireEvent.click(button("Apply 2 changes to 2 notes"));
  await screen.findByText("Applied 2 changes to 2 notes.");
  expect(shared.queue.flush).toHaveBeenCalled();
  expect((await db.notes.get(a.id))).toMatchObject({ title: a.title, html: "<p>New wording</p>" });
  expect((await db.notes.get(b.id)).tags).toEqual(["class"]);
  expect(await readOutbox()).toHaveLength(2);
  await screen.findByText("No suggestions waiting.");
  fireEvent.click(await screen.findByRole("button", { name: "Undo Claude Code's last change" }));
  await screen.findByText("Earlier version restored.");
  expect(await db.notes.get(a.id)).toEqual({ ...a, rev: a.rev + 2 });
  expect(await db.notes.get(b.id)).toEqual({ ...b, rev: b.rev + 2 });
});
it("leaves stale rows visible, grey and disabled, applies only current cards, and dismisses stale", async () => {
  syncSession.update({ proposals: versions });
  await updateNote(a.id, { title: "Phone edit" });
  render(<SyncReview {...props()} />);
  await screen.findByText(STALE_XPS);
  const stale = screen.getByRole("article", { name: "Phone edit" });
  expect(within(stale).getAllByRole("checkbox").every((box) => box.disabled)).toBe(true);
  expect(stale.querySelectorAll(".opacity-55").length).toBeGreaterThan(0);
  expect(within(stale).getByRole("button", { name: "Edit" }).disabled).toBe(true);
  fireEvent.click(button("Apply 1 change to 1 note")); await screen.findByText("Applied 1 change to 1 note.");
  expect((await db.notes.get(a.id)).title).toBe("Phone edit");
  fireEvent.click(within(stale).getByRole("button", { name: "Dismiss" }));
  await screen.findByText("No suggestions waiting.");
  expect((await readOutbox()).map(({ outcome }) => outcome)).toEqual(["applied", "stale"]);
});
it("shows no Apply bar when only stale suggestions are left", async () => {
  syncSession.update({ proposals: versions.filter((version) => version.note === a.id) });
  await updateNote(a.id, { title: "Phone edit" });
  render(<SyncReview {...props()} />);
  await screen.findByText(STALE_XPS);
  expect(screen.queryByRole("button", { name: /^(Apply|Nothing ticked)/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
});
it("preserves the reviewed diff when the source changes, with all ticks disabled", async () => {
  syncSession.update({ proposals: [versions[0]] }); render(<SyncReview {...props()} />);
  await screen.findByRole("button", { name: "Apply 2 changes to 1 note" });
  const diff = document.querySelector(".review-added")?.textContent;
  await act(async () => { await updateNote(a.id, { html: "<p>Completely different local text</p>" }); });
  await screen.findByText(STALE_XPS);
  expect(document.querySelector(".review-added")?.textContent).toBe(diff);
  expect(document.body.textContent).not.toContain("Completely different local text");
  expect(screen.getAllByRole("checkbox").every((box) => box.disabled)).toBe(true);
});
it("refuses the entire batch if a note changes during queue flush, then refreshes the cards", async () => {
  syncSession.update({ proposals: versions });
  const shared = props(); shared.queue.flush.mockImplementation(() => updateNote(b.id, { title: "Saved during flush" }));
  render(<SyncReview {...shared} />);
  fireEvent.click(await screen.findByRole("button", { name: "Apply 3 changes to 2 notes" }));
  await screen.findByText("Something changed while you were reviewing. Nothing was applied. Check the suggestions again.");
  await screen.findByText(STALE_XPS);
  expect(await db.notes.get(a.id)).toEqual(a);
  expect(await readOutbox()).toEqual([]); expect(await db.prefs.get("claudeLastChange")).toBeUndefined();
  expect(button("Apply 2 changes to 1 note").disabled).toBe(false);
});
it("Dismiss hides a current card at once and does not reappear after outbox acknowledgement", async () => {
  syncSession.update({ proposals: [versions[0]] }); render(<SyncReview {...props()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
  await screen.findByText("No suggestions waiting.");
  expect((await readOutbox())[0].outcome).toBe("dismissed");
  expect(await db.notes.get(a.id)).toEqual(a);
  await act(async () => { await db.prefs.delete("syncOutbox"); syncSession.update({ proposals: versions.slice(0, 1) }); });
  expect(screen.getByText("No suggestions waiting.")).toBeTruthy();
});
it("filters saved outcomes on mount and keeps the copy decision above proposals", async () => {
  syncSession.update({ proposals: versions, confirm: { removed: [], changed: [] } });
  await appendOutbox({ ...versions[0], outcome: "dismissed" });
  const onOpen = vi.fn(); render(<SyncBar onOpen={onOpen} />);
  fireEvent.click(button("The XPS copy needs your decision · Review"));
  expect(onOpen).toHaveBeenLastCalledWith({ screen: "settings-sync" });
  act(() => syncSession.update({ confirm: null }));
  fireEvent.click(await screen.findByRole("button", { name: "Claude Code suggests changes to 1 note · Review" }));
  expect(onOpen).toHaveBeenLastCalledWith({ screen: "sync-review" });
});
it.each([{ readOnly: true }, { replaced: true }, { versionChange: "pending" }])("disables Apply and Dismiss under notebook guard %j", async (guard) => {
  syncSession.update({ proposals: versions }); const shared = props(), view = render(<SyncReview {...shared} />);
  await screen.findByRole("button", { name: "Apply 3 changes to 2 notes" });
  vi.spyOn(notebookAccess, "getSnapshot").mockReturnValue(guard); view.rerender(<SyncReview {...shared} />);
  expect(button("Apply 3 changes to 2 notes").disabled).toBe(true);
  expect(screen.getAllByRole("button", { name: "Dismiss" }).every((button) => button.disabled)).toBe(true);
});
it("Settings → Sync offers the shared Undo and its confirmation with the xps label", async () => {
  syncSession.update({ proposals: [versions[0]] }); const shared = props(), view = render(<SyncReview {...shared} />);
  fireEvent.click(await screen.findByRole("button", { name: "Apply 2 changes to 1 note" }));
  await screen.findByText("Applied 2 changes to 1 note."); view.unmount();
  render(<SyncSettings {...shared} />);
  fireEvent.click(await screen.findByRole("button", { name: "Undo Claude Code's last change" }));
  const dialog = screen.getByRole("dialog", { name: "Undo Claude Code's last change?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Undo", exact: true }));
  await screen.findByText("Earlier version restored.");
  expect((await db.notes.get(a.id)).html).toBe(a.html);
});
it("routes through App and Android Back closes the formatted preview and title edit before leaving", async () => {
  render(<App />); await idle();
  act(() => syncSession.update({ proposals: [versions[0]] }));
  fireEvent.click(await screen.findByRole("button", { name: "Claude Code suggests changes to 1 note · Review" }));
  await screen.findByRole("heading", { name: "Claude Code's suggestions" }); await idle();
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.click(button("Show before and after"));
  const route = window.history.state[NAVIGATION_KEY];
  act(() => window.history.back());
  await waitFor(() => expect(screen.queryByText("+ After")).toBeNull());
  await idle();
  expect(screen.getByLabelText("Proposed title")).toBeTruthy();
  expect(window.history.state[NAVIGATION_KEY]).toEqual(route);
  act(() => window.history.back());
  await waitFor(() => expect(screen.queryByLabelText("Proposed title")).toBeNull());
  await idle();
  expect(screen.getByRole("heading", { name: "Claude Code's suggestions" })).toBeTruthy();
  act(() => window.history.back());
  await screen.findByRole("heading", { name: "Notes", exact: true }); await idle();
});
