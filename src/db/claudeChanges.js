import { db, notebookAccess, writeTransaction, DATABASE_UPDATED } from "./db.js";
import { writeNoteInTransaction } from "./notes.js";
import { clearReferencedFileMarks } from "./files.js";
import { newId, isSafeId } from "../lib/ids.js";
import { nowIso } from "../lib/dates.js";
import { neutralizeNoteLinks } from "../lib/text.js";

export const STALE_PROPOSAL = "This note changed since Claude read it. Ask again.";
const stale = () => { throw new Error(STALE_PROPOSAL); };
const tables = () => [db.notes, db.folders, db.tombstones, db.files, db.prefs];
async function generationCheck(expected) {
  if (notebookAccess.getSnapshot().versionChange) throw new Error(DATABASE_UPDATED);
  if (expected === undefined || expected !== notebookAccess.getGeneration() || ((await db.prefs.get("notebookGeneration"))?.value ?? null) !== expected) stale();
}
async function checkPlan(plan) {
  await generationCheck(plan.generation);
  if (!plan.notes.length || new Set(plan.notes.map((item) => item.id)).size !== plan.notes.length) stale();
  const notes = await db.notes.bulkGet(plan.notes.map((item) => item.id));
  if (notes.some((note, index) => !note || note.deletedAt !== null || note.rev !== plan.notes[index].expectedRev)) stale();
  for (const expected of plan.folderChecks ?? []) {
    const folder = await db.folders.get(expected.id);
    if (!folder || folder.name !== expected.name) stale();
  }
  if (plan.createFolders?.length) {
    const folders = await db.folders.toArray();
    if (plan.createFolders.some(({ name }) => folders.some((folder) => folder.name.toLowerCase() === name.toLowerCase()))) stale();
  }
  return notes;
}
export async function claudePlanIsCurrent(plan) {
  try { return await db.transaction("r", db.notes, db.folders, db.prefs, async () => { await checkPlan(plan); return true; }); }
  catch { return false; }
}
export function applyClaudeChanges(plan) {
  return writeTransaction(tables(), async () => {
    const notes = await checkPlan(plan);
    const folders = await db.folders.toArray(), created = new Map();
    let position = folders.reduce((max, folder) => Math.max(max, folder.position), -1) + 1;
    for (const { name } of plan.createFolders ?? []) {
      if (!isSafeId(name) || name !== name.trim() || !plan.notes.some((item) => item.patch.folderId?.create === name) || [...created.keys()].some((existing) => existing.toLowerCase() === name.toLowerCase()) || folders.some((folder) => folder.name.toLowerCase() === name.toLowerCase())) stale();
      const id = newId(); created.set(name, id);
      await db.folders.add({ id, name, position: position++ });
    }
    const undo = { changeId: newId(), generation: plan.generation, at: nowIso(), notes: [], createdFolders: [...created.values()], createdNotes: [], trashedNotes: [] };
    for (const [index, item] of plan.notes.entries()) {
      const before = notes[index], patch = { ...item.patch };
      if (patch.folderId && typeof patch.folderId === "object") {
        const id = created.get(patch.folderId.create);
        if (!id) stale();
        patch.folderId = id;
      }
      const fields = Object.keys(patch).filter((key) => JSON.stringify(patch[key]) !== JSON.stringify(before[key]));
      if (!fields.length) continue;
      const next = await writeNoteInTransaction(before, patch);
      undo.notes.push({ id: before.id, before, fields, writtenRev: next.rev });
      // The old body is now protected by Undo; clear any pre-existing unused clock immediately.
      await clearReferencedFileMarks(before.html);
    }
    if (!undo.notes.length) throw new Error("Claude suggests no changes.");
    await db.prefs.put({ key: "claudeLastChange", value: undo });
    return { changeId: undo.changeId, applied: undo.notes.length };
  });
}
// Device-local data can still be damaged. Never restore an incomplete before-copy.
export function isClaudeChange(record) {
  const fields = ["title", "html", "folderId", "tags", "pinned", "deletedAt"];
  const date = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
  return !!record && isSafeId(record.changeId) && (record.generation === null || isSafeId(record.generation)) && date(record.at) &&
    Array.isArray(record.createdFolders) && record.createdFolders.every(isSafeId) &&
    Array.isArray(record.createdNotes) && Array.isArray(record.trashedNotes) &&
    Array.isArray(record.notes) && record.notes.length > 0 && new Set(record.notes.map((entry) => entry?.id)).size === record.notes.length &&
    record.notes.every((entry) => {
      const before = entry?.before;
      return isSafeId(entry?.id) && before?.id === entry.id && typeof before.title === "string" && typeof before.html === "string" &&
        (before.folderId === null || isSafeId(before.folderId)) && Array.isArray(before.tags) && before.tags.every(isSafeId) &&
        typeof before.pinned === "boolean" && (before.deletedAt === null || date(before.deletedAt)) && date(before.createdAt) && date(before.updatedAt) &&
        Number.isSafeInteger(before.rev) && before.rev > 0 && Number.isSafeInteger(entry.writtenRev) && entry.writtenRev > before.rev &&
        Array.isArray(entry.fields) && entry.fields.length > 0 && entry.fields.every((field) => fields.includes(field));
    });
}
async function readUndo(changeId) {
  const record = (await db.prefs.get("claudeLastChange"))?.value;
  if (!isClaudeChange(record) || record.changeId !== changeId) throw new Error("That Claude change is no longer available.");
  await generationCheck(record.generation);
  return record;
}
async function restoredPatch(before, fields, tombstones) {
  const patch = Object.fromEntries(fields.map((key) => [key, before[key]]));
  if (Object.hasOwn(patch, "html")) patch.html = neutralizeNoteLinks(patch.html, tombstones);
  if (patch.folderId && !(await db.folders.get(patch.folderId))) patch.folderId = null;
  return patch;
}
export function undoClaudeChange(changeId) {
  return writeTransaction(tables(), async () => {
    const record = await readUndo(changeId);
    const notes = await db.notes.bulkGet(record.notes.map((entry) => entry.id));
    if (notes.some((note, index) => !note || note.deletedAt !== null || note.rev !== record.notes[index].writtenRev)) {
      return { conflict: true, notes: record.notes.map((entry) => ({ id: entry.id, title: entry.before.title })) };
    }
    const tombstones = new Set(await db.tombstones.toCollection().primaryKeys());
    for (const [index, entry] of record.notes.entries()) {
      const patch = await restoredPatch(entry.before, entry.fields, tombstones);
      const next = await writeNoteInTransaction(notes[index], patch, { housekeeping: true });
      await db.notes.put({ ...next, updatedAt: entry.before.updatedAt });
      await clearReferencedFileMarks(next.html);
    }
    for (const id of record.createdFolders) if (!(await db.notes.filter((note) => note.folderId === id).count())) await db.folders.delete(id);
    await db.prefs.delete("claudeLastChange");
    return { restored: record.notes.length };
  });
}
export function restoreClaudeCopies(changeId) {
  return writeTransaction(tables(), async () => {
    const record = await readUndo(changeId);
    const tombstones = new Set(await db.tombstones.toCollection().primaryKeys()), ids = [];
    for (const { before } of record.notes) {
      const at = nowIso(), id = newId();
      const base = { id, rev: 0, createdAt: at, updatedAt: at, pinned: false, deletedAt: null };
      const patch = await restoredPatch(before, ["title", "html", "folderId", "tags"], tombstones);
      patch.title = `${before.title || "Untitled"} (before Claude)`;
      await writeNoteInTransaction(base, patch, { housekeeping: true });
      ids.push(id);
    }
    await db.prefs.delete("claudeLastChange");
    return { ids };
  });
}
