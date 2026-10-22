import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import App from "../App.jsx";
import SyncReview from "./SyncReview.jsx";
import SyncSettings from "./settings/SyncSettings.jsx";
import SyncBar from "../components/SyncBar.jsx";
import { db, notebookAccess, writeTransaction } from "../db/db.js";
import { createNote, updateNote } from "../db/notes.js";
import { createFolder, deleteFolder } from "../db/folders.js";
import * as syncTrigger from "../sync/trigger.js";
import { resetDatabase } from "../test/fixtures.js";
import { proposalFixture, newProposalFixture, trashProposalFixture } from "../sync/inbox-fixtures.js";
import { syncSession } from "../sync/session.js";
import { appendOutbox, readOutbox, readHandled, appendHandledInTransaction } from "../sync/prefs.js";
import { STALE_KEEP_BOTH, STALE_TRASH, STALE_GENERATION, handledEntry } from "../sync/inbox.js";
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
  await screen.findByText("2 suggestions · from Claude Code on the XPS");
  expect(screen.queryByText("No suggestions waiting.")).toBeNull();
});
it("shows the approved shared rows, quoted reason, audit, selection and title validation", async () => {
  versions[0].body += '<script>bad()</script><p style="text-align: right">Added line</p>';
  syncSession.update({ proposals: versions });
  render(<SyncReview {...props()} />);
  await screen.findByText("2 suggestions · from Claude Code on the XPS");
  expect(screen.getAllByText("“Make the fixture clearer.”")).toHaveLength(2);
  expect(screen.getByText("Nothing changes until you tap Apply or Add as a new note. Undo works afterwards.")).toBeTruthy();
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
  await screen.findByText(STALE_KEEP_BOTH);
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
  await screen.findByText(STALE_KEEP_BOTH);
  expect(screen.queryByRole("button", { name: /^(Apply|Nothing ticked)/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
});
it("preserves the reviewed diff when the source changes, with all ticks disabled", async () => {
  syncSession.update({ proposals: [versions[0]] }); render(<SyncReview {...props()} />);
  await screen.findByRole("button", { name: "Apply 2 changes to 1 note" });
  const diff = document.querySelector(".review-added")?.textContent;
  await act(async () => { await updateNote(a.id, { html: "<p>Completely different local text</p>" }); });
  await screen.findByText(STALE_KEEP_BOTH);
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
  await screen.findByText(STALE_KEEP_BOTH);
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
  fireEvent.click(await screen.findByRole("button", { name: "Claude Code has 1 suggestion · Review" }));
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
  const started = vi.spyOn(syncTrigger, "startSync");
  render(<App />); await idle();
  // App starts sync after boot; that reset must finish before the fixture state arrives.
  await waitFor(() => expect(started).toHaveBeenCalled());
  act(() => syncSession.update({ proposals: [versions[0]] }));
  fireEvent.click(await screen.findByRole("button", { name: "Claude Code has 1 suggestion · Review" }));
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
it("renders a new note and Trash, validates a new title, and applies and undoes both", async () => {
  syncSession.update({ proposals: [newProposalFixture({ newFolder: "Recipes" }), trashProposalFixture(b)] });
  render(<SyncReview {...props()} />);
  await screen.findByText("2 suggestions · from Claude Code on the XPS");
  expect(screen.getByRole("checkbox", { name: /^New note/ })).toBeTruthy(); expect(screen.getByRole("checkbox", { name: "Move to Trash" })).toBeTruthy();
  fireEvent.click(button("Edit")); fireEvent.change(screen.getByLabelText("Proposed title"), { target: { value: "x".repeat(201) } });
  expect(button("Apply 2 changes to 2 notes").disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Proposed title"), { target: { value: "My new note" } });
  fireEvent.click(button("Apply 2 changes to 2 notes")); await screen.findByText("Applied 2 changes to 2 notes.");
  const copy = await db.notes.filter((n) => n.title === "My new note").first(); expect(copy).toBeTruthy(); expect((await db.notes.get(b.id)).deletedAt).not.toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Undo Claude Code's last change" }));
  const dialog = screen.getByRole("dialog"); expect(dialog.textContent).toContain('1 new note moves to Trash, “Second note” comes back from Trash.');
  fireEvent.click(within(dialog).getByRole("button", { name: "Undo", exact: true }));
  await screen.findByText("Claude Code's change undone."); expect((await db.notes.get(copy.id)).deletedAt).not.toBeNull(); expect((await db.notes.get(b.id)).deletedAt).toBeNull();
  expect(await db.folders.count()).toBe(0);
});
it("offers Keep both only for a readable stale edit in this generation, and uses the exact stale sentences", async () => {
  await updateNote(a.id, { title: "Local" }); await updateNote(b.id, { title: "Local trash" });
  const fresh = newProposalFixture({ generation: "old" });
  syncSession.update({ proposals: [versions[0], trashProposalFixture({ ...b, rev: 1 }), fresh] });
  const view = render(<SyncReview {...props()} />);
  await screen.findByText(STALE_KEEP_BOTH); expect(button("Keep both")).toBeTruthy();
  expect(screen.getByText(STALE_TRASH)).toBeTruthy(); expect(screen.getByText(STALE_GENERATION)).toBeTruthy();
  view.unmount(); syncSession.update({ proposals: [{ ...versions[0], extra: true }] }); render(<SyncReview {...props()} />);
  await screen.findByText("This suggestion can't be read safely. Dismiss it and ask Claude Code to try again.");
  expect(screen.queryByRole("button", { name: "Keep both" })).toBeNull();
});
it("Keep both shows the fresh copy, saves it and offers Undo", async () => {
  syncSession.update({ proposals: [versions[0]] }); await updateNote(a.id, { title: "Local" });
  render(<SyncReview {...props()} />); fireEvent.click(await screen.findByRole("button", { name: "Keep both" }));
  const dialog = await screen.findByRole("dialog", { name: "Keep both" });
  expect(dialog.textContent).toContain("Clear title (from Claude Code)"); expect(dialog.textContent).toContain("New wording");
  expect(dialog.textContent).not.toContain("Old wording");
  fireEvent.click(within(dialog).getByRole("button", { name: "Add as a new note" }));
  await screen.findByText("Added “Clear title (from Claude Code)”.");
  expect(screen.queryByRole("dialog")).toBeNull(); expect(await db.notes.filter((n) => n.title === "Clear title (from Claude Code)").count()).toBe(1);
  expect((await readHandled())[0].outcome).toBe("kept"); expect((await db.notes.get(a.id)).title).toBe("Local");
});
it("offers Keep both once an unreadable card goes stale while the review is open", async () => {
  const home = await createFolder("Home"), target = await createFolder("Target");
  a = await updateNote(a.id, { folderId: home.id });
  const version = proposalFixture(a, { title: "Proposed", body: "<p>Proposed body</p>", folderId: target.id });
  await deleteFolder(target.id);
  syncSession.update({ proposals: [version] });
  render(<SyncReview {...props()} />);
  await screen.findByText(/This suggestion can't be read safely/);
  expect(screen.queryByRole("button", { name: "Keep both" })).toBeNull();
  await updateNote(a.id, { title: "Owner" });
  const keep = await screen.findByRole("button", { name: "Keep both" });
  expect(screen.queryByText(/This suggestion can't be read safely/)).toBeNull();
  fireEvent.click(keep);
  const dialog = await screen.findByRole("dialog", { name: "Keep both" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add as a new note" }));
  await screen.findByText("Added “Proposed (from Claude Code)”.");
  expect((await db.notes.filter((note) => note.title === "Proposed (from Claude Code)").first()).folderId).toBe(home.id);
});
it.each(["deleted", "ambiguous"])("offers Keep both for a stale edit with a %s folder", async (kind) => {
  const folder = await createFolder("Before");
  a = await updateNote(a.id, { folderId: folder.id });
  const version = proposalFixture(a, { title: "Proposed", body: "<p>Proposed body</p>",
    ...(kind === "ambiguous" ? { folderId: null, newFolder: "Recipes" } : {}) });
  if (kind === "ambiguous") { await createFolder("Recipes"); await createFolder("recipes"); await updateNote(a.id, { title: "Owner" }); }
  else await deleteFolder(folder.id);
  syncSession.update({ proposals: [version] });
  render(<SyncReview {...props()} />);
  const keep = await screen.findByRole("button", { name: "Keep both" });
  expect(keep.disabled).toBe(false);
  expect(screen.queryByText(/This suggestion can't be read safely/)).toBeNull();
  expect(screen.queryByRole("button", { name: /^Apply/ })).toBeNull();
  fireEvent.click(keep);
  const dialog = await screen.findByRole("dialog", { name: "Keep both" });
  expect(within(dialog).getByText(kind === "deleted" ? "No folder" : "Before")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Add as a new note" }));
  await screen.findByText("Added “Proposed (from Claude Code)”.");
  const copy = await db.notes.filter((note) => note.title === "Proposed (from Claude Code)").first();
  expect(copy.folderId).toBe(kind === "deleted" ? null : folder.id);
});
it.each(["title", "folder"])("closes Keep both on a %s race and requires opening and confirming the sheet again", async (field) => {
  syncSession.update({ proposals: [versions[0]] }); await updateNote(a.id, { title: "Local" });
  await db.folders.put({ id: "folder", name: "Folder", position: 0 });
  const shared = props(); render(<SyncReview {...shared} />);
  fireEvent.click(await screen.findByRole("button", { name: "Keep both" })); await screen.findByRole("dialog");
  shared.queue.flush.mockImplementationOnce(() => updateNote(a.id, field === "title" ? { title: "Later" } : { folderId: "folder" }));
  fireEvent.click(button("Add as a new note"));
  await screen.findByText("Something changed while you were reviewing. Nothing was added. Open Keep both and check the copy again.");
  expect(screen.queryByRole("dialog")).toBeNull(); expect(await db.notes.count()).toBe(2); expect(await readHandled()).toEqual([]);
  fireEvent.click(button("Keep both")); const dialog = await screen.findByRole("dialog");
  if (field === "folder") expect(within(dialog).getByText("Folder")).toBeTruthy();
  fireEvent.click(button("Add as a new note")); await screen.findByText("Added “Clear title (from Claude Code)”.");
});
it("disables Apply for a ticked link into ticked Trash and clears the error when either is unticked", async () => {
  syncSession.update({ proposals: [newProposalFixture({ body: `<p><a href="note:${b.id}">Same words</a></p>` }), trashProposalFixture(b)] });
  render(<SyncReview {...props()} />);
  const message = "A ticked change links to “Second note”, which you're moving to Trash. Untick one of them.";
  await screen.findByText(message); expect(button("Apply 2 changes to 2 notes").disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Move to Trash" })); expect(screen.queryByText(message)).toBeNull(); expect(button("Apply 1 change to 1 note").disabled).toBe(false);
  fireEvent.click(screen.getByRole("checkbox", { name: "Move to Trash" })); fireEvent.click(screen.getByRole("checkbox", { name: /^New note/ }));
  expect(screen.queryByText(message)).toBeNull(); expect(button("Apply 1 change to 1 note").disabled).toBe(false);
});
it("a handled version remains hidden on a fresh session, and a competing pid is Dismiss only", async () => {
  const old = newProposalFixture(), next = { ...old, hash: "d".repeat(64) };
  await writeTransaction([db.prefs], () => appendHandledInTransaction([handledEntry(old, null, "applied")]));
  syncSession.update({ proposals: [old] }); const view = render(<SyncReview {...props()} />);
  await screen.findByText("No suggestions waiting."); view.unmount(); syncSession.reset(); syncSession.update({ proposals: [next] });
  render(<SyncReview {...props()} />); await screen.findByText("You already added this note.");
  expect(screen.queryByRole("checkbox")).toBeNull(); expect(screen.queryByRole("button", { name: /^Apply/ })).toBeNull();
  expect(button("Dismiss")).toBeTruthy();
});
it("mixed Undo names its decisions without treating a new note as an edited source", async () => {
  syncSession.update({ proposals: [versions[0], newProposalFixture(), trashProposalFixture(b)] });
  render(<SyncReview {...props()} />); fireEvent.click(await screen.findByRole("button", { name: "Apply 4 changes to 3 notes" }));
  await screen.findByText("Applied 4 changes to 3 notes.");
  await act(async () => { await updateNote(a.id, { title: "My later edit" }); });
  fireEvent.click(await screen.findByRole("button", { name: "Undo Claude Code's last change" }));
  const dialog = screen.getByRole("dialog"); expect(dialog.textContent).toContain('1 note gets its earlier version back. If notes changed since, nothing is overwritten:');
  fireEvent.click(within(dialog).getByRole("button", { name: "Undo", exact: true }));
  await screen.findByText("Some notes changed after Claude Code's change.");
  expect(screen.getByText("New fixture stays as it is")).toBeTruthy(); expect(screen.getByText("Second note comes out of Trash")).toBeTruthy();
  expect(screen.getByText("My later edit stays as it is now; its earlier version comes back as “First note (before Claude)”")).toBeTruthy();
  fireEvent.click(button("Undo, keeping later changes")); await screen.findByText("Claude Code's change undone.");
  expect((await db.notes.get(a.id)).title).toBe("My later edit");
});
it("Android Back closes Show the note and Keep both before leaving the review", async () => {
  const started = vi.spyOn(syncTrigger, "startSync");
  await updateNote(a.id, { title: "Local" }); render(<App />); await idle();
  await waitFor(() => expect(started).toHaveBeenCalled());
  act(() => syncSession.update({ proposals: [versions[0], trashProposalFixture(b)] }));
  fireEvent.click(await screen.findByRole("button", { name: "Claude Code has 2 suggestions · Review" }));
  await screen.findByRole("heading", { name: "Claude Code's suggestions" }); await idle();
  fireEvent.click(await screen.findByRole("button", { name: "Show the note" }));
  const route = window.history.state[NAVIGATION_KEY];
  act(() => window.history.back()); await waitFor(() => expect(screen.queryByRole("button", { name: "Hide the note" })).toBeNull()); await idle();
  expect(window.history.state[NAVIGATION_KEY]).toEqual(route);
  fireEvent.click(button("Keep both")); await screen.findByRole("dialog", { name: "Keep both" }); await idle();
  act(() => window.history.back()); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); await idle();
  expect(window.history.state[NAVIGATION_KEY]).toEqual(route);
  expect(screen.getByRole("heading", { name: "Claude Code's suggestions" })).toBeTruthy();
  act(() => window.history.back()); await screen.findByRole("heading", { name: "Notes", exact: true }); await idle();
});

it("the list bar remembers legacy outbox-only outcomes after acknowledgement", async () => {
  await appendOutbox({ proposal: versions[0].proposal, hash: versions[0].hash, outcome: "applied", applied: [], at: new Date().toISOString() });
  syncSession.update({ proposals: versions });
  render(<SyncBar onOpen={() => {}} />);
  await screen.findByRole("button", { name: "Claude Code has 1 suggestion · Review" });
  await act(async () => { await db.prefs.delete("syncOutbox"); syncSession.update({ proposals: versions }); });
  await waitFor(() => expect(syncSession.getSnapshot().proposals).toEqual([versions[1]]));
  expect(screen.queryByRole("button", { name: "Claude Code has 2 suggestions · Review" })).toBeNull();
});
