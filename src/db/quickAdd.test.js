import Dexie from "dexie";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db, notebookAccess, ReadOnlyNotebookError, NotebookReplacedError } from "./db.js";
import { quickAddToNote } from "./quickAdd.js";
import { createNote, updateNote, trashNote, NoteChangedElsewhereError } from "./notes.js";
import { resetDatabase, AT } from "../test/fixtures.js";

beforeEach(resetDatabase);
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it("bumps rev and Edited, and recomputes text and links from the complete body", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(AT));
  const note = await createNote({ html: '<p><a href="note:target">Kept link</a></p>' });
  await db.notes.update(note.id, { text: "stale", linkedIds: ["stale"] });
  vi.setSystemTime(Date.now() + 1000);
  const added = await quickAddToNote(note.id, "Fresh");
  expect(added).toMatchObject({ rev: note.rev + 1, createdAt: note.createdAt, linkedIds: ["target"], text: "Inbox\nFresh\nKept link" });
  expect(added.updatedAt).not.toBe(note.updatedAt);
  expect(await db.notes.get(note.id)).toEqual(added);
});
it("keeps both additions newest first and refuses a stale save afterwards", async () => {
  const note = await createNote();
  await quickAddToNote(note.id, "First");
  const second = await quickAddToNote(note.id, "Second");
  expect(second.rev).toBe(note.rev + 2);
  expect(second.html).toContain("<ul><li><p>Second</p></li><li><p>First</p></li></ul>");
  await expect(updateNote(note.id, { html: "<p>Stale</p>" }, { expectedRev: note.rev })).rejects.toBeInstanceOf(NoteChangedElsewhereError);
  expect((await db.notes.get(note.id)).html).toBe(second.html);
});
it("honours the note's date switch", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 26, 12));
  const note = await createNote();
  await updateNote(note.id, { addDate: true });
  expect((await quickAddToNote(note.id, "Reminder")).html).toContain("26 Oct — Reminder");
});
it("refuses missing and trashed notes", async () => {
  await expect(quickAddToNote("missing", "Text")).rejects.toThrow("That note is no longer available.");
  const note = await createNote(); await trashNote(note.id);
  const before = await db.notes.get(note.id);
  await expect(quickAddToNote(note.id, "Text")).rejects.toThrow("That note is no longer available.");
  expect(await db.notes.get(note.id)).toEqual(before);
});
it("refuses a replaced notebook without changing its notes", async () => {
  const note = await createNote();
  await db.prefs.put({ key: "notebookGeneration", value: "replacement" });
  await expect(quickAddToNote(note.id, "Text")).rejects.toBeInstanceOf(NotebookReplacedError);
  expect(await db.notes.get(note.id)).toEqual(note);
});
it("refuses a newer notebook without changing its notes", async () => {
  const note = await createNote(); db.close();
  const newer = new Dexie(db.name);
  newer.version(7).stores({ notes: "id, updatedAt, deletedAt, *tags, *linkedIds", folders: "id, position", tombstones: "id", prefs: "key", files: "id, unusedSince", fileData: "id" });
  try { await newer.open(); } finally { newer.close(); }
  await notebookAccess.load();
  await expect(quickAddToNote(note.id, "Text")).rejects.toBeInstanceOf(ReadOnlyNotebookError);
  expect(await db.notes.get(note.id)).toEqual(note);
});
