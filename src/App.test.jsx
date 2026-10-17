import { StrictMode } from "react";
import Dexie from "dexie";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App.jsx";
import { db, getPref, setPref, DATABASE_UPDATED } from "./db/db.js";
import * as notesDb from "./db/notes.js";
import { createNote, getNote, trashNote } from "./db/notes.js";
import { backupFixture, noteFixture, resetDatabase } from "./test/fixtures.js";
import { createFolder } from "./db/folders.js";
import { NAVIGATION_KEY, activeEntry } from "./lib/navigation.js";
import { downloadJson } from "./lib/file.js";
import { stubEditorGeometry, tapEditorLink } from "./test/editor.js";
import { extractNoteLinks } from "./lib/text.js";

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
  await waitFor(() => expect(screen.getByRole("button", { name: "Back" }).disabled).toBe(false));
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
  expect(dialog.textContent).toContain("Your toolbar, colours and styles will be replaced by the backup's.");
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

it.each(["trash", "missing"])("stays on the current note and explains a %s link target", async (kind) => {
  const target = noteFixture({ id: "target", title: "Target", deletedAt: new Date().toISOString() });
  const source = noteFixture({ title: "Source", html: '<p><a href="note:target">Target link</a></p>', text: "Target link", linkedIds: [target.id] });
  await db.notes.bulkAdd(kind === "trash" ? [source, target] : [source]);
  await start();
  await openNote("Source");
  const body = screen.getByLabelText("Note body");
  const route = activeEntry(window.history.state[NAVIGATION_KEY]);
  const url = window.location.href;
  expect(tapEditorLink(body.querySelector("a"))).toBe(false);
  expect(screen.getByText(kind === "trash" ? "That note is in the Trash. Restore it from the Trash to open it." : "That note no longer exists.")).toBeTruthy();
  expect(activeEntry(window.history.state[NAVIGATION_KEY])).toEqual(route);
  expect(screen.getByLabelText("Note body")).toBe(body);
  expect(screen.getByLabelText("Title").value).toBe("Source");
  expect(window.location.href).toBe(url);
});

it("flushes pending text on following a live link and Back returns to that text intact", async () => {
  const target = noteFixture({ id: "target", title: "Target", html: "<p>Target body</p>", text: "Target body" });
  const source = noteFixture({ title: "Source", html: '<p><a href="note:target">Target link</a></p>', text: "Target link", linkedIds: [target.id] });
  await db.notes.bulkAdd([source, target]);
  await start();
  await openNote("Source");
  const body = screen.getByLabelText("Note body");
  act(() => body.editor.chain().setTextSelection(body.editor.state.doc.content.size - 1).insertContent(" Pending text").run());
  const text = body.editor.getText();
  const url = window.location.href;
  tapEditorLink(body.querySelector("a"));
  await waitFor(() => expect(screen.getByLabelText("Title").value).toBe("Target"));
  expect((await getNote(source.id)).text).toBe(text);
  expect(screen.getByLabelText("Note body").textContent).toBe("Target body");
  expect(within(screen.getByRole("region", { name: "Linked from" })).getByRole("button", { name: "Source" })).toBeTruthy();
  act(() => window.history.back());
  await waitFor(() => expect(screen.getByLabelText("Title").value).toBe("Source"));
  expect(screen.getByLabelText("Note body").textContent).toBe(text);
  expect(window.location.href).toBe(url);
});

it("keeps unsaved text in the editor if following a link cannot flush, then allows retry", async () => {
  const source = noteFixture({ title: "Source", html: '<p><a href="note:target">Target link</a></p>', linkedIds: ["target"] });
  await db.notes.bulkAdd([source, noteFixture({ id: "target", title: "Target" })]);
  await start();
  await openNote("Source");
  const body = screen.getByLabelText("Note body");
  const put = vi.spyOn(db.notes, "put").mockRejectedValue(new Error("Disk full"));
  act(() => body.editor.commands.insertContent("Keep this "));
  tapEditorLink(body.querySelector("a"));
  await screen.findByText("Not saved");
  await waitFor(() => expect(screen.getByRole("button", { name: "Back" }).disabled).toBe(false));
  expect(screen.getByLabelText("Note body")).toBe(body);
  expect(body.textContent).toContain("Keep this");
  expect(activeEntry(window.history.state[NAVIGATION_KEY]).noteId).toBe(source.id);
  put.mockRestore();
  stubEditorGeometry(body.editor);
  act(() => { body.editor.view.focus(); body.editor.commands.setTextSelection(body.editor.view.posAtDOM(body.querySelector("a"), 0) + 2); });
  fireEvent.click(await screen.findByRole("button", { name: "Open note" }));
  await waitFor(() => expect(screen.getByLabelText("Title").value).toBe("Target"));
  expect((await getNote(source.id)).text).toContain("Keep this");
});

it("saves a picker-created href and derived linkedIds, then lists its backlink", async () => {
  const source = noteFixture({ title: "Source", html: "<p></p>", text: "" });
  const target = noteFixture({ id: "target", title: "Destino" });
  await db.notes.bulkAdd([source, target]);
  await start();
  await openNote("Source");
  stubEditorGeometry(screen.getByLabelText("Note body").editor);
  fireEvent.click(within(screen.getByRole("toolbar", { name: "Formatting", exact: true })).getByRole("button", { name: "Link to note" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Destino" }));
  expect(document.activeElement).toBe(screen.getByLabelText("Note body"));
  await back();
  const saved = await getNote(source.id);
  expect(saved.html).toContain('href="note:target"');
  expect(saved.text).toBe("Destino");
  expect(saved.linkedIds).toEqual(extractNoteLinks(saved.html));
  expect(saved.linkedIds).toEqual([target.id]);
  await openNote("Destino");
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Renamed destination" } });
  fireEvent.click(within(screen.getByRole("region", { name: "Linked from" })).getByRole("button", { name: "Source" }));
  await waitFor(() => expect(screen.getByLabelText("Title").value).toBe("Source"));
  expect(screen.getByLabelText("Note body").querySelector("a").textContent).toBe("Destino");
  expect((await getNote(target.id)).title).toBe("Renamed destination");
});

it("searches live notes with chips and restores the query and results on Back", async () => {
  await db.folders.add({ id: "f", name: "Reading", position: 0 });
  await db.notes.bulkAdd([
    noteFixture({ title: "Árbol", html: "<p>Un niño</p>", text: "Un niño", folderId: "f" }),
    noteFixture({ id: "other", title: "Otro árbol", text: "Niño" }),
    noteFixture({ id: "trash", title: "Trashed árbol", text: "Niño", folderId: "f", deletedAt: new Date().toISOString() }),
  ]);
  await start();
  const rows = () => within(screen.getByRole("list", { name: "Notes" })).queryAllByRole("button").map((button) => button.getAttribute("aria-label"));
  fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "ARBOL nino" } });
  expect(rows()).toEqual(["Árbol", "Otro árbol"]);
  fireEvent.click(screen.getByRole("button", { name: "Reading" }));
  expect(rows()).toEqual(["Árbol"]);
  await openNote("Árbol");
  await back();
  expect(screen.getByLabelText("Search notes").value).toBe("ARBOL nino");
  expect(screen.getByRole("button", { name: "Reading" }).getAttribute("aria-pressed")).toBe("true");
  expect(rows()).toEqual(["Árbol"]);
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(activeEntry(window.history.state[NAVIGATION_KEY])).not.toHaveProperty("query");
});

it("restores a sanitised list search query on boot", async () => {
  await db.notes.bulkAdd([noteFixture({ title: "Árbol" }), noteFixture({ id: "other", title: "Unrelated" })]);
  window.history.replaceState({ [NAVIGATION_KEY]: { version: 1, stack: [
    { screen: "list", key: "root", filter: { type: "all" }, query: "  ARBOL  ", scrollY: 0 },
  ] } }, "");
  await start();
  expect(screen.getByLabelText("Search notes").value).toBe("ARBOL");
  expect(within(screen.getByRole("list", { name: "Notes" })).getAllByRole("button")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Árbol" })).toBeTruthy();
});

it.each(["open", "purge", "refresh"])("shows a boot failure instead of an empty notebook when %s fails", async (step) => {
  await createNote({ title: "Still safe" });
  if (step === "open") vi.spyOn(db, "open").mockRejectedValueOnce(new Error("Cannot open database"));
  if (step === "purge") vi.spyOn(notesDb, "purgeExpired").mockRejectedValueOnce(new Error("Cannot purge"));
  if (step === "refresh") vi.spyOn(notesDb, "liveNotes").mockRejectedValueOnce(new Error("Cannot read notes"));
  render(<App />);
  await screen.findByText("Couldn't open your notes. They have not been deleted. Reload to try again.");
  expect(screen.getByRole("alert").textContent).toContain("Cannot");
  expect(screen.queryByText("No notes yet.")).toBeNull();
  expect(screen.queryByRole("list", { name: "Notes" })).toBeNull();
  expect(await db.notes.count()).toBe(1);
});

it("opens a newer database for reading, skips boot purge, and disables all editing and backup controls", async () => {
  const live = await createNote({ title: "Newer notebook" });
  await db.notes.add(noteFixture({ id: "old-trash", title: "Expired", deletedAt: "2020-01-01T00:00:00.000Z" }));
  await createFolder("Read only folder");
  db.close();
  const newer = new Dexie(db.name);
  newer.version(3).stores({ notes: "id, updatedAt, deletedAt, *tags, *linkedIds", folders: "id, position", tombstones: "id", prefs: "key" });
  await newer.open();
  newer.close();
  const purge = vi.spyOn(notesDb, "purgeExpired");
  render(<App />);
  await screen.findByText("This notebook was updated by a newer version of the app. Reload to update.");
  await screen.findByRole("button", { name: "Newer notebook" });
  expect(purge).not.toHaveBeenCalled();
  expect(await db.notes.count()).toBe(2);
  expect(screen.getByRole("button", { name: "+ New note" }).disabled).toBe(true);
  await openNote("Newer notebook");
  expect(screen.getByLabelText("Title").readOnly).toBe(true);
  expect(screen.getByLabelText("Note body").editor.isEditable).toBe(false);
  for (const label of ["Pin note", "Choose folder", "Delete", "Bold"]) expect(screen.getByRole("button", { name: label, exact: true }).matches(":disabled")).toBe(true);
  expect(screen.getByLabelText("Add tag").matches(":disabled")).toBe(true);
  await back();
  fireEvent.click(screen.getByRole("button", { name: "Folders", exact: true }));
  await screen.findByLabelText("New folder name");
  expect(screen.getByRole("button", { name: "Rename Read only folder" }).matches(":disabled")).toBe(true);
  expect(screen.getByLabelText("New folder name").matches(":disabled")).toBe(true);
  await back();
  fireEvent.click(screen.getByRole("button", { name: "Trash (1)" }));
  await screen.findByRole("button", { name: "Restore" });
  expect(screen.getByRole("button", { name: "Restore" }).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Delete now" }).disabled).toBe(true);
  await back();
  await settings();
  expect(screen.getByRole("button", { name: "Export backup" }).disabled).toBe(true);
  expect(screen.getByLabelText("Import backup").disabled).toBe(true);
  expect(await getNote(live.id)).toEqual(live);
  expect(await db.tombstones.count()).toBe(0);
});

it("locks immediately on versionchange, drains held editor input, then closes after saving", async () => {
  const original = await createNote({ title: "Before upgrade", html: "<p>Original</p>" });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const update = notesDb.updateNote;
  const write = vi.spyOn(notesDb, "updateNote").mockImplementationOnce(async (...args) => {
    await gate;
    return update(...args);
  });
  await start();
  await openNote("Before upgrade");
  const editor = screen.getByLabelText("Note body").editor;
  // This is the delayed DOM-observer path used for Android deletions, before onUpdate runs.
  const observer = editor.view.domObserver;
  editor.view.dom.querySelector("p").firstChild.nodeValue = "Origina";
  observer.flushSoon();
  act(() => { expect(db.on("versionchange").fire({ oldVersion: 20, newVersion: 30 })).toBe(false); });
  expect(screen.getByLabelText("Title").closest("[inert]")).toBeTruthy();
  await waitFor(() => expect(write).toHaveBeenCalledOnce());
  expect(db.isOpen()).toBe(true);
  await act(async () => release());
  await screen.findByText(DATABASE_UPDATED);
  expect(db.isOpen()).toBe(false);
  write.mockRestore();
  // Reopen only in the test, after the simulated upgrade, to inspect the fixture saved before close.
  await db.open();
  expect((await getNote(original.id)).html).toBe("<p>Origina</p>");
});

it("keeps versionchange failures locked with Retry usable, then closes after the retry saves", async () => {
  await createNote({ title: "Before upgrade" });
  await start();
  await openNote("Before upgrade");
  const put = vi.spyOn(db.notes, "put").mockRejectedValue(new Error("Disk full"));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Keep this edit" } });
  act(() => db.on("versionchange").fire({ oldVersion: 20, newVersion: 30 }));
  await screen.findByText("Not saved. Disk full");
  expect(db.isOpen()).toBe(true);
  expect(screen.getByLabelText("Title").closest("[inert]")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry save" }).disabled).toBe(false);
  expect(screen.queryByText(DATABASE_UPDATED)).toBeNull();
  expect(put).toHaveBeenCalledOnce();
  put.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await screen.findByText(DATABASE_UPDATED);
  expect(db.isOpen()).toBe(false);
  expect(screen.queryByText("Not saved. Disk full")).toBeNull();
});

it("a replacement broadcast locks the receiving window, closes its dialog, and never writes pending text", async () => {
  let receiver;
  const close = vi.fn();
  vi.stubGlobal("BroadcastChannel", class {
    constructor(name) { expect(name).toBe("notes_app"); receiver = this; }
    close = close;
  });
  const original = await createNote({ title: "Before replacement" });
  await start();
  await openNote("Before replacement");
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Pending in old window" } });
  fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  const put = vi.spyOn(db.notes, "put");
  act(() => receiver.onmessage({ data: { type: "notebook-replaced", generation: "other-window" } }));
  await screen.findByText("The notebook was replaced in another window. Reload. Changes made here since then were not saved.");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByLabelText("Title").closest("[inert]")).toBeTruthy();
  fireEvent(window, new Event("pagehide"));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)); });
  expect(put).not.toHaveBeenCalled();
  expect(await getNote(original.id)).toEqual(original);
  expect(screen.getByLabelText("Title").value).toBe("Pending in old window");
  cleanup();
  expect(close).toHaveBeenCalled();
});

it("a stale write without BroadcastChannel also locks the app and preserves the replacement", async () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  const original = await createNote({ title: "Before replacement" });
  await start();
  await openNote("Before replacement");
  await db.prefs.put({ key: "notebookGeneration", value: "other-window-import" });
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Stale edit" } });
  fireEvent.blur(screen.getByLabelText("Title"));
  await screen.findByText("The notebook was replaced in another window. Reload. Changes made here since then were not saved.");
  expect(screen.getByLabelText("Title").closest("[inert]")).toBeTruthy();
  expect((await getNote(original.id)).title).toBe(original.title);
});

it("uses stored selectionMenu ids for the real editor pop-up", async () => {
  await createNote({ title: "Custom pop-up", html: "<p>Select these words</p>" });
  await setPref("selectionMenu", ["strike", "color:#123456", "unknown"]);
  await start();
  await openNote("Custom pop-up");
  const editor = screen.getByLabelText("Note body").editor;
  stubEditorGeometry(editor);
  act(() => { editor.view.focus(); editor.commands.setTextSelection({ from: 1, to: 7 }); });
  const menu = await screen.findByRole("toolbar", { name: "Selection formatting" });
  expect(within(menu).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Strikethrough", "#123456"]);
});

it.each(["Delete", "Choose folder", "Link to note"])("Android Back closes %s without leaving the note; the next Back leaves", async (label) => {
  await createNote({ title: "Overlay fixture" });
  await start(); await openNote("Overlay fixture");
  fireEvent.click(screen.getByRole("button", { name: label, exact: true }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  const stack = window.history.state[NAVIGATION_KEY];
  act(() => window.history.back());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(screen.getByRole("button", { name: "Back" }).disabled).toBe(false));
  expect(screen.getByLabelText("Title").value).toBe("Overlay fixture");
  expect(window.history.state[NAVIGATION_KEY]).toEqual(stack);
  act(() => window.history.back());
  await screen.findByRole("button", { name: "+ New note" });
  expect(activeEntry(window.history.state[NAVIGATION_KEY]).screen).toBe("list");
});

it("Android Back closes the More tray and leaves the selected note at the same history position", async () => {
  await createNote({ title: "Tray fixture", html: "<p>Selected text</p>" });
  await setPref("toolbarLayout", "more");
  await start(); await openNote("Tray fixture");
  const editor = screen.getByLabelText("Note body").editor;
  stubEditorGeometry(editor);
  act(() => { editor.view.focus(); editor.commands.setTextSelection({ from: 1, to: 9 }); });
  const more = within(screen.getByRole("toolbar", { name: "Formatting", exact: true })).getByRole("button", { name: "More" });
  fireEvent.pointerDown(more); fireEvent.pointerUp(more); fireEvent.click(more);
  expect(screen.getByRole("region", { name: "More tray" })).toBeTruthy();
  const stack = window.history.state[NAVIGATION_KEY];
  act(() => window.history.back());
  await waitFor(() => expect(screen.queryByRole("region", { name: "More tray" })).toBeNull());
  await waitFor(() => expect(screen.getByRole("button", { name: "Back" }).disabled).toBe(false));
  expect(window.history.state[NAVIGATION_KEY]).toEqual(stack);
  expect(editor.state.selection).toMatchObject({ from: 1, to: 9 });
  expect(document.activeElement).toBe(editor.view.dom);
  act(() => window.history.back());
  await screen.findByRole("button", { name: "+ New note" });
});

it("Android Back dismisses the import confirmation without replacing the notebook or leaving Settings", async () => {
  const note = await createNote({ title: "Keep" });
  await start(); await settings(); await upload(backupFixture());
  fireEvent.click(screen.getByRole("button", { name: "Replace notebook" }));
  const stack = window.history.state[NAVIGATION_KEY];
  act(() => window.history.back());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(screen.getByRole("button", { name: "Back" }).disabled).toBe(false));
  expect(window.history.state[NAVIGATION_KEY]).toEqual(stack);
  expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
  expect(await db.notes.toArray()).toEqual([note]);
  expect(downloadJson).not.toHaveBeenCalled();
});
