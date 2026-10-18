import { useCallback, useEffect, useRef, useState } from "react";
import { Pin, Trash2, Sparkles, Copy } from "lucide-react";
import { db } from "../db/db.js";
import { liveNotes } from "../db/notes.js";
import { allFolders } from "../db/folders.js";
import { noteToText } from "../lib/textExport.js";
import { copyText } from "../lib/clipboard.js";
import NoteEditor from "../editor/NoteEditor.jsx";
import LinkPicker from "../editor/LinkPicker.jsx";
import ScreenHeader from "../components/ScreenHeader.jsx";
import FolderPicker from "../components/FolderPicker.jsx";
import TagInput from "../components/TagInput.jsx";
import Dialog from "../components/Dialog.jsx";
import { captureTidyPayload } from "../claude/proposals.js";
import { claudeSession } from "../claude/session.js";
import Confirm from "../components/Confirm.jsx";
import { noteTitle, tagsInUse, visibleNotes } from "../lib/notebookView.js";
import { noteDates, nowIso } from "../lib/dates.js";

// The fields whose change counts as an edit, as in src/db/notes.js.
const CONTENT_FIELDS = ["title", "html", "folderId", "tags"];

export default function Note({ initialNote, notes, folders, toolbarIds, formatting, readOnly = false, queue, status, busy, onBack, onDelete, onOpenNote, error, run, refresh, onImageError, claudeReady, onOpen, setMessage }) {
  const [note, setNote] = useState(initialNote);
  const [claudeSheet, setClaudeSheet] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [confirmTidy, setConfirmTidy] = useState(false);
  async function copyAsText() {
    await queue.flush();
    const [notes, folders] = await db.transaction("r", db.notes, db.folders, () => Promise.all([liveNotes(), allFolders()]));
    const saved = notes.find((row) => row.id === note.id);
    if (!saved) throw new Error("That note no longer exists or is in Trash.");
    try {
      await copyText(noteToText(saved, folders, notes));
      setMessage("Copied as text.");
    } catch {
      setMessage("Couldn't copy. Use Settings → Export notes as text.");
    }
  }
  async function tidyNote(confirmed = false) {
    const existing = claudeSession.getSnapshot().proposal;
    if (!confirmed && existing) { setClaudeSheet(false); setConfirmTidy(true); return; }
    const success = await run(async () => {
      await queue.flush();
      const payload = await captureTidyPayload(note.id, instruction);
      if (!claudeSession.prepareProposal(payload)) throw new Error("Wait for Claude's current request to finish.");
    });
    if (success) { setClaudeSheet(false); setConfirmTidy(false); onOpen({ screen: "claude-review" }); }
  }
  const [confirmAsk, setConfirmAsk] = useState(false);
  function askNote(clear = false) {
    const scope = claudeSession.getSnapshot().conversation?.scope;
    if (!clear && scope && (scope.kind !== "note" || scope.noteId !== note.id)) { setClaudeSheet(false); setConfirmAsk(true); return; }
    if (clear) claudeSession.clearConversation();
    claudeSession.setPendingScope({ kind: "note", noteId: note.id });
    setClaudeSheet(false); setConfirmAsk(false); onOpen({ screen: "ask" });
  }
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
    // Show the edit time at once; the save writes the stored updatedAt moments later.
    setNote((current) => ({ ...current, ...patch,
      ...(CONTENT_FIELDS.some((key) => Object.hasOwn(patch, key) && JSON.stringify(patch[key]) !== JSON.stringify(current[key])) ? { updatedAt: nowIso() } : {}) }));
  }
  return <section className="flex flex-1 flex-col pb-24" onBlur={() => { queue.flush().catch(() => {}); }}>
    <ScreenHeader title="Note" onBack={onBack} busy={busy}>
      {claudeReady && <button className="icon-button" aria-label="Claude" disabled={busy} onClick={() => setClaudeSheet(true)}><Sparkles size={20} aria-hidden="true" /></button>}
      <span role="status" className={`pr-1 text-xs ${status === "error" ? "font-semibold text-red-700" : "text-[var(--color-muted)]"}`}>{status === "error" ? "Not saved" : status}</span>
    </ScreenHeader>
    <input className="mx-4 min-w-0 bg-transparent py-2 text-xl font-semibold outline-none" aria-label="Title" placeholder="Title (optional)"
      readOnly={readOnly} value={note.title} onChange={(event) => edit({ title: event.target.value })} />
    <div className="mx-4 mb-2 min-w-0 border-b border-[var(--color-line)] pb-3">
      <div className="flex items-center gap-1">
        <fieldset disabled={readOnly} className="min-w-0 flex-1"><FolderPicker folders={folders} value={note.folderId} onChange={(folderId) => edit({ folderId })} /></fieldset>
        <button className="icon-button" aria-label="Copy as text" disabled={busy} onClick={() => run(copyAsText)}><Copy size={18} aria-hidden="true" /></button>
        <button className="icon-button" aria-label="Pin note" disabled={readOnly} aria-pressed={note.pinned} onClick={() => edit({ pinned: !note.pinned })}><Pin size={18} aria-hidden="true" /></button>
        <button className="icon-button text-red-700" aria-label="Delete" disabled={readOnly} onClick={() => setConfirmDelete(true)}><Trash2 size={18} aria-hidden="true" /></button>
      </div>
      <fieldset disabled={readOnly} className="min-w-0">
        {/* Copy as text works read-only; editing tags must not. */}
        <fieldset disabled={readOnly} className="min-w-0"><TagInput tags={note.tags} allTags={tagsInUse(notes)} onChange={(tags) => edit({ tags })} /></fieldset>
      </fieldset>
    </div>
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
    {claudeSheet && <Dialog title="Claude" sheet busy={busy} onClose={() => setClaudeSheet(false)}><div className="space-y-3"><button className="app-button w-full" disabled={busy} onClick={() => askNote()}>Ask about this note</button>
      <h2 className="font-semibold">Tidy this note</h2>
      <label className="block text-sm" htmlFor="tidy-instruction">What should Claude do? Leave blank to fix mistakes and tidy the formatting.</label>
      <textarea id="tidy-instruction" disabled={busy} rows={3} maxLength={500} className="w-full rounded border p-2" value={instruction} onChange={(event) => setInstruction(event.target.value)} />
      <button className="app-button" disabled={busy || readOnly || claudeSession.isBusy()} onClick={() => tidyNote()}>Continue</button>
    </div></Dialog>}
    {confirmTidy && <Confirm title="Discard Claude's other proposal?" confirmLabel="Discard and continue" busy={busy} onCancel={() => setConfirmTidy(false)} onConfirm={() => tidyNote(true)}>Only one proposal is kept at a time.</Confirm>}
    {confirmAsk && <Confirm title="Clear the current conversation and ask about this note?" confirmLabel="Clear and ask" onCancel={() => setConfirmAsk(false)} onConfirm={() => askNote(true)}>The current answers will be cleared.</Confirm>}
    <p className="mx-4 mt-6 text-xs text-[var(--color-muted)]">{noteDates(note)}</p>
    {linkEditor && <LinkPicker editor={linkEditor} noteId={note.id} notes={notes} folders={folders} onClose={() => setLinkEditor(null)} />}
    {confirmDelete && <Confirm title="Move note to Trash?" confirmLabel="Move to Trash" busy={busy} error={error} onCancel={() => setConfirmDelete(false)} onConfirm={() => onDelete(note.id)}>
      You can restore this note for 30 days. After that, it is permanently deleted.
    </Confirm>}
  </section>;
}
