import { db, writeTransaction } from "./db.js";
import { writeNoteInTransaction } from "./notes.js";
import { quickAddHtml } from "../lib/quickAdd.js";

export function quickAddToNote(id, text) {
  return writeTransaction([db.notes, db.folders, db.files], async () => {
    const note = await db.notes.get(id);
    if (!note || note.deletedAt !== null) throw new Error("That note is no longer available.");
    return writeNoteInTransaction(note, { html: quickAddHtml(note.html, text, { date: !!note.addDate }) });
  });
}
