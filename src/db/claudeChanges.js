import { db, notebookAccess, writeTransaction, DATABASE_UPDATED } from "./db.js";
import { writeNoteInTransaction, insertNoteInTransaction } from "./notes.js";
import { clearReferencedFileMarks } from "./files.js";
import { newId, isSafeId } from "../lib/ids.js";
import { nowIso } from "../lib/dates.js";
import { noteTitle } from "../lib/notebookView.js";
import { extractNoteLinks, neutralizeNoteLinks } from "../lib/text.js";

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
  const createdIds = new Set((plan.createNotes ?? []).map((note) => note.id)), targets = new Set();
  for (const [index, item] of plan.notes.entries()) {
    if (Object.hasOwn(item.patch, "html")) for (const id of extractNoteLinks(item.patch.html)) {
      if (!notes[index].linkedIds.includes(id)) targets.add(id);
    }
  }
  for (const note of plan.createNotes ?? []) for (const id of extractNoteLinks(note.html)) targets.add(id);
  const linked = await db.notes.bulkGet([...targets].filter((id) => !createdIds.has(id)));
  if (linked.some((note) => !note)) stale();
  for (const expected of plan.folderChecks ?? []) {
    const folder = await db.folders.get(expected.id);
    if (!folder || folder.name !== expected.name) stale();
  }
  if (plan.createFolders?.length || plan.expectedNewFolders?.length) {
    const folders = await db.folders.toArray();
    if ([...(plan.createFolders ?? []).map(({ name }) => name), ...(plan.expectedNewFolders ?? [])].some((name) => folders.some((folder) => folder.name.toLowerCase() === name.toLowerCase()))) stale();
  }
  if (plan.backlinkCheck) {
    const { sourceIds, groupIds, noteIds } = plan.backlinkCheck;
    const actual = await db.notes.where("linkedIds").anyOf(sourceIds).distinct().filter((note) => note.deletedAt === null && !groupIds.includes(note.id)).primaryKeys();
    if (actual.length !== noteIds.length || actual.some((id) => !noteIds.includes(id))) stale();
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
      if (!isSafeId(name) || name !== name.trim() || ![...plan.notes.map((item) => item.patch), ...(plan.createNotes ?? [])].some((item) => item.folderId?.create === name) || [...created.keys()].some((existing) => existing.toLowerCase() === name.toLowerCase()) || folders.some((folder) => folder.name.toLowerCase() === name.toLowerCase())) stale();
      const id = newId(); created.set(name, id);
      await db.folders.add({ id, name, position: position++ });
    }
    const undo = { ...(plan.kind ? { kind: plan.kind } : {}), changeId: newId(), generation: plan.generation, at: nowIso(), notes: [], createdFolders: [...created.values()], createdNotes: [], trashedNotes: [] };
    for (const [index, item] of plan.notes.entries()) {
      const before = notes[index], patch = { ...item.patch };
      if (patch.folderId && typeof patch.folderId === "object") {
        const id = created.get(patch.folderId.create);
        if (!id) stale();
        patch.folderId = id;
      }
      const fields = Object.keys(patch).filter((key) => JSON.stringify(patch[key]) !== JSON.stringify(before[key]));
      // An exact-duplicate merge leaves the kept note as it is: it gets no Undo entry.
      if (!fields.length) { if (item.role && !(item.role === "content" && plan.kind === "merge")) throw new Error("An approved note change is empty."); continue; }
      const next = await writeNoteInTransaction(before, patch, { housekeeping: item.housekeeping === true });
      undo.notes.push({ id: before.id, before, fields, writtenRev: next.rev, ...(item.role ? { role: item.role } : {}) });
      if (item.role === "trashed") undo.trashedNotes.push(before.id);
      // The old body is now protected by Undo; clear any pre-existing unused clock immediately.
      await clearReferencedFileMarks(before.html);
    }
    if (!undo.notes.length) throw new Error("Claude suggests no changes.");
    for (const item of plan.createNotes ?? []) {
      const folderId = item.folderId && typeof item.folderId === "object" ? created.get(item.folderId.create) : item.folderId;
      if (folderId === undefined) stale();
      const next = await insertNoteInTransaction({ ...item, folderId });
      undo.createdNotes.push({ id: next.id, writtenRev: next.rev });
    }
    if (!isClaudeChange(undo)) throw new Error("Invalid Claude change.");
    await db.prefs.put({ key: "claudeLastChange", value: undo });
    return { changeId: undo.changeId, applied: undo.notes.length, created: undo.createdNotes.map((note) => note.id) };
  });
}
// Device-local data can still be damaged. Never restore an incomplete before-copy.
export function isClaudeChange(record) {
  const fields = ["title", "html", "folderId", "tags", "pinned", "deletedAt"];
  const date = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
  const valid = !!record && isSafeId(record.changeId) && (record.generation === null || isSafeId(record.generation)) && date(record.at) &&
    Array.isArray(record.createdFolders) && record.createdFolders.every(isSafeId) &&
    Array.isArray(record.createdNotes) && Array.isArray(record.trashedNotes) &&
    Array.isArray(record.notes) && record.notes.length > 0 && new Set(record.notes.map((entry) => entry?.id)).size === record.notes.length &&
    record.notes.every((entry) => {
      const before = entry?.before;
      return isSafeId(entry?.id) && before?.id === entry.id && typeof before.title === "string" && typeof before.html === "string" &&
        (before.folderId === null || isSafeId(before.folderId)) && Array.isArray(before.tags) && before.tags.every(isSafeId) &&
        typeof before.pinned === "boolean" && (before.deletedAt === null || date(before.deletedAt)) && date(before.createdAt) && date(before.updatedAt) &&
        Number.isSafeInteger(before.rev) && before.rev > 0 && Number.isSafeInteger(entry.writtenRev) && entry.writtenRev > before.rev &&
        Array.isArray(entry.fields) && entry.fields.length > 0 && new Set(entry.fields).size === entry.fields.length && entry.fields.every((field) => fields.includes(field));
    });
  if (!valid || ![undefined, "links", "merge", "split"].includes(record.kind)) return false;
  if (!["merge", "split"].includes(record.kind)) return !record.createdNotes.length && !record.trashedNotes.length && record.notes.every((entry) => !Object.hasOwn(entry, "role"));
  const content = record.notes.filter((entry) => entry.role === "content"), trashed = record.notes.filter((entry) => entry.role === "trashed");
  if (content.length > 1 || (record.kind === "split" && content.length !== 1) || record.notes.some((entry) => !["content", "trashed", "relinked"].includes(entry.role))) return false;
  if (trashed.some((entry) => entry.fields.length !== 1 || entry.fields[0] !== "deletedAt" || entry.before.deletedAt !== null)) return false;
  if (record.notes.some((entry) => entry.role === "relinked" && (entry.fields.length !== 1 || entry.fields[0] !== "html"))) return false;
  if (record.trashedNotes.length !== trashed.length || new Set(record.trashedNotes).size !== trashed.length || record.trashedNotes.some((id) => !trashed.some((entry) => entry.id === id))) return false;
  if (new Set(record.createdNotes.map((entry) => entry?.id)).size !== record.createdNotes.length || record.createdNotes.some((entry) => !entry || Object.keys(entry).length !== 2 || !isSafeId(entry.id) || !Number.isSafeInteger(entry.writtenRev) || entry.writtenRev < 1 || record.notes.some((note) => note.id === entry.id))) return false;
  return record.kind === "merge" ? trashed.length > 0 && record.createdNotes.length === 0 : record.notes.length === 1 && record.createdNotes.length > 0;
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
export const isMetadataOnlyChange = (record) => record.createdNotes.length === 0 && record.trashedNotes.length === 0 && record.notes.every((entry) => entry.fields.every((field) => ["title", "tags", "folderId"].includes(field)));
export const allowsPartialUndo = (record) => isMetadataOnlyChange(record) ||
  (record.kind === "links" && !record.createdNotes.length && !record.trashedNotes.length &&
  !record.createdFolders.length && record.notes.every((entry) => entry.fields.length === 1 && entry.fields[0] === "html"));
export function undoClaudeChange(changeId, { unchangedOnly = false, keepEdits = false, expected } = {}) {
  return writeTransaction(tables(), async () => {
    const record = await readUndo(changeId);
    if (["merge", "split"].includes(record.kind)) return undoMovedNotes(record, { keepEdits, expected });
    const notes = await db.notes.bulkGet(record.notes.map((entry) => entry.id));
    const unchanged = notes.map((note, index) => !!note && note.deletedAt === null && note.rev === record.notes[index].writtenRev);
    const partial = allowsPartialUndo(record);
    if (unchanged.some((value) => !value) && !(unchangedOnly && partial)) {
      return { conflict: true, partial, unchanged: unchanged.filter(Boolean).length, notes: record.notes.map((entry) => ({ id: entry.id, title: entry.before.title })) };
    }
    const skipped = record.notes.filter((_entry, index) => !unchanged[index]).map((entry) => ({ id: entry.id, title: noteTitle(notes.find((note) => note?.id === entry.id) ?? entry.before) }));
    const tombstones = new Set(await db.tombstones.toCollection().primaryKeys());
    for (const [index, entry] of record.notes.entries()) {
      if (!unchanged[index]) continue;
      const patch = await restoredPatch(entry.before, entry.fields, tombstones);
      const next = await writeNoteInTransaction(notes[index], patch, { housekeeping: true });
      await db.notes.put({ ...next, updatedAt: entry.before.updatedAt });
      await clearReferencedFileMarks(next.html);
    }
    for (const id of record.createdFolders) if (!(await db.notes.filter((note) => note.folderId === id).count())) await db.folders.delete(id);
    await db.prefs.delete("claudeLastChange");
    return { restored: unchanged.filter(Boolean).length, ...(unchangedOnly ? { skipped } : {}) };
  });
}
export function restoreClaudeCopies(changeId) {
  return writeTransaction(tables(), async () => {
    const record = await readUndo(changeId);
    if (["merge", "split"].includes(record.kind)) throw new Error("Use Undo for this change instead.");
    if (allowsPartialUndo(record)) throw new Error("Use Undo for the unchanged notes instead.");
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

// One decision table serves both merge and split. A conflict never restores just some content:
// the owner may have moved words between notes since Apply, so even an unchanged body is copied.
const conflictAction = {
  content: (note) => note ? "copy" : "copy-purged",
  trashed: (note) => !note ? "copy-purged" : note.deletedAt !== null ? "out-of-trash" : "already-back",
  relinked: () => "left-relinked",
  created: () => "left-created",
};
async function undoMovedNotes(record, { keepEdits, expected }) {
  const entries = [...record.notes, ...record.createdNotes.map((note) => ({ ...note, role: "created" }))];
  const notes = await db.notes.bulkGet(entries.map((entry) => entry.id));
  const asLeft = entries.every((entry, index) => {
    const note = notes[index];
    return note && note.rev === entry.writtenRev && (entry.role === "trashed" ? note.deletedAt !== null : note.deletedAt === null);
  });
  const decisions = entries.map((entry, index) => ({ id: entry.id, title: noteTitle(notes[index] ?? entry.before ?? { title: "Untitled", text: "" }), action: conflictAction[entry.role](notes[index]) }));
  if (!asLeft && (!keepEdits || JSON.stringify(decisions) !== JSON.stringify(expected))) return { conflict: true, keepEdits: true, decisions };
  const tombstones = new Set(await db.tombstones.toCollection().primaryKeys()), copies = [];
  for (const [index, entry] of entries.entries()) {
    const note = notes[index];
    if (!asLeft) {
      const action = decisions[index].action;
      if (["copy", "copy-purged"].includes(action)) {
        const patch = await restoredPatch(entry.before, ["title", "html", "folderId", "tags"], tombstones);
        const id = newId();
        await insertNoteInTransaction({ ...patch, id, title: `${entry.before.title || "Untitled"} (before Claude)` });
        copies.push(id);
      } else if (action === "out-of-trash") await writeNoteInTransaction(note, { deletedAt: null, html: neutralizeNoteLinks(note.html, tombstones) }, { housekeeping: true });
      continue;
    }
    if (entry.role === "created") {
      await writeNoteInTransaction(note, { deletedAt: nowIso(), ...(record.createdFolders.includes(note.folderId) ? { folderId: null } : {}) }, { housekeeping: true });
    } else if (entry.role === "trashed") {
      await writeNoteInTransaction(note, { deletedAt: null, html: neutralizeNoteLinks(note.html, tombstones) }, { housekeeping: true });
    } else {
      const patch = await restoredPatch(entry.before, entry.fields, tombstones);
      const next = await writeNoteInTransaction(note, patch, { housekeeping: true });
      await db.notes.put({ ...next, updatedAt: entry.before.updatedAt });
    }
  }
  if (asLeft) for (const id of record.createdFolders) if (!(await db.notes.filter((note) => note.folderId === id).count())) await db.folders.delete(id);
  await db.prefs.delete("claudeLastChange");
  return asLeft ? { restored: true, kind: record.kind } : { restored: true, keepEdits: true, decisions, copies };
}
