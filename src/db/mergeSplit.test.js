import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { db, getPref, notebookAccess } from "./db.js";
import { createNote, updateNote, trashNote, restoreNote, purgeNow } from "./notes.js";
import { createFolder, deleteFolder } from "./folders.js";
import { cleanupFiles, FILE_RETENTION_MS } from "./files.js";
import { resetDatabase, AT } from "../test/fixtures.js";
import { captureMergePayload, validateMergeProposal, mergePlan } from "../claude/merge.js";
import { captureSplitPayload, validateSplitProposal, splitPlan } from "../claude/split.js";
import { applyClaudeChanges, undoClaudeChange, restoreClaudeCopies, isClaudeChange, claudePlanIsCurrent, STALE_PROPOSAL } from "./claudeChanges.js";
let a, b, link, folder;
const merged = { summary: '', title: 'Merged', html: '<p>A</p><p>B</p>', tags: ['both'], folder: { action: 'keep', name: null }, reason: '' };
const split = { summary: '', title: null, html: '<p>A</p>', notes: [{ title: 'New', html: '<p>B</p>', tags: ['b'], folder: { action: 'create', name: 'New folder' }, reason: '' }] };
const captureMerge = async () => { const payload = await captureMergePayload([b.id, a.id]); return mergePlan(payload, validateMergeProposal(merged, payload)); };
const captureSplit = async (value = split) => { const payload = await captureSplitPayload(a.id); return splitPlan(payload, validateSplitProposal(value, payload)); };
const snapshot = async () => ({ notes: await db.notes.toArray(), folders: await db.folders.toArray(), undo: await getPref('claudeLastChange') });
beforeEach(async () => {
  await resetDatabase(); folder = await createFolder('Original');
  a = await createNote({ title: 'A', html: '<p>A</p>', folderId: folder.id }); b = await createNote({ title: 'B', html: '<p>B</p>', folderId: folder.id });
  await db.notes.update(a.id, { createdAt: AT, updatedAt: AT }); a = await db.notes.get(a.id);
  link = await createNote({ title: 'Link', html: `<p><a href="note:${b.id}">B</a></p>` });
});
afterEach(() => vi.restoreAllMocks());
it('atomically merges, pins, trashes and redirects; housekeeping preserves dates and clean Undo restores', async () => {
  b = await updateNote(b.id, { pinned: true }); const before = await snapshot(), plan = await captureMerge();
  const result = await applyClaudeChanges(plan); expect(result.created).toEqual([]); expect(result.applied).toBe(3);
  const kept = await db.notes.get(a.id), source = await db.notes.get(b.id), linked = await db.notes.get(link.id), undo = await getPref('claudeLastChange');
  expect(kept).toMatchObject({ pinned: true, title: 'Merged', text: 'A\nB', rev: a.rev + 1 });
  expect(source.deletedAt).not.toBeNull(); expect(source.updatedAt).toBe(b.updatedAt); expect(linked.updatedAt).toBe(link.updatedAt); expect(linked.linkedIds).toEqual([a.id]);
  expect(undo).toMatchObject({ kind: 'merge', trashedNotes: [b.id], createdNotes: [] }); expect(isClaudeChange(undo)).toBe(true);
  expect(await undoClaudeChange(result.changeId)).toEqual({ restored: true, kind: 'merge' });
  for (const n of before.notes) expect(await db.notes.get(n.id)).toEqual({ ...n, rev: n.rev + 2 });
});
it.each(['kept', 'source', 'backlink', 'added', 'removed', 'trashed'])('refuses all writes for stale %s', async (state) => {
  const plan = await captureMerge();
  if (state === 'kept') await updateNote(a.id, { title: 'Later' });
  if (state === 'source') await updateNote(b.id, { title: 'Later' });
  if (state === 'backlink') await updateNote(link.id, { title: 'Later' });
  if (state === 'added') await createNote({ html: `<p><a href="note:${b.id}">New link</a></p>` });
  if (state === 'removed') await updateNote(link.id, { html: '<p>No link</p>' });
  if (state === 'trashed') await trashNote(b.id);
  const before = await snapshot(); expect(await claudePlanIsCurrent(plan)).toBe(false); await expect(applyClaudeChanges(plan)).rejects.toThrow(STALE_PROPOSAL); expect(await snapshot()).toEqual(before);
});
it('ignores Trash backlinks both at capture and if added later', async () => {
  await trashNote(link.id); const before = await db.notes.get(link.id), plan = await captureMerge();
  const other = await createNote({ html: `<p><a href="note:${b.id}">Other</a></p>` }); await trashNote(other.id);
  expect(plan.backlinkCheck.noteIds).toEqual([]); await applyClaudeChanges(plan); expect(await db.notes.get(link.id)).toEqual(before);
});
it.each(['merge', 'split'])('rolls back %s when a write fails', async (kind) => {
  const plan = kind === 'merge' ? await captureMerge() : await captureSplit(), before = await snapshot();
  const method = kind === 'merge' ? 'put' : 'add', original = db.notes[method].bind(db.notes); let count = 0;
  vi.spyOn(db.notes, method).mockImplementation((...args) => ++count === (kind === 'merge' ? 2 : 1) ? Promise.reject(new Error('Disk full')) : original(...args));
  await expect(applyClaudeChanges(plan)).rejects.toThrow('Disk full'); expect(await snapshot()).toEqual(before);
});
it('refuses a role patch that changes nothing and colliding create ids', async () => {
  const plan = await captureMerge(); plan.notes[2].patch = { html: plan.notes[2].patch.html.replace(a.id, b.id) }; let before = await snapshot();
  await expect(applyClaudeChanges(plan)).rejects.toThrow('empty'); expect(await snapshot()).toEqual(before);
  const next = await captureSplit(); next.createNotes[0].id = b.id; before = await snapshot();
  await expect(applyClaudeChanges(next)).rejects.toThrow(); expect(await snapshot()).toEqual(before);
});
it.each(['existing', 'create', 'keep', 'none'])('splits into %s folders and full Undo trashes new notes', async (action) => {
  const value = { ...split, notes: [{ ...split.notes[0], html: `<p><a href="note:N1">A</a></p>`, folder: { action, name: ['existing', 'create'].includes(action) ? action === 'existing' ? folder.name : 'New folder' : null } }] };
  const plan = await captureSplit(value), before = await db.notes.get(a.id), result = await applyClaudeChanges(plan), created = await db.notes.get(result.created[0]);
  expect(created).toMatchObject({ title: 'New', text: 'A', tags: ['b'], pinned: false, rev: 1, deletedAt: null }); expect(created.linkedIds).toHaveLength(1);
  expect((await db.notes.get(a.id)).linkedIds).toContain(created.id);
  const undo = await getPref('claudeLastChange'); expect(isClaudeChange(undo)).toBe(true);
  expect(await undoClaudeChange(result.changeId)).toEqual({ restored: true, kind: 'split' });
  expect(await db.notes.get(a.id)).toEqual({ ...before, rev: before.rev + 2 }); expect((await db.notes.get(created.id)).deletedAt).not.toBeNull();
  if (action === 'create') { expect((await db.notes.get(created.id)).folderId).toBeNull(); expect(await db.folders.get(created.folderId)).toBeUndefined(); }
});
it('groups new folders ignoring case and appends to Split into on a second split', async () => {
  let plan = await captureSplit({ ...split, notes: ['New folder', 'new folder'].map((name) => ({ ...split.notes[0], folder: { action: 'create', name } })) });
  const first = await applyClaudeChanges(plan); expect((await db.notes.bulkGet(first.created)).map((n) => n.folderId)).toEqual([expect.any(String), expect.any(String)]);
  expect(await db.folders.count()).toBe(2); const firstHtml = (await db.notes.get(a.id)).html;
  const payload = await captureSplitPayload(a.id); const body = JSON.parse(payload.requestText).notebookData.note.html;
  plan = splitPlan(payload, validateSplitProposal({ ...split, html: body, notes: [{ ...split.notes[0], folder: { action: 'keep', name: null } }] }, payload));
  const next = await applyClaudeChanges(plan), html = (await db.notes.get(a.id)).html;
  expect(html.match(/Split into:/g)).toHaveLength(1); expect(html).toContain(' · '); expect(html).toContain(next.created[0]); expect(html).toContain(first.created[0]); expect(firstHtml).toContain(first.created[1]);
});
it.each(['content-edit', 'content-trash', 'content-purge', 'source-restored', 'source-rev', 'source-purged', 'relinked-edit', 'relinked-purged'])('merge conflict table: %s never overwrites or removes', async (state) => {
  const { changeId } = await applyClaudeChanges(await captureMerge());
  if (state === 'content-edit') await updateNote(a.id, { title: 'Later A', html: '<p>Later text</p>' });
  if (state === 'content-trash' || state === 'content-purge') { await trashNote(a.id); if (state === 'content-purge') await purgeNow(a.id); }
  if (state === 'source-restored') await restoreNote(b.id);
  if (state === 'source-rev') await deleteFolder(folder.id);
  if (state === 'source-purged') await purgeNow(b.id);
  if (state === 'relinked-edit') await updateNote(link.id, { html: '<p>Later link text</p>' });
  if (state === 'relinked-purged') { await trashNote(link.id); await purgeNow(link.id); }
  const before = await snapshot(), result = await undoClaudeChange(changeId);
  expect(result).toMatchObject({ conflict: true, keepEdits: true }); expect(await snapshot()).toEqual(before);
  expect(result.decisions.map((d) => d.action)).toEqual([state === 'content-purge' ? 'copy-purged' : 'copy', state === 'source-restored' ? 'already-back' : state === 'source-purged' ? 'copy-purged' : 'out-of-trash', 'left-relinked']);
  const done = await undoClaudeChange(changeId, { keepEdits: true, expected: result.decisions });
  expect(done.copies).toHaveLength(state === 'source-purged' ? 2 : 1); expect((await db.notes.get(done.copies[0])).title).toBe('A (before Claude)');
  expect(await db.notes.get(a.id)).toEqual(before.notes.find((n) => n.id === a.id)); expect(await db.notes.get(link.id)).toEqual(before.notes.find((n) => n.id === link.id));
  if (state !== 'source-purged') { const sourceBefore = before.notes.find((n) => n.id === b.id); expect(await db.notes.get(b.id)).toMatchObject({ deletedAt: null, updatedAt: sourceBefore.updatedAt, html: sourceBefore.html }); }
  expect(await getPref('claudeLastChange')).toBeUndefined();
});
it.each(['original', 'created', 'created-trash', 'created-purge'])('split conflict keeps all later notes and folders: %s', async (state) => {
  const { changeId, created } = await applyClaudeChanges(await captureSplit());
  if (state === 'original') await updateNote(a.id, { html: '<p>Later original</p>' });
  if (state === 'created') await updateNote(created[0], { html: '<p>Later new note</p>' });
  if (state === 'created-trash' || state === 'created-purge') { await trashNote(created[0]); if (state === 'created-purge') await purgeNow(created[0]); }
  const before = await snapshot(), offer = await undoClaudeChange(changeId);
  expect(offer.decisions.map((d) => d.action)).toEqual(['copy', 'left-created']); expect(await snapshot()).toEqual(before);
  const result = await undoClaudeChange(changeId, { keepEdits: true, expected: offer.decisions }); expect(result.copies).toHaveLength(1);
  for (const n of before.notes) expect(await db.notes.get(n.id)).toEqual(n);
  expect(await db.folders.toArray()).toEqual(before.folders);
});
it('rechecks the displayed decisions and refuses copies for both kinds', async () => {
  for (const kind of ['merge', 'split']) {
    const { changeId } = await applyClaudeChanges(kind === 'merge' ? await captureMerge() : await captureSplit());
    await expect(restoreClaudeCopies(changeId)).rejects.toThrow('Use Undo for this change instead.');
    await updateNote(a.id, { title: `Later ${kind}` }); const offer = await undoClaudeChange(changeId);
    await updateNote(a.id, { title: `Changed again ${kind}` }); const before = await snapshot();
    const second = await undoClaudeChange(changeId, { keepEdits: true, expected: offer.decisions });
    expect(second.conflict).toBe(true); expect(second.decisions[0].title).toBe(`Changed again ${kind}`); expect(await snapshot()).toEqual(before);
    await undoClaudeChange(changeId, { keepEdits: true, expected: second.decisions });
  }
});
it('cleans tombstones and missing folders in copies and restored Trash sources', async () => {
  const target = await createNote({ title: 'Target' }); await updateNote(a.id, { html: `<p><a href="note:${target.id}">Target</a></p>` });
  const { changeId } = await applyClaudeChanges(await captureMerge()); await trashNote(target.id); await purgeNow(target.id); await deleteFolder(folder.id);
  const offer = await undoClaudeChange(changeId), result = await undoClaudeChange(changeId, { keepEdits: true, expected: offer.decisions });
  expect(await db.notes.get(result.copies[0])).toMatchObject({ folderId: null, linkedIds: [], text: 'Target' });
});
it.each(['merge', 'split'])('undo-only images survive cleanup for %s', async (kind) => {
  await updateNote(a.id, { html: '<p>A</p><img data-file="image">' }); await db.files.put({ id: 'image', unusedSince: AT }); await db.fileData.put({ id: 'image', bytes: new ArrayBuffer(1) });
  await applyClaudeChanges(kind === 'merge' ? await captureMerge() : await captureSplit());
  await cleanupFiles(new Date(Date.parse(AT) + 3 * FILE_RETENTION_MS));
  expect((await db.files.get('image')).unusedSince).toBeNull(); expect(await db.fileData.get('image')).toBeTruthy();
});
it.each(['merge', 'split'])('rejects damaged %s records and rollback retains the undo record', async (kind) => {
  const { changeId } = await applyClaudeChanges(kind === 'merge' ? await captureMerge() : await captureSplit());
  const record = await getPref('claudeLastChange'); expect(isClaudeChange(record)).toBe(true);
  const mutations = [r => { r.kind = 'bad'; }, r => { delete r.notes[0].role; }, r => { r.notes[0].role = 'relinked'; }, r => { r.notes[0].fields.push(r.notes[0].fields[0]); }, r => { r.trashedNotes.push('foreign'); }, r => { r.createdNotes.push({ id: a.id, writtenRev: 1 }); }];
  if (kind === 'merge') mutations.push(r => { r.notes[1].before.deletedAt = AT; }, r => { r.notes[1].fields = ['html']; }, r => { r.notes[2].fields = ['title']; }, r => { r.trashedNotes = []; });
  else mutations.push(r => { r.createdNotes = []; }, r => { r.createdNotes[0].writtenRev = 0; }, r => { r.createdNotes.push(r.createdNotes[0]); }, r => { r.createdNotes[0].extra = true; });
  for (const mutate of mutations) { const damaged = structuredClone(record); mutate(damaged); expect(isClaudeChange(damaged)).toBe(false); }
  const before = await snapshot(), original = db.notes.put.bind(db.notes); let count = 0;
  vi.spyOn(db.notes, 'put').mockImplementation((...args) => ++count === 2 ? Promise.reject(new Error('Disk full')) : original(...args));
  await expect(undoClaudeChange(changeId)).rejects.toThrow('Disk full'); expect(await snapshot()).toEqual(before);
});
it('continues to accept 3c–3e records but refuses roles or created/trashed notes on them', async () => {
  for (const kind of [undefined, 'links']) {
    const note = await db.notes.get(a.id), plan = { generation: notebookAccess.getGeneration(), kind, notes: [{ id: note.id, expectedRev: note.rev, patch: { html: `<p>${kind ?? 'tidy'}</p>` } }] };
    await applyClaudeChanges(plan); const record = await getPref('claudeLastChange'); expect(isClaudeChange(record)).toBe(true);
    expect(isClaudeChange({ ...record, createdNotes: [{ id: 'new', writtenRev: 1 }] })).toBe(false); expect(isClaudeChange({ ...record, trashedNotes: ['old'] })).toBe(false);
    record.notes[0].role = 'content'; expect(isClaudeChange(record)).toBe(false);
  }
});
it('full Undo cleans removed links against tombstones while leaving dates and revisions correct', async () => {
  const target = await createNote(); await updateNote(a.id, { html: `<p><a href="note:${target.id}">Target</a></p>` });
  const { changeId } = await applyClaudeChanges(await captureMerge()); await trashNote(target.id); await purgeNow(target.id);
  expect(await undoClaudeChange(changeId)).toEqual({ restored: true, kind: 'merge' }); expect((await db.notes.get(a.id)).linkedIds).toEqual([]);
});
it('keep-edits confirmation rolls back copies and restored sources together on failure', async () => {
  const { changeId } = await applyClaudeChanges(await captureMerge()); await updateNote(a.id, { html: '<p>Later</p>' });
  const offer = await undoClaudeChange(changeId), before = await snapshot();
  vi.spyOn(db.notes, 'put').mockRejectedValue(new Error('Disk full'));
  await expect(undoClaudeChange(changeId, { keepEdits: true, expected: offer.decisions })).rejects.toThrow('Disk full'); expect(await snapshot()).toEqual(before);
});
it('checks a backlink to two sources once at Apply and redirects both hrefs', async () => {
  const third = await createNote({ title: 'C', html: '<p>C</p>' });
  await updateNote(link.id, { html: `<p><a href="note:${b.id}">B</a> <a href="note:${third.id}">C</a></p>` });
  const payload = await captureMergePayload([a.id, b.id, third.id]), plan = mergePlan(payload, validateMergeProposal({ ...merged, html: '<p>A</p><p>B</p><p>C</p>' }, payload));
  expect(plan.backlinkCheck.noteIds).toEqual([link.id]); expect(await claudePlanIsCurrent(plan)).toBe(true); await applyClaudeChanges(plan);
  const current = await db.notes.get(link.id); expect(current.linkedIds).toEqual([a.id]); expect(current.html.match(new RegExp(a.id, 'g'))).toHaveLength(2);
});
it('applies an exact duplicate merge without touching the kept note, and Undo brings the source back', async () => {
  await updateNote(b.id, { html: a.html }); const payload = await captureMergePayload([a.id, b.id]);
  const proposal = validateMergeProposal({ ...merged, title: a.title, html: a.html, tags: a.tags }, payload);
  const keptBefore = await db.notes.get(a.id), result = await applyClaudeChanges(mergePlan(payload, proposal));
  expect(await db.notes.get(a.id)).toEqual(keptBefore); expect((await db.notes.get(b.id)).deletedAt).not.toBeNull();
  const undo = await getPref('claudeLastChange');
  expect(undo.notes.map((entry) => entry.role)).toEqual(['trashed', 'relinked']); expect(isClaudeChange(undo)).toBe(true);
  expect(await undoClaudeChange(result.changeId)).toEqual({ restored: true, kind: 'merge' });
  expect((await db.notes.get(b.id)).deletedAt).toBeNull(); expect(await db.notes.get(a.id)).toEqual(keptBefore);
  expect((await db.notes.get(link.id)).linkedIds).toEqual([b.id]);
});
it('refuses an empty trashed entry', async () => {
  const plan = await captureMerge(), before = await snapshot();
  await expect(applyClaudeChanges({ ...plan, notes: plan.notes.map((item) => item.role === 'trashed' ? { ...item, patch: {} } : item) })).rejects.toThrow('An approved note change is empty.');
  expect(await snapshot()).toEqual(before);
});
it('accepts a merge record without a content entry but never a split without one', async () => {
  const plan = await captureMerge(); await applyClaudeChanges(plan); const undo = await getPref('claudeLastChange');
  const sourcesOnly = { ...undo, notes: undo.notes.filter((entry) => entry.role !== 'content') };
  expect(isClaudeChange(sourcesOnly)).toBe(true);
  expect(isClaudeChange({ ...sourcesOnly, kind: 'split', trashedNotes: [], notes: sourcesOnly.notes.filter((entry) => entry.role === 'relinked'), createdNotes: [{ id: 'x1', writtenRev: 1 }] })).toBe(false);
});
