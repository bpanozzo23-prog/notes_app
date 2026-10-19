import { useState } from "react";
import { purgeNow, restoreNote, TRASH_RETENTION_MS } from "../db/notes.js";
import { noteTitle } from "../lib/notebookView.js";
import ScreenHeader from "../components/ScreenHeader.jsx";
import Confirm from "../components/Confirm.jsx";

export default function Trash({ trash, refresh, run, busy, readOnly, onBack, error }) {
  const [deleting, setDeleting] = useState(null);
  async function change(task) { return run(async () => { await task(); await refresh(); }); }
  return <section>
    <ScreenHeader title="Trash" onBack={onBack} busy={busy} />
    <div className="px-4 pb-8">
      <p className="mb-4 text-sm text-[var(--color-muted)]">Deleted notes stay here for 30 days.</p>
      {!trash.length && <p className="py-8 text-center text-[var(--color-muted)]">Trash is empty.</p>}
      <ul className="divide-y divide-[var(--color-line)]">
        {trash.map((note) => <li key={note.id} className="py-4">
          <h2 className="truncate font-medium">{noteTitle(note)}</h2>
          <p className="mt-1 text-xs text-[var(--color-muted)]">Deleted {new Date(note.deletedAt).toLocaleDateString()} · expires in {Math.max(0, Math.ceil((Date.parse(note.deletedAt) + TRASH_RETENTION_MS - Date.now()) / 86400000))} days</p>
          <div className="mt-3 flex gap-2">
            <button className="app-button" disabled={busy || readOnly} onClick={() => change(() => restoreNote(note.id))}>Restore</button>
            <button className="app-button danger" disabled={busy || readOnly} onClick={() => setDeleting(note)}>Delete now</button>
          </div>
        </li>)}
      </ul>
    </div>
    {deleting && <Confirm tone="danger" title="Permanently delete note?" confirmLabel="Delete now" busy={busy} error={error} onCancel={() => setDeleting(null)} onConfirm={async () => {
      if (await change(() => purgeNow(deleting.id))) setDeleting(null);
    }}>“{noteTitle(deleting)}” will be deleted immediately. This cannot be undone.</Confirm>}
  </section>;
}
