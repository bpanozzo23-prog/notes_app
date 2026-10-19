import { noteTitle } from "../lib/notebookView.js";

export function sourceState(source, payload, notes, trash, folders) {
  const live = notes.find((note) => note.id === source.noteId);
  const note = live ?? trash.find((note) => note.id === source.noteId);
  const snapshot = payload.entries.find((entry) => entry.noteId === source.noteId);
  return { title: note ? noteTitle(note) : source.title,
    folder: note ? folders.find((folder) => folder.id === note.folderId)?.name ?? "No folder" : "",
    label: !note ? "No longer exists" : !live ? "In Trash" : note.updatedAt !== snapshot?.updatedAt ? "Edited since Claude read it" : "",
    exists: !!note,
  };
}
export default function Sources({ sources, payload, notes, trash, folders, openNote, busy }) {
  if (!sources?.length) return null;
  return <section aria-label="Sources" className="mt-4 rounded-lg border border-[var(--color-line)] p-3 text-sm">
    <h3 className="font-semibold">Sources</h3>
    <ol className="divide-y divide-[var(--color-line)]">
      {sources.map((source) => {
        const state = sourceState(source, payload, notes, trash, folders);
        const label = <><span className="block font-medium">{source.number}. {state.title}</span><span className="block text-xs text-[var(--color-muted)]">{state.folder}</span>{state.label && <span className="block text-xs">{state.label}</span>}</>;
        return <li key={source.noteId} className="break-words py-2">
          {state.exists ? <button className="min-h-11 w-full text-left" disabled={busy} onClick={() => openNote(source.noteId)}>{label}</button> : <div>{label}</div>}
          {source.quotes.map((quote) => <p key={quote} className="mt-1 text-[var(--color-muted)]">“{quote}”</p>)}
        </li>;
      })}
    </ol>
  </section>;
}
