import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import App from "../App.jsx";
import Ask from "./Ask.jsx";
import ClaudeReview from "./ClaudeReview.jsx";
import ClaudeReadyBar from "../components/ClaudeReadyBar.jsx";
import { seedMoveReview, cleanupMoveReview, reviewProps } from "../test/moveReview.js";
import { db } from "../db/db.js";
import { updateNote, trashNote } from "../db/notes.js";
import { captureDuplicatesPayload, runDuplicates } from "../claude/duplicates.js";
import { duplicatesEvents, duplicatesVariants } from "../claude/fixtures/duplicates.js";
import { claudeSession as session } from "../claude/session.js";
import { chunkedFetch } from "../test/anthropic.js";
let sample, payload;
const button = (name) => screen.getByRole('button', { name, exact: true });
const ready = async (proposal) => runDuplicates({ payload, fetch: chunkedFetch(duplicatesEvents(proposal)).fetch });
beforeEach(async () => { sample = await seedMoveReview(); payload = await captureDuplicatesPayload(); });
afterEach(cleanupMoveReview);
it('shows groups without Apply, keeps ticks on returning from merge disclosure and flushes before capture', async () => {
  await ready(); const props = reviewProps(sample.notes); props.queue.flush.mockImplementation(() => updateNote(payload.notes[14].id, { html: '<p>Flushed writing</p>' }));
  render(<ClaudeReview {...props} />); expect(screen.getAllByRole('article')).toHaveLength(2); expect(screen.getAllByRole('checkbox').every((box) => box.checked)).toBe(true); expect(screen.queryByRole('button', { name: /^Apply/ })).toBeNull();
  const second = within(screen.getByRole('article', { name: 'Suggested merge 2' })); fireEvent.click(second.getAllByRole('checkbox')[0]); expect(second.getByRole('button', { name: 'Merge 1 notes…' }).disabled).toBe(true);
  fireEvent.click(within(screen.getByRole('article', { name: 'Suggested merge 1' })).getByRole('button', { name: 'Merge 2 notes…' }));
  const dialog = await screen.findByRole('dialog', { name: 'Send to Anthropic?' }); expect(dialog.textContent).toContain('These 2 notes: titles, text and formatting, folders and tags');
  expect(session.getSnapshot().proposal.payload.requestText).toContain('Flushed writing'); expect(session.getSnapshot().suggestions.kind).toBe('duplicates');
  fireEvent.click(button('Cancel')); await screen.findByRole('article', { name: 'Suggested merge 1' }); expect(props.onBack).not.toHaveBeenCalled();
  expect(within(screen.getByRole('article', { name: 'Suggested merge 2' })).getAllByRole('checkbox')[0].checked).toBe(false);
});
it('ticks only the first five in a six-note group and requires 2–5', async () => {
  await ready(duplicatesVariants.six); render(<ClaudeReview {...reviewProps(sample.notes)} />);
  expect(screen.getAllByRole('checkbox').filter((box) => box.checked)).toHaveLength(5); expect(button('Merge 5 notes…').disabled).toBe(false);
  fireEvent.click(screen.getAllByRole('checkbox')[5]); expect(button('Merge 6 notes…').disabled).toBe(true); expect(screen.getByText('Choose 2–5 notes to merge.')).toBeTruthy();
});
it('hides groups with fewer than two live notes, ignores revisions for suggestions', async () => {
  await ready(); const props = reviewProps(sample.notes), view = render(<ClaudeReview {...props} />);
  await updateNote(payload.notes[14].id, { title: 'Updated list' }); view.rerender(<ClaudeReview {...props} notes={await db.notes.toArray()} />); expect(screen.getByText('Updated list')).toBeTruthy();
  await trashNote(payload.notes[14].id); await trashNote(payload.notes[2].id); view.rerender(<ClaudeReview {...props} notes={await db.notes.toArray()} />);
  expect(screen.getByText('No suggested merges left.')).toBeTruthy(); expect(screen.queryByRole('article')).toBeNull();
});
it('opens from the third Ask button, discloses exactly the notebook text and sends only after Send', async () => {
  const fetch = vi.fn(chunkedFetch(duplicatesEvents()).fetch); vi.stubGlobal('fetch', fetch); render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ask Claude', exact: true })); fireEvent.click(await screen.findByRole('button', { name: 'Tidy the notebook', exact: true })); fireEvent.click(button('Find duplicates to merge'));
  const dialog = await screen.findByRole('dialog', { name: 'Send to Anthropic?' }); expect(dialog.textContent).toContain('18 notes: titles, text, folders and tags'); expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send' })); await screen.findByRole('article', { name: 'Suggested merge 1' });
});
it('discard confirmation continues duplicates and ready bar calls them suggestions', async () => {
  await ready(); const props = reviewProps(sample.notes); render(<><Ask {...props} /><ClaudeReadyBar screen="ask" onOpen={props.onOpen} /></>);
  expect(button("Claude's suggestions are ready · Review")).toBeTruthy(); fireEvent.click(button('Tidy the notebook')); fireEvent.click(button('Find duplicates to merge'));
  fireEvent.click(await screen.findByRole('button', { name: 'Discard and continue' })); await waitFor(() => expect(session.getSnapshot().proposal.status).toBe('disclosure'));
  expect(session.getSnapshot().proposal.kind).toBe('duplicates'); expect(session.getSnapshot().suggestions).toBeNull();
});
it('empty duplicates have no cards or Apply', async () => {
  await ready(duplicatesVariants.empty); render(<ClaudeReview {...reviewProps(sample.notes)} />); expect(screen.getByText('Claude found no duplicates to merge.')).toBeTruthy();
});
