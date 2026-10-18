import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { db } from "../db/db.js";
import { undoClaudeChange, restoreClaudeCopies, isClaudeChange, allowsPartialUndo } from "../db/claudeChanges.js";
import Confirm from "./Confirm.jsx";
import { noteTitle } from "../lib/notebookView.js";

export default function ClaudeUndo({ changeId, settings = false, run, queue, refresh, disabled, onRestored }) {
  const [record, setRecord] = useState(null), [confirm, setConfirm] = useState(false), [conflict, setConflict] = useState(false), [message, setMessage] = useState("");
  useEffect(() => {
    const subscription = liveQuery(() => db.prefs.get("claudeLastChange")).subscribe({ next: (row) => setRecord(row?.value ?? null), error: () => setRecord(null) });
    return () => subscription.unsubscribe();
  }, []);
  const current = isClaudeChange(record) && (!changeId || record.changeId === changeId);
  const undo = (id = record.changeId, unchangedOnly = false) => run(async () => {
    await queue?.flush();
    const result = await undoClaudeChange(id, { unchangedOnly });
    setConfirm(false);
    if (result.conflict) setConflict({ id, ...result });
    else { setConflict(false); setMessage(unchangedOnly ? `Restored ${result.restored} unchanged ${result.restored === 1 ? "note" : "notes"}.${result.skipped.length ? ` Left as they are${record.kind === "links" ? " (their links stay)" : ""}: ${result.skipped.map((note) => note.title).join(", ")}.` : ""}` : "Earlier version restored."); await refresh(); onRestored?.(); }
  });
  const copies = () => run(async () => {
    await queue?.flush();
    await restoreClaudeCopies(conflict.id);
    setConflict(false); setMessage("Earlier versions restored as new notes."); await refresh(); onRestored?.();
  });
  return <div className="space-y-2 text-sm">
    {current && <>
      {settings && <p>{new Date(record.at).toLocaleString("en-GB")} · {record.notes.map((entry) => noteTitle(entry.before)).join(", ")}</p>}
      <button className="app-button" disabled={disabled} onClick={() => settings ? setConfirm(record.changeId) : undo()}>{settings ? "Undo Claude's last change" : "Undo"}</button>
      {conflict?.id === record.changeId && <div role="status" className="space-y-2"><p>A note changed after Claude's edit. Your later edits will be kept.</p>{conflict.partial ? <button className="app-button" disabled={disabled} onClick={() => undo(conflict.id, true)}>Undo the {conflict.unchanged} unchanged {conflict.unchanged === 1 ? "note" : "notes"}</button> : <button className="app-button" disabled={disabled} onClick={copies}>Restore the earlier versions as new notes</button>}</div>}
    </>}
    {message && <p role="status">{message}</p>}
    {current && confirm === record.changeId && <Confirm title="Undo Claude's last change?" confirmLabel="Undo" busy={disabled} onCancel={() => setConfirm(false)} onConfirm={() => undo(confirm)}>Restore the earlier version of {record.notes.map((entry) => noteTitle(entry.before)).join(", ")}. {allowsPartialUndo(record) ? "If notes changed since, you can undo only the unchanged notes." : "If it changed since, you can restore a new copy instead."}</Confirm>}
  </div>;
}
