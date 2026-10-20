import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import App from "../App.jsx";
import Ask from "./Ask.jsx";
import ClaudeReview from "./ClaudeReview.jsx";
import { db, notebookAccess } from "../db/db.js";
import { resetDatabase } from "../test/fixtures.js";
import { updateNote } from "../db/notes.js";
import { saveClaudeKey, setClaudeEnabled } from "../claude/prefs.js";
import { captureReorganisePayload, runReorganise, STALE_REORGANISE } from "../claude/reorganise.js";
import { claudeSession as session } from "../claude/session.js";
import { chunkedFetch } from "../test/anthropic.js";
import { reorganiseEvents, reorganiseNotebook } from "../claude/fixtures/reorganise.js";
const key = 'sk-ant-SENTINEL-REORGANISE-PRIVATE';
let payload;
const props = () => ({ notes: [], trash: [], folders: [], openNote: vi.fn(), onOpen: vi.fn(), queue: { flush: vi.fn(async () => {}) }, run: async (task) => { await task(); return true; }, refresh: vi.fn(async () => {}), onBack: vi.fn(), busy: false, claudeReady: true });
const button = (name) => screen.getByRole('button', { name, exact: true });
const note = (handle) => payload.notes.find((note) => note.handle === handle);
const card = (handle) => within(screen.getByRole('article', { name: note(handle).displayTitle }));
beforeEach(async () => {
  session.clearSession(); await resetDatabase(); await saveClaudeKey(key); await setClaudeEnabled(true);
  const sample = JSON.parse(readFileSync(resolve(__dirname, '../../public/sample-notebook.json'), 'utf8'));
  await db.notes.bulkPut(sample.notes); await db.folders.bulkPut(sample.folders); payload = await captureReorganisePayload();
  window.history.replaceState(null, ''); vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(async () => { cleanup(); session.clearSession(); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function ready() { await runReorganise({ payload, fetch: chunkedFetch(reorganiseNotebook).fetch }); }
it('defaults every metadata row ticked, supports per-note and per-row untick, title editing and partial Apply without body changes', async () => {
  await ready(); const shared = props(); render(<ClaudeReview {...shared} />);
  await waitFor(() => expect(button('Apply 7 changes').disabled).toBe(false));
  expect(screen.getAllByRole('checkbox').every((box) => box.checked)).toBe(true); expect(card('N18').getByText('Llevar el cuaderno azul a la biblioteca el jueves y devolver los libros de la lista de lecturas.')).toBeTruthy();
  fireEvent.click(card('N18').getByRole('button', { name: `Untick all in ${note('N18').displayTitle}` })); expect(button('Apply 4 changes')).toBeTruthy();
  fireEvent.click(card('N18').getByRole('button', { name: `Tick all in ${note('N18').displayTitle}` })); expect(button('Apply 7 changes')).toBeTruthy();
  fireEvent.click(card('N18').getByRole('button', { name: `Untick all in ${note('N18').displayTitle}` }));
  fireEvent.click(card('N10').getByRole('checkbox')); expect(button('Apply 3 changes')).toBeTruthy();
  fireEvent.click(card('N7').getByRole('button', { name: 'Edit' }));
  fireEvent.change(card('N7').getByRole('textbox'), { target: { value: 'x'.repeat(201) } }); expect(button('Apply 3 changes').disabled).toBe(true);
  fireEvent.change(card('N7').getByRole('textbox'), { target: { value: '  My reading title  ' } });
  fireEvent.click(button('Apply 3 changes')); await screen.findByText('Applied 3 changes.'); expect(shared.queue.flush).toHaveBeenCalled();
  expect((await db.notes.get(note('N7').id)).title).toBe('My reading title'); expect(await db.folders.count()).toBe(3);
  expect(await db.notes.get(note('N18').id)).toMatchObject({ title: note('N18').title, rev: note('N18').rev });
  for (const original of payload.notes) expect((await db.notes.get(original.id)).html).toBe(original.html);
});
it('creates one shared folder, offers clean Undo, and restores all notes', async () => {
  await ready(); render(<ClaudeReview {...props()} />); await waitFor(() => expect(button('Apply 7 changes').disabled).toBe(false));
  expect(screen.getAllByText(/Pendientes \(new folder\)/)).toHaveLength(2);
  fireEvent.click(button('Apply 7 changes')); await screen.findByText('Applied 7 changes.'); expect(await db.folders.count()).toBe(4);
  fireEvent.click(await screen.findByRole('button', { name: 'Undo', exact: true })); await screen.findByText('Earlier version restored.');
  expect(await db.folders.count()).toBe(3);
  for (const original of payload.notes) expect(await db.notes.get(original.id)).toMatchObject({ title: original.title, html: original.html, tags: original.tags, folderId: original.folderId, updatedAt: original.updatedAt });
});
it('offers Undo the unchanged notes, names the skipped note, and preserves a used new folder', async () => {
  await ready(); render(<ClaudeReview {...props()} />); await waitFor(() => expect(button('Apply 7 changes').disabled).toBe(false));
  fireEvent.click(button('Apply 7 changes')); await screen.findByText('Applied 7 changes.');
  await updateNote(note('N18').id, { title: 'My later reminder' });
  fireEvent.click(await screen.findByRole('button', { name: 'Undo', exact: true }));
  const partial = await screen.findByRole('button', { name: 'Undo the 4 unchanged notes' });
  expect(screen.queryByRole('button', { name: 'Restore the earlier versions as new notes' })).toBeNull();
  fireEvent.click(partial); await screen.findByText('Restored 4 unchanged notes. Left as they are: My later reminder.');
  expect((await db.notes.get(note('N18').id)).title).toBe('My later reminder'); expect(await db.notes.count()).toBe(19); expect(await db.folders.count()).toBe(4);
  expect(await db.prefs.get('claudeLastChange')).toBeUndefined();
});
it('Untick all disables Apply; an empty proposal has no Apply or stale message', async () => {
  await ready(); const view = render(<ClaudeReview {...props()} />); fireEvent.click(button('Untick all')); expect(button('Apply 0 changes').disabled).toBe(true);
  view.unmount(); await runReorganise({ payload, fetch: chunkedFetch(reorganiseEvents({ summary: 'Already organised.', changes: [] })).fetch });
  render(<ClaudeReview {...props()} />); await screen.findByText('Claude suggests no changes.'); expect(screen.queryByRole('button', { name: /^Apply/ })).toBeNull(); expect(screen.queryByRole('alert')).toBeNull();
});
it.each([false, true])('refuses one stale unticked note at render or after flushing Apply (%s)', async (duringFlush) => {
  await ready(); const shared = props(); render(<ClaudeReview {...shared} />); await waitFor(() => expect(button('Apply 7 changes').disabled).toBe(false));
  fireEvent.click(card('N18').getByRole('button', { name: `Untick all in ${note('N18').displayTitle}` }));
  if (duringFlush) { shared.queue.flush.mockImplementation(() => updateNote(note('N18').id, { title: 'Changed during flush' })); fireEvent.click(button('Apply 4 changes')); }
  else await updateNote(note('N18').id, { title: 'Changed' });
  await screen.findByText(STALE_REORGANISE.replace(/ Ask again\.$/, "")); expect(button('Apply 4 changes').disabled).toBe(true); expect((await db.notes.get(note('N7').id)).title).toBe('');
  expect(screen.getAllByRole('checkbox').every((box) => box.disabled)).toBe(true);
  expect(await db.prefs.get('claudeLastChange')).toBeUndefined(); fireEvent.click(button('Ask again')); await screen.findByRole('dialog', { name: 'Send to Anthropic?' });
});
it.each([{ readOnly: true }, { replaced: true }, { versionChange: 'pending' }])('disables Apply, Undo and partial Undo with guard message %j', async (access) => {
  await ready(); const shared = props(), view = render(<ClaudeReview {...shared} />); await waitFor(() => expect(button('Apply 7 changes').disabled).toBe(false));
  const mock = vi.spyOn(notebookAccess, 'getSnapshot').mockReturnValue(access); view.rerender(<ClaudeReview {...shared} />); expect(button('Apply 7 changes').disabled).toBe(true); expect(screen.getByRole('status').textContent).toContain('Reload');
  mock.mockRestore(); view.rerender(<ClaudeReview {...shared} />); fireEvent.click(button('Apply 7 changes')); await screen.findByText('Applied 7 changes.');
  await updateNote(note('N18').id, { title: 'Later' }); fireEvent.click(await screen.findByRole('button', { name: 'Undo', exact: true })); await screen.findByRole('button', { name: 'Undo the 4 unchanged notes' });
  vi.spyOn(notebookAccess, 'getSnapshot').mockReturnValue(access); view.rerender(<ClaudeReview {...shared} />); expect(button('Undo').disabled).toBe(true); expect(button('Undo the 4 unchanged notes').disabled).toBe(true);
});
it('runs Ask → sheet → disclosure → review through real navigation with nothing sent until Send and no key leaks', async () => {
  const fixture = chunkedFetch(reorganiseNotebook), fetch = vi.fn(fixture.fetch); vi.stubGlobal('fetch', fetch);
  const logs = ['log', 'warn', 'error', 'debug', 'info'].map((method) => vi.spyOn(console, method));
  render(<App />); fireEvent.click(await screen.findByRole('button', { name: 'Ask Claude', exact: true })); fireEvent.click(await screen.findByRole('button', { name: 'Tidy the notebook' }));
  expect(screen.getByRole('dialog', { name: 'Tidy the notebook' })).toBeTruthy(); fireEvent.click(button('Titles, tags and folders'));
  const dialog = await screen.findByRole('dialog', { name: 'Send to Anthropic?' }); expect(dialog.textContent).toContain('18 notes: titles, text, folders and tags'); expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send' })); await waitFor(() => expect(button('Apply 7 changes').disabled).toBe(false));
  for (const output of [fixture.requests.map((r) => r.body), document.body.innerHTML, window.history.state, session.getSnapshot(), logs.map((spy) => spy.mock.calls)]) expect(inspect(output, { depth: 30 })).not.toContain(key);
  fireEvent.click(button('Back')); fireEvent.click(await screen.findByRole('button', { name: 'Tidy the notebook' })); fireEvent.click(button('Titles, tags and folders'));
  const previous = session.getSnapshot().proposal; expect(await screen.findByRole('dialog', { name: "Discard Claude's other proposal?" })).toBeTruthy();
  fireEvent.click(button('Cancel')); expect(session.getSnapshot().proposal).toBe(previous);
  fireEvent.click(button('Tidy the notebook')); fireEvent.click(button('Titles, tags and folders')); fireEvent.click(button('Discard and continue'));
  await screen.findByRole('dialog', { name: 'Send to Anthropic?' }); expect(session.getSnapshot().proposal.id).not.toBe(previous.id); expect(fetch).toHaveBeenCalledTimes(1);
});
it('captures only after flush and leaves a conversation intact', async () => {
  const request = session.beginRequest('ask'); session.setConversation(request.token, { scope: { kind: 'notebook' }, payload: { entries: [], capturedAt: new Date().toISOString() }, turns: [], ended: 'Done' }); session.endRequest(request.token);
  const conversation = session.getSnapshot().conversation, shared = props(); shared.queue.flush.mockImplementation(() => updateNote(note('N7').id, { title: 'Saved draft' }));
  render(<Ask {...shared} />); fireEvent.click(button('Tidy the notebook')); fireEvent.click(button('Titles, tags and folders'));
  await waitFor(() => expect(shared.onOpen).toHaveBeenCalledWith({ screen: 'claude-review' })); expect(session.getSnapshot().proposal.payload.requestText).toContain('Saved draft'); expect(session.getSnapshot().conversation).toBe(conversation);
});
it.each(['offline', 'readOnly', 'replaced', 'versionChange', 'request'])('disables the Ask entry in %s', (kind) => {
  if (kind === 'offline') vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  else if (kind === 'request') session.beginRequest('ask');
  else vi.spyOn(notebookAccess, 'getSnapshot').mockReturnValue({ [kind]: true });
  render(<Ask {...props()} />); expect(button('Tidy the notebook').disabled).toBe(true);
});
