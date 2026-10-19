import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { db, notebookAccess } from "./db.js";
import * as notes from "./notes.js";
import { createFolder, deleteFolder } from "./folders.js";
import { applyClaudeChanges, undoClaudeChange } from "./claudeChanges.js";
import { SaveQueue } from "../lib/saveQueue.js";
import { resetDatabase } from "../test/fixtures.js";

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());
const conflict = (error, id, patch) => {
  if (!(error instanceof notes.NoteChangedElsewhereError)) throw error;
  return notes.createConflictCopy(id, patch);
};
function windowQueue(note, options = {}) {
  const queue = new SaveQueue({ save: notes.updateNote, resolveConflict: conflict, ...options });
  queue.setKnownRev(note.id, note.rev);
  return queue;
}
const planFor = (note, patch) => ({ generation: notebookAccess.getGeneration(), notes: [{ id: note.id, expectedRev: note.rev, patch }] });

it.each(["edit", "tidy", "merge", "undo", "trash", "purge"])("preserves both windows after B's %s; flush succeeds and later typing follows the copy", async (kind) => {
  const original = await notes.createNote({ title: "Original", html: "<p>Before</p>" });
  const a = windowQueue(original), b = windowQueue(original), events = [];
  a.onConflict((event) => events.push(event));
  if (kind === "edit") { b.schedule(original.id, { html: "<p>B</p>" }); await b.flush(); }
  if (["tidy", "merge", "undo"].includes(kind)) {
    const plan = planFor(original, { html: "<p>B</p>" });
    if (kind === "merge") {
      const source = await notes.createNote({ title: "Source" });
      plan.kind = "merge"; plan.notes[0].role = "content";
      plan.notes.push({ id: source.id, expectedRev: source.rev, role: "trashed", patch: { deletedAt: new Date().toISOString() } });
    }
    const result = await applyClaudeChanges(plan);
    if (kind === "undo") await undoClaudeChange(result.changeId);
  }
  if (["trash", "purge"].includes(kind)) {
    await notes.trashNote(original.id);
    if (kind === "purge") await notes.purgeNow(original.id);
  }
  const savedB = await notes.getNote(original.id);
  a.schedule(original.id, { title: "My draft", html: "<p>A</p>" });
  await expect(a.flush()).resolves.toBeUndefined();
  expect(await notes.getNote(original.id)).toEqual(savedB);
  expect(events).toHaveLength(1);
  const { copyId } = events[0];
  expect(events[0]).toEqual({ noteId: original.id, copyId, copyTitle: "My draft (conflict copy)" });
  expect(await notes.getNote(copyId)).toMatchObject({ title: "My draft (conflict copy)", html: "<p>A</p>", rev: 1, deletedAt: null, pinned: false });
  a.schedule(original.id, { html: "<p>A later</p>" }); await a.flush();
  expect(await notes.getNote(copyId)).toMatchObject({ html: "<p>A later</p>", rev: 2 });
  expect(await notes.getNote(original.id)).toEqual(savedB);
});
it("checks expected revisions without writing and keeps unguarded updateNote behavior", async () => {
  const note = await notes.createNote();
  await expect(notes.updateNote(note.id, { title: "Stale" }, { expectedRev: 0 })).rejects.toBeInstanceOf(notes.NoteChangedElsewhereError);
  expect(await notes.getNote(note.id)).toEqual(note);
  await expect(notes.updateNote("missing", { title: "Stale" }, { expectedRev: 1 })).rejects.toBeInstanceOf(notes.NoteChangedElsewhereError);
  expect(await notes.updateNote(note.id, { title: "Allowed" })).toMatchObject({ rev: 2, title: "Allowed" });
  await expect(notes.updateNote("missing", {})).rejects.toThrow("Note does not exist");
});
it("same-window content, pin, tags and folder saves advance the known revision", async () => {
  const note = await notes.createNote(), folder = await createFolder("Folder"), queue = windowQueue(note), listener = vi.fn();
  queue.onConflict(listener);
  for (const patch of [...Array.from({ length: 10 }, (_, n) => ({ html: `<p>${n}</p>` })), { pinned: true }, { tags: ["tag"] }, { folderId: folder.id }, { title: "Done" }]) {
    queue.schedule(note.id, patch); await queue.flush();
  }
  expect(listener).not.toHaveBeenCalled();
  expect(await notes.getNote(note.id)).toMatchObject({ rev: 15, title: "Done", pinned: true, tags: ["tag"], folderId: folder.id });
  expect(await db.notes.count()).toBe(1);
});
it("copies can conflict again, and reopening the original clears its redirect", async () => {
  const note = await notes.createNote({ title: "Original" }), a = windowQueue(note), events = [];
  a.onConflict((event) => events.push(event));
  await notes.updateNote(note.id, { title: "B" });
  a.schedule(note.id, { html: "<p>A</p>" }); await a.flush();
  const first = await notes.getNote(events[0].copyId), c = windowQueue(first);
  c.schedule(first.id, { html: "<p>C</p>" }); await c.flush();
  a.schedule(note.id, { html: "<p>A again</p>" }); await a.flush();
  expect(events).toHaveLength(2);
  expect(events[1].noteId).toBe(note.id);
  expect(await notes.getNote(first.id)).toMatchObject({ html: "<p>C</p>" });
  expect(await notes.getNote(events[1].copyId)).toMatchObject({ html: "<p>A again</p>" });
  a.setKnownRev(note.id, (await notes.getNote(note.id)).rev);
  a.schedule(note.id, { title: "Reopened" }); await a.flush();
  expect(await notes.getNote(note.id)).toMatchObject({ title: "Reopened" });
  expect(events).toHaveLength(2);
});
it("preserves keystrokes queued while conflict recovery is in flight", async () => {
  const note = await notes.createNote(), b = windowQueue(note);
  b.schedule(note.id, { title: "B" }); await b.flush();
  let release, started;
  const ready = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const a = windowQueue(note, { resolveConflict: async (...args) => { started(); await gate; return conflict(...args); } }), events = [];
  a.onConflict((event) => events.push(event));
  a.schedule(note.id, { html: "<p>First</p>" }); const flushing = a.flush();
  await ready; a.schedule(note.id, { html: "<p>Last</p>", tags: ["later"] }); release();
  await flushing;
  expect(await notes.getNote(events[0].copyId)).toMatchObject({ html: "<p>Last</p>", tags: ["later"], rev: 2 });
});
it("cleans tombstones and missing folders, overlays only draft fields, and unpins copies", async () => {
  const folder = await createFolder("Old"), target = await notes.createNote();
  const original = await notes.createNote({ title: "Stored", folderId: folder.id });
  await notes.updateNote(original.id, { pinned: true, tags: ["stored"] });
  const note = await notes.getNote(original.id), a = windowQueue(note), events = [];
  a.onConflict((event) => events.push(event));
  await deleteFolder(folder.id); await notes.trashNote(target.id); await notes.purgeNow(target.id);
  a.schedule(note.id, { html: `<p><a href="note:${target.id}">Gone</a></p>`, folderId: folder.id }); await a.flush();
  expect(await notes.getNote(events[0].copyId)).toMatchObject({ title: "Stored (conflict copy)", folderId: null, tags: ["stored"], pinned: false, linkedIds: [], text: "Gone" });
  expect((await notes.getNote(events[0].copyId)).html).not.toContain("note:");
});
it("a missing note starts the copy with an empty body and an Untitled fallback", async () => {
  const note = await notes.createNote({ title: "Old" }), queue = windowQueue(note), events = [];
  queue.onConflict((event) => events.push(event));
  await notes.trashNote(note.id); await notes.purgeNow(note.id);
  queue.schedule(note.id, { tags: ["draft"] }); await queue.flush();
  expect(await notes.getNote(events[0].copyId)).toMatchObject({ title: "Untitled (conflict copy)", html: "<p></p>", folderId: null, tags: ["draft"] });
});
it("replacement guards take precedence over conflict recovery", async () => {
  const note = await notes.createNote(), recovery = vi.fn(conflict), queue = windowQueue(note, { resolveConflict: recovery });
  await db.prefs.put({ key: "notebookGeneration", value: "replacement" });
  queue.schedule(note.id, { title: "Old notebook draft" });
  await expect(queue.flush()).rejects.toThrow();
  expect(await notes.getNote(note.id)).toEqual(note); expect(await db.notes.count()).toBe(1);
  expect(recovery).toHaveBeenCalledTimes(1);
  expect(recovery.mock.calls[0][0]).not.toBeInstanceOf(notes.NoteChangedElsewhereError);
});
