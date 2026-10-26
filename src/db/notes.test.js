import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db, allPrefs, delPref, getPref, setPref } from "./db.js";
import { withoutCollapse, isContentEdit, createNote, updateNote, getNote, setPinned, trashNote, restoreNote, purgeExpired, liveNotes, trashedNotes, backlinksFor, TRASH_RETENTION_MS } from "./notes.js";
import { createFolder } from "./folders.js";
import { AT, resetDatabase } from "../test/fixtures.js";

beforeEach(resetDatabase);
afterEach(() => vi.useRealTimers());
function clock(at = AT) { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at)); }

it("declares only the approved stores and indexes", () => {
  expect(db.tables.map((table) => table.name).sort()).toEqual(["fileData", "files", "folders", "notes", "prefs", "tombstones"]);
  expect(db.notes.schema.indexes.map((index) => index.src)).toEqual(["updatedAt", "deletedAt", "*tags", "*linkedIds"]);
});
it("creates a complete note and derives text and outgoing links", async () => {
  clock();
  const note = await createNote({ title: "Title", html: '<h1>Hola</h1><p><a href="note:target">Target</a></p>' });
  expect(await getNote(note.id)).toEqual(note);
  expect(note).toMatchObject({ title: "Title", text: "Hola\nTarget", linkedIds: ["target"], folderId: null, tags: [], pinned: false, rev: 1, createdAt: AT, updatedAt: AT, deletedAt: null });
  expect(await liveNotes()).toEqual([note]);
  expect(await trashedNotes()).toEqual([]);
});
it.each(["title", "html", "folderId", "tags"])("bumps recency and rev for %s edits", async (field) => {
  clock();
  const folder = await createFolder("Folder");
  const note = await createNote();
  const value = { title: "Changed", html: "<p>Changed</p>", folderId: folder.id, tags: ["changed"] }[field];
  vi.setSystemTime(Date.now() + 1000);
  const next = await updateNote(note.id, { [field]: value });
  expect(next.rev).toBe(2);
  expect(next.updatedAt).not.toBe(note.updatedAt);
  expect(next.createdAt).toBe(note.createdAt);
  expect((await updateNote(note.id, { [field]: value })).updatedAt).toBe(next.updatedAt);
});
it("saves and syncs a collapsed or expanded list line without moving Edited", async () => {
  clock();
  const open = "<ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li></ul>";
  const shut = open.replace("<ul><li>", '<ul><li data-collapsed="true">');
  const note = await createNote({ html: open });
  vi.setSystemTime(Date.now() + 1000);
  const collapsed = await updateNote(note.id, { html: shut });
  expect(collapsed.html).toBe(shut);
  expect(collapsed.rev).toBe(note.rev + 1);
  expect(collapsed.updatedAt).toBe(note.updatedAt);
  vi.setSystemTime(Date.now() + 1000);
  const typed = await updateNote(note.id, { html: shut.replace("Child", "Children") });
  expect(typed.updatedAt).not.toBe(note.updatedAt);
});
it("treats only li and heading attributes as a collapse, never the same words in text or links", () => {
  expect(withoutCollapse('<ul><li data-checked="true" data-collapsed="true" data-type="taskItem"><p>a</p></li></ul>'))
    .toBe('<ul><li data-checked="true" data-type="taskItem"><p>a</p></li></ul>');
  for (const tag of ["h1", "h2", "h3"]) {
    const open = `<${tag} style="line-height: 2;">Title</${tag}><p>Section</p>`;
    const folded = open.replace(' style=', ' data-collapsed="true" style=');
    expect(withoutCollapse(folded)).toBe(open);
    expect(isContentEdit({ html: folded }, { html: open })).toBe(false);
    expect(withoutCollapse(`<p>&lt;${tag} data-collapsed="true"&gt;</p>`)).toBe(`<p>&lt;${tag} data-collapsed="true"&gt;</p>`);
  }
  const text = '<p> data-collapsed="true" &lt;li data-collapsed="true"&gt;</p>';
  expect(withoutCollapse(text)).toBe(text);
  const link = '<p><a href="https://example.com/?x=%22%20data-collapsed=%22true">l</a></p>';
  expect(withoutCollapse(link)).toBe(link);
  expect(isContentEdit({ pinned: true }, { pinned: false })).toBe(false);
  expect(isContentEdit({ html: "<p>b</p>" }, { html: "<p>a</p>" })).toBe(true);
});
it("normalises tags, derives from HTML, and protects immutable/derived fields", async () => {
  const note = await createNote();
  const next = await updateNote(note.id, { tags: [" uno ", "uno", "", "dos"], html: '<p>Text <a href="note:a">A</a></p>' });
  expect(next.tags).toEqual(["uno", "dos"]);
  expect(next.text).toBe("Text A");
  expect(next.linkedIds).toEqual(["a"]);
  for (const key of ["id", "rev", "text", "linkedIds", "updatedAt", "createdAt"]) {
    await expect(updateNote(note.id, { [key]: "bad" })).rejects.toThrow("Cannot edit");
  }
  await expect(updateNote(note.id, { tags: [4] })).rejects.toThrow();
  await expect(updateNote(note.id, { html: null })).rejects.toThrow();
  await expect(updateNote("missing", {})).rejects.toThrow("does not exist");
  await expect(createNote({ folderId: "missing" })).rejects.toThrow("Folder does not exist");
});
it("pins, trashes and restores without changing recency, and retains links while trashed", async () => {
  clock();
  const target = await createNote();
  const source = await createNote({ html: `<p><a href="note:${target.id}">Target</a></p>` });
  vi.setSystemTime(Date.now() + 1000);
  expect(await setPinned(target.id, true)).toMatchObject({ rev: 2, pinned: true, updatedAt: AT });
  expect(await trashNote(target.id)).toMatchObject({ rev: 3, updatedAt: AT });
  expect((await liveNotes()).map((note) => note.id)).toEqual([source.id]);
  expect((await trashedNotes()).map((note) => note.id)).toEqual([target.id]);
  expect((await getNote(source.id)).linkedIds).toEqual([target.id]);
  expect(await restoreNote(target.id)).toMatchObject({ rev: 4, deletedAt: null, updatedAt: AT });
  expect(await trashedNotes()).toEqual([]);
});
it("serialises concurrent read-modify-write operations without losing revisions", async () => {
  const note = await createNote();
  await Promise.all([updateNote(note.id, { title: "New title" }), setPinned(note.id, true)]);
  expect(await getNote(note.id)).toMatchObject({ title: "New title", pinned: true, rev: 3 });
});
it("purges strictly after 30 days, leaves tombstones, and neutralises live links atomically", async () => {
  clock();
  const old = await createNote();
  const boundary = await createNote();
  await trashNote(old.id);
  vi.setSystemTime(Date.now() + 1);
  await trashNote(boundary.id);
  const html = `<p><a class="kept" href="note:${old.id}"><b>Old</b></a> <a href="note:${boundary.id}">Boundary</a></p>`;
  const source = await createNote({ html });
  const trashedSource = await createNote({ html });
  await trashNote(trashedSource.id);
  const now = new Date(Date.parse(AT) + TRASH_RETENTION_MS + 1);
  expect(await purgeExpired(now)).toBe(1);
  expect(await getNote(old.id)).toBeUndefined();
  expect(await db.tombstones.get(old.id)).toEqual({ id: old.id, purgedAt: now.toISOString() });
  expect(await getNote(source.id)).toMatchObject({ html: `<p><a class="kept"><b>Old</b></a> <a href="note:${boundary.id}">Boundary</a></p>`, linkedIds: [boundary.id], text: "Old Boundary", rev: 2, updatedAt: source.updatedAt });
  expect((await getNote(trashedSource.id)).html).toBe(html);
  expect((await restoreNote(trashedSource.id)).linkedIds).toEqual([boundary.id]);
  expect(await purgeExpired(now)).toBe(0);
});
it("returns only live backlinks and updates the link index after edits", async () => {
  const target = await createNote();
  const a = await createNote({ html: `<a href="note:${target.id}">A</a>` });
  const b = await createNote({ html: `<a href="note:${target.id}">B</a>` });
  await trashNote(b.id);
  expect((await backlinksFor(target.id)).map((note) => note.id)).toEqual([a.id]);
  await updateNote(a.id, { html: "<p>Unlinked</p>" });
  expect(await backlinksFor(target.id)).toEqual([]);
});
it("orders live notes newest first and handles preferences", async () => {
  clock();
  const a = await createNote();
  vi.setSystemTime(Date.now() + 1000);
  const b = await createNote();
  expect((await liveNotes()).map((note) => note.id)).toEqual([b.id, a.id]);
  expect(await getPref("toolbar")).toBeUndefined();
  await setPref("toolbar", ["bold"]);
  await setPref("storagePersisted", false);
  expect(await allPrefs()).toEqual({ toolbar: ["bold"], storagePersisted: false });
  await delPref("toolbar");
  expect(await getPref("toolbar")).toBeUndefined();
});

it("purgeNow refuses a live note and rolls back deletion if tombstone creation fails", async () => {
  const { purgeNow } = await import("./notes.js");
  const target = await createNote();
  await expect(purgeNow(target.id)).rejects.toThrow("Move the note to Trash");
  await trashNote(target.id);
  const tombstones = vi.spyOn(db.tombstones, "bulkPut").mockRejectedValueOnce(new Error("Disk full"));
  await expect(purgeNow(target.id)).rejects.toThrow("Disk full");
  expect(await getNote(target.id)).toBeTruthy();
  expect(await db.tombstones.get(target.id)).toBeUndefined();
  tombstones.mockRestore();
  expect(await purgeNow(target.id)).toBe(1);
  await expect(purgeNow(target.id)).rejects.toThrow("does not exist");
});

it("defaults Quick add switches off and saves them without moving Edited", async () => {
  clock();
  const note = await createNote();
  expect(note).toMatchObject({ quickAdd: false, addDate: false });
  vi.setSystemTime(Date.now() + 1000);
  const next = await updateNote(note.id, { quickAdd: true, addDate: true });
  expect(next).toMatchObject({ quickAdd: true, addDate: true, rev: note.rev + 1, updatedAt: note.updatedAt });
  expect(isContentEdit({ quickAdd: true, addDate: true }, note)).toBe(false);
});
it.each(["quickAdd", "addDate"])("requires boolean %s", async (field) => {
  const note = await createNote();
  for (const value of [null, undefined, 1, "true", {}]) await expect(updateNote(note.id, { [field]: value })).rejects.toThrow(`${field} must be a boolean`);
});
