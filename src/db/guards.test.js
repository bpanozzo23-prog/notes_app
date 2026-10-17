import Dexie from "dexie";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db, notebookAccess, createNotebookAccess, ReadOnlyNotebookError, NotebookReplacedError, setPref, delPref } from "./db.js";
import { buildBackup, importBackup } from "./backup.js";
import { createNote, updateNote, trashNote, restoreNote, purgeExpired, purgeNow } from "./notes.js";
import { createFolder, renameFolder, reorderFolders, deleteFolder } from "./folders.js";
import { AT, noteFixture, backupFixture, resetDatabase } from "../test/fixtures.js";

const stores = { notes: "id, updatedAt, deletedAt, *tags, *linkedIds", folders: "id, position", tombstones: "id", prefs: "key" };
const connections = [];
function connection(version) {
  const other = new Dexie(db.name);
  other.version(version).stores(stores);
  connections.push(other);
  return other;
}
const rows = () => Promise.all([db.notes.toArray(), db.folders.toArray(), db.tombstones.toArray(), db.prefs.toArray()]);
beforeEach(resetDatabase);
afterEach(() => { for (const other of connections.splice(0)) other.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("opens a seeded v1 database at v2 without rewriting any rows", async () => {
  await db.delete();
  const old = connection(1);
  await old.open();
  const seed = [[noteFixture({ folderId: "f", tags: ["tag"], rev: 9 })], [{ id: "f", name: "Folder", position: 4 }],
    [{ id: "gone", purgedAt: AT }], [{ key: "private", value: "fixture" }, { key: "toolbar", value: ["italic"] }]];
  for (const [index, table] of ["notes", "folders", "tombstones", "prefs"].entries()) await old.table(table).bulkAdd(seed[index]);
  old.close();
  await notebookAccess.load();
  expect(db.backendDB().version).toBe(20);
  expect(await rows()).toEqual(seed);
});

const writers = [
  ["create note", () => createNote()], ["update note", () => updateNote(noteFixture().id, { title: "stale" })],
  ["trash", () => trashNote(noteFixture().id)], ["restore", () => restoreNote(noteFixture().id)],
  ["purge expired", () => purgeExpired()], ["purge now", () => purgeNow(noteFixture().id)],
  ["create folder", () => createFolder("Stale")], ["rename folder", () => renameFolder("f", "Stale")],
  ["reorder folders", () => reorderFolders(["f"])], ["delete folder", () => deleteFolder("f")],
  ["set preference", () => setPref("lastBackupAt", AT)], ["delete preference", () => delPref("storagePersisted")],
  ["import", () => importBackup(backupFixture())], ["export", () => buildBackup()],
];

it("detects Dexie's newer-database fallback and refuses every writer and export", async () => {
  db.close();
  const newer = connection(3);
  await newer.open();
  await newer.notes.add(noteFixture());
  newer.close();
  await notebookAccess.load();
  expect(db.verno).toBe(2); // Dexie 4.4.6 does NOT update verno for an explicit schema.
  expect(db.backendDB().version / 10).toBe(3);
  expect(notebookAccess.getSnapshot().readOnly).toBe(true);
  const before = await rows();
  for (const [, write] of writers) await expect(write()).rejects.toBeInstanceOf(ReadOnlyNotebookError);
  expect(await rows()).toEqual(before);
});

it("adopts an import only in the importing window; stale note, purge, folder and preference writes all fail", async () => {
  const other = connection(2);
  const stale = createNotebookAccess(other);
  await stale.load(); // Remembers the initial null generation.
  await setPref("storagePersisted", true);
  await importBackup(backupFixture({ folders: [{ id: "f", name: "Folder", position: 0 }] }));
  const generation = (await db.prefs.get("notebookGeneration")).value;
  expect(typeof generation).toBe("string");
  await updateNote(noteFixture().id, { title: "Importing window can save" });
  await expect(stale.write([other.notes], () => other.notes.clear())).rejects.toBeInstanceOf(NotebookReplacedError);
  expect(stale.getSnapshot().replaced).toBe(true);
  // Exercise every public writer with the second window's remembered initial generation.
  notebookAccess.adopt(null);
  const before = await rows();
  for (const [, write] of writers) await expect(write()).rejects.toBeInstanceOf(NotebookReplacedError);
  expect(await rows()).toEqual(before);
  expect((await db.prefs.get("storagePersisted")).value).toBe(true);
});

it("posts replacement only after commit and retains the old generation when import rolls back", async () => {
  const postMessage = vi.fn(), close = vi.fn();
  vi.stubGlobal("BroadcastChannel", class { constructor(name) { expect(name).toBe("notes_app"); } postMessage = postMessage; close = close; });
  await importBackup(backupFixture());
  const generation = (await db.prefs.get("notebookGeneration")).value;
  expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "notebook-replaced", generation });
  expect(close).toHaveBeenCalledOnce();
  const put = vi.spyOn(db.prefs, "put").mockRejectedValueOnce(new Error("Full"));
  await expect(importBackup(backupFixture({ notes: [] }))).rejects.toThrow("Full");
  expect((await db.prefs.get("notebookGeneration")).value).toBe(generation);
  expect(postMessage).toHaveBeenCalledTimes(1);
  put.mockRestore();
  await updateNote(noteFixture().id, { title: "Still current" });
});

it("suppresses Dexie's default close synchronously and closes only after a real upgrade's flush", async () => {
  let finish;
  const flush = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  let closing;
  const unsubscribe = notebookAccess.subscribe(() => {
    if (notebookAccess.getSnapshot().versionChange === "pending") closing = notebookAccess.flushAndClose(flush);
  });
  const newer = connection(3);
  const opening = newer.open();
  await vi.waitFor(() => expect(flush).toHaveBeenCalledOnce());
  expect(db.isOpen()).toBe(true);
  finish();
  await closing;
  await opening;
  unsubscribe();
  expect(db.isOpen()).toBe(false);
  expect(notebookAccess.getSnapshot().versionChange).toBe("closed");
});

it("leaves the connection open after a failed flush, then closes after retry", async () => {
  expect(db.on("versionchange").fire({ oldVersion: 20, newVersion: 30 })).toBe(false);
  const flush = vi.fn().mockRejectedValueOnce(new Error("Disk full")).mockResolvedValueOnce(undefined);
  await expect(notebookAccess.flushAndClose(flush)).rejects.toThrow("Disk full");
  expect(db.isOpen()).toBe(true);
  expect(notebookAccess.getSnapshot().versionChange).toBe("pending");
  await notebookAccess.flushAndClose(flush);
  expect(db.isOpen()).toBe(false);
});

it("does not clear a versionchange that arrives while the boot generation is being read", async () => {
  const prefs = db.table("prefs");
  const get = prefs.get.bind(prefs);
  vi.spyOn(prefs, "get").mockImplementationOnce(async (key) => {
    const row = await get(key);
    db.on("versionchange").fire({ oldVersion: 20, newVersion: 30 });
    return row;
  });
  await notebookAccess.load();
  expect(notebookAccess.getSnapshot().versionChange).toBe("pending");
  expect(db.isOpen()).toBe(true);
});
