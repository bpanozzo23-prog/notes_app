import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App.jsx";
import { db, getPref, setPref } from "./db/db.js";
import { createNote, getNote, trashNote } from "./db/notes.js";
import { backupFixture, noteFixture, resetDatabase } from "./test/fixtures.js";
import { createFolder } from "./db/folders.js";
import { NAVIGATION_KEY, activeEntry } from "./lib/navigation.js";
import { downloadJson } from "./lib/file.js";

vi.mock("./lib/file.js", async (importOriginal) => ({ ...await importOriginal(), downloadJson: vi.fn() }));
const pwa = vi.hoisted(() => ({ needRefresh: false, offlineReady: false, update: vi.fn(), options: null, setOfflineReady: null }));
vi.mock("virtual:pwa-register/react", async () => {
  const { useState } = await import("react");
  return { useRegisterSW: (options) => {
    pwa.options = options;
    const offline = useState(pwa.offlineReady);
    pwa.setOfflineReady = offline[1];
    return { needRefresh: [pwa.needRefresh, vi.fn()], offlineReady: offline, updateServiceWorker: pwa.update };
  } };
});
let persist;
beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  window.history.replaceState(null, "");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  pwa.needRefresh = false;
  pwa.offlineReady = false;
  pwa.update.mockResolvedValue(undefined);
  persist = vi.fn().mockResolvedValue(true);
  Object.defineProperty(navigator, "storage", { configurable: true, value: { persist } });
});
afterEach(async () => {
  cleanup();
  // Let unmount's flush finish before the next test deletes the database.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete navigator.storage;
});
async function start() {
  render(<StrictMode><App /></StrictMode>);
  await waitFor(() => expect(screen.getByRole("button", { name: "+ New note" }).disabled).toBe(false));
}
async function openNote(title) {
  fireEvent.click(screen.getByRole("button", { name: title }));
  await screen.findByLabelText("Title");
  await waitFor(() => expect(screen.getByRole("button", { name: "Back" }).disabled).toBe(false));
}
async function back() {
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByRole("button", { name: "+ New note" });
}
async function settings() {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("button", { name: "Export backup" });
}
async function upload(raw) {
  fireEvent.change(screen.getByLabelText("Import backup"), { target: { files: [new File([typeof raw === "string" ? raw : JSON.stringify(raw)], "fixture.json", { type: "application/json" })] } });
  await screen.findByText("fixture.json");
}

it("creates, autosaves, leaves/reopens, exports and trashes a real fixture note", async () => {
  await start();
  fireEvent.click(screen.getByRole("button", { name: "+ New note" }));
  const title = await screen.findByLabelText("Title");
  await waitFor(() => expect(screen.getByRole("button", { name: "Back" }).disabled).toBe(false));
  fireEvent.change(title, { target: { value: "Fixture title" } });
  act(() => screen.getByLabelText("Note body").editor.commands.insertContent("Fixture body"));
  await back();
  const [stored] = await db.notes.toArray();
  expect(stored).toMatchObject({ title: "Fixture title", text: "Fixture body" });
  expect(persist).toHaveBeenCalledTimes(1);
  expect(await getPref("storagePersisted")).toBe(true);
  await openNote("Fixture title");
  expect(screen.getByLabelText("Note body").textContent).toBe("Fixture body");
  await back();
  await settings();
  fireEvent.click(screen.getByRole("button", { name: "Export backup" }));
  await screen.findByText("Backup download started.");
  expect(downloadJson.mock.calls[0][0].notes).toEqual([stored]);
  expect(await getPref("lastBackupAt")).toBeTruthy();
  await back();
  await openNote("Fixture title");
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
  await screen.findByText("No notes yet.");
  expect((await getNote(stored.id)).deletedAt).not.toBeNull();
});
it("previews import and cancellation; downloads a safety copy before replacing all tables", async () => {
  const original = await createNote({ title: "Original" });
  await setPref("privateKey", "fixture-only");
  await start();
  await settings();
  await upload(backupFixture());
  expect(screen.getByText("1 notes (0 in Trash), 0 folders, 0 deletion records.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Replace notebook" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog.textContent).toContain("Replace 1 notes and 0 folders with 1 notes and 0 folders?");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(await db.notes.toArray()).toEqual([original]);
  expect(downloadJson).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole("button", { name: "Replace notebook" }).disabled).toBe(false));
  const writes = [];
  downloadJson.mockImplementationOnce((backup, filename) => {
    writes.push("download");
    expect(backup.notes).toEqual([original]);
    expect(backup.preferences).not.toHaveProperty("privateKey");
    expect(filename).toMatch(/^before-import-notes-backup-/);
  });
  const bulk = db.notes.bulkAdd.bind(db.notes);
  vi.spyOn(db.notes, "bulkAdd").mockImplementation((rows) => { writes.push("import"); return bulk(rows); });
  fireEvent.click(screen.getByRole("button", { name: "Replace notebook" }));
  fireEvent.click(screen.getByRole("button", { name: "Import and replace" }));
  await screen.findByText(/Backup imported/);
  expect(writes).toEqual(["download", "import"]);
  expect(await db.notes.toArray()).toEqual(backupFixture().notes);
  // Device-local settings are not in the file and survive a restore.
  expect(await getPref("privateKey")).toBe("fixture-only");
});
it("shows invalid-file errors without offering replacement, and aborts if the safety download fails", async () => {
  const original = await createNote({ title: "Keep" });
  await start();
  await settings();
  await upload("not JSON");
  expect(screen.getByRole("alert").textContent).toContain("not valid JSON");
  expect(screen.queryByRole("button", { name: "Replace notebook" })).toBeNull();
  await upload(backupFixture());
  downloadJson.mockImplementationOnce(() => { throw new Error("Download failed"); });
  fireEvent.click(screen.getByRole("button", { name: "Replace notebook" }));
  fireEvent.click(screen.getByRole("button", { name: "Import and replace" }));
  await within(screen.getByRole("dialog")).findByText("Download failed");
  expect(await db.notes.toArray()).toEqual([original]);
});
it("shows persistent save failure, keeps the editor open, and retries before navigation", async () => {
  const original = await createNote({ title: "Original" });
  await start();
  await openNote("Original");
  const put = vi.spyOn(db.notes, "put").mockRejectedValue(new Error("Quota exceeded"));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Unsaved title" } });
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByText("Not saved");
  expect(screen.getByLabelText("Title").value).toBe("Unsaved title");
  expect((await getNote(original.id)).title).toBe("Original");
  put.mockRestore();
  await waitFor(() => expect(screen.getByRole("button", { name: "Retry save" }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(screen.queryByText("Not saved")).toBeNull());
  await back();
  expect((await getNote(original.id)).title).toBe("Unsaved title");
});
it.each(["blur", "hidden", "pagehide"])("flushes pending title edits on %s", async (event) => {
  const original = await createNote({ title: "Original" });
  await start();
  await openNote("Original");
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Flush me" } });
  if (event === "blur") fireEvent.blur(screen.getByLabelText("Title"));
  if (event === "hidden") {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
  }
  if (event === "pagehide") fireEvent(window, new Event("pagehide"));
  // Less than the 400 ms debounce: this must be the event's explicit flush.
  await waitFor(async () => expect((await getNote(original.id)).title).toBe("Flush me"), { timeout: 300 });
});
it("purges expired fixture notes on startup and reads the saved toolbar", async () => {
  const old = await createNote({ title: "Old" });
  await db.notes.update(old.id, { deletedAt: "2020-01-01T00:00:00.000Z" });
  await createNote({ title: "Live" });
  await setPref("toolbar", ["h1"]);
  await start();
  expect(await getNote(old.id)).toBeUndefined();
  expect(await db.tombstones.get(old.id)).toMatchObject({ id: old.id });
  await openNote("Live");
  const toolbar = screen.getByRole("toolbar");
  expect(toolbar.querySelectorAll("button")).toHaveLength(1);
  expect(toolbar.textContent).not.toContain("Bold");
});

it("does not claim persistence from an imported preference when this browser lacks the API", async () => {
  delete navigator.storage;
  await setPref("storagePersisted", true);
  await start();
  await settings();
  expect(screen.getByText("Persistent storage: Unavailable in this browser")).toBeTruthy();
});

it("queues folder, tag and pin edits together with body edits, and reopens the saved metadata", async () => {
  const folder = await createFolder("Reading");
  const original = await createNote({ title: "Metadata" });
  await db.notes.add(noteFixture({ tags: ["Spanish"] }));
  await start();
  await openNote("Metadata");
  fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reading" }));
  fireEvent.change(screen.getByLabelText("Add tag"), { target: { value: "new tag" } });
  fireEvent.keyDown(screen.getByLabelText("Add tag"), { key: "Enter" });
  fireEvent.change(screen.getByLabelText("Add tag"), { target: { value: "spa" } });
  fireEvent.click(screen.getByRole("button", { name: "Spanish", exact: true }));
  fireEvent.change(screen.getByLabelText("Add tag"), { target: { value: "comma," } });
  fireEvent.click(screen.getByRole("button", { name: "Remove tag new tag" }));
  fireEvent.click(screen.getByRole("button", { name: "Pin note" }));
  act(() => screen.getByLabelText("Note body").editor.commands.insertContent("Saved body"));
  await back();
  expect(await getNote(original.id)).toMatchObject({ folderId: folder.id, tags: ["Spanish", "comma"], pinned: true, text: "Saved body" });
  await openNote("Metadata");
  expect(screen.getByRole("button", { name: "Choose folder" }).textContent).toBe("Reading");
  expect(screen.getByRole("button", { name: "Pin note" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "Remove tag Spanish" })).toBeTruthy();
});

it("creates in the filtered folder and Android Back restores that filter and scroll", async () => {
  const folder = await createFolder("Reading");
  await start();
  fireEvent.click(screen.getByRole("button", { name: "Reading" }));
  Object.defineProperty(window, "scrollY", { configurable: true, value: 260 });
  fireEvent(window, new Event("scroll"));
  fireEvent.click(screen.getByRole("button", { name: "+ New note" }));
  await screen.findByLabelText("Title");
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "In folder" } });
  act(() => window.history.back());
  await screen.findByRole("button", { name: "+ New note" });
  expect(screen.getByRole("button", { name: "Reading" }).getAttribute("aria-pressed")).toBe("true");
  expect(window.scrollTo).toHaveBeenLastCalledWith(0, 260);
  expect((await db.notes.toArray())[0]).toMatchObject({ folderId: folder.id, title: "In folder" });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
});

it("creates, renames and reorders folders; confirming deletion moves both live and trashed notes", async () => {
  const folder = await createFolder("Old folder");
  const live = await createNote({ title: "Live", folderId: folder.id });
  const deleted = await createNote({ title: "Deleted", folderId: folder.id });
  await trashNote(deleted.id);
  await start();
  fireEvent.click(screen.getByRole("button", { name: "Folders" }));
  await screen.findByLabelText("New folder name");
  fireEvent.change(screen.getByLabelText("New folder name"), { target: { value: "Second" } });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await screen.findByRole("button", { name: "Move Second up" });
  fireEvent.click(screen.getByRole("button", { name: "Move Second up" }));
  await waitFor(async () => expect((await db.folders.orderBy("position").first()).name).toBe("Second"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Move Second up" }).disabled).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "Rename Old folder" }));
  fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: "Renamed" } });
  fireEvent.click(screen.getByRole("button", { name: "Save name" }));
  await screen.findByRole("button", { name: "Delete Renamed" });
  fireEvent.click(screen.getByRole("button", { name: "Delete Renamed" }));
  expect(screen.getByRole("dialog").textContent).toContain("2 notes (including any in Trash) will move to no folder");
  fireEvent.click(screen.getByRole("button", { name: "Delete folder", exact: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(await db.folders.get(folder.id)).toBeUndefined();
  expect((await getNote(live.id)).folderId).toBeNull();
  expect((await getNote(deleted.id)).folderId).toBeNull();
});

it("restores from Trash and purges now only after confirmation, with tombstone and link cleanup", async () => {
  const target = await createNote({ title: "Trash fixture" });
  const source = await createNote({ title: "Link source", html: `<p><a href="note:${target.id}">Keep text</a></p>` });
  await trashNote(target.id);
  await start();
  fireEvent.click(screen.getByRole("button", { name: "Trash (1)" }));
  await screen.findByRole("button", { name: "Restore" });
  expect(screen.getByText(/expires in 30 days/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  await screen.findByText("Trash is empty.");
  expect((await getNote(target.id)).deletedAt).toBeNull();
  await back();
  await openNote("Trash fixture");
  fireEvent.click(screen.getByRole("button", { name: "Delete", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
  await screen.findByRole("button", { name: "Trash (1)" });
  fireEvent.click(screen.getByRole("button", { name: "Trash (1)" }));
  await screen.findByRole("button", { name: "Delete now" });
  fireEvent.click(screen.getByRole("button", { name: "Delete now" }));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(await getNote(target.id)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Delete now" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete now" }));
  await screen.findByText("Trash is empty.");
  expect(await getNote(target.id)).toBeUndefined();
  expect(await db.tombstones.get(target.id)).toMatchObject({ id: target.id });
  expect(await getNote(source.id)).toMatchObject({ text: "Keep text", linkedIds: [] });
});

it("disables update Reload while pending, saving or failed; requests activation only after a successful flush", async () => {
  pwa.needRefresh = true;
  await createNote({ title: "Update fixture" });
  await start();
  await openNote("Update fixture");
  const reload = screen.getByRole("button", { name: "Reload" });
  expect(reload.disabled).toBe(false);
  let reject;
  const write = vi.spyOn(db.notes, "put").mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Unsaved" } });
  expect(reload.disabled).toBe(true);
  expect(screen.getByText("Waiting for your notes to save.")).toBeTruthy();
  fireEvent.click(reload);
  expect(pwa.update).not.toHaveBeenCalled();
  fireEvent.blur(screen.getByLabelText("Title"));
  await waitFor(() => expect(write).toHaveBeenCalled());
  expect(reload.disabled).toBe(true);
  await act(async () => reject(new Error("Disk full")));
  await screen.findByText("Save failed. Retry save before reloading.");
  expect(reload.disabled).toBe(true);
  write.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(reload.disabled).toBe(false));
  fireEvent.click(reload);
  await waitFor(() => expect(pwa.update).toHaveBeenCalledWith(true));
  expect((await db.notes.toArray())[0].title).toBe("Unsaved");
});

it("briefly announces the first offline install and clears the announcement", async () => {
  pwa.offlineReady = true;
  await start();
  expect(screen.getByText("Ready to work offline")).toBeTruthy();
  await waitFor(() => expect(screen.queryByText("Ready to work offline")).toBeNull(), { timeout: 4500 });
});

it("restores a missing note history destination as a list on boot", async () => {
  window.history.replaceState({ [NAVIGATION_KEY]: { version: 1, stack: [
    { screen: "list", key: "root", filter: { type: "all" }, scrollY: 0 },
    { screen: "note", noteId: "gone", key: "visit", scrollY: 0 },
  ] } }, "");
  await start();
  expect(screen.queryByLabelText("Title")).toBeNull();
  expect(activeEntry(window.history.state[NAVIGATION_KEY]).screen).toBe("list");
});

it("guards an externally activated update with a flush and keeps unsaved text after failure", async () => {
  await createNote({ title: "External update" });
  await start();
  await openNote("External update");
  const write = vi.spyOn(db.notes, "put").mockRejectedValue(new Error("Disk full"));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Keep unsaved" } });
  act(() => pwa.options.onNeedReload());
  await screen.findByText("Not saved");
  await waitFor(() => expect(screen.getByRole("button", { name: "Retry save" }).disabled).toBe(false));
  expect(screen.getByLabelText("Title").value).toBe("Keep unsaved");
  expect(screen.getByRole("button", { name: "Reload" }).disabled).toBe(true);
  expect(write).toHaveBeenCalledTimes(1);
  write.mockRestore();
});

it("restores a root list's scroll after boot has loaded its rows", async () => {
  await createNote({ title: "Root restore" });
  window.history.replaceState({ [NAVIGATION_KEY]: { version: 1, stack: [
    { screen: "list", key: "root", filter: { type: "all" }, scrollY: 180 },
  ] } }, "");
  await start();
  expect(window.scrollTo).toHaveBeenLastCalledWith(0, 180);
});
