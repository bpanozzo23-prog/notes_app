import { useCallback, useEffect, useRef, useState } from "react";
import { Pin, Trash2 } from "lucide-react";
import NoteEditor from "../editor/NoteEditor.jsx";
import LinkPicker from "../editor/LinkPicker.jsx";
import ScreenHeader from "../components/ScreenHeader.jsx";
import FolderPicker from "../components/FolderPicker.jsx";
import TagInput from "../components/TagInput.jsx";
import Confirm from "../components/Confirm.jsx";
import { noteTitle, tagsInUse, visibleNotes } from "../lib/notebookView.js";

export default function Note({ initialNote, notes, folders, toolbarIds, formatting, readOnly = false, queue, status, busy, onBack, onDelete, onOpenNote, error, run, refresh, onImageError }) {
  const [note, setNote] = useState(initialNote);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [linkEditor, setLinkEditor] = useState(null);
  const editorRef = useRef(null);
  const onEditor = useCallback((editor) => { editorRef.current = editor; }, []);
  useEffect(() => queue.onBeforeFlush(() => {
    // Hand over input ProseMirror is still holding before the queue saves (Android deletions
    // wait 20 ms in its DOM observer; a reload or Back inside that window would drop them).
    const observer = editorRef.current?.view?.domObserver;
    observer?.forceFlush?.();
    observer?.flush?.();
  }), [queue]);
  function openLinkPicker(editor) {
    // Synchronous focus lets Dialog remember the editor even for keyboard-activated buttons.
    editor.view.focus();
    setLinkEditor(editor);
  }
  function removeLink(editor) { editor.chain().focus().extendMarkRange("link").unsetLink().run(); }
  const linkedFrom = visibleNotes(notes.filter((source) => source.deletedAt === null && source.linkedIds.includes(note.id)));
  function edit(patch) {
    if (readOnly) return;
    queue.schedule(note.id, patch);
    setNote((current) => ({ ...current, ...patch }));
  }
  return <section className="flex flex-1 flex-col pb-24" onBlur={() => { queue.flush().catch(() => {}); }}>
    <ScreenHeader title="Note" onBack={onBack} busy={busy}>
      <span role="status" className={`pr-1 text-xs ${status === "error" ? "font-semibold text-red-700" : "text-[var(--color-muted)]"}`}>{status === "error" ? "Not saved" : status}</span>
    </ScreenHeader>
    <input className="mx-4 min-w-0 bg-transparent py-2 text-xl font-semibold outline-none" aria-label="Title" placeholder="Title (optional)"
      readOnly={readOnly} value={note.title} onChange={(event) => edit({ title: event.target.value })} />
    <fieldset disabled={readOnly} className="mx-4 mb-2 min-w-0 border-b border-[var(--color-line)] pb-3">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1"><FolderPicker folders={folders} value={note.folderId} onChange={(folderId) => edit({ folderId })} /></div>
        <button className="icon-button" aria-label="Pin note" aria-pressed={note.pinned} onClick={() => edit({ pinned: !note.pinned })}><Pin size={18} aria-hidden="true" /></button>
        <button className="icon-button text-red-700" aria-label="Delete" onClick={() => setConfirmDelete(true)}><Trash2 size={18} aria-hidden="true" /></button>
      </div>
      <TagInput tags={note.tags} allTags={tagsInUse(notes)} onChange={(tags) => edit({ tags })} />
    </fieldset>
    <NoteEditor queue={queue} onImageError={onImageError} note={note} onChange={(html) => edit({ html })} toolbarIds={toolbarIds} formatting={formatting} readOnly={readOnly} busy={busy} run={run} refresh={refresh} error={error} onEditor={onEditor}
      ui={{ openLinkPicker, openNote: onOpenNote, removeLink }} />
    {linkedFrom.length > 0 && <section aria-label="Linked from" className="mx-4 mt-4 border-t border-[var(--color-line)] pt-4">
      <h2 className="font-semibold">Linked from</h2>
      <ul className="divide-y divide-[var(--color-line)]">
        {linkedFrom.map((source) => <li key={source.id}>
          <button className="min-h-11 w-full py-3 text-left" aria-label={noteTitle(source)} disabled={busy} onClick={() => onOpenNote(source.id)}>
            <span className="block break-words font-medium">{noteTitle(source)}</span>
            <span className="block break-words text-sm text-[var(--color-muted)]">{folders.find((folder) => folder.id === source.folderId)?.name ?? "No folder"}</span>
          </button>
        </li>)}
      </ul>
    </section>}
    {linkEditor && <LinkPicker editor={linkEditor} noteId={note.id} notes={notes} folders={folders} onClose={() => setLinkEditor(null)} />}
    {confirmDelete && <Confirm title="Move note to Trash?" confirmLabel="Move to Trash" busy={busy} error={error} onCancel={() => setConfirmDelete(false)} onConfirm={() => onDelete(note.id)}>
      You can restore this note for 30 days. After that, it is permanently deleted.
    </Confirm>}
  </section>;
}
