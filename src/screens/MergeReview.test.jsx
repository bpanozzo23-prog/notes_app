import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import ClaudeReview from "./ClaudeReview.jsx";
import ClaudeUndo from "../components/ClaudeUndo.jsx";
import { seedMoveReview, cleanupMoveReview, reviewProps } from "../test/moveReview.js";
import { db, notebookAccess } from "../db/db.js";
import { updateNote } from "../db/notes.js";
import { captureMergePayload, runMerge } from "../claude/merge.js";
import { captureDuplicatesPayload, runDuplicates } from "../claude/duplicates.js";
import { duplicatesEvents } from "../claude/fixtures/duplicates.js";
import { mergeEvents } from "../claude/fixtures/merge.js";
import { claudeSession as session } from "../claude/session.js";
import { chunkedFetch } from "../test/anthropic.js";
let sample, payload;
const button = (name) => screen.getByRole('button', { name, exact: true });
async function ready() {
  await runDuplicates({ payload: await captureDuplicatesPayload(), fetch: chunkedFetch(duplicatesEvents()).fetch });
  payload = await captureMergePayload(sample.notes.filter((n) => ['Libros por leer', 'Lista de lecturas'].includes(n.title)).map((n) => n.id));
  session.prepareProposal(payload, { keepSuggestions: true }); await runMerge({ payload, fetch: chunkedFetch(mergeEvents()).fetch });
}
beforeEach(async () => { sample = await seedMoveReview(); await ready(); });
afterEach(cleanupMoveReview);
it('shows the body, Trash/backlinks and word-for-word lists, no ticks, then Apply/open/other suggestions', async () => {
  const props = reviewProps(sample.notes), view = render(<ClaudeReview {...props} />); await waitFor(() => expect(button('Apply merge').disabled).toBe(false));
  expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByRole('button', { name: 'Untick all' })).toBeNull();
  for (const text of ['The merged note', 'Not in the merged note word for word:', 'New wording:', 'Lista de lecturas as it is now']) expect(screen.getByText(text)).toBeTruthy();
  expect(screen.getByText(/^Moves to Trash: Lista de lecturas/)).toBeTruthy(); expect(screen.getByText(/^Also updates links in: Recordatorio suelto/)).toBeTruthy();
  fireEvent.click(button('Apply merge')); await screen.findByText('Merged 2 notes into “Libros por leer”.');
  fireEvent.click(button('Open the merged note')); expect(props.openNote).toHaveBeenCalledWith(payload.keepId);
  view.rerender(<ClaudeReview {...props} notes={await db.notes.toArray()} />); fireEvent.click(button('Other suggested merges (1)')); await screen.findByRole('article', { name: 'Suggested merge 2' });
});
it('full Undo reports Merge undone', async () => {
  render(<ClaudeReview {...reviewProps(sample.notes)} />); await waitFor(() => expect(button('Apply merge').disabled).toBe(false)); fireEvent.click(button('Apply merge'));
  fireEvent.click(await screen.findByRole('button', { name: 'Undo', exact: true })); await screen.findByText('Merge undone.');
});
it('keep-edits Undo shows decisions, rechecks a changed list, and creates the earlier-content copy', async () => {
  render(<ClaudeReview {...reviewProps(sample.notes)} />); await waitFor(() => expect(button('Apply merge').disabled).toBe(false)); fireEvent.click(button('Apply merge'));
  await screen.findByRole('button', { name: 'Undo', exact: true }); await updateNote(payload.keepId, { title: 'Later title', html: '<p>Later writing</p>' });
  fireEvent.click(button('Undo')); await screen.findByRole('button', { name: 'Undo, keeping later changes' });
  expect(screen.getByText('Lista de lecturas comes out of Trash')).toBeTruthy(); expect(screen.getByText(/Recordatorio suelto stays as it is/)).toBeTruthy();
  await updateNote(payload.keepId, { title: 'Changed again' }); fireEvent.click(button('Undo, keeping later changes')); await screen.findByText('Something changed again; check the list.');
  fireEvent.click(button('Undo, keeping later changes')); await screen.findByText('Undone, keeping later changes. Earlier content restored as copies where needed.');
  expect((await db.notes.toArray()).some((n) => n.title === 'Libros por leer (before Claude)')).toBe(true); expect((await db.notes.get(payload.keepId)).title).toBe('Changed again');
});
it.each([false, true])('stale note at review or Apply flush refuses and Ask again retains suggestions (%s)', async (duringFlush) => {
  const props = reviewProps(sample.notes); render(<ClaudeReview {...props} />); await waitFor(() => expect(button('Apply merge').disabled).toBe(false));
  if (duringFlush) { props.queue.flush.mockImplementation(() => updateNote(payload.notes[1].id, { title: 'Later' })); fireEvent.click(button('Apply merge')); }
  else await updateNote(payload.notes[1].id, { title: 'Later' });
  await screen.findByText('Some notes changed since Claude read them.'); expect(button('Apply merge').disabled).toBe(true);
  fireEvent.click(button('Ask again')); await screen.findByRole('dialog', { name: 'Send to Anthropic?' }); expect(session.getSnapshot().suggestions.kind).toBe('duplicates');
  expect(session.getSnapshot().proposal.payload.notes.map((n) => n.id)).toEqual(payload.notes.map((n) => n.id));
});
it('Discard returns to retained suggestions and settings describe only the merged notes', async () => {
  const props = reviewProps(sample.notes), view = render(<ClaudeReview {...props} />); fireEvent.click(button('Discard')); await screen.findByRole('article', { name: 'Suggested merge 1' }); expect(props.onBack).not.toHaveBeenCalled();
  await act(async () => { await ready(); }); await waitFor(() => expect(button('Apply merge').disabled).toBe(false)); fireEvent.click(button('Apply merge')); await screen.findByRole('button', { name: 'Undo', exact: true });
  view.unmount(); render(<ClaudeUndo settings {...props} />); fireEvent.click(await screen.findByRole('button', { name: "Undo Claude's last change" }));
  const dialog = await screen.findByRole('dialog'); expect(dialog.textContent).toContain('Separate the merged notes again'); expect(dialog.textContent).not.toContain('Recordatorio suelto');
});

it.each([{ readOnly: true }, { replaced: true }, { versionChange: 'pending' }])('guards merge Apply and keep-edits Undo %j', async (access) => {
  const props = reviewProps(sample.notes), view = render(<ClaudeReview {...props} />); await waitFor(() => expect(button('Apply merge').disabled).toBe(false));
  const mock = vi.spyOn(notebookAccess, 'getSnapshot').mockReturnValue(access); view.rerender(<ClaudeReview {...props} />); expect(button('Apply merge').disabled).toBe(true);
  mock.mockRestore(); view.rerender(<ClaudeReview {...props} />); fireEvent.click(button('Apply merge')); await screen.findByRole('button', { name: 'Undo', exact: true });
  await updateNote(payload.keepId, { title: 'Later' }); fireEvent.click(button('Undo')); await screen.findByRole('button', { name: 'Undo, keeping later changes' });
  vi.spyOn(notebookAccess, 'getSnapshot').mockReturnValue(access); view.rerender(<ClaudeReview {...props} />); expect(button('Undo').disabled).toBe(true); expect(button('Undo, keeping later changes').disabled).toBe(true);
});
