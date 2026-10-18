import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Editor } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { extensions } from "../editor/extensions.js";
import { db, getPref } from "../db/db.js";
import { resetDatabase } from "../test/fixtures.js";
import { updateNote, trashNote, backlinksFor } from "../db/notes.js";
import { captureLinksPayload, buildLinksRequest, validateLinksProposal, findLinkPlacement, applyLinksToHtml, linksPlan, linksItemIds, runLinks, LINKS_SCHEMA, LINKS_TASK } from "./links.js";
import { LINKS_SYSTEM_PROMPT } from "./prompts.js";
import { noteSchema, parseBody, normalizeBody } from "./html.js";
import { claudeSession as session } from "./session.js";
import { saveClaudeKey } from "./prefs.js";
import { estimateRequest, NOTEBOOK_TOKENS_PER_CHAR } from "./payload.js";
import { chunkedFetch } from "../test/anthropic.js";
import { linksProposal, linksShots, linksNotebook, linksUnknown, linksExcessive, linksRefusal, linksCut } from "./fixtures/links.js";
import { RESPONSE_ERRORS } from "./client.js";
import { applyClaudeChanges, claudePlanIsCurrent, undoClaudeChange, restoreClaudeCopies, allowsPartialUndo } from "../db/claudeChanges.js";
const key = 'sk-ant-SENTINEL-LINKS';
let payload;
const note = (handle) => payload.notes.find((note) => note.handle === handle);
const validate = (links) => validateLinksProposal({ summary: 'Test', links }, payload);
const link = (patch = {}) => ({ from: 'N17', to: 'N2', phrase: 'ser y estar', reason: 'Reason', ...patch });
const plan = (proposal = validateLinksProposal(linksProposal, payload), ticked = linksItemIds(proposal)) => linksPlan(payload, proposal, ticked);
beforeEach(async () => {
  session.clearSession(); await resetDatabase(); await saveClaudeKey(key);
  const sample = JSON.parse(readFileSync('public/sample-notebook.json', 'utf8'));
  await db.notes.bulkPut(sample.notes); await db.folders.bulkPut(sample.folders);
  payload = await captureLinksPayload();
});
afterEach(() => { session.clearSession(); vi.restoreAllMocks(); });
it('captures frozen live notes and only the disclosed fields, with ordered deduplicated live links', async () => {
  const data = JSON.parse(payload.requestText), text = JSON.stringify(buildLinksRequest(payload));
  expect(data.task).toBe(LINKS_TASK); expect(payload.notes).toHaveLength(18);
  expect(Object.isFrozen(payload)).toBe(true); expect(Object.isFrozen(note('N1').linksTo)).toBe(true);
  expect(Object.isFrozen(note('N1'))).toBe(true);
  for (const item of data.notes) expect(Object.keys(item)).toEqual(['handle', 'title', 'text', 'linksTo']);
  for (const value of [key, 'Nota en la papelera', 'sample-landscape', ...payload.notes.map((n) => n.id), ...(await db.folders.toArray()).map((f) => f.id), '<p>', 'note:']) expect(text).not.toContain(value);
  expect(note('N1').linksTo).toEqual(['N2', 'N3']); expect(note('N2').linksTo).toEqual(['N4']); expect(note('N4').linksTo).toEqual(['N2']); expect(note('N7').linksTo).toEqual(['N6']);
  const trashed = (await db.notes.toArray()).find((n) => n.deletedAt !== null);
  await updateNote(note('N1').id, { html: `<p><a href="note:${note('N3').id}">Three</a><a href="note:${note('N2').id}">Two</a><a href="note:${note('N3').id}">Again</a><a href="note:${trashed.id}">Trash</a><a href="note:missing">Missing</a></p>` });
  const next = await captureLinksPayload(); expect(next.notes[0].linksTo).toEqual(['N2', 'N3']); expect(next.requestText).not.toContain(trashed.title);
  const tied = payload.notes.slice(-2);
  for (const n of tied) await db.notes.update(n.id, { createdAt: '2026-01-01' });
  expect((await captureLinksPayload()).notes.slice(0, 2).map((n) => n.id)).toEqual(tied.map((n) => n.id).sort());
});
it('streams with the model, structured schema, fallback, cost/spend and uncached provisional estimate', async () => {
  const fixture = chunkedFetch(linksNotebook); await runLinks({ payload, fetch: fixture.fetch, maxRetries: 0 });
  expect(fixture.requests[0].body).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 32000, output_config: { effort: 'high', format: { type: 'json_schema', schema: LINKS_SCHEMA } }, stream: true, fallbacks: 'default' });
  expect(fixture.requests[0].headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
  for (const field of ['citations', 'document', 'cache_control', 'thinking', 'temperature', 'top_p', 'budget_tokens']) expect(JSON.stringify(fixture.requests[0].body)).not.toContain(`"${field}"`);
  expect(session.getSnapshot().proposal).toMatchObject({ kind: 'links', status: 'ready', cost: { kind: 'known', dollars: 0.062 } });
  expect((await getPref('claudeSpend')).dollars).toBe(0.062);
  const tokens = Math.ceil((payload.system.length + payload.requestText.length) * NOTEBOOK_TOKENS_PER_CHAR);
  expect(estimateRequest({ payload })).toEqual({ tokens, dollars: (tokens * 4 + 2000 * 20) / 1000000 });
});
it.each([[linksUnknown, RESPONSE_ERRORS.invalid], [linksExcessive, RESPONSE_ERRORS.invalid], [linksRefusal, RESPONSE_ERRORS.refusal], [linksCut, RESPONSE_ERRORS.truncated]])('refuses unusable streams without writing notes', async (events, error) => {
  const before = await db.notes.toArray(); await runLinks({ payload, fetch: chunkedFetch(events).fetch });
  expect(session.getSnapshot().proposal).toMatchObject({ status: 'failed', error }); expect(await db.notes.toArray()).toEqual(before);
});
it('drops self, existing and repeated pairs, keeps the first and freezes the result', () => {
  const result = validate([link(), link({ phrase: 'Revisar' }), link({ from: 'N2' }), link({ from: 'N7', to: 'N6' })]);
  expect(result.links).toHaveLength(1); expect(result.links[0].phrase).toBe('ser y estar'); expect(Object.isFrozen(result.links[0].placement)).toBe(true);
  expect(validate([link({ from: 'N2' })]).noChanges).toBe(true); expect(validate([]).noChanges).toBe(true);
});
it.each([{ from: 'N19' }, { to: 'N19' }, { to: 'raw-id' }, { phrase: 4 }, { reason: null }, { html: '<p>x</p>' }])('rejects unknown handles and malformed shape %j', (patch) => expect(() => validate([link(patch)])).toThrow(RESPONSE_ERRORS.invalid));
it('rejects missing fields and extra top-level fields and checks the limit before dropping redundancies', () => {
  expect(() => validateLinksProposal({ links: [] }, payload)).toThrow(RESPONSE_ERRORS.invalid);
  expect(() => validateLinksProposal({ summary: '', links: [], extra: true }, payload)).toThrow(RESPONSE_ERRORS.invalid);
  expect(validate(Array.from({ length: 30 }, () => link())).links).toHaveLength(1);
  expect(() => validate(Array.from({ length: 31 }, () => link()))).toThrow(RESPONSE_ERRORS.invalid);
});
it.each(['', '   ', 'x'.repeat(101), 'x\ny', 'x\u0000y', 'x\u007fy', 'x\u009fy', '\tser y estar'])('falls back for an unusable phrase %j', (phrase) => {
  expect(validate([link({ phrase })]).links[0]).toMatchObject({ phrase: null, placement: { kind: 'see-also' } });
});
it('trims phrase and reason without rewriting them', () => {
  expect(validate([link({ phrase: '  ser y estar  ', reason: '  Español\nreason  ' })]).links[0]).toMatchObject({ phrase: 'ser y estar', reason: 'Español\nreason', placement: { kind: 'inline' } });
});
it('pins every full fixture placement and every screenshot placement against the public sample', () => {
  const full = validateLinksProposal(linksProposal, payload);
  expect(full.links.map((l) => [l.from, l.to, l.placement.kind])).toEqual(linksProposal.links.slice(0, 15).map((l, i) => [l.from, l.to, i < 6 ? 'inline' : 'see-also']));
  const shots = validateLinksProposal(linksShots, payload);
  expect(shots.links.map((l) => l.placement.kind)).toEqual(['inline', 'inline', 'see-also', 'inline', 'see-also', 'inline', 'see-also']);
  for (const l of [...full.links, ...shots.links]) if (l.placement.kind === 'inline') {
    const doc = Node.fromJSON(noteSchema, parseBody(note(l.from).html));
    expect(doc.textBetween(l.placement.from, l.placement.to)).toBe(l.phrase);
  }
});
it.each([
  ['<p>before<br>target after</p>', 'target', 'inline'],
  ['<p><a href="note:x">target</a> <code>target</code> target</p>', 'target', 'inline'],
  ['<p><a href="note:x">target</a></p><pre><code>target</code></pre><p><code>target</code></p>', 'target', 'see-also'],
  ['<p>aaa</p>', 'aa', 'see-also'], ['<p>!!!</p>', '!!', 'see-also'],
  ['<p>Target</p>', 'target', 'see-also'], ['<p>target</p><p>target</p>', 'target', 'see-also'],
  ['<p>frases</p>', 'frase', 'see-also'], ['<p>refrase</p>', 'frase', 'see-also'],
  ['<p>1frase</p>', 'frase', 'see-also'], ['<p>frase2</p>', 'frase', 'see-also'],
  ['<p>éfrase</p>', 'frase', 'see-also'], ['<p>frase𐐀</p>', 'frase', 'see-also'],
  ['<p>𐐀frase</p>', 'frase', 'see-also'], ['<p>«frase»</p>', 'frase', 'inline'],
  ['<p>café</p>', 'cafe\u0301', 'see-also'], ['<p>one<br>two</p>', 'onetwo', 'see-also'],
])('places %s / %s as %s', (html, phrase, kind) => {
  const placement = findLinkPlacement(html, phrase); expect(placement.kind).toBe(kind);
  if (kind === 'inline') expect(Node.fromJSON(noteSchema, parseBody(html)).textBetween(placement.from, placement.to)).toBe(phrase);
});
it('uses real snippet text, cuts at 40 characters and leaves adjacent link/code boundaries usable', () => {
  const html = `<p>${'x'.repeat(50)} <a href="note:x">linked</a><code>code</code>target<br>${'z'.repeat(50)}</p>`;
  const p = findLinkPlacement(html, 'target');
  expect(p).toMatchObject({ kind: 'inline', match: 'target' }); expect(p.before).toMatch(/^…/); expect(p.before).toContain('linkedcode'); expect(p.after).toBe(` ${'z'.repeat(39)}…`); expect(JSON.stringify(p)).not.toContain('\\u0000');
});
it('keeps overlap placement fixed even if the earlier link is unticked', () => {
  const proposal = validate([link({ from: 'N14', to: 'N4', phrase: 'repasar los verbos' }), link({ from: 'N14', to: 'N2', phrase: 'los verbos' })]);
  expect(proposal.links.map((l) => l.placement.kind)).toEqual(['inline', 'see-also']);
  const html = linksPlan(payload, proposal, ['N14>N2']).notes[0].patch.html;
  expect(html).toContain('See also:'); expect(html).not.toMatch(/<a[^>]*>los verbos/);
});
it('links across bold/plain text with one anchor, preserving marks and hard breaks', () => {
  const html = '<p>Before<br><strong>El</strong> principito <span style="color: #dc2626; font-size: 17pt">rojo</span></p>';
  const phrase = 'El principito rojo', placement = findLinkPlacement(html, phrase);
  const result = applyLinksToHtml(html, [{ to: 'N2', targetId: 'target', placement }], () => 'Target');
  const dom = new DOMParser().parseFromString(result, 'text/html');
  expect(dom.querySelectorAll('a')).toHaveLength(1); expect(dom.querySelector('a').textContent).toBe(phrase);
  expect(dom.querySelector('a strong').textContent).toBe('El'); expect(dom.querySelector('a span').style.fontSize).toBe('17pt'); expect(dom.querySelector('br')).toBeTruthy();
});
it.each([
  '<ul><li><p>list</p></li></ul>', '<div data-callout="tip"><p>tip</p></div>', '<hr>',
  '<p>body</p><p></p><p></p>', '<p>See also: old</p><p></p>', '<p>See also:</p>', '<p></p>', '',
])('appends See also in the editor form after the last substantive block: %s', (html) => {
  const extras = [{ to: 'N7', targetId: note('N7').id, placement: { kind: 'see-also' } }, { to: 'N2', targetId: note('N2').id, placement: { kind: 'see-also' } }];
  const result = applyLinksToHtml(html, extras, (handle) => note(handle).displayTitle), parsed = parseBody(result);
  const blocks = parsed.content, paragraphs = blocks.filter((n) => n.type === 'paragraph' && n.content);
  const see = paragraphs.at(-1); expect(see.content[0].text).toBe(html.includes('See also: old') ? 'See also: old · ' : 'See also: ');
  expect(see.content[1].text).toBe(note('N7').displayTitle); expect(see.content[2].text).toBe(' · ');
  if (html.includes('<p></p>')) expect(blocks.at(-1)).toMatchObject({ type: 'paragraph' });
  if (html.startsWith('<ul>')) expect(blocks.map((n) => n.type)).toEqual(['bulletList', 'paragraph']);
  expect(normalizeBody(result)).toBe(result);
  const editor = new Editor({ element: document.createElement('div'), extensions, content: result });
  try { editor.view.dispatch(editor.state.tr); expect(editor.getHTML()).toBe(result); } finally { editor.destroy(); }
});
it('matches a real editor after its first transaction for every applied fixture source', () => {
  for (const entry of plan().notes.filter((n) => n.patch.html)) {
    const html = entry.patch.html, editor = new Editor({ element: document.createElement('div'), extensions, content: html });
    try { editor.view.dispatch(editor.state.tr); expect(editor.getHTML(), entry.id).toBe(html); } finally { editor.destroy(); }
  }
});
it('deduplicates sources and targets in order, checks every referenced note, and writes only ticked links and projections', async () => {
  const proposal = validateLinksProposal(linksProposal, payload), selected = ['N17>N3', 'N14>N4', 'N4>N14', 'N6>N7'], p = plan(proposal, selected);
  const handles = [...new Set([...proposal.links.map((l) => l.from), ...proposal.links.map((l) => l.to)])];
  expect(p.notes.map((n) => n.id)).toEqual(handles.map((h) => note(h).id)); expect(await claudePlanIsCurrent(p)).toBe(true);
  await applyClaudeChanges(p);
  expect((await getPref('claudeLastChange')).kind).toBe('links');
  for (const original of payload.notes) {
    const current = await db.notes.get(original.id);
    if (selected.some((id) => id.startsWith(`${original.handle}>`))) { expect(current.rev).toBe(original.rev + 1); expect(current.updatedAt).not.toBe(original.updatedAt); }
    else expect(current.html).toBe(original.html);
  }
  const source = await db.notes.get(note('N17').id); expect(source.linkedIds).toEqual([note('N3').id]);
  expect((await backlinksFor(note('N3').id)).map((n) => n.id)).toContain(source.id);
  expect((await db.notes.get(note('N6').id)).text).toContain(`See also: ${note('N7').displayTitle}`);
});
it.each(['source', 'target', 'trash-target', 'generation'])('refuses all links when %s is stale, including unticked targets', async (kind) => {
  const p = plan(undefined, ['N17>N3']);
  if (kind === 'source') await updateNote(note('N17').id, { pinned: true });
  if (kind === 'target') await updateNote(note('N2').id, { title: 'Edited target' });
  if (kind === 'trash-target') await trashNote(note('N2').id);
  if (kind === 'generation') await db.prefs.put({ key: 'notebookGeneration', value: 'replacement' });
  const before = await db.notes.toArray(); expect(await claudePlanIsCurrent(p)).toBe(false);
  await expect(applyClaudeChanges(p)).rejects.toThrow(); expect(await db.notes.toArray()).toEqual(before); expect(await getPref('claudeLastChange')).toBeUndefined();
});
it('rolls back all links and the undo record if a later write fails', async () => {
  const p = plan(), before = await db.notes.toArray(), put = db.notes.put.bind(db.notes); let count = 0;
  vi.spyOn(db.notes, 'put').mockImplementation((...args) => ++count === 3 ? Promise.reject(new Error('Disk full')) : put(...args));
  await expect(applyClaudeChanges(p)).rejects.toThrow('Disk full'); expect(await db.notes.toArray()).toEqual(before); expect(await getPref('claudeLastChange')).toBeUndefined();
});
it('clean Undo restores HTML and edited dates exactly', async () => {
  const before = await db.notes.toArray(), { changeId } = await applyClaudeChanges(plan());
  await undoClaudeChange(changeId);
  for (const original of before) expect(await db.notes.get(original.id)).toMatchObject({ html: original.html, updatedAt: original.updatedAt, text: original.text, linkedIds: original.linkedIds });
});
it('partial Undo keeps edited notes and their links, names them, restores others and refuses copies', async () => {
  const { changeId } = await applyClaudeChanges(plan()), record = await getPref('claudeLastChange');
  await updateNote(note('N14').id, { title: 'Later class notes' }); const later = await db.notes.get(note('N14').id), beforeUndo = await db.notes.toArray();
  expect(await undoClaudeChange(changeId)).toMatchObject({ conflict: true, partial: true, unchanged: record.notes.length - 1 });
  expect(await db.notes.toArray()).toEqual(beforeUndo); await expect(restoreClaudeCopies(changeId)).rejects.toThrow('unchanged notes');
  const result = await undoClaudeChange(changeId, { unchangedOnly: true });
  expect(result).toMatchObject({ restored: record.notes.length - 1, skipped: [{ id: later.id, title: later.title }] });
  expect(await db.notes.get(later.id)).toEqual(later);
  for (const entry of record.notes.filter((n) => n.id !== later.id)) expect(await db.notes.get(entry.id)).toMatchObject({ html: entry.before.html, updatedAt: entry.before.updatedAt });
});
it('an unmarked tidy body change still uses copies, and malformed links combinations do not allow partial Undo', async () => {
  const p = plan(undefined, ['N17>N3']); delete p.kind;
  const { changeId } = await applyClaudeChanges(p); await updateNote(note('N17').id, { title: 'Later' });
  expect(await undoClaudeChange(changeId)).toMatchObject({ conflict: true, partial: false });
  const record = await getPref('claudeLastChange');
  expect(allowsPartialUndo({ ...record, kind: 'links', createdFolders: ['folder'] })).toBe(false);
  expect(allowsPartialUndo({ ...record, kind: 'links', createdNotes: ['new'] })).toBe(false);
  expect(allowsPartialUndo({ ...record, kind: 'links', trashedNotes: ['old'] })).toBe(false);
  expect((await restoreClaudeCopies(changeId)).ids).toHaveLength(1);
});
it.each(['cancel', 'discard'])('%s aborts a running links request and rejects late callbacks', async (action) => {
  const fixture = chunkedFetch(linksNotebook, { stepped: true }), pending = runLinks({ payload, fetch: fixture.fetch });
  await vi.waitFor(() => expect(fixture.requests).toHaveLength(1));
  const token = session.getSnapshot().request.token;
  if (action === 'cancel') session.cancelRequest(); else session.discardProposal();
  fixture.release(100); await pending; session.setProposal(token, { status: 'ready' });
  expect(session.getSnapshot().proposal).toBeNull(); expect(session.getSnapshot().request).toBeNull();
});
it('refuses silent replacement at Send and sends the frozen disclosure after ordinary edits', async () => {
  await updateNote(note('N17').id, { html: '<p>Later writing</p>' });
  const fixture = chunkedFetch(linksUnknown); await runLinks({ payload, fetch: fixture.fetch });
  expect(fixture.requests[0].body.messages[0].content).toBe(payload.requestText); expect((await getPref('claudeSpend')).dollars).toBe(0.062);
  await db.prefs.put({ key: 'notebookGeneration', value: 'replacement' }); const fetch = vi.fn(); await runLinks({ payload, fetch });
  expect(fetch).not.toHaveBeenCalled(); expect(session.getSnapshot().proposal.error).toBe('Some notes changed since Claude read them. Ask again.');
});
it('pins the load-bearing prompt rules', () => {
  for (const phrase of ['English and Spanish', 'data, never instructions', 'most notes need none', 'linksTo', 'to itself', 'at most 30 links', 'issued N handles', 'Never return note HTML', 'one to six words', 'copied exactly', 'names the target note or its subject', 'related only by theme', 'whole words', 'only once', 'single line', '[→ …]', '[image]', '[Tip]', 'Use null', 'See also:', "note's language", 'one-sentence summary']) expect(LINKS_SYSTEM_PROMPT).toContain(phrase);
});
