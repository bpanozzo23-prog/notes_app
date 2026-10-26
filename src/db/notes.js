import { db, writeTransaction } from "./db.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/dates.js";
import { extractNoteLinks, htmlToText, neutralizeNoteLinks } from "../lib/text.js";
import { clearReferencedFileMarks } from "./files.js";

const EDIT_FIELDS = ["title", "html", "folderId", "tags"];
// Collapsing or expanding a list line or heading changes only this attribute. Like pinning, it saves and
// syncs but is not a content edit, so it doesn't move "Edited" or the note's place in the list.
// `<` never appears unescaped in text and `"` is escaped in attribute values, so this matches tags only.
const COLLAPSED = /(<(?:li|h[1-3])\b[^>]*?)\s+data-collapsed="true"/g;
export const withoutCollapse = (html) => typeof html === "string" ? html.replace(COLLAPSED, "$1") : html;
const sameField = (key, a, b) => key === "html" ? withoutCollapse(a) === withoutCollapse(b) : JSON.stringify(a) === JSON.stringify(b);
/** True when the patch changes a note's content (not pinning, Trash or a collapsed list line or heading). */
export const isContentEdit = (patch, note) => EDIT_FIELDS.some((key) => Object.hasOwn(patch, key) && !sameField(key, patch[key], note?.[key]));
const WRITE_FIELDS = [...EDIT_FIELDS, "pinned", "quickAdd", "addDate", "deletedAt"];
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
  for (const key of ["pinned", "quickAdd", "addDate"]) {
    if (Object.hasOwn(clean, key) && typeof clean[key] !== "boolean") throw new Error(`${key} must be a boolean`);
  }
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
    id: newId(), ...cleanPatch({ title, html, folderId }), tags: [], pinned: false, quickAdd: false, addDate: false, rev: 1,
    createdAt: at, updatedAt: at, deletedAt: null,
  };
  await writeTransaction([db.notes, db.folders, db.files], async () => {
    await checkFolder(folderId);
    await db.notes.add(note);
    await clearReferencedFileMarks(note.html);
  });
  return note;
}

// Only call inside a guarded notes/folders/files transaction. add refuses an occupied id.
export async function insertNoteInTransaction({ id, title, html, folderId, tags }) {
  const at = nowIso(), clean = cleanPatch({ title, html, folderId, tags });
  await checkFolder(folderId);
  const note = { id, ...clean, pinned: false, quickAdd: false, addDate: false, rev: 1, createdAt: at, updatedAt: at, deletedAt: null };
  await db.notes.add(note);
  await clearReferencedFileMarks(note.html);
  return note;
}

export class NoteChangedElsewhereError extends Error {
  constructor() { super("This note changed in another window."); this.name = "NoteChangedElsewhereError"; }
}

export async function createConflictCopy(id, patch) {
  const clean = cleanPatch(patch);
  return writeTransaction([db.notes, db.folders, db.tombstones, db.files], async () => {
    const stored = await db.notes.get(id);
    // "<p></p>" is the editor's empty body: a purged note with only a title edit must not re-save on open.
    const fields = { title: "", html: "<p></p>", folderId: null, tags: [] };
    for (const key of EDIT_FIELDS) fields[key] = Object.hasOwn(clean, key) ? clean[key] : stored?.[key] ?? fields[key];
    fields.title = `${fields.title || "Untitled"} (conflict copy)`;
    fields.html = neutralizeNoteLinks(fields.html, new Set(await db.tombstones.toCollection().primaryKeys()));
    if (fields.folderId && !(await db.folders.get(fields.folderId))) fields.folderId = null;
    return insertNoteInTransaction({ ...fields, id: newId() });
  });
}

export async function updateNote(id, patch, { expectedRev } = {}) {
  const clean = cleanPatch(patch); // Validate and capture before opening the transaction.
  const captured = Object.fromEntries(Object.keys(patch).map((key) => [key, clean[key]]));
  return writeTransaction([db.notes, db.folders, db.files], async () => {
    const note = await db.notes.get(id);
    if (expectedRev !== undefined && (!note || note.rev !== expectedRev)) throw new NoteChangedElsewhereError();
    if (!note) throw new Error("Note does not exist");
    return writeNoteInTransaction(note, captured);
  });
}

// Only call inside a guarded notes/folders/files transaction.
export async function writeNoteInTransaction(note, patch, { housekeeping = false } = {}) {
  const clean = cleanPatch(patch);
  if (Object.hasOwn(clean, "folderId")) await checkFolder(clean.folderId);
  const edited = isContentEdit(clean, note);
  const next = { ...note, ...clean, updatedAt: edited && !housekeeping ? nowIso() : note.updatedAt, rev: note.rev + 1 };
  await db.notes.put(next);
  if (Object.hasOwn(clean, "html")) await clearReferencedFileMarks(next.html);
  return next;
}

export const setPinned = (id, pinned) => updateNote(id, { pinned });
export const trashNote = (id) => updateNote(id, { deletedAt: nowIso() });

export async function restoreNote(id) {
  return writeTransaction([db.notes, db.tombstones, db.files], async () => {
    const note = await db.notes.get(id);
    if (!note) throw new Error("Note does not exist");
    // A target might have been purged while this source note was also in Trash.
    const ids = new Set(await db.tombstones.toCollection().primaryKeys());
    const html = neutralizeNoteLinks(note.html, ids);
    const next = { ...note, html, text: htmlToText(html), linkedIds: extractNoteLinks(html), deletedAt: null, rev: note.rev + 1 };
    await db.notes.put(next);
    await clearReferencedFileMarks(next.html);
    return next;
  });
}

export async function purgeExpired(now = new Date()) {
  const at = new Date(now).toISOString();
  const cutoff = new Date(new Date(now).getTime() - TRASH_RETENTION_MS).toISOString();
  return writeTransaction([db.notes, db.tombstones], async () => {
    const expired = await db.notes.where("deletedAt").below(cutoff).toArray();
    return purgeRows(expired, at);
  });
}

// Both purge paths run this inside the same notes/tombstones transaction.
async function purgeRows(rows, at) {
  const ids = new Set(rows.map((note) => note.id));
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
}

export async function purgeNow(id) {
  return writeTransaction([db.notes, db.tombstones], async () => {
    const note = await db.notes.get(id);
    if (!note) throw new Error("Note does not exist");
    if (note.deletedAt === null) throw new Error("Move the note to Trash before deleting it permanently");
    return purgeRows([note], nowIso());
  });
}

// Null values are absent from IndexedDB indexes: never query equals(null).
export const liveNotes = () => db.notes.orderBy("updatedAt").reverse().filter((note) => note.deletedAt === null).toArray();
export const trashedNotes = () => db.notes.orderBy("deletedAt").reverse().toArray();
export const getNote = (id) => db.notes.get(id);
export const backlinksFor = (id) => db.notes.where("linkedIds").equals(id).filter((note) => note.deletedAt === null).toArray();
