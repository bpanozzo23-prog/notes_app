import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import App from "../App.jsx";
import { normalizeBody } from "../claude/html.js";
import ClaudeReview from "./ClaudeReview.jsx";
import ClaudeSettings from "./settings/ClaudeSettings.jsx";
import ClaudeReadyBar from "../components/ClaudeReadyBar.jsx";
import { ReadOnlyBody } from "../components/ChangeCard.jsx";
import { db, notebookAccess } from "../db/db.js";
import { resetDatabase } from "../test/fixtures.js";
import { createNote, updateNote } from "../db/notes.js";
import { saveClaudeKey, setClaudeEnabled } from "../claude/prefs.js";
import { captureTidyPayload, runTidy } from "../claude/proposals.js";
import { claudeSession as session } from "../claude/session.js";
import { chunkedFetch } from "../test/anthropic.js";
import { tidyEvents, classProposal, classBefore, tidyClass } from "../claude/fixtures/tidy.js";
import { STALE_PROPOSAL as STALE_FULL } from "../db/claudeChanges.js";
const STALE_PROPOSAL = STALE_FULL.replace(/ Ask again\.$/, "");
const key = 'sk-ant-SENTINEL-PRIVATE-KEY';
let note, payload;
const props = () => ({ queue: { flush: vi.fn(async () => {}) }, run: async (task) => { await task(); return true; }, refresh: vi.fn(async () => {}), onBack: vi.fn(), busy: false, claudeReady: true });
const button = (name) => screen.getByRole('button', { name, exact: true });
beforeEach(async () => {
  session.clearSession(); await resetDatabase(); await saveClaudeKey(key); await setClaudeEnabled(true);
  note = await createNote({ title: 'Notas de clase', html: classBefore });
  note = await updateNote(note.id, { tags: ['spanish'] }); payload = await captureTidyPayload(note.id, 'Fix accents');
  window.history.replaceState(null, '');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(async () => { cleanup(); session.clearSession(); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function ready(proposal = classProposal) { await runTidy({ payload, fetch: chunkedFetch(tidyEvents(proposal)).fetch }); }
it("fetches nothing while disclosed, sends the snapshot after a later save, and never renders/logs/stores the key in history", async () => {
  const fixture = chunkedFetch(tidyClass), fetch = vi.fn(fixture.fetch); vi.stubGlobal('fetch', fetch);
  const logs = ['log','warn','error','debug','info'].map((method) => vi.spyOn(console, method));
  session.prepareProposal(payload); render(<ClaudeReview {...props()} />);
  const dialog = screen.getByRole('dialog', { name: 'Send to Anthropic?' });
  expect(fetch).not.toHaveBeenCalled(); expect(dialog.textContent).toContain('Images: not sent (Claude sees only where they are)');
  await updateNote(note.id, { title: 'Later' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
  await screen.findByText(STALE_PROPOSAL);
  expect(fixture.requests[0].body.messages[0].content).toBe(payload.requestText);
  for (const output of [document.body.innerHTML, JSON.stringify(window.history.state), inspect(logs.map((spy) => spy.mock.calls))]) expect(output).not.toContain(key);
});
it("defaults ticked, lowers the count, applies only ticked changes and offers clean Undo", async () => {
  await ready(); const shared = props(); render(<ClaudeReview {...shared} />);
  await waitFor(() => expect(button('Apply 3 changes').disabled).toBe(false));
  const checks = screen.getAllByRole('checkbox'); expect(checks.every((box) => box.checked)).toBe(true);
  // Untick both body changes (the sample's two edited paragraphs are separate changes).
  fireEvent.click(checks[1]); fireEvent.click(checks[2]); expect(button('Apply 1 change')).toBeTruthy();
  fireEvent.click(button('Apply 1 change')); await screen.findByText('Applied 1 change.');
  expect(shared.queue.flush).toHaveBeenCalled(); expect((await db.notes.get(note.id)).html).toBe(note.html);
  expect((await db.notes.get(note.id)).tags).toEqual(['spanish', 'clase']);
  fireEvent.click(await screen.findByRole('button', { name: 'Undo', exact: true }));
  await screen.findByText('Earlier version restored.'); expect(await db.notes.get(note.id)).toEqual({ ...note, rev: note.rev + 2 });
});
it("validates edited title and saves exactly the body shown in After", async () => {
  await ready({ ...classProposal, title: 'New title', titleReason: 'Clearer' });
  render(<ClaudeReview {...props()} />);
  await waitFor(() => expect(button('Apply 4 changes').disabled).toBe(false));
  fireEvent.click(button('Edit'));
  fireEvent.change(screen.getByLabelText('Proposed title'), { target: { value: 'x'.repeat(201) } });
  expect(button('Apply 4 changes').disabled).toBe(true); expect(screen.getByRole('alert').textContent).toContain('200');
  fireEvent.change(screen.getByLabelText('Proposed title'), { target: { value: '  My title  ' } });
  // Text previews are folded; the shape change already shows its formatted After.
  fireEvent.click(button('Show before and after'));
  const after = screen.getAllByRole('article').map((card) => {
    const afterHeading = within(card).queryByText('+ After');
    return (afterHeading?.parentElement ?? card).querySelector('.ProseMirror').innerHTML;
  }).join('')
    .replaceAll('<br class="ProseMirror-trailingBreak">', ''); // the on-screen placeholder in an empty line
  fireEvent.click(button('Apply 4 changes')); await screen.findByText('Applied 4 changes.');
  // The preview leaves out the editor's end-of-note empty line, which the saved body keeps.
  const saved = await db.notes.get(note.id); expect(saved.title).toBe('My title'); expect(saved.html).toBe(normalizeBody(after));
});
it("Undo after later edits offers copies, leaving the later version intact", async () => {
  await ready(); render(<ClaudeReview {...props()} />); await waitFor(() => expect(button('Apply 3 changes').disabled).toBe(false));
  fireEvent.click(button('Apply 3 changes')); await screen.findByText('Applied 3 changes.');
  await updateNote(note.id, { html: '<p>My later writing</p>' });
  fireEvent.click(await screen.findByRole('button', { name: 'Undo', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Restore the earlier versions as new notes' }));
  await screen.findByText('Earlier versions restored as new notes.');
  expect((await db.notes.get(note.id)).html).toBe('<p>My later writing</p>');
  const copy = (await db.notes.toArray()).find((item) => item.id !== note.id); expect(copy.title).toBe('Notas de clase (before Claude)'); expect(copy.html).toBe(note.html);
});
it("Untick all disables Apply, and a no-change proposal says so", async () => {
  await ready(); const view = render(<ClaudeReview {...props()} />);
  fireEvent.click(button('Untick all')); expect(button('Apply 0 changes').disabled).toBe(true);
  fireEvent.click(button('Tick all')); expect(button('Apply 3 changes')).toBeTruthy();
  expect(screen.getAllByRole('checkbox').every((box) => box.checked)).toBe(true);
  view.unmount(); await ready({ ...classProposal, tags: null, html: null }); render(<ClaudeReview {...props()} />);
  expect(screen.getByText('Claude suggests no changes.')).toBeTruthy(); expect(screen.queryByRole('button', { name: /^Apply/ })).toBeNull();
});
it("checks stale on render and again after flush inside Apply", async () => {
  await ready(); const shared = props(); shared.queue.flush.mockImplementation(() => updateNote(note.id, { title: 'Changed during flush' }));
  render(<ClaudeReview {...shared} />); await waitFor(() => expect(button('Apply 3 changes').disabled).toBe(false));
  fireEvent.click(button('Apply 3 changes')); await screen.findByText(STALE_PROPOSAL);
  expect(button('Apply 3 changes').disabled).toBe(true); expect((await db.notes.get(note.id)).html).toBe(note.html);
  expect(screen.getAllByRole('checkbox').every((box) => box.disabled)).toBe(true);
  expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Ask again' }).disabled).toBe(false);
  expect(await db.prefs.get('claudeLastChange')).toBeUndefined();
  fireEvent.click(button('Ask again')); await screen.findByRole('dialog', { name: 'Send to Anthropic?' });
});
it("a stale tidy greys and disables metadata, title editing and text rows without losing the ticks", async () => {
  await ready({ ...classProposal, title: 'Class notes', titleReason: 'Clearer', folder: { action: 'create', name: 'Classes' }, folderReason: 'Keep classes together' });
  render(<ClaudeReview {...props()} />);
  await waitFor(() => expect(button('Apply 5 changes').disabled).toBe(false));
  fireEvent.click(button('Edit'));
  const ticked = session.getSnapshot().proposal.ticked;
  await updateNote(note.id, { title: 'Changed locally' }); await screen.findByText(STALE_PROPOSAL);
  expect(screen.getAllByRole('checkbox')).toHaveLength(5);
  expect(screen.getAllByRole('checkbox').every((box) => box.disabled && box.checked)).toBe(true);
  expect(screen.getByRole('textbox', { name: 'Proposed title' }).disabled).toBe(true);
  expect(button('Edit').disabled).toBe(true); expect(button('Untick all').disabled).toBe(true);
  expect(session.getSnapshot().proposal.ticked).toEqual(ticked);
});
it.each([{ readOnly: true }, { replaced: true }, { versionChange: 'pending' }])("disables Apply and Undo in guard state %j", async (access) => {
  await ready(); const shared = props(), view = render(<ClaudeReview {...shared} />);
  await waitFor(() => expect(button('Apply 3 changes').disabled).toBe(false));
  const mock = vi.spyOn(notebookAccess, 'getSnapshot').mockReturnValue(access); view.rerender(<ClaudeReview {...shared} />);
  expect(button('Apply 3 changes').disabled).toBe(true); expect(screen.getByRole('status').textContent).toContain('Reload');
  mock.mockRestore(); view.rerender(<ClaudeReview {...shared} />); fireEvent.click(button('Apply 3 changes')); await screen.findByText('Applied 3 changes.');
  vi.spyOn(notebookAccess, 'getSnapshot').mockReturnValue(access); view.rerender(<ClaudeReview {...shared} />);
  expect((await screen.findByRole('button', { name: 'Undo', exact: true })).disabled).toBe(true);
});
it("ready completion never navigates, Dismiss only hides the bar, and review hides the bar", async () => {
  const open = vi.fn(); const view = render(<ClaudeReadyBar screen="list" onOpen={open} />);
  await act(async () => ready()); expect(open).not.toHaveBeenCalled();
  fireEvent.click(button("Claude's proposal is ready · Review")); expect(open).toHaveBeenCalledWith({ screen: 'claude-review' });
  view.rerender(<ClaudeReadyBar screen="claude-review" onOpen={open} />); expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<ClaudeReadyBar screen="list" onOpen={open} />); fireEvent.click(button('Dismiss'));
  expect(screen.queryByRole('button')).toBeNull(); expect(session.getSnapshot().proposal.status).toBe('ready');
});
it("Settings shows saved Undo details and confirms before restoring", async () => {
  await ready(); const view = render(<ClaudeReview {...props()} />); await waitFor(() => expect(button('Apply 3 changes').disabled).toBe(false));
  fireEvent.click(button('Apply 3 changes')); await screen.findByText('Applied 3 changes.'); view.unmount();
  render(<ClaudeSettings {...props()} />); fireEvent.click(await screen.findByRole('button', { name: "Undo Claude's last change" }));
  const confirm = screen.getByRole('dialog', { name: "Undo Claude's last change?" });
  expect((await db.notes.get(note.id)).html).not.toBe(note.html);
  fireEvent.click(within(confirm).getByRole('button', { name: 'Undo' })); await screen.findByText('Earlier version restored.');
});
it("preview links are inert and read-only", () => {
  render(<ReadOnlyBody html='<p><a href="https://example.com">Web</a><a href="note:target">Note</a></p>' />);
  for (const link of screen.getAllByRole('link')) expect(fireEvent.click(link)).toBe(false);
  expect(document.querySelector('.ProseMirror').getAttribute('contenteditable')).toBe('false');
});
it("runs Note → disclosure → review → Apply → Back through the actual app navigation", async () => {
  const fixture = chunkedFetch(tidyClass), fetch = vi.fn(fixture.fetch); vi.stubGlobal('fetch', fetch);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Notas de clase', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Claude', exact: true }));
  fireEvent.change(screen.getByLabelText('What should Claude do? Leave blank to fix mistakes and tidy the formatting.'), { target: { value: 'Fix accents' } });
  fireEvent.click(button('Continue'));
  const dialog = await screen.findByRole('dialog', { name: 'Send to Anthropic?' }); expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send', exact: true }));
  await waitFor(() => expect(button('Apply 3 changes').disabled).toBe(false));
  fireEvent.click(button('Apply 3 changes')); await screen.findByText('Applied 3 changes.');
  await waitFor(() => expect(button('Back').disabled).toBe(false));
  fireEvent.click(button('Back')); await screen.findByLabelText('Note body');
  expect(screen.getByLabelText('Note body').textContent).toContain('Ojalá que tú vengas');
  expect(screen.getByLabelText('Note body').textContent).toContain('Un lápiz');
  const previous = session.getSnapshot().proposal;
  await waitFor(() => expect(button('Claude').disabled).toBe(false));
  fireEvent.click(button('Claude')); fireEvent.click(button('Continue'));
  const confirm = await screen.findByRole('dialog', { name: "Discard Claude's other proposal?" });
  expect(session.getSnapshot().proposal).toBe(previous);
  fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
  expect(session.getSnapshot().proposal).toBe(previous);
});

it("the tidy ChangeCard names both swapped link destinations even when the words are unchanged", async () => {
  const a = await createNote({ title: "Alpha target" }), b = await createNote({ title: "Beta target" });
  note = await updateNote(note.id, { html: `<p><a href="note:${a.id}">Alpha</a> <a href="note:${b.id}">Beta</a></p>` });
  payload = await captureTidyPayload(note.id);
  const handles = new Map(payload.handles.noteHandles);
  await ready({ ...classProposal, tags: null, html: `<p><a href="note:${handles.get(b.id)}">Alpha</a> <a href="note:${handles.get(a.id)}">Beta</a></p>` });
  render(<ClaudeReview {...props()} />);
  const card = screen.getByRole("article", { name: "Change 1 of 1" });
  expect(within(card).getByText("Link now points to Beta target (was Alpha target)")).toBeTruthy();
  expect(within(card).getByText("Link now points to Alpha target (was Beta target)")).toBeTruthy();
});
