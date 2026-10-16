import { db } from "./db.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/dates.js";
import { extractNoteLinks, htmlToText, neutralizeNoteLinks } from "../lib/text.js";

const EDIT_FIELDS = ["title", "html", "folderId", "tags"];
const WRITE_FIELDS = [...EDIT_FIELDS, "pinned", "deletedAt"];
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function cleanPatch(patch) {
  for (const key of Object.keys(patch)) {
    if (!WRITE_FIELDS.includes(key)) throw new Error(`Cannot edit note field: ${key}`);
  }
  const clean = { ...patch };
  for (const key of ["title", "html"]) {
    if (Object.hasOwn(clean, key) && typeof clean[key] !== "string") throw new Error(`${key} must be a string`);
  }
  if (Object.hasOwn(clean, "folderId") && clean.folderId !== null && typeof clean.folderId !== "string") {
    throw new Error("folderId must be a string or null");
  }
  if (Object.hasOwn(clean, "tags")) {
    if (!Array.isArray(clean.tags) || clean.tags.some((tag) => typeof tag !== "string")) {
      throw new Error("tags must be strings");
    }
    clean.tags = [...new Set(clean.tags.map((tag) => tag.trim()).filter(Boolean))];
  }
  if (Object.hasOwn(clean, "pinned") && typeof clean.pinned !== "boolean") throw new Error("pinned must be a boolean");
  if (Object.hasOwn(clean, "deletedAt") && clean.deletedAt !== null &&
      (typeof clean.deletedAt !== "string" || !Number.isFinite(Date.parse(clean.deletedAt)))) {
    throw new Error("deletedAt must be a timestamp or null");
  }
  if (Object.hasOwn(clean, "html")) {
    clean.text = htmlToText(clean.html);
    clean.linkedIds = extractNoteLinks(clean.html);
  }
  return clean;
}

async function checkFolder(folderId) {
  if (folderId !== null && !(await db.folders.get(folderId))) throw new Error("Folder does not exist");
}

export async function createNote({ folderId = null, title = "", html = "<p></p>" } = {}) {
  const at = nowIso();
  const note = {
    id: newId(), ...cleanPatch({ title, html, folderId }), tags: [], pinned: false, rev: 1,
    createdAt: at, updatedAt: at, deletedAt: null,
  };
  await db.transaction("rw", db.notes, db.folders, async () => {
    await checkFolder(folderId);
    await db.notes.add(note);
  });
  return note;
}

export async function updateNote(id, patch) {
  const clean = cleanPatch(patch);
  return db.transaction("rw", db.notes, db.folders, async () => {
    const note = await db.notes.get(id);
    if (!note) throw new Error("Note does not exist");
    if (Object.hasOwn(clean, "folderId")) await checkFolder(clean.folderId);
    const edited = EDIT_FIELDS.some((key) => Object.hasOwn(clean, key) &&
      JSON.stringify(clean[key]) !== JSON.stringify(note[key]));
    const next = { ...note, ...clean, updatedAt: edited ? nowIso() : note.updatedAt, rev: note.rev + 1 };
    await db.notes.put(next);
    return next;
  });
}

export const setPinned = (id, pinned) => updateNote(id, { pinned });
export const trashNote = (id) => updateNote(id, { deletedAt: nowIso() });

export async function restoreNote(id) {
  return db.transaction("rw", db.notes, db.tombstones, async () => {
    const note = await db.notes.get(id);
    if (!note) throw new Error("Note does not exist");
    // A target might have been purged while this source note was also in Trash.
    const ids = new Set(await db.tombstones.toCollection().primaryKeys());
    const html = neutralizeNoteLinks(note.html, ids);
    const next = { ...note, html, text: htmlToText(html), linkedIds: extractNoteLinks(html), deletedAt: null, rev: note.rev + 1 };
    await db.notes.put(next);
    return next;
  });
}

export async function purgeExpired(now = new Date()) {
  const at = new Date(now).toISOString();
  const cutoff = new Date(new Date(now).getTime() - TRASH_RETENTION_MS).toISOString();
  return db.transaction("rw", db.notes, db.tombstones, async () => {
    const expired = await db.notes.where("deletedAt").below(cutoff).toArray();
    const ids = new Set(expired.map((note) => note.id));
    if (!ids.size) return 0;
    await db.tombstones.bulkPut([...ids].map((id) => ({ id, purgedAt: at })));
    await db.notes.bulkDelete([...ids]);
    await db.notes.filter((note) => note.deletedAt === null).modify((note) => {
      const html = neutralizeNoteLinks(note.html, ids);
      if (html === note.html) return false;
      note.html = html;
      note.text = htmlToText(html);
      note.linkedIds = extractNoteLinks(html);
      note.rev += 1; // Link cleanup is housekeeping, not a recency change.
    });
    return ids.size;
  });
}

// Null values are absent from IndexedDB indexes: never query equals(null).
export const liveNotes = () => db.notes.orderBy("updatedAt").reverse().filter((note) => note.deletedAt === null).toArray();
export const trashedNotes = () => db.notes.orderBy("deletedAt").reverse().toArray();
export const getNote = (id) => db.notes.get(id);
export const backlinksFor = (id) => db.notes.where("linkedIds").equals(id).filter((note) => note.deletedAt === null).toArray();
