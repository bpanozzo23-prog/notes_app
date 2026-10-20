import fs from "node:fs/promises";
import path from "node:path";
import { EXPORTED_PREFS, extractFileIds } from "./constants.mjs";
import { atomicWrite, removeFile } from "./fsutil.mjs";

export async function buildBackup(store, now = new Date(), snapshot = store.published) {
  const files = [];
  const referenced = new Set(snapshot.notes.flatMap((n) => extractFileIds(n.html)));
  for (const id of referenced) {
    const binding = Object.hasOwn(snapshot.files, id) && snapshot.files[id];
    if (!binding) continue;
    const bytes = await store.readObject(binding.sha256);
    if (!bytes || bytes.length !== binding.size) continue;
    const { type, size, width, height, createdAt } = binding;
    files.push({ id, type, size, width, height, createdAt, data: bytes.toString("base64") });
  }
  return { format: "notes_app-backup", schemaVersion: snapshot.meta.schemaVersion,
    appVersion: snapshot.meta.appVersion, exportedAt: new Date(now).toISOString(),
    notes: structuredClone(snapshot.notes), folders: structuredClone(snapshot.folders),
    tombstones: structuredClone(snapshot.tombstones), files,
    preferences: structuredClone(Object.fromEntries(EXPORTED_PREFS.filter((key) =>
      Object.hasOwn(snapshot.preferences, key)).map((key) => [key, snapshot.preferences[key]]))) };
}
export function localDay(now) {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export async function dailyBackup(store, now) {
  if (store.published.meta.round === 0) return;
  const filename = `notes-backup-${localDay(now)}.json`;
  const names = await fs.readdir(store.backups);
  if (!names.includes(filename)) {
    // Avoid the recursive canonical serializer here: a large backup needs only one JSON string.
    const envelope = await buildBackup(store, now);
    await writeJsonBackup(path.join(store.backups, filename), envelope);
  }
  const backups = (await fs.readdir(store.backups)).filter((n) => /^notes-backup-\d{4}-\d\d-\d\d\.json$/.test(n)).sort().reverse();
  for (const old of backups.slice(14)) await removeFile(path.join(store.backups, old));
}

// Atomic write of the normal JSON envelope, without another base64 or sorted-key copy.
async function writeJsonBackup(filename, envelope) {
  await atomicWrite(filename, JSON.stringify(envelope), { once: true });
}
