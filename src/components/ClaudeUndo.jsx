import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { db } from "../db/db.js";
import { undoClaudeChange, restoreClaudeCopies, isClaudeChange, allowsPartialUndo } from "../db/claudeChanges.js";
import Confirm from "./Confirm.jsx";
import { noteTitle } from "../lib/notebookView.js";

function decisionLabel({ id, title, action }, record) {
  const copyTitle = `${record.notes.find((entry) => entry.id === id)?.before.title || "Untitled"} (before Claude)`;
  if (action === "out-of-trash") return `${title} comes out of Trash`;
  if (action === "already-back") return `${title} is already back and stays as it is`;
  if (action === "copy-purged") return `${title} was deleted permanently; it comes back as “${copyTitle}”`;
  if (action === "copy") return `${title} stays as it is now; its earlier version comes back as “${copyTitle}”`;
  if (action === "left-relinked") return `${title} stays as it is (its link opens the merged note)`;
  return `${title} stays as it is`;
}
function description(record, confirm = false) {
  const content = record.notes.find((entry) => entry.role === "content"), title = content && noteTitle(content.before);
  const sources = record.notes.filter((entry) => entry.role === "trashed").map((entry) => noteTitle(entry.before)).join(", ");
  // An exact-duplicate merge left the kept note untouched, so the record holds only the sources.
  if (record.kind === "merge") return confirm ? `Separate the merged notes again: ${title ? `${title} gets its earlier content back and ` : ""}${sources} comes out of Trash. If notes changed since, nothing is overwritten: you'll see what Undo can do first.` : title ? `Merge into “${title}”: ${title}, ${sources}` : `Merge: ${sources} moved to Trash`;
  if (record.kind === "split") return confirm ? `Put “${title}” back together; ${record.createdNotes.length === 1 ? "the new note moves" : `the ${record.createdNotes.length} new notes move`} to Trash. If notes changed since, nothing is overwritten: you'll see what Undo can do first.` : `Split “${title}” into ${record.createdNotes.length} new ${record.createdNotes.length === 1 ? "note" : "notes"}`;
  const titles = record.notes.map((entry) => noteTitle(entry.before)).join(", ");
  return confirm ? `Restore the earlier version of ${titles}. ${allowsPartialUndo(record) ? "If notes changed since, you can undo only the unchanged notes." : "If it changed since, you can restore a new copy instead."}` : titles;
}
export default function ClaudeUndo({ changeId, settings = false, run, queue, refresh, disabled, onRestored }) {
  const [record, setRecord] = useState(null), [confirm, setConfirm] = useState(false), [conflict, setConflict] = useState(false), [message, setMessage] = useState("");
  useEffect(() => {
    const subscription = liveQuery(() => db.prefs.get("claudeLastChange")).subscribe({ next: (row) => setRecord(row?.value ?? null), error: () => setRecord(null) });
    return () => subscription.unsubscribe();
  }, []);
  const current = isClaudeChange(record) && (!changeId || record.changeId === changeId);
  const undo = (id = record.changeId, unchangedOnly = false, keepEdits = false) => run(async () => {
    await queue?.flush();
    const result = await undoClaudeChange(id, { unchangedOnly, keepEdits, ...(keepEdits ? { expected: conflict.decisions } : {}) });
    setConfirm(false);
    if (result.conflict) setConflict({ id, ...result, changedAgain: keepEdits });
    else {
      setConflict(false);
      setMessage(result.keepEdits ? "Undone, keeping later changes. Earlier content restored as copies where needed." : result.kind === "merge" ? "Merge undone." : result.kind === "split" ? "Split undone." : unchangedOnly ? `Restored ${result.restored} unchanged ${result.restored === 1 ? "note" : "notes"}.${result.skipped.length ? ` Left as they are${record.kind === "links" ? " (their links stay)" : ""}: ${result.skipped.map((note) => note.title).join(", ")}.` : ""}` : "Earlier version restored.");
      await refresh(); onRestored?.();
    }
  });
  const copies = () => run(async () => {
    await queue?.flush();
    await restoreClaudeCopies(conflict.id);
    setConflict(false); setMessage("Earlier versions restored as new notes."); await refresh(); onRestored?.();
  });
  return <div className="space-y-2 text-sm">
    {current && <>
      {settings && <p>{new Date(record.at).toLocaleString("en-GB")} · {description(record)}</p>}
      <button className="app-button" disabled={disabled} onClick={() => settings ? setConfirm(record.changeId) : undo()}>{settings ? "Undo Claude's last change" : "Undo"}</button>
      {conflict?.id === record.changeId && <div role="status" className="space-y-2">{conflict.keepEdits ? <>
        <p>Some notes changed after Claude's {record.kind}. Undo won't overwrite anything:</p>
        {conflict.changedAgain && <p>Something changed again; check the list.</p>}
        <ul className="list-disc space-y-2 pl-5">{conflict.decisions.map((decision) => <li key={decision.id}>{decisionLabel(decision, record)}</li>)}</ul>
        <button className="app-button" disabled={disabled} onClick={() => undo(conflict.id, false, true)}>Undo, keeping later changes</button>
      </> : <><p>A note changed after Claude's edit. Your later edits will be kept.</p>{conflict.partial ? <button className="app-button" disabled={disabled} onClick={() => undo(conflict.id, true)}>Undo the {conflict.unchanged} unchanged {conflict.unchanged === 1 ? "note" : "notes"}</button> : <button className="app-button" disabled={disabled} onClick={copies}>Restore the earlier versions as new notes</button>}</>}</div>}
    </>}
    {message && <p role="status">{message}</p>}
    {current && confirm === record.changeId && <Confirm title="Undo Claude's last change?" confirmLabel="Undo" busy={disabled} onCancel={() => setConfirm(false)} onConfirm={() => undo(confirm)}>{description(record, true)}</Confirm>}
  </div>;
}
