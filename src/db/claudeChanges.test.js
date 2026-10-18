import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { db, notebookAccess, getPref, writeTransaction } from "./db.js";
import { createNote, updateNote, trashNote, purgeNow, writeNoteInTransaction } from "./notes.js";
import { createFolder, renameFolder } from "./folders.js";
import { applyClaudeChanges, undoClaudeChange, restoreClaudeCopies, STALE_PROPOSAL } from "./claudeChanges.js";
import { cleanupFiles, FILE_RETENTION_MS } from "./files.js";
import { importBackup } from "./backup.js";
import { resetDatabase, backupFixture, AT } from "../test/fixtures.js";
beforeEach(resetDatabase);
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const planFor = (notes, patch = { title: "Tidied" }) => ({ generation: notebookAccess.getGeneration(), notes: notes.map((note) => ({ id: note.id, expectedRev: note.rev, patch })), createFolders: [], folderChecks: [] });
it("writes projections, rev, recency and a complete undo copy, and restores exactly with a forward revision", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(AT));
  const before = await createNote({ title: "Original", html: '<p>Before</p><img data-file="image">' });
  await db.files.put({ id: "image", unusedSince: AT });
  vi.setSystemTime(Date.now() + 1000);
  const result = await applyClaudeChanges(planFor([before], { html: '<p><a href="note:target">After</a></p>', title: "After" }));
  expect(await db.notes.get(before.id)).toMatchObject({ rev: 2, text: "After", linkedIds: ["target"], updatedAt: new Date().toISOString() });
  const record = await getPref("claudeLastChange");
  expect(record).toMatchObject({ changeId: result.changeId, generation: null, notes: [{ id: before.id, before, fields: ["html", "title"], writtenRev: 2 }], createdNotes: [], trashedNotes: [] });
  expect((await db.files.get("image")).unusedSince).toBeNull();
  expect(await undoClaudeChange(result.changeId)).toEqual({ restored: 1 });
  expect(await db.notes.get(before.id)).toEqual({ ...before, rev: 3 });
  expect(await getPref("claudeLastChange")).toBeUndefined();
});
it("housekeeping cleans fields and advances rev without moving recency", async () => {
  const note = await createNote();
  const next = await writeTransaction([db.notes, db.folders, db.files], () => writeNoteInTransaction(note, { html: '<p>Changed</p>' }, { housekeeping: true }));
  expect(next).toMatchObject({ rev: 2, updatedAt: note.updatedAt, text: "Changed", linkedIds: [] });
});
it.each(["rev", "renamed", "deleted"])("refuses every note for one stale %s", async (kind) => {
  const folder = await createFolder("Original"), a = await createNote(), b = await createNote();
  const plan = { ...planFor([a, b]), folderChecks: [{ id: folder.id, name: folder.name }] };
  if (kind === "rev") await updateNote(b.id, { title: "Later" });
  if (kind === "renamed") await renameFolder(folder.id, "Other");
  if (kind === "deleted") await db.folders.delete(folder.id);
  await expect(applyClaudeChanges(plan)).rejects.toThrow(STALE_PROPOSAL);
  expect(await db.notes.get(a.id)).toEqual(a); expect(await getPref("claudeLastChange")).toBeUndefined();
});
it("rolls back notes, new folders, image marks and prefs when a later write fails", async () => {
  const a = await createNote({ html: '<p>A</p><img data-file="image">' }), b = await createNote();
  await db.files.put({ id: "image", unusedSince: AT });
  const plan = planFor([a, b], { title: "New", folderId: { create: "New folder" } }); plan.createFolders = [{ name: "New folder" }];
  const original = db.notes.put.bind(db.notes); let writes = 0;
  vi.spyOn(db.notes, "put").mockImplementation((...args) => ++writes === 2 ? Promise.reject(new Error("Disk full")) : original(...args));
  await expect(applyClaudeChanges(plan)).rejects.toThrow("Disk full");
  expect(await db.notes.toArray()).toEqual(expect.arrayContaining([a, b]));
  expect(await db.folders.count()).toBe(0); expect(await db.prefs.count()).toBe(0);
  expect((await db.files.get("image")).unusedSince).toBe(AT);
});
it("refuses a different generation and upgrade-pending writes", async () => {
  const note = await createNote(), plan = planFor([note]);
  await expect(applyClaudeChanges({ ...plan, generation: "wrong" })).rejects.toThrow();
  vi.spyOn(notebookAccess, "getSnapshot").mockReturnValue({ versionChange: "pending" });
  await expect(applyClaudeChanges(plan)).rejects.toThrow("updated");
  expect(await db.notes.get(note.id)).toEqual(note);
});
it("refuses replaced and read-only notebook writes", async () => {
  const note = await createNote();
  vi.spyOn(notebookAccess, "check").mockRejectedValue(new Error("Read-only notebook"));
  await expect(applyClaudeChanges(planFor([note]))).rejects.toThrow("Read-only");
  expect(await db.notes.get(note.id)).toEqual(note);
});
it.each([false, true])("removes a created folder only if unused (used=%s)", async (used) => {
  const before = await createNote(), plan = planFor([before], { folderId: { create: "New folder" } });
  plan.createFolders = [{ name: "New folder" }];
  const { changeId } = await applyClaudeChanges(plan), folder = (await db.folders.toArray())[0];
  if (used) await createNote({ folderId: folder.id });
  await undoClaudeChange(changeId);
  expect(!!(await db.folders.get(folder.id))).toBe(used);
  expect((await db.notes.get(before.id)).folderId).toBeNull();
});
it.each(["edit", "trash", "purge"])("after %s Undo changes nothing and offers fresh copies", async (kind) => {
  const before = await createNote({ title: "Original", html: '<p>Keep</p>' });
  const { changeId } = await applyClaudeChanges(planFor([before], { title: "Tidied", html: "<p>Tidied body</p>" }));
  if (kind === "edit") await updateNote(before.id, { html: "<p>Later writing</p>" });
  else { await trashNote(before.id); if (kind === "purge") await purgeNow(before.id); }
  const later = await db.notes.get(before.id);
  expect(await undoClaudeChange(changeId)).toMatchObject({ conflict: true });
  expect(await db.notes.get(before.id)).toEqual(later);
  const { ids } = await restoreClaudeCopies(changeId);
  expect(ids).toHaveLength(1); expect(ids[0]).not.toBe(before.id);
  expect(await db.notes.get(ids[0])).toMatchObject({ title: "Original (before Claude)", html: before.html, rev: 1, deletedAt: null });
  const copy = await db.notes.get(ids[0]); expect(copy.updatedAt).toBe(copy.createdAt);
  expect(await getPref("claudeLastChange")).toBeUndefined();
});
it.each([false, true])("neutralises purged links and missing folders on restore (copies=%s)", async (copies) => {
  const target = await createNote(), folder = await createFolder("Old");
  const before = await createNote({ folderId: folder.id, html: `<p><a href="note:${target.id}">Target</a></p>` });
  const { changeId } = await applyClaudeChanges(planFor([before], { html: "<p>New</p>", folderId: null }));
  await trashNote(target.id); await purgeNow(target.id); await db.folders.delete(folder.id);
  if (copies) { await updateNote(before.id, { title: "Later" }); await undoClaudeChange(changeId); }
  const result = copies ? await restoreClaudeCopies(changeId) : await undoClaudeChange(changeId);
  const restored = await db.notes.get(copies ? result.ids[0] : before.id);
  expect(restored.folderId).toBeNull(); expect(restored.linkedIds).toEqual([]); expect(restored.html).not.toContain("note:"); expect(restored.text).toBe("Target");
});
it("import clears the record and rejects a retained undo id or old generation", async () => {
  const before = await createNote(), plan = planFor([before]);
  const { changeId } = await applyClaudeChanges(plan);
  await importBackup(backupFixture());
  expect(await getPref("claudeLastChange")).toBeUndefined();
  await expect(undoClaudeChange(changeId)).rejects.toThrow();
  await expect(applyClaudeChanges(plan)).rejects.toThrow();
});
it.each(["clear", "replace"])("retains images past 30 days, starting a fresh clock on %s", async (release) => {
  const before = await createNote({ html: '<p>Old</p><img data-file="image">' });
  await db.files.put({ id: "image", unusedSince: AT }); await db.fileData.put({ id: "image", bytes: new ArrayBuffer(1) });
  const { changeId } = await applyClaudeChanges(planFor([before], { html: '<p>No image</p>' }));
  const muchLater = new Date(Date.parse(AT) + 2 * FILE_RETENTION_MS);
  await cleanupFiles(muchLater); expect((await db.files.get("image")).unusedSince).toBeNull();
  if (release === "clear") await db.prefs.delete("claudeLastChange");
  else { const current = await db.notes.get(before.id); await applyClaudeChanges(planFor([current])); await expect(undoClaudeChange(changeId)).rejects.toThrow(); }
  await cleanupFiles(muchLater); expect((await db.files.get("image")).unusedSince).toBe(muchLater.toISOString());
  await cleanupFiles(new Date(+muchLater + FILE_RETENTION_MS)); expect(await db.files.get("image")).toBeTruthy();
  await cleanupFiles(new Date(+muchLater + FILE_RETENTION_MS + 1)); expect(await db.files.get("image")).toBeUndefined(); expect(await db.fileData.get("image")).toBeUndefined();
});
it("refuses through the real newer-database and replaced-generation guards", async () => {
  const before = await createNote(), plan = planFor([before]);
  const backend = db.backendDB();
  const version = vi.spyOn(backend, 'version', 'get').mockReturnValue(50);
  await expect(applyClaudeChanges(plan)).rejects.toThrow('newer version');
  version.mockRestore();
  // Reload the access state after restoring the test database's reported version.
  await notebookAccess.load();
  await db.prefs.put({ key: 'notebookGeneration', value: 'another-window' });
  await expect(applyClaudeChanges(plan)).rejects.toThrow('replaced');
  expect(await db.notes.get(before.id)).toEqual(before);
});
it("refuses an old-generation undo even if an obsolete record is put back after import", async () => {
  const before = await createNote(), { changeId } = await applyClaudeChanges(planFor([before]));
  const record = await getPref('claudeLastChange');
  await importBackup(backupFixture());
  await db.prefs.put({ key: 'claudeLastChange', value: record });
  const notes = await db.notes.toArray();
  await expect(undoClaudeChange(changeId)).rejects.toThrow(STALE_PROPOSAL);
  await expect(restoreClaudeCopies(changeId)).rejects.toThrow(STALE_PROPOSAL);
  expect(await db.notes.toArray()).toEqual(notes);
});
it("refuses unused new folders and names occupied since the proposal", async () => {
  const note = await createNote();
  await expect(applyClaudeChanges({ ...planFor([note]), createFolders: [{ name: 'Unused' }] })).rejects.toThrow(STALE_PROPOSAL);
  await createFolder('Occupied');
  await expect(applyClaudeChanges({ ...planFor([note], { folderId: { create: 'occupied' } }), createFolders: [{ name: 'occupied' }] })).rejects.toThrow(STALE_PROPOSAL);
  expect(await db.notes.get(note.id)).toEqual(note);
});
it("one edited note makes a multi-note undo conflict without restoring any originals", async () => {
  const a = await createNote({ title: 'A' }), b = await createNote({ title: 'B' });
  const { changeId } = await applyClaudeChanges(planFor([a, b], { html: "<p>Tidied body</p>" }));
  await updateNote(b.id, { html: '<p>Later</p>' });
  const beforeUndo = await db.notes.toArray();
  expect((await undoClaudeChange(changeId)).notes).toHaveLength(2);
  expect(await db.notes.toArray()).toEqual(beforeUndo);
  const { ids } = await restoreClaudeCopies(changeId); expect(ids).toHaveLength(2);
  expect((await db.notes.bulkGet(ids)).map((note) => note.title)).toEqual(['A (before Claude)', 'B (before Claude)']);
});
it.each(['edit', 'trash', 'purge', 'pin'])('metadata Undo after %s restores only unchanged notes, preserves dates, clears the record and never creates copies', async (kind) => {
  const a = await createNote({ title: 'A', html: '<p>Keep A</p>' }), b = await createNote({ title: 'B', html: '<p>Keep B</p>' });
  const plan = planFor([a, b], { title: 'Tidied', tags: ['clase'], folderId: { create: 'Together' } }); plan.createFolders = [{ name: 'Together' }];
  const { changeId } = await applyClaudeChanges(plan), folder = (await db.folders.toArray())[0];
  if (kind === 'edit') await updateNote(b.id, { title: 'Later B', html: '<p>My later text</p>' });
  if (kind === 'pin') await updateNote(b.id, { pinned: true });
  if (kind === 'trash' || kind === 'purge') { await trashNote(b.id); if (kind === 'purge') await purgeNow(b.id); }
  const later = await db.notes.get(b.id), beforeUndo = await db.notes.toArray();
  expect(await undoClaudeChange(changeId)).toMatchObject({ conflict: true, metadataOnly: true, unchanged: 1 });
  expect(await db.notes.toArray()).toEqual(beforeUndo);
  await expect(restoreClaudeCopies(changeId)).rejects.toThrow('unchanged notes');
  const result = await undoClaudeChange(changeId, { unchangedOnly: true });
  expect(result).toMatchObject({ restored: 1, skipped: [{ id: b.id, title: later?.title || 'B' }] });
  expect(await db.notes.get(a.id)).toEqual({ ...a, rev: a.rev + 2 }); expect(await db.notes.get(b.id)).toEqual(later);
  expect(await db.notes.count()).toBe(beforeUndo.length); expect(await getPref('claudeLastChange')).toBeUndefined();
  expect(!!await db.folders.get(folder.id)).toBe(kind !== 'purge');
});
it('rechecks partial Undo after its offer, safely clears an all-changed record, and refuses an obsolete change id', async () => {
  const a = await createNote({ title: 'A' }), b = await createNote({ title: 'B' });
  const { changeId } = await applyClaudeChanges(planFor([a, b])); await updateNote(b.id, { title: 'Later B' });
  expect(await undoClaudeChange(changeId)).toMatchObject({ unchanged: 1 });
  await updateNote(a.id, { title: 'Later A' }); const later = await db.notes.toArray();
  expect(await undoClaudeChange(changeId, { unchangedOnly: true })).toMatchObject({ restored: 0, skipped: [{ title: 'Later A' }, { title: 'Later B' }] });
  expect(await db.notes.toArray()).toEqual(later); expect(await getPref('claudeLastChange')).toBeUndefined();
  const next = await applyClaudeChanges(planFor(later)); await expect(undoClaudeChange(changeId, { unchangedOnly: true })).rejects.toThrow('no longer available');
  expect((await getPref('claudeLastChange')).changeId).toBe(next.changeId);
});
it('rolls back partial Undo and retains its record when a later write fails', async () => {
  const a = await createNote(), b = await createNote(), c = await createNote();
  const { changeId } = await applyClaudeChanges(planFor([a, b, c])); await updateNote(c.id, { title: 'Later' });
  const before = await db.notes.toArray(), undo = await getPref('claudeLastChange');
  const put = db.notes.put.bind(db.notes); let writes = 0;
  vi.spyOn(db.notes, 'put').mockImplementation((...args) => ++writes === 3 ? Promise.reject(new Error('Disk full')) : put(...args));
  await expect(undoClaudeChange(changeId, { unchangedOnly: true })).rejects.toThrow('Disk full');
  expect(await db.notes.toArray()).toEqual(before); expect(await getPref('claudeLastChange')).toEqual(undo);
});
it('a single body change anywhere keeps the copies path for the whole change', async () => {
  const a = await createNote({ title: 'A' }), b = await createNote({ title: 'B' });
  const plan = planFor([a, b]); plan.notes[1].patch = { html: '<p>New body</p>' };
  const { changeId } = await applyClaudeChanges(plan); await updateNote(a.id, { title: 'Later' });
  const before = await db.notes.toArray();
  expect(await undoClaudeChange(changeId, { unchangedOnly: true })).toMatchObject({ conflict: true, metadataOnly: false });
  expect(await db.notes.toArray()).toEqual(before); expect((await restoreClaudeCopies(changeId)).ids).toHaveLength(2);
});
