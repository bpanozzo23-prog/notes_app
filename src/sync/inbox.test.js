import Dexie from "dexie";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db, notebookAccess } from "../db/db.js";
import { createNote, updateNote, trashNote } from "../db/notes.js";
import { applyClaudeChanges, claudePlanIsCurrent, isClaudeChange, STALE_PROPOSAL, undoClaudeChange } from "../db/claudeChanges.js";
import { createFolder, deleteFolder } from "../db/folders.js";
import { resetDatabase, AT, noteFixture } from "../test/fixtures.js";
import { buildInbox, readInboxSnapshot, dismissProposal, pendingProposals, keepBothModel } from "./inbox.js";
import { inboxPlan, keepBothPlan } from "./plan.js";
import { readOutbox, readHandled, appendOutbox, saveConnection, isReportable } from "./prefs.js";
import { proposalFixture } from "./inbox-fixtures.js";
import { runSyncRound } from "./round.js";
import { syncSession } from "./session.js";
import { syncFixture } from "./test-support.js";
import { readProposals } from "../../server/proposals.mjs";

beforeEach(async () => { await resetDatabase(); syncSession.reset(); });
afterEach(() => { vi.restoreAllMocks(); syncSession.reset(); });
const build = async (versions) => buildInbox(versions, await readInboxSnapshot());
const allTicks = (cards) => cards.flatMap((card) => card.ids);
it.each(["proposal", "hash", "note"])("refuses an array-wrapped %s on the card", async (field) => {
  const source = await createNote(), version = proposalFixture(source);
  version[field] = [version[field]];
  const [card] = await build([version]);
  expect(card.invalid).toBe(true);
  expect(card.ids).toEqual([]);
});
it.each([{ hash: "bad" }, { hash: ["a".repeat(64)] }, { proposal: ["p-abc"] }, { proposal: "x".repeat(129) }])("Dismiss hides an unreportable identity only on the phone: %j", async (patch) => {
  const source = await createNote(), version = proposalFixture(source, patch);
  syncSession.update({ proposals: [version] });
  const [card] = await build([version]);
  expect(card.invalid).toBe(true); expect(isReportable(version)).toBe(false);
  await dismissProposal(card);
  expect(await readOutbox()).toEqual([]);
  expect(await db.prefs.get("syncOutbox")).toBeUndefined();
  expect(await readHandled()).toEqual([{ proposal: version.proposal, hash: version.hash, generation: null, outcome: "dismissed" }]);
  expect(syncSession.getSnapshot().proposals).toEqual([]);
  syncSession.reset(); syncSession.update({ proposals: [version] });
  expect(await build(syncSession.getSnapshot().proposals)).toEqual([]);
});
it.each([{ hash: "bad" }, { hash: ["a".repeat(64)] }, { proposal: ["p-abc"] }, { proposal: "bad identity" }])("refuses unreportable outbox entries in an xps plan: %j", async (patch) => {
  const source = await createNote(), cards = await build([proposalFixture(source, { title: "Changed" })]);
  const plan = inboxPlan(cards, allTicks(cards), null);
  Object.assign(plan.outbox[0], patch);
  expect(await claudePlanIsCurrent(plan)).toBe(false);
  await expect(applyClaudeChanges(plan)).rejects.toThrow(STALE_PROPOSAL);
  expect(await db.notes.toArray()).toEqual([source]);
  expect(await readOutbox()).toEqual([]); expect(await readHandled()).toEqual([]);
  expect(await db.prefs.get("claudeLastChange")).toBeUndefined();
});
it.each(["deleted", "deleted then moved", "ambiguous"])("keeps a stale edit readable when its proposed folder is %s, and saves Keep both in the current folder", async (kind) => {
  const folder = await createFolder("Before"), source = await createNote({ folderId: folder.id, title: "Before", html: "<p>Before</p>" });
  const version = proposalFixture(source, { title: "After", tags: ["changed"], body: "<p>After</p><script>bad()</script>",
    ...(kind === "ambiguous" ? { folderId: null, newFolder: "Recipes" } : {}) });
  if (kind === "ambiguous") { await createFolder("Recipes"); await createFolder("recipes"); await updateNote(source.id, { title: "Owner" }); }
  else await deleteFolder(folder.id);
  if (kind === "deleted then moved") await updateNote(source.id, { folderId: (await createFolder("Now")).id });
  const [card] = await build([version]);
  expect(card).toMatchObject({ stale: true, folder: { action: "keep" }, title: "After", tags: ["changed"], audit: ["1 script"] });
  expect(card.invalid).toBeUndefined(); expect(card).not.toHaveProperty("resolvedFolder");
  expect(card.changes.some(({ id }) => id)).toBe(true);
  expect(inboxPlan([card], card.ids, null)).toMatchObject({ notes: [], createNotes: [], outbox: [] });
  const current = await db.notes.get(source.id), model = keepBothModel(version, await readInboxSnapshot());
  const { created } = await applyClaudeChanges(keepBothPlan(model));
  expect(await db.notes.get(created[0])).toMatchObject({ title: "After (from Claude Code)", folderId: current.folderId, tags: ["changed"], html: model.html });
  expect(await db.notes.get(source.id)).toEqual(current);
});
it.each([{ title: "\nBad" }, { tags: [null] }, { body: null }, { extra: true }, { folderId: ["missing"] }])("a stale edit's unresolved folder never excuses other invalid data: %j", async (patch) => {
  const source = await createNote(), version = proposalFixture(source, { folderId: "missing", ...patch });
  await updateNote(source.id, { title: "Owner" });
  expect((await build([version]))[0].invalid).toBe(true);
});
it.each(["revision", "generation", "Trash", "deletion"])("marks a proposal stale after %s", async (kind) => {
  const note = await createNote({ title: "Old", html: "<p>Old body</p>" }), proposal = proposalFixture(note, { title: "New", body: "<p>New body</p>" });
  if (kind === "revision") await updateNote(note.id, { title: "Local edit" });
  if (kind === "generation") { await db.prefs.put({ key: "notebookGeneration", value: "replacement" }); notebookAccess.adopt("replacement"); }
  if (kind === "Trash") await trashNote(note.id);
  if (kind === "deletion") await db.notes.delete(note.id);
  const cards = await build([proposal]);
  expect(cards[0].stale).toBe(true); expect(cards[0].invalid).toBeUndefined();
  expect(cards[0].changes.some(({ id }) => id)).toBe(true);
  expect(inboxPlan(cards, allTicks(cards), notebookAccess.getGeneration()).notes).toEqual([]);
});
it("cleans with identity maps, preserves only the note's images and live-note links, and builds metadata rows", async () => {
  const source = await createNote({ title: "Old", html: '<p>Old</p><img data-file="own">' }), target = await createNote({ title: "Target" }), trash = await createNote();
  await trashNote(trash.id);
  await db.folders.put({ id: "folder", name: "Classes", position: 0 });
  const [card] = await build([proposalFixture(source, { title: " New ", tags: ["class"], folderId: "folder",
    body: `<p>New <a href="note:${target.id}">live</a> <a href="note:${trash.id}">trash</a> <a href="note:unknown">unknown</a></p><img data-file="own"><img data-file="foreign">` })]);
  expect(card.stale).toBe(false); expect(card.invalid).toBeUndefined();
  expect(card.html).toContain('data-file="own"'); expect(card.html).not.toContain("foreign");
  expect(card.html).toContain(`note:${target.id}`); expect(card.html).not.toContain(`note:${trash.id}`); expect(card.html).not.toContain("note:unknown");
  expect(card.audit).toEqual(["1 picture from outside the note", "2 links to missing or trashed notes"]);
  expect(card).toMatchObject({ title: "New", tags: ["class"], folder: { action: "existing", id: "folder", name: "Classes" } });
  expect(card.ids).toEqual(["title", "tags", "folder", "body-1"].map((id) => `${card.version.proposal}:${card.version.hash}:${id}`));
});
it("compares tag sets, supports No folder, and rejects invalid title, tags and folder metadata", async () => {
  await db.folders.put({ id: "folder", name: "Classes", position: 0 });
  const source = await updateNote((await createNote({ title: "Fixture", folderId: "folder" })).id, { tags: ["one", "two"] });
  const [same] = await build([proposalFixture(source, { tags: ["two", "one"] })]);
  expect(same.ids).toEqual([]);
  const [none] = await build([proposalFixture(source, { folderId: null })]);
  expect(none.folder).toEqual({ action: "none", name: null });
  for (const invalid of [{ title: "\nBad" }, { title: "x".repeat(201) }, { tags: [" same ", "same"] }, { tags: ["same", "same"] }, { tags: ["\u0000"] }, { tags: Array.from({ length: 51 }, (_, n) => `tag-${n}`) }, { folderId: "missing" }]) {
    const cards = await build([proposalFixture(source, invalid)]);
    expect(cards[0].invalid).toBe(true);
    expect(inboxPlan(cards, allTicks(cards), null).notes).toEqual([]);
  }
});
it("keeps one pending version per note in submission order and excludes exactly handled versions", () => {
  const a = proposalFixture(noteFixture({ id: "one" })), b = proposalFixture(noteFixture({ id: "two" }), { sequence: 2 });
  const newer = { ...a, hash: "b".repeat(64), sequence: 3 };
  expect(pendingProposals([newer, a, b])).toEqual([b, newer]);
  expect(pendingProposals([a, b, newer], [a])).toEqual([b, newer]);
  expect(pendingProposals([a, b, newer], [newer])).toEqual([b]);
});
it("applies partial ticks across several notes and the outbox in one transaction, then undoes kind xps", async () => {
  const a = await createNote({ title: "A", html: "<p>First</p><p>Second</p>" }), b = await createNote({ title: "B" });
  const cards = await build([proposalFixture(a, { title: "A new", body: "<p>First changed</p><p>Second changed</p>" }), proposalFixture(b, { sequence: 2, tags: ["tag"] })]);
  const ticked = [cards[0].ticks.title, cards[0].changes[0].id, cards[1].ticks.tags];
  const transactions = [];
  for (const table of [db.notes, db.prefs]) {
    const put = table.put.bind(table);
    vi.spyOn(table, "put").mockImplementation((row) => { transactions.push(Dexie.currentTransaction); return put(row); });
  }
  const plan = inboxPlan(cards, ticked, null, {}, AT), result = await applyClaudeChanges(plan);
  expect(new Set(transactions).size).toBe(1);
  expect((await db.notes.get(a.id))).toMatchObject({ title: "A new", html: "<p>First changed</p><p>Second</p>" });
  expect((await db.notes.get(b.id)).tags).toEqual(["tag"]);
  expect(await readOutbox()).toEqual(plan.outbox);
  expect(plan.outbox.map(({ applied }) => applied)).toEqual([ticked.slice(0, 2), ticked.slice(2)]);
  const undo = (await db.prefs.get("claudeLastChange")).value;
  expect(undo.kind).toBe("xps"); expect(isClaudeChange(undo)).toBe(true);
  expect(isClaudeChange({ ...undo, createdNotes: [{ id: "no", writtenRev: 1 }] })).toBe(true);
  expect(isClaudeChange({ ...undo, notes: undo.notes.map((row) => ({ ...row, role: "content" })) })).toBe(false);
  await undoClaudeChange(result.changeId);
  expect(await db.notes.get(a.id)).toEqual({ ...a, rev: a.rev + 2 });
  expect(await db.notes.get(b.id)).toEqual({ ...b, rev: b.rev + 2 });
  expect(await readOutbox()).toEqual(plan.outbox);
});
it("leaves already stale cards out but refuses the entire reviewed batch if a current card changes", async () => {
  const a = await createNote({ title: "A" }), b = await createNote({ title: "B" }), c = await createNote({ title: "C" });
  const versions = [a, b, c].map((note, index) => proposalFixture(note, { title: `${note.title} new`, sequence: index + 1 }));
  await updateNote(c.id, { title: "C local" });
  const cards = await build(versions), plan = inboxPlan(cards, allTicks(cards), null);
  expect(plan.notes.map(({ id }) => id)).toEqual([a.id, b.id]);
  await updateNote(b.id, { title: "B local" });
  await expect(applyClaudeChanges(plan)).rejects.toThrow(STALE_PROPOSAL);
  expect((await db.notes.get(a.id)).title).toBe("A");
  expect(await readOutbox()).toEqual([]); expect(await db.prefs.get("claudeLastChange")).toBeUndefined();
});
it("refuses an imported generation at Apply without writing outcomes", async () => {
  const a = await createNote(), cards = await build([proposalFixture(a, { title: "Changed" })]), plan = inboxPlan(cards, allTicks(cards), null);
  await db.prefs.put({ key: "notebookGeneration", value: "new" }); notebookAccess.adopt("new");
  await expect(applyClaudeChanges(plan)).rejects.toThrow(STALE_PROPOSAL);
  expect(await readOutbox()).toEqual([]);
});
it("refuses a new link whose target moved to Trash for xps, while retaining the older Claude rule", async () => {
  const a = await createNote(), b = await createNote();
  const cards = await build([proposalFixture(a, { body: `<p><a href="note:${b.id}">Target</a></p>` })]), plan = inboxPlan(cards, allTicks(cards), null);
  await trashNote(b.id);
  await expect(applyClaudeChanges(plan)).rejects.toThrow(STALE_PROPOSAL);
  expect(await readOutbox()).toEqual([]);
  await expect(applyClaudeChanges({ ...plan, kind: undefined, outbox: undefined })).resolves.toMatchObject({ applied: 1 });
});
it("rolls back notes and Undo if writing the outbox fails; the successful append deduplicates", async () => {
  const a = await createNote({ title: "Original" }), cards = await build([proposalFixture(a, { title: "Proposed" })]), plan = inboxPlan(cards, allTicks(cards), null);
  const put = db.prefs.put.bind(db.prefs);
  const spy = vi.spyOn(db.prefs, "put").mockImplementation((row) => row.key === "syncOutbox" ? Promise.reject(new Error("fixture disk full")) : put(row));
  await expect(applyClaudeChanges(plan)).rejects.toThrow("fixture disk full");
  expect(await db.notes.get(a.id)).toEqual(a); expect(await db.prefs.get("claudeLastChange")).toBeUndefined();
  expect(await readOutbox()).toEqual([]);
  spy.mockRestore();
  await appendOutbox(plan.outbox);
  await applyClaudeChanges(plan);
  expect(await readOutbox()).toEqual(plan.outbox);
});
it.each([false, true])("Dismiss records the outcome and hides the version even after a late state response (stale=%s)", async (stale) => {
  const a = await createNote(), proposal = proposalFixture(a, { title: "Proposed" });
  if (stale) await updateNote(a.id, { title: "Later" });
  syncSession.update({ proposals: [proposal] });
  const [card] = await build([proposal]);
  await dismissProposal(card);
  expect(await readOutbox()).toEqual([{ proposal: proposal.proposal, hash: proposal.hash, outcome: stale ? "stale" : "dismissed", applied: [], at: expect.any(String) }]);
  expect(await readHandled()).toEqual([{ proposal: proposal.proposal, hash: proposal.hash, generation: null, outcome: stale ? "stale" : "dismissed" }]);
  expect(syncSession.getSnapshot().proposals).toEqual([]);
  syncSession.update({ proposals: [proposal] });
  expect(syncSession.getSnapshot().proposals).toEqual([]);
  expect(await build([proposal])).toEqual([]);
});
it("ingests file pairs through the real handler, reports Apply and Dismiss next round, and acknowledges the outbox", async () => {
  const server = await syncFixture();
  try {
    await saveConnection({ address: server.address, token: server.token });
    const a = await createNote({ title: "A" }), b = await createNote({ title: "B" });
    const round = () => runSyncRound({ clientFactory: server.clientFactory, onState: (state) => syncSession.update({ proposals: state.proposals }),
      onHandled: (entries) => syncSession.hideProposals(entries) });
    expect((await round()).status).toBe("ok");
    for (const [index, note] of [a, b].entries()) {
      const { note: id, basedOnRev, generation, title, folderId, tags, why, body } = proposalFixture(note, { title: `${note.title} changed` });
      const pid = `p-flow-${index}`;
      await fs.writeFile(path.join(server.config.viewDir, `inbox/${pid}.html`), body);
      await fs.writeFile(path.join(server.config.viewDir, `inbox/${pid}.json`), JSON.stringify({ note: id, basedOnRev, generation, title, folderId, tags, why }));
    }
    await round(); await round(); // two stable GET /v1/state observations
    const cards = await build(syncSession.getSnapshot().proposals);
    expect(cards).toHaveLength(2);
    const plan = inboxPlan([cards[0]], cards[0].ids, null);
    await applyClaudeChanges(plan); // The engine must also retire it without a mounted review.
    await dismissProposal(cards[1]);
    expect((await readOutbox()).length).toBe(2);
    expect((await round()).status).toBe("ok");
    expect(await readOutbox()).toEqual([]);
    expect(syncSession.getSnapshot().proposals).toEqual([]);
    const records = (await readProposals(server.config.storeDir)).map(({ record }) => record);
    expect(records[0]).toMatchObject({ status: "applied", outcome: { applied: cards[0].ids } });
    expect(records[1]).toMatchObject({ status: "dismissed" });
  } finally { await server.clean(); }
});

it.each([true, false])("a Claude Code proposal can keep or drop heading folds (keep=%s)", async (keep) => {
  const before = '<h2 data-collapsed="true">Section</h2><p>Before words.</p>';
  const source = await createNote({ html: before });
  const body = before.replace('Before', 'Better').replace(keep ? 'unused' : ' data-collapsed="true"', '');
  const cards = await build([proposalFixture(source, { body })]);
  expect(cards[0].audit).toEqual([]); expect(cards[0].html).toBe(body);
  const { changeId } = await applyClaudeChanges(inboxPlan(cards, allTicks(cards), null));
  expect((await db.notes.get(source.id)).html).toBe(body);
  await undoClaudeChange(changeId); expect((await db.notes.get(source.id)).html).toBe(before);
});
