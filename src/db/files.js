import { db, notebookAccess, writeTransaction } from "./db.js";
import { newId } from "../lib/ids.js";
import { extractFileIds } from "../lib/text.js";

export const IMAGE_TYPES = ["image/webp", "image/jpeg", "image/png", "image/gif"];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const FILE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function addImageFile({ type, bytes, width, height }) {
  if (!IMAGE_TYPES.includes(type) || !(bytes instanceof ArrayBuffer) || !bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES ||
      ![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 10000)) throw new Error("This image can't be used here.");
  const row = { id: newId(), type, size: bytes.byteLength, width, height, createdAt: new Date().toISOString(), unusedSince: null };
  await writeTransaction([db.files, db.fileData], async () => {
    await db.files.add(row);
    await db.fileData.add({ id: row.id, bytes });
  });
  return row.id;
}
export const getFile = (id) => db.files.get(id);

// Called inside the note writer's guarded transaction; never fetch image bytes.
export async function clearReferencedFileMarks(html) {
  for (const id of extractFileIds(html)) {
    const file = await db.files.get(id);
    if (file?.unusedSince != null) await db.files.update(id, { unusedSince: null });
  }
}

export async function fileStats() {
  let count = 0, bytes = 0, base64Bytes = 0;
  await db.files.each((file) => { count++; bytes += file.size; base64Bytes += 4 * Math.ceil(file.size / 3); });
  return { count, bytes, base64Bytes };
}
export async function cleanupFiles(now = new Date()) {
  if (notebookAccess.getSnapshot().readOnly) return;
  const at = new Date(now).toISOString();
  const cutoff = new Date(new Date(now).getTime() - FILE_RETENTION_MS).toISOString();
  return writeTransaction([db.notes, db.files, db.fileData, db.prefs], async () => {
    const referenced = new Set((await db.notes.toArray()).flatMap((note) => extractFileIds(note.html)));
    const undo = (await db.prefs.get("claudeLastChange"))?.value;
    if (Array.isArray(undo?.notes)) for (const entry of undo.notes) {
      if (typeof entry?.before?.html === "string") for (const id of extractFileIds(entry.before.html)) referenced.add(id);
    }
    // Index cursors return ids only; null marks have no unusedSince index entry.
    const [ids, markedIds] = await Promise.all([
      db.files.toCollection().primaryKeys(), db.files.orderBy("unusedSince").primaryKeys(),
    ]);
    const marked = new Set(markedIds);
    for (const id of markedIds) {
      if (referenced.has(id)) await db.files.update(id, { unusedSince: null });
    }
    for (const id of ids) {
      if (!referenced.has(id) && !marked.has(id)) await db.files.update(id, { unusedSince: at });
    }
    const expired = await db.files.where("unusedSince").below(cutoff).primaryKeys();
    if (expired.length) {
      await db.files.bulkDelete(expired);
      await db.fileData.bulkDelete(expired);
    }
  });
}
