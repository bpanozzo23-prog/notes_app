import { captureSplitPayload } from "../claude/split.js";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pin, Trash2, Sparkles, Copy, Ellipsis } from "lucide-react";
import { db } from "../db/db.js";
import { isContentEdit, liveNotes } from "../db/notes.js";
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
import { saveStatusLabel } from "../lib/saveStatus.js";

// The fields whose change counts as an edit, as in src/db/notes.js.

export default function Note({ initialNote, notes, folders, toolbarIds, formatting, readOnly: locked = false, queue, status, busy, onBack, onDelete, onOpenNote, error, run, refresh, onImageError, claudeReady, onOpen, setMessage }) {
  const [note, setNote] = useState(initialNote);
  const [conflict, setConflict] = useState(null);
  const readOnly = locked || !!conflict;
  useLayoutEffect(() => {
    queue.setKnownRev(initialNote.id, initialNote.rev);
    return queue.onConflict((event) => { if (event.noteId === initialNote.id) setConflict(event); });
  }, [queue, initialNote.id]);
  const [optionsSheet, setOptionsSheet] = useState(false);
  const [tagsSheet, setTagsSheet] = useState(false);
  const [claudeSheet, setClaudeSheet] = useState(false);
  const session = useSyncExternalStore(claudeSession.subscribe, claudeSession.getSnapshot);
  const [splitInstruction, setSplitInstruction] = useState("");
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
  async function tidyNote(kind = "tidy", confirmed = false) {
    const existing = claudeSession.getSnapshot().proposal;
    if (!confirmed && existing) { setClaudeSheet(false); setConfirmTidy(kind); return; }
    const success = await run(async () => {
      await queue.flush();
      const payload = await (kind === "split" ? captureSplitPayload(note.id, splitInstruction) : captureTidyPayload(note.id, instruction));
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
      ...(isContentEdit(patch, current) ? { updatedAt: nowIso() } : {}) }));
  }
  return <section className="flex flex-1 flex-col pb-24" onBlur={() => { queue.flush().catch(() => {}); }}>
    <ScreenHeader title="Note" onBack={onBack} busy={busy}>
      <span role="status" className={`pr-1 text-xs ${status === "error" ? "font-semibold text-red-700" : "text-[var(--color-muted)]"}`}>{saveStatusLabel(status)}</span>
      <button className="icon-button" aria-label="Pin note" disabled={readOnly} aria-pressed={note.pinned} onClick={() => edit({ pinned: !note.pinned })}><Pin size={18} aria-hidden="true" /></button>
      {claudeReady && <button className="icon-button" aria-label="Claude" disabled={busy} onClick={() => setClaudeSheet(true)}><Sparkles size={20} aria-hidden="true" /></button>}
      <button className="icon-button" aria-label="Note options" disabled={busy} onClick={() => setOptionsSheet(true)}><Ellipsis size={20} aria-hidden="true" /></button>
    </ScreenHeader>
    {conflict && <aside role="status" className="mx-4 my-3 rounded bg-amber-50 p-3 text-sm">
      <p>This note was changed in another window, so your edits here were saved in a new note, “{conflict.copyTitle}”. Nothing was overwritten.</p>
      <button className="min-h-11 underline" disabled={busy} onClick={() => onOpenNote(conflict.copyId)}>Open the copy</button>
    </aside>}
    <input className="mx-4 min-w-0 bg-transparent py-2 text-xl font-semibold outline-none" aria-label="Title" placeholder="Title (optional)"
      readOnly={readOnly} value={note.title} onChange={(event) => edit({ title: event.target.value })} />
    <div className="mx-4 mb-2 min-w-0 border-b border-[var(--color-line)] pb-2">
      <div className="flex flex-wrap items-center gap-x-3">
        <fieldset disabled={readOnly} className="min-w-0"><FolderPicker folders={folders} value={note.folderId} onChange={(folderId) => edit({ folderId })} /></fieldset>
        <button className="flex min-h-11 min-w-0 flex-1 items-center text-left text-sm" aria-label="Edit tags" disabled={readOnly} onClick={() => setTagsSheet(true)}>
          <span className={`min-w-0 break-words ${note.tags.length ? "" : "text-[var(--color-muted)]"}`}>{note.tags.length ? note.tags.map((tag) => `#${tag}`).join(" ") : "+ Tags"}</span>
        </button>
      </div>
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
    {optionsSheet && <Dialog title="Note options" sheet busy={busy} onClose={() => setOptionsSheet(false)}>
      <div className="space-y-1">
        <button className="flex min-h-11 w-full items-center gap-3 rounded px-2 text-left hover:bg-black/5" disabled={busy} onClick={async () => { await run(copyAsText); setOptionsSheet(false); }}><Copy size={18} aria-hidden="true" />Copy as text</button>
        <button className="flex min-h-11 w-full items-center gap-3 rounded px-2 text-left text-red-700 hover:bg-black/5" disabled={readOnly || busy} onClick={() => { setOptionsSheet(false); setConfirmDelete(true); }}><Trash2 size={18} aria-hidden="true" />Move to Trash…</button>
      </div>
      <button className="app-button mt-4 w-full" disabled={busy} onClick={() => setOptionsSheet(false)}>Cancel</button>
    </Dialog>}
    {tagsSheet && <Dialog title="Tags" sheet busy={busy} onClose={() => setTagsSheet(false)}>
      <fieldset disabled={readOnly} className="min-w-0"><TagInput tags={note.tags} allTags={tagsInUse(notes)} onChange={(tags) => edit({ tags })} suggestionsOpen initialFocus /></fieldset>
      <button className="app-button mt-4 w-full" disabled={busy} onClick={() => setTagsSheet(false)}>Done</button>
    </Dialog>}
    {claudeSheet && <Dialog title="Claude" sheet busy={busy} onClose={() => setClaudeSheet(false)}><div className="space-y-3"><button className="app-button w-full" disabled={busy} onClick={() => askNote()}>Ask about this note</button>
      <h2 className="font-semibold">Tidy this note</h2>
      <label className="block text-sm" htmlFor="tidy-instruction">What should Claude do? Leave blank to fix mistakes and tidy the formatting.</label>
      <textarea id="tidy-instruction" disabled={busy} rows={3} maxLength={500} className="w-full rounded border p-2" value={instruction} onChange={(event) => setInstruction(event.target.value)} />
      <button className="app-button" disabled={busy || readOnly || !!session.request} onClick={() => tidyNote()}>Continue</button>
      <h2 className="font-semibold">Split this note</h2>
      <label className="block text-sm" htmlFor="split-instruction">How should Claude split it? Leave blank to split by topic.</label>
      <textarea id="split-instruction" disabled={busy} rows={3} maxLength={500} className="w-full rounded border p-2" value={splitInstruction} onChange={(event) => setSplitInstruction(event.target.value)} />
      <button className="app-button" disabled={busy || readOnly || !!session.request} onClick={() => tidyNote("split")}>Split…</button>
    </div></Dialog>}
    {confirmTidy && <Confirm tone="danger" title="Discard Claude's other proposal?" confirmLabel="Discard and continue" busy={busy} onCancel={() => setConfirmTidy(false)} onConfirm={() => tidyNote(confirmTidy, true)}>Only one proposal is kept at a time.</Confirm>}
    {confirmAsk && <Confirm tone="danger" title="Clear the current conversation and ask about this note?" confirmLabel="Clear and ask" onCancel={() => setConfirmAsk(false)} onConfirm={() => askNote(true)}>The current answers will be cleared.</Confirm>}
    <p className="mx-4 mt-6 text-xs text-[var(--color-muted)]">{noteDates(note)}</p>
    {linkEditor && <LinkPicker editor={linkEditor} noteId={note.id} notes={notes} folders={folders} onClose={() => setLinkEditor(null)} />}
    {confirmDelete && <Confirm tone="danger" title="Move note to Trash?" confirmLabel="Move to Trash" busy={busy} error={error} onCancel={() => setConfirmDelete(false)} onConfirm={() => onDelete(note.id)}>
      You can restore this note for 30 days. After that, it is permanently deleted.
    </Confirm>}
  </section>;
}
