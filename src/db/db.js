import Dexie from "dexie";
import { SCHEMA_VERSION } from "../version.js";

export const db = new Dexie("notes_app");

const stores = {
  notes: "id, updatedAt, deletedAt, *tags, *linkedIds",
  folders: "id, position",
  tombstones: "id",
  prefs: "key",
};
db.version(1).stores(stores);
db.version(2).stores(stores);
db.version(3).stores(stores);
db.version(4).stores({ ...stores, files: "id, unusedSince", fileData: "id" });
// 5: list lines can be collapsed (<li data-collapsed="true">); no store change.
db.version(5).stores({ ...stores, files: "id, unusedSince", fileData: "id" });

export class ReadOnlyNotebookError extends Error {
  constructor() { super("This notebook was updated by a newer version of the app. Reload to update."); this.name = "ReadOnlyNotebookError"; }
}
export class NotebookReplacedError extends Error {
  constructor() { super("The notebook was replaced in another window. Reload. Changes made here since then were not saved."); this.name = "NotebookReplacedError"; }
}
export const DATABASE_UPDATED = "The app was updated in another window. Reload to keep editing.";

// One remembered generation per window. Reading/refreshing rows never adopts a new generation.
export function createNotebookAccess(database) {
  let generation;
  let state = { readOnly: false, replaced: false, versionChange: null };
  const listeners = new Set();
  const change = (patch) => {
    state = { ...state, ...patch };
    // UI work triggered by a refusal must not inherit the transaction being aborted.
    Dexie.ignoreTransaction(() => { for (const listener of listeners) listener(); });
  };
  const replaced = () => { if (!state.replaced) change({ replaced: true }); };
  // Another open copy of the app still holds the old version of the database, so this window's
  // upgrade waits. Say so on the boot status instead of waiting silently.
  database.on("blocked", () => {
    if (window.__notesBoot) window.__notesBoot.step = "waiting for another open copy of the app to close (it holds the old notebook version)";
  });
  database.on("versionchange", () => {
    change({ versionChange: "pending" });
    // Dexie's event chain tests the return value immediately; a Promise does not stop it.
    return false;
  });
  return {
    getSnapshot: () => state,
    getGeneration: () => generation,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    async load() {
      generation = undefined;
      change({ readOnly: false, replaced: false, versionChange: null });
      await database.open();
      // Explicit-schema Dexie keeps verno at the declared version after VersionError fallback.
      const readOnly = database.backendDB().version / 10 > SCHEMA_VERSION;
      generation = (await database.table("prefs").get("notebookGeneration"))?.value ?? null;
      change({ readOnly });
    },
    async check() {
      if (state.readOnly || database.backendDB().version / 10 > SCHEMA_VERSION) {
        if (!state.readOnly) change({ readOnly: true });
        throw new ReadOnlyNotebookError();
      }
      if (state.replaced) throw new NotebookReplacedError();
      if (state.versionChange === "closed") throw new Error(DATABASE_UPDATED);
      if (generation === undefined) throw new Error("The notebook has not been opened.");
      if (((await database.table("prefs").get("notebookGeneration"))?.value ?? null) !== generation) {
        replaced();
        throw new NotebookReplacedError();
      }
    },
    write(tables, task) {
      return database.transaction("rw", [...new Set([...tables, database.table("prefs")])], async () => {
        await this.check();
        return task();
      });
    },
    adopt(next) { generation = next; },
    listen() {
      if (typeof BroadcastChannel === "undefined") return () => {};
      const channel = new BroadcastChannel("notes_app");
      channel.onmessage = ({ data }) => {
        if (data?.type === "notebook-replaced" && typeof data.generation === "string" && data.generation !== generation) replaced();
      };
      return () => channel.close();
    },
    async flushAndClose(flush) {
      await flush();
      database.close();
      change({ versionChange: "closed" });
    },
  };
}

export const notebookAccess = createNotebookAccess(db);
export const writeTransaction = (tables, task) => notebookAccess.write(tables, task);

export function announceReplacement(generation) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel("notes_app");
  channel.postMessage({ type: "notebook-replaced", generation });
  channel.close();
}

export async function getPref(key) {
  return (await db.prefs.get(key))?.value;
}

export function setPref(key, value) {
  return writeTransaction([db.prefs], () => db.prefs.put({ key, value }));
}

export function delPref(key) {
  return writeTransaction([db.prefs], () => db.prefs.delete(key));
}

export async function allPrefs() {
  return Object.fromEntries((await db.prefs.toArray()).map(({ key, value }) => [key, value]));
}
