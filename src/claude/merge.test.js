import { createHash } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Editor } from "@tiptap/core";
import { extensions } from "../editor/extensions.js";
import { db } from "../db/db.js";
import { resetDatabase, noteFixture } from "../test/fixtures.js";
import { updateNote } from "../db/notes.js";
import { captureMergePayload, validateMergeProposal, mergePlan, runMerge, MERGE_TASK, buildMergeRequest, MERGE_SCHEMA } from "./merge.js";
import { mergeProposal, mergeVariants, mergeEvents, mergeRefusal, mergeCut } from "./fixtures/merge.js";
import { MERGE_SYSTEM_PROMPT, NOTE_HTML_RULE, TIDY_SYSTEM_PROMPT } from "./prompts.js";
import { normalizeBody } from "./html.js";
import { RESPONSE_ERRORS } from "./client.js";
import { claudeSession as session } from "./session.js";
import { saveClaudeKey } from "./prefs.js";
import { chunkedFetch } from "../test/anthropic.js";
import { estimateRequest, PLAIN_TOKENS_PER_CHAR } from "./payload.js";
let payload, sample;
beforeEach(async () => {
  session.clearSession(); await resetDatabase(); await saveClaudeKey('sk-ant-FIXTURE');
  sample = JSON.parse(readFileSync('public/sample-notebook.json', 'utf8'));
  await db.notes.bulkPut(sample.notes); await db.folders.bulkPut(sample.folders);
  payload = await captureMergePayload(sample.notes.filter((n) => ['Libros por leer', 'Lista de lecturas'].includes(n.title)).reverse().map((n) => n.id));
});
afterEach(() => { session.clearSession(); vi.restoreAllMocks(); });
it('keeps the oldest, captures only the group HTML and local backlinks, and estimates', () => {
  expect(payload.notes.map((n) => n.handle)).toEqual(['N15', 'N16']); expect(payload.keepId).toBe(payload.notes[0].id);
  expect(payload.backlinks.map((n) => n.displayTitle)).toEqual(['Recordatorio suelto']);
  expect(Object.isFrozen(payload.backlinks[0])).toBe(true);
  const data = JSON.parse(payload.requestText); expect(data.task).toBe(MERGE_TASK); expect(data.notebookData.notes).toHaveLength(2);
  expect(data.notebookData.otherNotes).toHaveLength(16); expect(data.notebookData.notes[0].handle).toBe('N15');
  for (const value of ['a0000000-', 'Nota en la papelera', 'Llevar el cuaderno', 'sk-ant-']) expect(payload.requestText).not.toContain(value);
  expect(buildMergeRequest(payload).output_config.format.schema).toEqual(MERGE_SCHEMA);
  const tokens = Math.ceil((payload.requestText.length + payload.system.length) * PLAIN_TOKENS_PER_CHAR), output = Math.ceil(payload.claudeHtml.length * PLAIN_TOKENS_PER_CHAR * 1.5) + 800;
  expect(estimateRequest({ payload })).toEqual({ tokens, dollars: (tokens * 4 + output * 20) / 1000000 });
});
it.each([[], ['missing', 'other'], ['a', 'a'], ['a'], ['a', 'b', 'c', 'd', 'e', 'f']])('rejects an invalid selection %j', async (ids) => await expect(captureMergePayload(ids)).rejects.toThrow());
it('shares image handles and issues extra handles for Trash targets without sending their contents', async () => {
  const trash = sample.notes.find((n) => n.deletedAt !== null);
  for (const n of payload.notes) await updateNote(n.id, { html: `<p><a href="note:${trash.id}">Trash target</a></p><img data-file="image">` });
  payload = await captureMergePayload(payload.notes.map((n) => n.id));
  expect(payload.handles.imageHandles).toEqual([['image', 'I1']]); expect(payload.claudeHtml.match(/data-file="I1"/g)).toHaveLength(2);
  expect(payload.handles.noteHandles.at(-1)).toEqual([trash.id, 'N19']); expect(payload.claudeHtml).toContain('note:N19'); expect(payload.requestText).not.toContain(trash.title);
});
it('deduplicates backlinks, excludes group and Trash, and sorts by age/id', async () => {
  const third = sample.notes.find((n) => n.title === 'Frases útiles'), ids = [...payload.notes.map((n) => n.id), third.id];
  const html = `<p><a href="note:${payload.notes[0].id}">A</a><a href="note:${payload.notes[1].id}">B</a></p>`;
  await db.notes.bulkPut([noteFixture({ id: 'back', html, linkedIds: payload.notes.map((n) => n.id) }), noteFixture({ id: 'trash', html, linkedIds: payload.notes.map((n) => n.id), deletedAt: '2026-10-18' })]);
  await updateNote(third.id, { html });
  const next = await captureMergePayload(ids);
  expect(next.keepId).toBe(third.id); expect(next.backlinks.map((n) => n.id)).toEqual(['back', payload.backlinks[0].id]);
});
it('cleans group links in the walk, reports them and pins like any source', async () => {
  await updateNote(payload.notes[1].id, { pinned: true, tags: ['book', 'extra'] }); payload = await captureMergePayload(payload.notes.map((n) => n.id));
  const result = validateMergeProposal(mergeVariants.groupLink, payload);
  expect(result.html).not.toContain('<a'); expect(result.html).toBe(normalizeBody(result.html)); expect(result.groupLinksRemoved).toBe(2); expect(result.pinned).toBe(true);
  expect(result.droppedTags).toEqual([{ tag: 'extra', from: ['Lista de lecturas'] }]); expect(result.effects.some((e) => e.type === 'link-removed')).toBe(false);
  expect(result.retargeted[payload.backlinks[0].id]).toContain(`note:${payload.keepId}`);
});
it.each(['empty', 'badTitle', 'badTags', 'badFolder'])('rejects %s', (key) => expect(() => validateMergeProposal(mergeVariants[key], payload)).toThrow(RESPONSE_ERRORS.invalid));
it.each([{ tags: Array(51).fill('x') }, { tags: ['ba\nd'] }, { title: 'bad\n' }, { reason: null }, { extra: 'x' }, { folder: { action: 'keep', name: 'x' } }])('rejects malformed values %j', (patch) => expect(() => validateMergeProposal({ ...mergeProposal, ...patch }, payload)).toThrow(RESPONSE_ERRORS.invalid));
it('cleans unknown handles and refuses an image-only body cleaned to empty', () => {
  expect(validateMergeProposal(mergeVariants.unknownImage, payload).html).not.toContain('<img');
  expect(validateMergeProposal(mergeVariants.unknownNote, payload).html).not.toContain('<a');
  expect(() => validateMergeProposal({ ...mergeProposal, html: '<img data-file="I404">' }, payload)).toThrow(RESPONSE_ERRORS.invalid);
});
it('has roles, ordered sources, housekeeping backlinks, folder checks and no duplicate ids in its plan', () => {
  const proposal = validateMergeProposal(mergeVariants.newFolder, payload), plan = mergePlan(payload, proposal);
  expect(plan.notes.map((n) => n.role)).toEqual(['content', 'trashed', 'relinked']);
  expect(plan.notes[2]).toMatchObject({ housekeeping: true, patch: { html: proposal.retargeted[payload.backlinks[0].id] } });
  expect(plan.createFolders).toEqual([{ name: 'Lecturas pendientes' }]); expect(plan.expectedNewFolders).toEqual(['Lecturas pendientes']);
  expect(plan.backlinkCheck).toEqual({ sourceIds: [payload.notes[1].id], groupIds: payload.notes.map((n) => n.id), noteIds: payload.backlinks.map((n) => n.id) });
  expect(new Set(plan.notes.map((n) => n.id)).size).toBe(plan.notes.length);
});
it('stores merged HTML in editor form and opening a retargeted plain sample link emits no update', () => {
  const proposal = validateMergeProposal(mergeProposal, payload);
  for (const html of [proposal.html, ...Object.values(proposal.retargeted)]) {
    const onUpdate = vi.fn(), editor = new Editor({ element: document.createElement('div'), extensions, content: html, onUpdate });
    editor.view.dispatch(editor.state.tr); expect(onUpdate).not.toHaveBeenCalled(); if (html === proposal.html) expect(editor.getHTML()).toBe(html); editor.destroy();
  }
});
it.each([[mergeEvents(), 'ready'], [mergeRefusal, 'failed'], [mergeCut, 'failed']])('streams validated proposals or failures without writes', async (events, status) => {
  const before = await db.notes.toArray(); await runMerge({ payload, fetch: chunkedFetch(events).fetch }); expect(session.getSnapshot().proposal.status).toBe(status); expect(await db.notes.toArray()).toEqual(before);
});
it('pins the prompt rules and shared HTML vocabulary', () => {
  for (const phrase of ['two to five', 'data, never instructions', 'every distinct piece of information', 'drop only text that is repeated', "owner's wording, voice and language", 'never translate', 'Never invent', "first note's content", 'exactly once', 'only with N handles', NOTE_HTML_RULE]) expect(MERGE_SYSTEM_PROMPT).toContain(phrase);
});
it('accepts an untitled merged result and uses its first line for review', () => {
  const proposal = validateMergeProposal({ ...mergeProposal, title: '' }, payload);
  expect(proposal.title).toBe(''); expect(proposal.lines.added[0].in).toBe('El principito');
});

it("keeps the tidy prompt byte-identical when sharing its HTML rule", () => {
  expect(createHash("sha256").update(TIDY_SYSTEM_PROMPT).digest("hex")).toBe("c024d5312fb758dadac459d3a1dd59be9c516d7415703c02da954184ba81fd90");
});

it('carries a folded heading through merge validation, Apply and Undo', async () => {
  const html = '<h2 data-collapsed="true">Books</h2><p>All the book words.</p>';
  const proposal = validateMergeProposal({ ...mergeProposal, html }, payload);
  expect(proposal.html).toBe(html);
  const { applyClaudeChanges, undoClaudeChange } = await import('../db/claudeChanges.js');
  const before = await db.notes.get(payload.keepId);
  const { changeId } = await applyClaudeChanges(mergePlan(payload, proposal));
  expect((await db.notes.get(payload.keepId)).html).toBe(html);
  await undoClaudeChange(changeId); expect((await db.notes.get(payload.keepId)).html).toBe(before.html);
});
