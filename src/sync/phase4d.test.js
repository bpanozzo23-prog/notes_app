import Dexie, { RangeSet } from "dexie";
import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { db, notebookAccess, writeTransaction, getPref } from "../db/db.js";
import { createNote, updateNote, trashNote, restoreNote, purgeNow, purgeExpired } from "../db/notes.js";
import { createFolder, renameFolder } from "../db/folders.js";
import { cleanupFiles, FILE_RETENTION_MS } from "../db/files.js";
import { buildBackup, importBackup, validateBackup, IGNORED_PREFS } from "../db/backup.js";
import { applyClaudeChanges, claudePlanIsCurrent, isClaudeChange, undoClaudeChange, restoreClaudeCopies, STALE_PROPOSAL } from "../db/claudeChanges.js";
import { resetDatabase, AT, noteFixture, backupFixture } from "../test/fixtures.js";
import { buildInbox, readInboxSnapshot, dismissProposal, pendingProposals, keepBothModel, handledEntry } from "./inbox.js";
import { inboxPlan, keepBothPlan, linkIntoTrashError } from "./plan.js";
import { readOutbox, readHandled, appendHandledInTransaction, acknowledgeOutbox, saveConnection, SYNC_PREFS } from "./prefs.js";
import { proposalFixture, newProposalFixture, trashProposalFixture } from "./inbox-fixtures.js";
import { runSyncRound, captureNotebook } from "./round.js";
import { syncSession } from "./session.js";
import { affectsSync } from "./changes.js";
import { syncFixture } from "./test-support.js";
import { readProposals } from "../../server/proposals.mjs";

beforeEach(async () => { await resetDatabase(); syncSession.reset(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); syncSession.reset(); });
const build = async (versions) => buildInbox(versions, await readInboxSnapshot());
const planFor = async (versions) => { const cards = await build(versions); return inboxPlan(cards, cards.flatMap((card) => card.ids), notebookAccess.getGeneration()); };
const undoRecord = () => getPref("claudeLastChange");
const snapshot = async () => ({ notes: await db.notes.toArray(), folders: await db.folders.toArray(), prefs: await db.prefs.toArray(), files: await db.files.toArray() });
const picture = async (id = "image") => db.files.put({ id, type: "image/png", size: 1, width: 1, height: 1, createdAt: AT, unusedSince: AT });

it("models all three kinds, a new note's effects and Trash backlinks", async () => {
  const source = await createNote({ title: "Source", html: '<p>Original</p><img data-file="image">' });
  await createNote({ title: "Backlink", html: `<p><a href="note:${source.id}">Source</a></p>` });
  const trashedLink = await createNote({ title: "Hidden backlink", html: `<p><a href="note:${source.id}">Source</a></p>` }); await trashNote(trashedLink.id);
  const [edit, fresh] = await build([proposalFixture(source, { title: "Better" }), newProposalFixture({ body: `<h2>New</h2><p><a href="note:${source.id}">Source</a> <a href="https://example.com/full/path">web</a></p><img data-file="image">` })]);
  expect(edit).toMatchObject({ kind: "edit", title: "Better", stale: false });
  expect(fresh).toMatchObject({ kind: "new", title: "New fixture", tags: ["new"], folder: { action: "none" }, stale: false });
  expect(fresh.html.endsWith("<p></p>")).toBe(true);
  expect(fresh.effects).toEqual(expect.arrayContaining([{ type: "image-added", id: "image" }, { type: "note-link-added", href: `note:${source.id}` }, { type: "web-link-added", href: "https://example.com/full/path" }]));
  expect(fresh.ids).toEqual([`${fresh.version.proposal}:${fresh.version.hash}:note`]);
  const [trash] = await build([trashProposalFixture(source)]);
  expect(trash).toMatchObject({ kind: "trash", html: source.html, backlinks: ["Backlink"], stale: false });
  expect(trash.ids).toEqual([`${trash.version.proposal}:${trash.version.hash}:trash`]);
});
it("uses typed keys, latest wins across edit/Trash and by new pid, with exact version hiding", () => {
  const note = noteFixture({ id: "p-new-fixture" }), edit = proposalFixture(note), trash = trashProposalFixture(note), fresh = newProposalFixture();
  const later = { ...fresh, hash: "d".repeat(64), sequence: 4 };
  expect(pendingProposals([fresh, edit])).toHaveLength(2);
  expect(pendingProposals([edit, fresh, trash, later])).toEqual([trash, later]);
  expect(pendingProposals([edit, fresh, trash, later], [], [handledEntry(later, null, "applied")])).toEqual([trash]);
});

const shapes = ["edit", "new", "trash"];
const shape = (kind, note = noteFixture()) => kind === "new" ? newProposalFixture() : kind === "trash" ? trashProposalFixture(note) : proposalFixture(note);
it.each(shapes)("rechecks every required field and rejects extras for %s", async (kind) => {
  const note = await createNote({ html: "<p>Body</p>" }), valid = shape(kind, note);
  expect((await build([valid]))[0].invalid).toBeUndefined();
  for (const key of Object.keys(valid)) {
    const broken = { ...valid }; delete broken[key];
    const cards = await build([broken]);
    if (key !== "status") expect(cards[0]?.invalid, `missing ${key}`).toBe(true);
  }
  for (const extra of [{ extra: true }, { pinned: true }, { deletedAt: AT }, ...(kind === "trash" ? [{ body: "<p>Body</p>" }, { title: "No" }, { tags: [] }, { folderId: null }, { newFolder: "No" }] : [{ trash: false }, { trash: true }])]) {
    const [card] = await build([{ ...valid, ...extra }]); expect(card.invalid).toBe(true); expect(card.ids).toEqual([]);
  }
});
it.each(shapes)("checks common value types and limits for %s", async (kind) => {
  const note = await createNote({ html: "<p>Body</p>" });
  for (const invalid of [{ generation: 3 }, { generation: {} }, { why: null }, { why: "x".repeat(301) }, { sequence: "1" }, { hash: "wrong" }, { proposal: "wrong" }, { ingestedAt: "wrong" },
    ...(kind !== "new" ? [{ note: "" }, { note: {} }, { basedOnRev: 0 }, { basedOnRev: 1.5 }, { basedOnRev: "1" }] : [{ basedOnRev: 1 }]),
    ...(kind === "trash" ? [{ trash: "true" }, { trash: false }] : [{ body: null }, { body: "é".repeat(262145) }, { title: "\nNo" }, { title: " ".repeat(201) }, { title: 2 }, { tags: "tag" }, { tags: [" a"] }, { tags: ["a", "a"] }, { tags: ["\u0000"] }, { tags: Array(51).fill("tag") }, { tags: ["x".repeat(513)] }, { folderId: {} }, { newFolder: " " }, { newFolder: " F" }, { newFolder: "F\u0000" }, { newFolder: "x".repeat(513) }, { newFolder: "F", folderId: "folder" }, { tags: Array.from({ length: 40 }, (_, i) => `${i}${"x".repeat(500)}`) }])]) {
    const [card] = await build([{ ...shape(kind, note), ...invalid }]); expect(card.invalid, JSON.stringify(invalid).slice(0, 100)).toBe(true);
  }
});
it.each(["<p></p>", "<script>bad()</script>", '<img data-file="foreign">'])("rejects a new note without text or an allowed image: %s", async (body) => {
  expect((await build([newProposalFixture({ body })]))[0].invalid).toBe(true);
});
it("new-note staleness depends only on generation, while Trash uses rev, Trash and absence", async () => {
  const note = await createNote();
  for (const extra of [{}, { generation: "old" }]) expect((await build([newProposalFixture(extra)]))[0].stale).toBe(!!extra.generation);
  const trash = trashProposalFixture(note);
  await updateNote(note.id, { title: "Later" }); expect((await build([trash]))[0].stale).toBe(true);
  await trashNote(note.id); expect((await build([trash]))[0].stale).toBe(true);
  await purgeNow(note.id); expect((await build([trash]))[0].stale).toBe(true);
});

it("resolves ids independently of duplicate names, resolves new names once, and rejects ambiguous/missing folders", async () => {
  await db.folders.bulkPut([{ id: "one", name: "Recipes", position: 0 }, { id: "two", name: "recipes", position: 1 }]);
  expect((await build([newProposalFixture({ folderId: "two" })]))[0].folder).toEqual({ action: "existing", id: "two", name: "recipes" });
  expect((await build([newProposalFixture({ newFolder: "RECIPES" })]))[0].invalid).toBe(true);
  expect((await build([newProposalFixture({ folderId: "missing" })]))[0].invalid).toBe(true);
  await db.folders.delete("two");
  const plan = await planFor([newProposalFixture({ newFolder: "recipes" })]);
  expect(plan.createFolders).toEqual([]); expect(plan.expectedNewFolders).toEqual([]);
  expect(plan.nameReuseChecks).toEqual([{ id: "one", name: "Recipes" }]);
  await db.folders.put({ id: "three", name: "RECIPES", position: 1 });
  expect(await claudePlanIsCurrent(plan)).toBe(false); await expect(applyClaudeChanges(plan)).rejects.toThrow(STALE_PROPOSAL);
});
it("refuses a folder appearing during review then rebuilds for reuse; unticked changes create/check no new folder", async () => {
  const note = await createNote({ title: "Old" }), version = proposalFixture(note, { title: "New", newFolder: "Recipes" });
  const cards = await build([version]), plan = inboxPlan(cards, cards[0].ids, null);
  const folder = await createFolder("recipes");
  await expect(applyClaudeChanges(plan)).rejects.toThrow(STALE_PROPOSAL);
  const rebuilt = await planFor([version]); expect(rebuilt.createFolders).toEqual([]); expect(rebuilt.notes[0].patch.folderId).toBe(folder.id);
  const partial = inboxPlan(cards, [cards[0].ticks.title], null);
  expect(partial.createFolders).toEqual([]); expect(partial.expectedNewFolders).toEqual([]);
  await applyClaudeChanges(partial); expect((await db.notes.get(note.id)).folderId).toBeNull();
});
it("uses first spelling for a shared new folder across an edit and new note and checks source/destination folders", async () => {
  const original = await createFolder("Original"), note = await createNote({ folderId: original.id });
  const plan = await planFor([proposalFixture(note, { folderId: null, newFolder: "Recipes" }), newProposalFixture({ newFolder: "recipes" })]);
  expect(plan.createFolders).toEqual([{ name: "Recipes" }]); expect(plan.expectedNewFolders).toEqual(["Recipes"]);
  expect(plan.notes[0].patch.folderId).toEqual({ create: "Recipes" }); expect(plan.createNotes[0].folderId).toEqual({ create: "Recipes" });
  expect(plan.folderChecks).toEqual([{ id: original.id, name: original.name }]);
  await renameFolder(original.id, "Renamed"); await expect(applyClaudeChanges(plan)).rejects.toThrow(STALE_PROPOSAL);
});

it("two windows applying one new note commit one note and one Undo, even after acknowledgement", async () => {
  const cards = await build([newProposalFixture()]), first = inboxPlan(cards, cards[0].ids, null), second = inboxPlan(cards, cards[0].ids, null);
  const results = await Promise.allSettled([applyClaudeChanges(first), applyClaudeChanges(second)]);
  expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  const record = await undoRecord(); expect(await db.notes.count()).toBe(1); expect(record.createdNotes).toHaveLength(1);
  expect(await readHandled()).toEqual(first.handled); expect(await readOutbox()).toHaveLength(1);
  await acknowledgeOutbox(first.outbox);
  expect(await readOutbox()).toEqual([]); expect(await build([newProposalFixture()])).toEqual([]);
  await expect(applyClaudeChanges(second)).rejects.toThrow(STALE_PROPOSAL);
  expect(await undoRecord()).toEqual(record); expect(await db.notes.count()).toBe(1);
});
it.each(["applied", "kept", "dismissed", "stale"])("a competing new-note version under a %s pid is Dismiss only", async (outcome) => {
  const old = newProposalFixture(), next = newProposalFixture({ hash: "d".repeat(64) }), waiting = await planFor([next]);
  await writeTransaction([db.prefs], () => appendHandledInTransaction([handledEntry(old, null, outcome)]));
  const [card] = await build([next]);
  expect(card.handledMessage).toBe(["applied", "kept"].includes(outcome) ? "You already added this note." : "You already dismissed this note.");
  expect(inboxPlan([card], card.ids, null).createNotes).toEqual([]);
  await expect(applyClaudeChanges(waiting)).rejects.toThrow(STALE_PROPOSAL);
  await dismissProposal(card); expect(await readHandled()).toHaveLength(2);
});
it("keeps an asleep window blocked after thousands of handled versions, and drops only other generations on the next write", async () => {
  const old = newProposalFixture(), sleeping = await planFor([old]);
  const entries = [handledEntry(old, null, "applied"), ...Array.from({ length: 1500 }, (_, i) => ({ proposal: `p-later-${i}`, hash: "a".repeat(64), generation: null, outcome: "dismissed" }))];
  await writeTransaction([db.prefs], () => appendHandledInTransaction(entries));
  expect(await readHandled()).toHaveLength(1501); await expect(applyClaudeChanges(sleeping)).rejects.toThrow(STALE_PROPOSAL);
  await db.prefs.put({ key: "notebookGeneration", value: "replacement" }); notebookAccess.adopt("replacement");
  const unhandled = { ...old, hash: "d".repeat(64) };
  const [stale] = await build([unhandled]); await dismissProposal(stale);
  expect(await readHandled()).toEqual([handledEntry(unhandled, "replacement", "stale")]);
});
it("Dismiss computes stale inside its transaction and rolls back the outcome if handled storage fails", async () => {
  const note = await createNote(), [card] = await build([trashProposalFixture(note)]);
  await updateNote(note.id, { title: "After review" });
  const put = db.prefs.put.bind(db.prefs), spy = vi.spyOn(db.prefs, "put").mockImplementation((row) => row.key === "syncHandled" ? Promise.reject(new Error("Full")) : put(row));
  await expect(dismissProposal(card)).rejects.toThrow("Full"); expect(await readOutbox()).toEqual([]);
  spy.mockRestore(); await dismissProposal(card);
  expect(await readHandled()).toEqual([handledEntry(card.version, null, "stale")]);
  expect((await readOutbox())[0].outcome).toBe("stale");
});
it("handled data never triggers sync, exports, syncs or enters the React session; imports preserve it", async () => {
  const entry = { ...handledEntry(newProposalFixture(), null, "dismissed"), sentinel: "HANDLED-PRIVATE-SENTINEL" };
  await writeTransaction([db.prefs], () => appendHandledInTransaction([entry]));
  expect(SYNC_PREFS).toContain("syncHandled"); expect(IGNORED_PREFS).toContain("syncHandled");
  expect(affectsSync({ "idb://notes_app/prefs/": new RangeSet().addKey("syncHandled") })).toBe(false);
  expect(JSON.stringify(await buildBackup())).not.toContain(entry.sentinel);
  expect(JSON.stringify(await captureNotebook())).not.toContain(entry.sentinel);
  syncSession.update({ syncHandled: [entry] }); expect(JSON.stringify(syncSession.getSnapshot())).not.toContain(entry.sentinel);
  const result = validateBackup(backupFixture({ preferences: { syncHandled: [entry] } }));
  expect(result.ok).toBe(true); expect(result.warnings.join(" ")).toContain("syncHandled");
  await importBackup(backupFixture()); expect(await readHandled()).toEqual([entry]);
});

async function mixed() {
  const edit = await createNote({ title: "Edited", html: "<p>Before</p>" }), trash = await createNote({ title: "Trashed", html: '<p>Keep picture</p><img data-file="image">' });
  await picture();
  const versions = [proposalFixture(edit, { title: "After", body: "<p>After</p>" }), newProposalFixture({ newFolder: "Recipes", body: '<p>New picture</p><img data-file="image">' }), trashProposalFixture(trash)];
  return { edit, trash, plan: await planFor(versions) };
}
it("commits a mixed plan's edits, new note/folder, Trash, image marks, Undo and outcomes in one transaction", async () => {
  const { edit, trash, plan } = await mixed(), transactions = [];
  for (const table of [db.notes, db.folders, db.prefs, db.files]) for (const method of ["put", "add", "update"]) {
    const original = table[method].bind(table); vi.spyOn(table, method).mockImplementation((...args) => { transactions.push(Dexie.currentTransaction); return original(...args); });
  }
  const { changeId, created } = await applyClaudeChanges(plan);
  expect(new Set(transactions).size).toBe(1);
  expect(await db.notes.get(edit.id)).toMatchObject({ title: "After", html: "<p>After</p>" });
  expect((await db.notes.get(trash.id)).deletedAt).not.toBeNull();
  expect(await db.notes.get(created[0])).toMatchObject({ pinned: false, rev: 1, tags: ["new"], folderId: expect.any(String) });
  expect((await db.files.get("image")).unusedSince).toBeNull();
  expect(await undoRecord()).toMatchObject({ kind: "xps", changeId, createdFolderNames: ["Recipes"], trashedNotes: [trash.id], createdNotes: [{ id: created[0], writtenRev: 1 }] });
  expect(await readOutbox()).toEqual(plan.outbox); expect(await readHandled()).toEqual(plan.handled);
});
it.each(["syncOutbox", "syncHandled", "claudeLastChange"])("rolls back the mixed batch and picture marks when %s fails", async (key) => {
  const { plan } = await mixed(), before = await snapshot(), put = db.prefs.put.bind(db.prefs);
  vi.spyOn(db.prefs, "put").mockImplementation((row) => row.key === key ? Promise.reject(new Error("Full")) : put(row));
  await expect(applyClaudeChanges(plan)).rejects.toThrow("Full"); expect(await snapshot()).toEqual(before);
});
it("accepts created-only xps plans and refuses empty plans and created-only plans of other kinds", async () => {
  const plan = await planFor([newProposalFixture()]); expect(await claudePlanIsCurrent(plan)).toBe(true);
  await expect(applyClaudeChanges({ ...plan, createNotes: [] })).rejects.toThrow(STALE_PROPOSAL);
  for (const kind of [undefined, "links", "merge", "split"]) await expect(applyClaudeChanges({ ...plan, kind })).rejects.toThrow(STALE_PROPOSAL);
  const result = await applyClaudeChanges(plan); expect(result).toMatchObject({ applied: 0, created: [expect.any(String)] }); expect(isClaudeChange(await undoRecord())).toBe(true);
});
it("validates moved-note xps records and rejects damaged roles, fields, copies and lists", async () => {
  const { plan } = await mixed(); await applyClaudeChanges(plan); const record = await undoRecord(); expect(isClaudeChange(record)).toBe(true);
  for (const mutate of [r => { r.notes[0].role = "content"; }, r => { r.notes[0].role = "relinked"; }, r => { r.notes[0].role = undefined; }, r => { r.notes[0].fields = ["pinned"]; },
    r => { r.notes[0].fields = ["deletedAt"]; }, r => { r.notes[1].fields.push("title"); }, r => { r.notes[1].before.deletedAt = AT; }, r => { r.trashedNotes = []; }, r => { r.trashedNotes.push(r.trashedNotes[0]); },
    r => { r.createdNotes.push(r.createdNotes[0]); }, r => { r.createdNotes[0].id = r.notes[0].id; }, r => { r.createdNotes[0].extra = true; }, r => { r.createdNotes[0].writtenRev = 0; },
    r => { r.createdFolderNames = []; }, r => { r.createdFolderNames = [4]; }, r => { r.notes = []; r.createdNotes = []; r.trashedNotes = []; }]) {
    const damaged = structuredClone(record); mutate(damaged); expect(isClaudeChange(damaged)).toBe(false);
  }
});
it.each(["new", "trash", "mixed"])("Undo as left restores %s notes and removes an unchanged unused created folder", async (kind) => {
  const { edit, trash, plan } = await mixed();
  if (kind === "new") plan.notes = [];
  if (kind === "trash") { plan.notes = plan.notes.filter((n) => n.role === "trashed"); plan.createNotes = []; plan.createFolders = []; plan.expectedNewFolders = []; }
  const { changeId, created } = await applyClaudeChanges(plan), folder = (await undoRecord()).createdFolders[0];
  await expect(restoreClaudeCopies(changeId)).rejects.toThrow("Use Undo for this change instead.");
  expect(await undoClaudeChange(changeId)).toEqual({ restored: true, kind: "xps" });
  expect((await db.notes.get(trash.id)).deletedAt).toBeNull();
  expect((await db.notes.get(edit.id)).html).toBe(edit.html);
  for (const id of created) expect(await db.notes.get(id)).toMatchObject({ deletedAt: expect.any(String), folderId: null });
  if (folder) expect(await db.folders.get(folder)).toBeUndefined();
});
it.each(["new", "trash", "mixed-edit", "mixed-new", "mixed-trash"])("Undo after one later change (%s) preserves every current body", async (kind) => {
  const { edit, trash, plan } = await mixed();
  if (kind === "new") plan.notes = [];
  if (kind === "trash") { plan.notes = plan.notes.filter((n) => n.role === "trashed"); plan.createNotes = []; plan.createFolders = []; plan.expectedNewFolders = []; }
  const { changeId, created } = await applyClaudeChanges(plan);
  const changedId = kind.endsWith("new") ? created[0] : kind.endsWith("trash") ? trash.id : edit.id;
  await updateNote(changedId, { title: "Later", html: "<p>Later words</p>" }); const before = await snapshot();
  const offer = await undoClaudeChange(changeId); expect(offer.conflict).toBe(true); expect(await snapshot()).toEqual(before);
  const done = await undoClaudeChange(changeId, { keepEdits: true, expected: offer.decisions });
  for (const old of before.notes) { const current = await db.notes.get(old.id); expect(current.html).toBe(old.html); expect(current.title).toBe(old.title); }
  expect(done.copies).toHaveLength(kind.startsWith("mixed") ? 1 : 0);
  if (done.copies.length) expect(await db.notes.get(done.copies[0])).toMatchObject({ title: "Edited (before Claude)", html: edit.html });
  expect(await db.folders.toArray()).toEqual(before.folders);
  if (kind !== "new") expect((await db.notes.get(trash.id)).deletedAt).toBeNull();
});
it("Undo rechecks the displayed xps decisions and retains renamed created folders", async () => {
  const { edit, plan } = await mixed(), { changeId } = await applyClaudeChanges(plan), record = await undoRecord();
  await renameFolder(record.createdFolders[0], "Owner's folder");
  await undoClaudeChange(changeId); expect((await db.folders.get(record.createdFolders[0])).name).toBe("Owner's folder");
  const current = await db.notes.get(edit.id), next = await planFor([proposalFixture(current, { proposal: "p-second-edit", title: "Again" }), newProposalFixture({ proposal: "p-second-copy" })]);
  const result = await applyClaudeChanges(next); await updateNote(edit.id, { title: "Later" });
  const offer = await undoClaudeChange(result.changeId); await updateNote(edit.id, { title: "Later again" }); const before = await snapshot();
  expect((await undoClaudeChange(result.changeId, { keepEdits: true, expected: offer.decisions })).conflict).toBe(true); expect(await snapshot()).toEqual(before);
});

it("allows only live-note pictures in new notes and refuses a picture deleted after review", async () => {
  const live = await createNote({ html: '<img data-file="live">' }), trash = await createNote({ html: '<img data-file="trash">' }); await trashNote(trash.id);
  for (const id of ["live", "trash", "unreferenced"]) await picture(id);
  const [card] = await build([newProposalFixture({ body: '<p>Images</p><img data-file="live"><img data-file="trash"><img data-file="unreferenced">' })]);
  expect(card.html).toContain('data-file="live"'); expect(card.html).not.toContain('data-file="trash"'); expect(card.html).not.toContain('data-file="unreferenced"');
  const plan = inboxPlan([card], card.ids, null); expect(await claudePlanIsCurrent(plan)).toBe(true);
  await db.files.delete("live"); const before = await snapshot();
  expect(await claudePlanIsCurrent(plan)).toBe(false); await expect(applyClaudeChanges(plan)).rejects.toThrow(STALE_PROPOSAL); expect(await snapshot()).toEqual(before);
  expect((await db.notes.get(live.id)).html).toContain("live");
});
it("a new note protects its reused picture after the original is purged and after Undo moves the new note to Trash", async () => {
  const source = await createNote({ html: '<img data-file="image">' }); await picture();
  const { changeId, created } = await applyClaudeChanges(await planFor([newProposalFixture({ body: '<img data-file="image">' })]));
  await trashNote(source.id); await purgeNow(source.id);
  const later = new Date(Date.now() + FILE_RETENTION_MS * 3); await cleanupFiles(later);
  expect((await db.files.get("image")).unusedSince).toBeNull(); await undoClaudeChange(changeId);
  expect((await db.notes.get(created[0])).deletedAt).not.toBeNull(); await cleanupFiles(later);
  expect((await db.files.get("image")).unusedSince).toBeNull();
});
it("a trashed original purged after 30 days comes back through Undo with its retained pictures", async () => {
  const source = await createNote({ title: "Photo", html: '<img data-file="image">' }); await picture();
  const { changeId } = await applyClaudeChanges(await planFor([trashProposalFixture(source)]));
  const later = new Date(Date.now() + FILE_RETENTION_MS * 3); await purgeExpired(later); await cleanupFiles(later);
  expect(await db.notes.get(source.id)).toBeUndefined(); expect((await db.files.get("image")).unusedSince).toBeNull();
  const offer = await undoClaudeChange(changeId); expect(offer.decisions[0].action).toBe("copy-purged");
  const result = await undoClaudeChange(changeId, { keepEdits: true, expected: offer.decisions });
  expect(await db.notes.get(result.copies[0])).toMatchObject({ title: "Photo (before Claude)", html: source.html });
});

it("Keep both uses the fresh source folder, the proposal's tags and all-note images; exactly the sheet is saved and undone", async () => {
  const folder = await createFolder("Now"), source = await createNote({ title: "Source", html: '<p>Source</p><img data-file="image">' }); await picture();
  const version = proposalFixture(source, { title: "Proposed", tags: ["proposal"], newFolder: "Ignored", body: '<p>Proposed</p><img data-file="image"><script>bad()</script>' });
  await updateNote(source.id, { folderId: folder.id }); await trashNote(source.id);
  const model = keepBothModel(version, await readInboxSnapshot()), plan = keepBothPlan(model, AT);
  expect(model.title).toBe("Proposed (from Claude Code)"); expect(model.folder.id).toBe(folder.id); expect(model.audit).toEqual(["1 script"]);
  const { changeId, created } = await applyClaudeChanges(plan);
  expect(await db.notes.get(created[0])).toMatchObject({ title: model.title, html: model.html, tags: model.tags, folderId: model.folder.id, pinned: false });
  expect(await readOutbox()).toEqual([{ proposal: version.proposal, hash: version.hash, outcome: "kept", applied: [], at: AT }]);
  expect(await readHandled()).toEqual([handledEntry(version, null, "kept")]);
  await undoClaudeChange(changeId); expect((await db.notes.get(created[0])).deletedAt).not.toBeNull();
});
it.each(["folder", "title", "source-returned", "folder-renamed", "link", "picture"])("Keep both refuses when %s changes after the sheet opens", async (what) => {
  const folder = await createFolder("Folder"), source = await createNote({ title: "Source", folderId: folder.id, html: '<p>Body</p><img data-file="image">' }), target = await createNote({ title: "Target" }); await picture();
  const version = proposalFixture(source, { body: `<p><a href="note:${target.id}">Target</a></p><img data-file="image">` });
  await updateNote(source.id, { title: "Local" });
  if (what === "source-returned") await db.notes.delete(source.id);
  const model = keepBothModel(version, await readInboxSnapshot()), plan = keepBothPlan(model);
  if (what === "folder") await updateNote(source.id, { folderId: null });
  if (what === "title") await updateNote(source.id, { title: "Later" });
  if (what === "source-returned") await db.notes.put(source);
  if (what === "folder-renamed") await renameFolder(folder.id, "Renamed");
  if (what === "link") await updateNote(target.id, { title: "Renamed target" });
  if (what === "picture") await db.files.update("image", { width: 2 });
  const before = await snapshot(); expect(await claudePlanIsCurrent(plan)).toBe(false);
  await expect(applyClaudeChanges(plan)).rejects.toThrow(STALE_PROPOSAL); expect(await snapshot()).toEqual(before);
});
it("Keep both title fallback, length, missing folder/source, generation and availability checks", async () => {
  const source = await createNote({ title: "Current", html: "<p>Body</p>" }), version = proposalFixture(source, { title: "" });
  expect(() => keepBothModel(version, { notes: [source], folders: [], generation: null })).toThrow();
  await updateNote(source.id, { title: "Owner" }); let snap = await readInboxSnapshot();
  expect(keepBothModel(version, snap).title).toBe("Owner (from Claude Code)");
  const long = keepBothModel({ ...version, title: "x".repeat(200) }, snap); expect(long.title).toHaveLength(200);
  expect(() => keepBothModel({ ...version, generation: "old" }, snap)).toThrow();
  expect(() => keepBothModel(newProposalFixture(), snap)).toThrow();
  expect(() => keepBothModel({ ...version, extra: true }, snap)).toThrow();
  expect(() => keepBothModel(version, { ...snap, handled: [handledEntry(version, null, "kept")] })).toThrow();
  await db.notes.delete(source.id); snap = await readInboxSnapshot();
  expect(keepBothModel(version, snap)).toMatchObject({ title: "Untitled (from Claude Code)", folder: { action: "none" }, sourceCheck: { id: source.id, rev: null } });
});
it("sends kept through the real request handler and drains the outbox while the handled entry remains", async () => {
  const server = await syncFixture();
  try {
    await saveConnection({ address: server.address, token: server.token });
    const source = await createNote({ title: "Source", html: "<p>Old body</p>" });
    const round = () => runSyncRound({ clientFactory: server.clientFactory, onState: (state) => syncSession.update({ proposals: state.proposals }) });
    await round();
    await fs.writeFile(path.join(server.config.viewDir, "inbox/p-keep-fixture.html"), "<p>Claude body</p>");
    await fs.writeFile(path.join(server.config.viewDir, "inbox/p-keep-fixture.json"), JSON.stringify({ note: source.id, basedOnRev: source.rev, generation: null, title: "Proposed", folderId: null, tags: [], why: "Fixture" }));
    await round(); await round();
    const version = syncSession.getSnapshot().proposals[0]; expect(version).toBeTruthy();
    await updateNote(source.id, { title: "Local" });
    await applyClaudeChanges(keepBothPlan(keepBothModel(version, await readInboxSnapshot())));
    expect((await round()).status).toBe("ok"); expect(await readOutbox()).toEqual([]);
    expect(await readHandled()).toEqual([handledEntry(version, null, "kept")]);
    expect((await readProposals(server.config.storeDir))[0].record).toMatchObject({ status: "kept", outcome: { outcome: "kept", applied: [] } });
    expect(server.requests.some((r) => r.path === "/v1/state?proposals=2")).toBe(true);
  } finally { await server.clean(); }
});
it.each(["edit", "new"])("shows changed destinations despite identical words and refuses a ticked %s link into ticked Trash", async (kind) => {
  const a = await createNote({ title: "A" }), b = await createNote({ title: "B" }), source = await createNote({ html: `<p><a href="note:${a.id}">Same words</a></p>` });
  const body = `<p><a href="note:${b.id}">Same words</a></p>`, version = kind === "new" ? newProposalFixture({ body }) : proposalFixture(source, { body });
  const cards = await build([version, trashProposalFixture(b)]), selected = new Set(cards.flatMap((c) => c.ids));
  const effects = kind === "new" ? cards[0].effects : cards[0].changes.find((c) => c.id).effects;
  expect(effects.some((effect) => effect.href === `note:${b.id}` || effect.after === `note:${b.id}`)).toBe(true);
  expect(linkIntoTrashError(cards, selected)).toBe("A ticked change links to “B”, which you're moving to Trash. Untick one of them.");
  const plan = inboxPlan(cards, selected, null), before = await snapshot();
  expect(await claudePlanIsCurrent(plan)).toBe(false); await expect(applyClaudeChanges(plan)).rejects.toThrow(STALE_PROPOSAL); expect(await snapshot()).toEqual(before);
  selected.delete(cards[1].ids[0]); expect(linkIntoTrashError(cards, selected)).toBe("");
  await applyClaudeChanges(inboxPlan(cards, selected, null));
});
it.each([undefined, "links", "merge", "split", "xps"])("records folder names for %s and keeps folders for older records without names", async (kind) => {
  for (const old of [false, true]) {
    await resetDatabase();
    const source = await createNote({ title: "Source" }), other = await createNote({ title: "Other" });
    const plan = { kind, generation: null, createFolders: [{ name: "Created" }], notes: [{ id: source.id, expectedRev: source.rev, patch: { html: "<p>Changed</p>", folderId: { create: "Created" } },
      ...(["merge", "split"].includes(kind) ? { role: "content" } : {}) }],
      ...(kind === "split" ? { createNotes: [{ id: "created", title: "Created", html: "<p>New</p>", tags: [], folderId: { create: "Created" } }] } : {}) };
    if (kind === "merge") plan.notes.push({ id: other.id, expectedRev: other.rev, role: "trashed", patch: { deletedAt: AT } });
    const { changeId } = await applyClaudeChanges(plan), record = await undoRecord();
    expect(record.createdFolderNames).toEqual(["Created"]); expect(record.createdFolders).toHaveLength(1);
    expect(isClaudeChange(record)).toBe(true);
    if (old) { delete record.createdFolderNames; expect(isClaudeChange(record)).toBe(true); await db.prefs.put({ key: "claudeLastChange", value: record }); }
    await undoClaudeChange(changeId);
    expect(!!await db.folders.get(record.createdFolders[0])).toBe(old);
  }
});
it.each([undefined, "links", "xps"])("edits-only %s Undo keeps a renamed created folder or one used in Trash", async (kind) => {
  for (const use of ["renamed", "trash"]) {
    await resetDatabase(); const source = await createNote();
    const { changeId } = await applyClaudeChanges({ kind, generation: null, notes: [{ id: source.id, expectedRev: source.rev, patch: { folderId: { create: "Created" } } }], createFolders: [{ name: "Created" }] });
    const [folder] = await db.folders.toArray();
    if (use === "renamed") await renameFolder(folder.id, "Mine");
    else { const occupant = await createNote({ folderId: folder.id }); await trashNote(occupant.id); }
    await undoClaudeChange(changeId); expect(await db.folders.get(folder.id)).toBeTruthy();
  }
});
it("Trash conflict leaves an already restored note alone", async () => {
  const source = await createNote({ title: "Source" });
  const { changeId } = await applyClaudeChanges(await planFor([trashProposalFixture(source)]));
  await restoreNote(source.id); const before = await db.notes.get(source.id), offer = await undoClaudeChange(changeId);
  expect(offer.decisions[0].action).toBe("already-back"); await undoClaudeChange(changeId, { keepEdits: true, expected: offer.decisions });
  expect(await db.notes.get(source.id)).toEqual(before);
});
it("also refuses an added link occurrence into Trash when another link already points there", async () => {
  const target = await createNote({ title: "Target" }), source = await createNote({ html: `<p><a href="note:${target.id}">Existing link</a></p>` });
  const versions = [proposalFixture(source, { body: source.html + `<p><a href="note:${target.id}">Another link</a></p>` }), trashProposalFixture(target)];
  const cards = await build(versions), ticks = new Set(cards.flatMap((c) => c.ids));
  expect(linkIntoTrashError(cards, ticks)).toContain("Target"); await expect(applyClaudeChanges(inboxPlan(cards, ticks, null))).rejects.toThrow(STALE_PROPOSAL);
  const originalOnly = await planFor([proposalFixture(source, { title: "Title only" }), trashProposalFixture(target)]);
  await expect(applyClaudeChanges(originalOnly)).resolves.toMatchObject({ applied: 2 });
});
