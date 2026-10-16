import Dexie from "dexie";
import { SCHEMA_VERSION } from "../version.js";

export const db = new Dexie("notes_app");

db.version(SCHEMA_VERSION).stores({
  notes: "id, updatedAt, deletedAt, *tags, *linkedIds",
  folders: "id, position",
  tombstones: "id",
  prefs: "key",
});

export async function getPref(key) {
  return (await db.prefs.get(key))?.value;
}

export function setPref(key, value) {
  return db.prefs.put({ key, value });
}

export function delPref(key) {
  return db.prefs.delete(key);
}

export async function allPrefs() {
  return Object.fromEntries((await db.prefs.toArray()).map(({ key, value }) => [key, value]));
}
