import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import Sources from "./Sources.jsx";
import { db, notebookAccess } from "../db/db.js";
import { createNote, updateNote } from "../db/notes.js";
import { applyClaudeChanges, undoClaudeChange } from "../db/claudeChanges.js";
import { captureNotePayload } from "../claude/payload.js";
import { resetDatabase, AT } from "../test/fixtures.js";

beforeEach(resetDatabase);
afterEach(() => { cleanup(); vi.useRealTimers(); });
it.each(["undo", "pin"])("a source captured after tidy shows the right edit label after %s", async (change) => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(AT));
  const note = await createNote({ title: "Source", html: "<p>Before</p>" });
  vi.setSystemTime(Date.now() + 1000);
  const { changeId } = await applyClaudeChanges({ generation: notebookAccess.getGeneration(), notes: [{ id: note.id, expectedRev: note.rev, patch: { html: "<p>Tidied</p>" } }] });
  const payload = await captureNotePayload(note.id);
  vi.setSystemTime(Date.now() + 1000);
  if (change === "undo") await undoClaudeChange(changeId);
  else await updateNote(note.id, { pinned: true });
  render(<Sources sources={[{ number: 1, noteId: note.id, title: "Source", quotes: ["Tidied"] }]} payload={payload} notes={[await db.notes.get(note.id)]} trash={[]} folders={[]} openNote={() => {}} />);
  if (change === "undo") expect(screen.getByText("Edited since Claude read it")).toBeTruthy();
  else expect(screen.queryByText("Edited since Claude read it")).toBeNull();
});
