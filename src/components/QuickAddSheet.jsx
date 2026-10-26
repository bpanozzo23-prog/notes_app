import { useEffect, useState } from "react";
import { getPref, setPref } from "../db/db.js";
import { dayMonth } from "../lib/dates.js";
import { noteTitle, visibleNotes } from "../lib/notebookView.js";
import Dialog from "./Dialog.jsx";

export default function QuickAddSheet({ notes, readOnly, busy, error, onClose, onAdd, onDraft }) {
  const chips = visibleNotes(notes.filter((note) => note.quickAdd), { type: "all" });
  const [selected, setSelected] = useState(null);
  const [text, setText] = useState("");
  const chosen = chips.find((note) => note.id === selected) ?? chips[0];
  const hasText = !!text.trim();
  useEffect(() => {
    let active = true;
    void getPref("quickAddLast").then((id) => { if (active) setSelected((current) => current ?? id); }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => { onDraft(hasText); }, [hasText, onDraft]);
  useEffect(() => () => onDraft(false), [onDraft]);
  async function add() {
    if (!chosen || !hasText || busy || readOnly) return;
    const id = chosen.id;
    if (await onAdd(id, text)) {
      setText("");
      // Remembering a chip is optional; a failed preference write must never invite a duplicate add.
      void setPref("quickAddLast", id).catch(() => {});
    }
  }
  return <Dialog title="Quick add" sheet routed busy={busy} onClose={onClose} footer={<div className="flex justify-end gap-2">
    <button className="app-button" disabled={busy} onClick={onClose}>Cancel</button>
    {chosen && <button className="app-button primary" disabled={busy || readOnly || !hasText} onClick={add}>Add</button>}
  </div>}>
    {chosen ? <>
      <div role="radiogroup" aria-label="Add to" className="mb-3 flex flex-wrap gap-2">
        {chips.map((note) => <button key={note.id} role="radio" aria-checked={chosen.id === note.id} className="filter-chip max-w-full truncate"
          disabled={busy} onClick={() => setSelected(note.id)}>{noteTitle(note)}</button>)}
      </div>
      <textarea rows={3} maxLength={2000} data-initial-focus enterKeyHint="enter" aria-label="Text to add" className="app-input w-full"
        placeholder={chosen.addDate ? `${dayMonth(new Date())} — …` : "What do you want to add?"} disabled={busy || readOnly}
        value={text} onChange={(event) => setText(event.target.value)} />
    </> : <p>Turn on Quick add in a note's ⋯ menu to list it here.</p>}
    {readOnly && <p className="mt-3 text-sm">Your notes are read-only right now, so nothing can be added.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </Dialog>;
}
