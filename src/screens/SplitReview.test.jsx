import Note from "./Note.jsx";
import ClaudeUndo from "../components/ClaudeUndo.jsx";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import App from "../App.jsx";
import ClaudeReview from "./ClaudeReview.jsx";
import { seedMoveReview, cleanupMoveReview, reviewProps } from "../test/moveReview.js";
import { db, notebookAccess } from "../db/db.js";
import { updateNote } from "../db/notes.js";
import { captureSplitPayload, runSplit } from "../claude/split.js";
import { splitEvents } from "../claude/fixtures/split.js";
import { claudeSession as session } from "../claude/session.js";
import { chunkedFetch } from "../test/anthropic.js";
let sample, payload;
const button = (name) => screen.getByRole('button', { name, exact: true });
const ready = async () => runSplit({ payload, fetch: chunkedFetch(splitEvents()).fetch });
beforeEach(async () => { sample = await seedMoveReview(); payload = await captureSplitPayload(sample.notes.find((n) => n.title === 'Vocabulario — comida').id, 'By topic'); });
afterEach(cleanupMoveReview);
it('shows keeps/new note and Apply as a whole; full Undo restores and trashes the new note', async () => {
  await ready(); const props = reviewProps(sample.notes); render(<ClaudeReview {...props} />); await waitFor(() => expect(button('Apply split').disabled).toBe(false));
  expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByRole('button', { name: 'Untick all' })).toBeNull(); expect(screen.getByText('This note keeps')).toBeTruthy();
  expect(screen.getByRole('article', { name: 'En el restaurante' })).toBeTruthy(); expect(screen.getByText('Then adds: Split into: En el restaurante')).toBeTruthy();
  fireEvent.click(button('Apply split')); await screen.findByText('Split into 1 new note.'); fireEvent.click(button('Open the note')); expect(props.openNote).toHaveBeenCalledWith(payload.note.id);
  expect((await db.notes.get(payload.note.id)).html).toContain('Split into:'); fireEvent.click(await screen.findByRole('button', { name: 'Undo', exact: true })); await screen.findByText('Split undone.');
  expect((await db.notes.toArray()).find((n) => n.title === 'En el restaurante').deletedAt).not.toBeNull();
});
it('a later edit of a created note offers keeping it and copying the original', async () => {
  await ready(); render(<ClaudeReview {...reviewProps(sample.notes)} />); await waitFor(() => expect(button('Apply split').disabled).toBe(false)); fireEvent.click(button('Apply split'));
  await screen.findByText('Split into 1 new note.'); const created = (await db.notes.toArray()).find((n) => n.title === 'En el restaurante'); await updateNote(created.id, { html: '<p>Later</p>' });
  fireEvent.click(await screen.findByRole('button', { name: 'Undo', exact: true })); await screen.findByText('En el restaurante stays as it is'); fireEvent.click(button('Undo, keeping later changes'));
  await screen.findByText('Undone, keeping later changes. Earlier content restored as copies where needed.'); expect((await db.notes.get(created.id)).html).toBe('<p>Later</p>');
});
it('recaptures a stale split with the same instruction', async () => {
  await ready(); render(<ClaudeReview {...reviewProps(sample.notes)} />); await updateNote(payload.note.id, { title: 'Later' });
  await screen.findByText('This note changed since Claude read it.'); expect(button('Apply split').disabled).toBe(true);
  fireEvent.click(button('Ask again')); const dialog = await screen.findByRole('dialog', { name: 'Send to Anthropic?' }); expect(dialog.textContent).toContain('By topic'); expect(dialog.textContent).toContain('Images: not sent (Claude sees only where they are)');
});
it.each(['tidy', 'split'])('Note sheet keeps its chosen action through discard confirmation (%s)', async (kind) => {
  await ready(); render(<App />); fireEvent.click(await screen.findByRole('button', { name: 'Vocabulario — comida', exact: true })); fireEvent.click(await screen.findByRole('button', { name: 'Claude', exact: true }));
  const box = screen.getByLabelText('How should Claude split it? Leave blank to split by topic.'); expect(box.maxLength).toBe(500); fireEvent.change(box, { target: { value: 'My split instruction' } });
  fireEvent.click(button(kind === 'split' ? 'Split…' : 'Continue')); fireEvent.click(await screen.findByRole('button', { name: 'Discard and continue' }));
  const dialog = await screen.findByRole('dialog', { name: 'Send to Anthropic?' }); expect(session.getSnapshot().proposal.kind).toBe(kind); if (kind === 'split') expect(dialog.textContent).toContain('My split instruction');
});
it('Note Split discloses and sends only on Send', async () => {
  const fetch = vi.fn(chunkedFetch(splitEvents()).fetch); vi.stubGlobal('fetch', fetch); render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Vocabulario — comida', exact: true })); fireEvent.click(await screen.findByRole('button', { name: 'Claude', exact: true })); fireEvent.click(button('Split…'));
  const dialog = await screen.findByRole('dialog', { name: 'Send to Anthropic?' }); expect(dialog.textContent).toContain('Split this note by topic'); expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send' })); await waitFor(() => expect(button('Apply split').disabled).toBe(false));
});

it('disables Split for read-only, busy and a running request, including one begun with the sheet open', async () => {
  const props = { ...reviewProps(sample.notes), initialNote: sample.notes.find((n) => n.id === payload.note.id), onOpenNote: vi.fn(), onDelete: vi.fn(), queue: { flush: vi.fn(async () => {}), onBeforeFlush: () => () => {}, subscribe: () => () => {}, setKnownRev: vi.fn(), onConflict: vi.fn(() => () => {}), schedule: vi.fn() } };
  const view = render(<Note {...props} readOnly />); fireEvent.click(button('Claude')); expect(button('Split…').disabled).toBe(true);
  view.rerender(<Note {...props} />); expect(button('Split…').disabled).toBe(false);
  act(() => { session.beginRequest('ask'); }); expect(button('Split…').disabled).toBe(true); act(() => session.cancelRequest());
  view.rerender(<Note {...props} busy />); expect(button('Split…').disabled).toBe(true);
});
it('guards split Apply and shows its Settings confirmation', async () => {
  await ready(); const props = reviewProps(sample.notes), view = render(<ClaudeReview {...props} />); await waitFor(() => expect(button('Apply split').disabled).toBe(false));
  const mock = vi.spyOn(notebookAccess, 'getSnapshot').mockReturnValue({ readOnly: true }); view.rerender(<ClaudeReview {...props} />); expect(button('Apply split').disabled).toBe(true);
  mock.mockRestore(); view.rerender(<ClaudeReview {...props} />); fireEvent.click(button('Apply split')); await screen.findByRole('button', { name: 'Undo', exact: true });
  view.unmount(); render(<ClaudeUndo settings {...props} />); fireEvent.click(await screen.findByRole('button', { name: "Undo Claude's last change" }));
  expect(screen.getByRole('dialog').textContent).toContain('the new note moves to Trash'); expect(screen.getByRole('dialog').textContent).toContain('nothing is overwritten');
});
it('shows a zero-note proposal once and offers no Apply', async () => {
  await runSplit({ payload, fetch: chunkedFetch(splitEvents({ summary: '', title: null, html: '', notes: [] })).fetch });
  render(<ClaudeReview {...reviewProps(sample.notes)} />); expect(screen.getAllByText('Claude suggests no split.')).toHaveLength(1); expect(screen.queryByRole('button', { name: 'Apply split' })).toBeNull();
});
