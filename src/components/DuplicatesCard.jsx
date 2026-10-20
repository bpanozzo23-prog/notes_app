import { notePreview } from "../claude/preview.js";
import { noteTitle } from "../lib/notebookView.js";
import { captureMergePayload } from "../claude/merge.js";
import { claudeSession } from "../claude/session.js";

export default function DuplicatesCard({ group, index, notes, selected, toggle, disabled, run, queue }) {
  const chosen = notes.filter((note) => selected.has(`g${index}:${note.handle}`));
  async function merge() {
    if (disabled || chosen.length < 2 || chosen.length > 5) return;
    await run(async () => {
      await queue.flush();
      const payload = await captureMergePayload(chosen.map((note) => note.id));
      if (!claudeSession.prepareProposal(payload, { keepSuggestions: true })) throw new Error("Wait for Claude's current request to finish.");
    });
  }
  return <article aria-label={`Suggested merge ${index}`} className="space-y-3 rounded-[14px] border border-[var(--color-line)] bg-white px-3.5 py-3">
    {notes.map((note) => <div key={note.handle}><label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={selected.has(`g${index}:${note.handle}`)} onChange={() => toggle(`g${index}:${note.handle}`)} disabled={disabled} /><span>{noteTitle(note)}</span></label>
      {notePreview(note.text) !== noteTitle(note) && <p className="text-sm text-[var(--color-muted)]">{notePreview(note.text)}</p>}</div>)}
    <p>{group.reason}</p>
    <button className="app-button primary" disabled={disabled || chosen.length < 2 || chosen.length > 5} onClick={merge}>Merge {chosen.length} notes…</button>
    {(chosen.length < 2 || chosen.length > 5) && <p className="text-sm">Choose 2–5 notes to merge.</p>}
  </article>;
}
