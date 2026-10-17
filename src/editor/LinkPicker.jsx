import { useState } from "react";
import Dialog from "../components/Dialog.jsx";
import { noteTitle } from "../lib/notebookView.js";
import { normalize } from "../lib/text.js";

export default function LinkPicker({ editor, noteId, notes, folders, onClose }) {
  const [query, setQuery] = useState("");
  const [selection] = useState(() => ({ from: editor.state.selection.from, to: editor.state.selection.to }));
  const candidates = notes.filter((note) => note.deletedAt === null && note.id !== noteId);
  const matching = candidates.filter((note) => normalize(`${note.title}\n${note.text}`).includes(normalize(query).trim()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));

  function choose(note) {
    const href = `note:${note.id}`;
    const chain = editor.chain().setTextSelection(selection);
    if (selection.from !== selection.to) chain.setLink({ href }).run();
    else chain.insertContent([
      { type: "text", text: noteTitle(note), marks: [{ type: "link", attrs: { href } }] },
      { type: "text", text: " ", marks: [] },
    ]).run();
    onClose();
  }

  return <Dialog title="Link to note" sheet onClose={onClose}>
    <input aria-label="Find note to link" data-initial-focus className="app-input mb-3 w-full" placeholder="Search notes"
      value={query} onChange={(event) => setQuery(event.target.value)} />
    <ul aria-label="Notes to link" className="divide-y divide-[var(--color-line)]">
      {matching.map((note) => <li key={note.id}>
        <button className="min-h-11 w-full py-3 text-left" aria-label={noteTitle(note)} onClick={() => choose(note)}>
          <span className="block break-words font-medium">{noteTitle(note)}</span>
          <span className="block break-words text-sm text-[var(--color-muted)]">{folders.find((folder) => folder.id === note.folderId)?.name ?? "No folder"}</span>
        </button>
      </li>)}
    </ul>
    {!matching.length && <p className="py-4 text-sm text-[var(--color-muted)]">{candidates.length ? "No notes match." : "No other notes yet."}</p>}
    <button className="app-button mt-4 w-full" onClick={onClose}>Cancel</button>
  </Dialog>;
}
