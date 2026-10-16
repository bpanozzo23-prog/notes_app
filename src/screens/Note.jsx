import { useState } from "react";
import { Pin, Trash2 } from "lucide-react";
import NoteEditor from "../editor/NoteEditor.jsx";
import ScreenHeader from "../components/ScreenHeader.jsx";
import FolderPicker from "../components/FolderPicker.jsx";
import TagInput from "../components/TagInput.jsx";
import Confirm from "../components/Confirm.jsx";
import { tagsInUse } from "../lib/notebookView.js";

export default function Note({ initialNote, notes, folders, toolbarIds, queue, status, busy, onBack, onDelete, error }) {
  const [note, setNote] = useState(initialNote);
  const [confirmDelete, setConfirmDelete] = useState(false);
  function edit(patch) {
    queue.schedule(note.id, patch);
    setNote((current) => ({ ...current, ...patch }));
  }
  return <section className="flex flex-1 flex-col" onBlur={() => { queue.flush().catch(() => {}); }}>
    <ScreenHeader title="Note" onBack={onBack} busy={busy}>
      <span role="status" className={`pr-1 text-xs ${status === "error" ? "font-semibold text-red-700" : "text-[var(--color-muted)]"}`}>{status === "error" ? "Not saved" : status}</span>
    </ScreenHeader>
    <input className="mx-4 min-w-0 bg-transparent py-2 text-xl font-semibold outline-none" aria-label="Title" placeholder="Title (optional)"
      value={note.title} onChange={(event) => edit({ title: event.target.value })} />
    <div className="mx-4 mb-2 border-b border-[var(--color-line)] pb-3">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1"><FolderPicker folders={folders} value={note.folderId} onChange={(folderId) => edit({ folderId })} /></div>
        <button className="icon-button" aria-label="Pin note" aria-pressed={note.pinned} onClick={() => edit({ pinned: !note.pinned })}><Pin size={18} aria-hidden="true" /></button>
        <button className="icon-button text-red-700" aria-label="Delete" onClick={() => setConfirmDelete(true)}><Trash2 size={18} aria-hidden="true" /></button>
      </div>
      <TagInput tags={note.tags} allTags={tagsInUse(notes)} onChange={(tags) => edit({ tags })} />
    </div>
    <NoteEditor note={note} onChange={(html) => edit({ html })} toolbarIds={toolbarIds} />
    {confirmDelete && <Confirm title="Move note to Trash?" confirmLabel="Move to Trash" busy={busy} error={error} onCancel={() => setConfirmDelete(false)} onConfirm={() => onDelete(note.id)}>
      You can restore this note for 30 days. After that, it is permanently deleted.
    </Confirm>}
  </section>;
}
