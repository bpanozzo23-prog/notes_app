import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import { readFileSync } from "node:fs";
import App from "../App.jsx";
import Ask from "./Ask.jsx";
import ClaudeReview from "./ClaudeReview.jsx";
import { db, notebookAccess } from "../db/db.js";
import { resetDatabase } from "../test/fixtures.js";
import { updateNote } from "../db/notes.js";
import { saveClaudeKey, setClaudeEnabled } from "../claude/prefs.js";
import { captureLinksPayload, runLinks } from "../claude/links.js";
import { STALE_REORGANISE } from "../claude/reorganise.js";
import { claudeSession as session } from "../claude/session.js";
import { chunkedFetch } from "../test/anthropic.js";
import { linksEvents, linksShotsEvents } from "../claude/fixtures/links.js";
const key = 'sk-ant-SENTINEL-LINKS-PRIVATE';
let payload;
const props = () => ({ notes: [], trash: [], folders: [], openNote: vi.fn(), onOpen: vi.fn(), queue: { flush: vi.fn(async () => {}) }, run: async (task) => { await task(); return true; }, refresh: vi.fn(async () => {}), onBack: vi.fn(), busy: false, claudeReady: true });
const button = (name) => screen.getByRole('button', { name, exact: true });
const note = (handle) => payload.notes.find((note) => note.handle === handle);
const card = (handle) => within(screen.getByRole('article', { name: note(handle).displayTitle }));
beforeEach(async () => {
  session.clearSession(); await resetDatabase(); await saveClaudeKey(key); await setClaudeEnabled(true);
  const sample = JSON.parse(readFileSync('public/sample-notebook.json', 'utf8'));
  await db.notes.bulkPut(sample.notes); await db.folders.bulkPut(sample.folders); payload = await captureLinksPayload();
  window.history.replaceState(null, ''); vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(async () => { cleanup(); session.clearSession(); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function ready() { await runLinks({ payload, fetch: chunkedFetch(linksShotsEvents).fetch }); }
it('groups by source with both placements, defaults all ticked, supports row/note untick and writes only approved links', async () => {
  await ready(); const shared = props(); render(<ClaudeReview {...shared} />);
  await waitFor(() => expect(button('Apply 7 changes').disabled).toBe(false));
  expect(screen.getAllByRole('article')).toHaveLength(5); expect(screen.getAllByRole('checkbox').every((box) => box.checked)).toBe(true);
  expect(card('N17').getAllByText(/Links the words/)).toHaveLength(2); expect(card('N17').getByText('Adds it to "See also:" at the end of the note')).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull(); expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(card('N17').getByRole('checkbox', { name: `→ ${note('N2').displayTitle}` })); expect(button('Apply 6 changes')).toBeTruthy();
  fireEvent.click(card('N9').getByRole('button', { name: 'Untick this note' })); expect(button('Apply 5 changes')).toBeTruthy();
  fireEvent.click(button('Apply 5 changes')); await screen.findByText('Applied 5 changes.'); expect(shared.queue.flush).toHaveBeenCalled();
  expect((await db.notes.get(note('N17').id)).linkedIds).toEqual([note('N3').id, note('N14').id]);
  expect((await db.notes.get(note('N9').id)).html).toBe(note('N9').html);
});
it('clean Undo restores the exact original HTML and dates', async () => {
  await ready(); render(<ClaudeReview {...props()} />); await waitFor(() => expect(button('Apply 7 changes').disabled).toBe(false));
  fireEvent.click(button('Apply 7 changes')); await screen.findByText('Applied 7 changes.');
  fireEvent.click(await screen.findByRole('button', { name: 'Undo', exact: true })); await screen.findByText('Earlier version restored.');
  for (const original of payload.notes) expect(await db.notes.get(original.id)).toMatchObject({ html: original.html, updatedAt: original.updatedAt });
});
it('partial Undo names the skipped note and says its links stay', async () => {
  await ready(); render(<ClaudeReview {...props()} />); await waitFor(() => expect(button('Apply 7 changes').disabled).toBe(false));
  fireEvent.click(button('Apply 7 changes')); await screen.findByText('Applied 7 changes.');
  await updateNote(note('N17').id, { title: 'Mi clase editada' }); const later = await db.notes.get(note('N17').id);
  fireEvent.click(await screen.findByRole('button', { name: 'Undo', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Undo the 4 unchanged notes' }));
  await screen.findByText('Restored 4 unchanged notes. Left as they are (their links stay): Mi clase editada.');
  expect(await db.notes.get(later.id)).toEqual(later); expect(await db.notes.count()).toBe(19); expect(await db.prefs.get('claudeLastChange')).toBeUndefined();
});
it.each([false, true])('refuses a stale target at review or during Apply flush (%s), then recaptures links', async (duringFlush) => {
  await ready(); const shared = props(); render(<ClaudeReview {...shared} />); await waitFor(() => expect(button('Apply 7 changes').disabled).toBe(false));
  fireEvent.click(card('N17').getByRole('checkbox', { name: `→ ${note('N2').displayTitle}` }));
  if (duringFlush) { shared.queue.flush.mockImplementation(() => updateNote(note('N2').id, { title: 'Changed target' })); fireEvent.click(button('Apply 6 changes')); }
  else await updateNote(note('N2').id, { title: 'Changed target' });
  await screen.findByText(STALE_REORGANISE); expect(button('Apply 6 changes').disabled).toBe(true); expect(await db.prefs.get('claudeLastChange')).toBeUndefined();
  fireEvent.click(button('Ask again')); const disclosure = await screen.findByRole('dialog', { name: 'Send to Anthropic?' });
  expect(disclosure.textContent).toContain('Links between notes'); expect(session.getSnapshot().proposal.payload.kind).toBe('links');
});
it('Untick all disables Apply and no-changes proposals have no Apply', async () => {
  await ready(); const view = render(<ClaudeReview {...props()} />); fireEvent.click(button('Untick all')); expect(button('Apply 0 changes').disabled).toBe(true);
  view.unmount(); await runLinks({ payload, fetch: chunkedFetch(linksEvents({ summary: 'Already linked.', links: [] })).fetch });
  render(<ClaudeReview {...props()} />); await screen.findByText('Claude suggests no changes.'); expect(screen.queryByRole('button', { name: /^Apply/ })).toBeNull();
});
it('Ask sheet discloses links, sends nothing before Send and runs real navigation without leaking the key', async () => {
  const fixture = chunkedFetch(linksShotsEvents), fetch = vi.fn(fixture.fetch); vi.stubGlobal('fetch', fetch);
  const logs = ['log', 'warn', 'error', 'debug', 'info'].map((method) => vi.spyOn(console, method));
  render(<App />); fireEvent.click(await screen.findByRole('button', { name: 'Ask Claude', exact: true })); fireEvent.click(await screen.findByRole('button', { name: 'Tidy the notebook' }));
  expect(button('Titles, tags and folders')).toBeTruthy(); fireEvent.click(button('Links between notes'));
  const dialog = await screen.findByRole('dialog', { name: 'Send to Anthropic?' });
  for (const text of ['Links between notes', '18 notes: titles, text and the links between them', 'Images: not sent ([image] marks where they are)', 'Trash: not sent', 'About']) expect(dialog.textContent).toContain(text);
  expect(fetch).not.toHaveBeenCalled(); fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(button('Apply 7 changes').disabled).toBe(false));
  for (const output of [fixture.requests.map((r) => r.body), document.body.innerHTML, window.history.state, session.getSnapshot(), logs.map((spy) => spy.mock.calls)]) expect(inspect(output, { depth: 30 })).not.toContain(key);
});
it.each([['Links between notes', 'links'], ['Titles, tags and folders', 'reorganise']])('discard confirmation continues with the chosen action: %s', async (label, kind) => {
  await ready(); const previous = session.getSnapshot().proposal, shared = props(); render(<Ask {...shared} />);
  fireEvent.click(button('Tidy the notebook')); fireEvent.click(button(label)); await screen.findByRole('dialog', { name: "Discard Claude's other proposal?" });
  fireEvent.click(button('Cancel')); expect(session.getSnapshot().proposal).toBe(previous);
  fireEvent.click(button('Tidy the notebook')); fireEvent.click(button(label)); fireEvent.click(button('Discard and continue'));
  await waitFor(() => expect(shared.onOpen).toHaveBeenCalledWith({ screen: 'claude-review' }));
  expect(session.getSnapshot().proposal.payload.kind).toBe(kind); expect(session.getSnapshot().proposal.id).not.toBe(previous.id);
});
it('captures links after flushing and preserves the Ask conversation', async () => {
  const request = session.beginRequest('ask'); session.setConversation(request.token, { scope: { kind: 'notebook' }, payload: { entries: [], capturedAt: new Date().toISOString() }, turns: [], ended: 'Done' }); session.endRequest(request.token);
  const conversation = session.getSnapshot().conversation, shared = props(); shared.queue.flush.mockImplementation(() => updateNote(note('N17').id, { html: '<p>Saved draft</p>' }));
  render(<Ask {...shared} />); fireEvent.click(button('Tidy the notebook')); fireEvent.click(button('Links between notes'));
  await waitFor(() => expect(shared.onOpen).toHaveBeenCalled()); expect(session.getSnapshot().proposal.payload.requestText).toContain('Saved draft'); expect(session.getSnapshot().conversation).toBe(conversation);
});
it.each([{ readOnly: true }, { replaced: true }, { versionChange: 'pending' }])('disables links Apply and partial Undo under the notebook guard %j', async (access) => {
  await ready(); const shared = props(), view = render(<ClaudeReview {...shared} />); await waitFor(() => expect(button('Apply 7 changes').disabled).toBe(false));
  const mock = vi.spyOn(notebookAccess, 'getSnapshot').mockReturnValue(access); view.rerender(<ClaudeReview {...shared} />); expect(button('Apply 7 changes').disabled).toBe(true);
  mock.mockRestore(); view.rerender(<ClaudeReview {...shared} />); fireEvent.click(button('Apply 7 changes')); await screen.findByText('Applied 7 changes.');
  await updateNote(note('N17').id, { title: 'Later' }); fireEvent.click(await screen.findByRole('button', { name: 'Undo', exact: true })); await screen.findByRole('button', { name: 'Undo the 4 unchanged notes' });
  vi.spyOn(notebookAccess, 'getSnapshot').mockReturnValue(access); view.rerender(<ClaudeReview {...shared} />); expect(button('Undo').disabled).toBe(true); expect(button('Undo the 4 unchanged notes').disabled).toBe(true);
});
