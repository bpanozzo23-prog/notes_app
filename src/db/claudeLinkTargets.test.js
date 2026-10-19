import { beforeEach, expect, it } from "vitest";
import { db, notebookAccess } from "./db.js";
import { createNote, trashNote, purgeNow } from "./notes.js";
import { applyClaudeChanges, claudePlanIsCurrent, STALE_PROPOSAL } from "./claudeChanges.js";
import { captureTidyPayload, validateTidyProposal, tidyPlan, tidyItemIds } from "../claude/proposals.js";
import { captureMergePayload, validateMergeProposal, mergePlan } from "../claude/merge.js";
import { captureSplitPayload, validateSplitProposal, splitPlan } from "../claude/split.js";
import { classProposal } from "../claude/fixtures/tidy.js";
import { resetDatabase } from "../test/fixtures.js";

beforeEach(resetDatabase);
const snapshot = () => db.transaction("r", db.tables, () => Promise.all(db.tables.map((table) => table.toArray())));
async function linkedPlan(kind, source, target) {
  const keep = { action: "keep", name: null };
  if (kind === "tidy") {
    const payload = await captureTidyPayload(source.id), handle = new Map(payload.handles.noteHandles).get(target.id);
    const proposal = validateTidyProposal({ ...classProposal, tags: null, html: `<p>New <a href="note:${handle}">Target</a></p>` }, payload);
    return tidyPlan(payload, proposal, tidyItemIds(proposal));
  }
  if (kind === "merge") {
    const other = await createNote({ html: "<p>Other</p>" }), payload = await captureMergePayload([source.id, other.id]);
    const handle = new Map(payload.handles.noteHandles).get(target.id);
    return mergePlan(payload, validateMergeProposal({ summary: "", title: "Merged", html: `<p>New <a href="note:${handle}">Target</a></p>`, tags: [], folder: keep, reason: "" }, payload));
  }
  const payload = await captureSplitPayload(source.id), handle = new Map(payload.handles.noteHandles).get(target.id);
  const html = `<p>New <a href="note:${handle}">Target</a></p>`;
  return splitPlan(payload, validateSplitProposal({ summary: "", title: null, html: kind === "split-new" ? "<p>Remaining</p>" : html,
    notes: [{ title: "New note", html: kind === "split-new" ? html : "<p>New body</p>", tags: [], folder: keep, reason: "" }] }, payload));
}
it.each(["tidy", "merge", "split", "split-new"])("%s refuses a newly proposed purged target without writes or replacing Undo", async (kind) => {
  const previous = await createNote({ title: "Previous" });
  await applyClaudeChanges({ generation: notebookAccess.getGeneration(), notes: [{ id: previous.id, expectedRev: previous.rev, patch: { title: "Previous tidy" } }] });
  const source = await createNote({ title: "Source", html: "<p>Before</p>" }), target = await createNote({ title: "Target" });
  const plan = await linkedPlan(kind, source, target);
  expect(await claudePlanIsCurrent(plan)).toBe(true);
  await trashNote(target.id); await purgeNow(target.id);
  const before = await snapshot();
  expect(await claudePlanIsCurrent(plan)).toBe(false);
  await expect(applyClaudeChanges(plan)).rejects.toThrow(STALE_PROPOSAL);
  expect(await snapshot()).toEqual(before);
});
it.each(["tidy", "merge", "split-new"])("%s accepts a new link to an existing Trash note", async (kind) => {
  const source = await createNote({ html: "<p>Before</p>" }), target = await createNote({ title: "Target" });
  const plan = await linkedPlan(kind, source, target);
  await trashNote(target.id);
  expect(await claudePlanIsCurrent(plan)).toBe(true);
  await expect(applyClaudeChanges(plan)).resolves.toHaveProperty("changeId");
});
it("an existing link to a missing id does not block editing the stored note", async () => {
  const source = await createNote({ html: '<p><a href="note:already-missing">Old link</a></p>' });
  const plan = { generation: notebookAccess.getGeneration(), notes: [{ id: source.id, expectedRev: source.rev, patch: { html: '<p>Reworded <a href="note:already-missing">Old link</a></p>' } }] };
  expect(await claudePlanIsCurrent(plan)).toBe(true);
  await expect(applyClaudeChanges(plan)).resolves.toHaveProperty("changeId");
  expect((await db.notes.get(source.id)).linkedIds).toEqual(["already-missing"]);
});
it("a split can link its original and new notes to ids created by the same plan", async () => {
  const source = await createNote({ html: "<p>A</p><p>B</p>" }), payload = await captureSplitPayload(source.id);
  const plan = splitPlan(payload, validateSplitProposal({ summary: "", title: null, html: "<p>A</p>", notes: ["B", "C"].map((title) => ({ title, html: `<p>${title}</p>`, tags: [], folder: { action: "keep", name: null }, reason: "" })) }, payload));
  plan.createNotes[0].html = `<p><a href="note:${plan.createNotes[1].id}">C</a></p>`;
  expect(await claudePlanIsCurrent(plan)).toBe(true);
  await expect(applyClaudeChanges(plan)).resolves.toHaveProperty("changeId");
  expect((await db.notes.get(source.id)).linkedIds).toEqual(plan.createNotes.map((note) => note.id));
  expect((await db.notes.get(plan.createNotes[0].id)).linkedIds).toEqual([plan.createNotes[1].id]);
});
