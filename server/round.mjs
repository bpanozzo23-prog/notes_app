import { SCHEMA_VERSION } from "./constants.mjs";
import { bindFiles, countsFor } from "./store.mjs";
import { guard } from "./guard.mjs";
import { dailyBackup } from "./backup.mjs";
import { readJson, writeJson } from "./fsutil.mjs";
import { fail, validatePush, validateOutcomes } from "./validate.mjs";
import { proposalFilename } from "./proposals.mjs";

export const ROUND_STEPS = ["journal", "apply", "commit", "publish", "device", "view", "backup", "uploads", "clear-journal", "response"];
export const OUTCOME_STEPS = ["journal", "apply", "commit", "publish", "view", "clear-journal", "response"];
const after = async (context, name) => { await context.afterStep?.(name); };
function result(store) {
  const { round, missingImages, lastRoundAt, historyError } = store.published.meta;
  return { round, counts: countsFor(store.published), missingImages, lastRoundAt, historyError };
}

// Must be called under context.enqueue. The journal contains the full target, so partial
// writes and replay never depend on already-overwritten rows, expired uploads, or a new clock.
export async function resolveJournal(context) {
  const { store, pairing } = context;
  const journal = await store.readJournal();
  if (!journal) return;
  if (!["round", "outcomes", "inbox"].includes(journal.kind)) throw new Error("invalid-journal");
  const steps = journal.kind === "round" ? ROUND_STEPS : OUTCOME_STEPS;
  if (!steps.includes(journal.step)) throw new Error("invalid-journal-step");
  const payload = journal.payload;
  const advance = async (name, operation) => {
    if (steps.indexOf(journal.step) >= steps.indexOf(name)) return;
    await operation();
    journal.step = name;
    await store.writeJournal(journal);
    await after(context, name);
  };
  if (journal.kind === "round") {
    if (store.published.meta.round > journal.targetRound) throw new Error("journal-round-mismatch");
    await advance("apply", async () => {
      if (store.published.meta.round !== journal.targetRound) await store.apply(payload.next);
    });
  } else {
    if (store.published.meta.round !== journal.targetRound) throw new Error("journal-round-mismatch");
    await advance("apply", async () => {
      for (const update of payload.updates) await writeJson(store.file(`proposals/${update.filename}`), update.record);
    });
  }
  await advance("commit", async () => {
    try {
      await store.git.commit(payload.message);
      payload.next.meta.historyError = false;
    } catch {
      // Publication still succeeds. No later write may skip this unrecorded version.
      payload.next.meta.historyError = true;
    }
  });
  await advance("publish", async () => { await store.publish(payload.next); });
  // meta.json can already be published if a process died between publication and checkpoint.
  // Conversely, after a checkpoint load() has selected the completed snapshot from disk.
  if (journal.kind === "round") {
    await advance("device", () => pairing.completeFirstPush(payload.deviceTokenSha256));
  }
  await advance("view", () => context.rebuildView(store.published));
  if (journal.kind === "round") {
    await advance("backup", () => dailyBackup(store, context.now()));
    await advance("uploads", () => store.pruneUploads(payload.boundUploads, context.now()));
  }
  await store.clearJournal();
  await after(context, "clear-journal");
}

export async function retryHistory(context) {
  const { store } = context;
  if (!store.published.meta.historyError) return;
  try { await store.git.commit(`round ${store.published.meta.round}: history retry`); }
  catch { return; }
  await store.setHistoryError(false);
}
export async function pushRound(context, push) {
  const { store, pairing, confirmations } = context;
  validatePush(push);
  if (store.published.meta.historyError) fail(503, "history-blocked");
  const previous = store.published;
  if (push.base.round !== previous.meta.round || push.base.generation !== previous.meta.generation) fail(409, "changed");
  if (previous.meta.round >= Number.MAX_SAFE_INTEGER) fail(503, "storage-problem");
  const device = await pairing.device();
  const allRows = device?.firstPushPending || previous.meta.generation !== push.generation;
  const supplied = new Map(push.rows.map((n) => [n.id, n]));
  const existing = new Map(previous.notes.map((n) => [n.id, n]));
  const notes = push.ids.map(({ id, rev }) => {
    if (supplied.has(id)) return supplied.get(id);
    if (allRows || existing.get(id)?.rev !== rev) fail(409, "changed");
    return existing.get(id);
  });
  // Cross-table uniqueness and folder references must also hold for omitted, unchanged rows.
  validatePush({ ...push, rows: notes });
  // Versions first: a refused push must not use up a confirmation the owner gave.
  if (push.schemaVersion > SCHEMA_VERSION) fail(409, "update-service");
  if (push.schemaVersion < previous.meta.schemaVersion) fail(409, "update-app");
  const binding = await bindFiles(store, push, notes, context.now());
  const differences = guard(previous, push, binding.files, device?.firstPushPending);
  if (differences.removed.length || differences.changed.length) {
    if (!confirmations.consume(push)) fail(409, "confirm", { ...differences, confirm: confirmations.issue(push) });
  }
  const at = new Date(context.now()).toISOString();
  const next = {
    meta: { round: previous.meta.round + 1, generation: push.generation, schemaVersion: push.schemaVersion,
      appVersion: push.appVersion, lastRoundAt: at, historyError: false, missingImages: binding.missingImages },
    notes, folders: push.folders, tombstones: push.tombstones, preferences: push.preferences,
    files: binding.files, notebookMd: push.notebookMd,
  };
  const removed = previous.notes.filter((n) => !push.ids.some((r) => r.id === n.id)).length;
  const journal = { kind: "round", targetRound: next.meta.round, step: "journal",
    payload: { push, previous, next, boundUploads: binding.boundUploads,
      deviceTokenSha256: device?.tokenSha256 ?? null,
      message: `round ${next.meta.round}: ${push.rows.length} notes written, ${removed} removed` } };
  await store.writeJournal(journal);
  await after(context, "journal");
  await resolveJournal(context);
  await after(context, "response");
  return result(store);
}

export async function recordOutcomes(context, body) {
  validateOutcomes(body);
  const { store } = context;
  if (store.published.meta.historyError) fail(503, "history-blocked");
  const updates = [], recorded = [], seen = new Set();
  for (const item of body) {
    let filename = proposalFilename(item.proposal, item.hash);
    const identity = `${item.proposal}-${item.hash}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    recorded.push({ proposal: item.proposal, hash: item.hash });
    let record = await readJson(store.file(`proposals/${filename}`), null);
    if (record && record.hash !== item.hash) continue;
    if (!record) {
      // Run A's fixtures/records used the full hash; retain their idempotent outcome behavior.
      filename = `${identity}.json`;
      record = await readJson(store.file(`proposals/${filename}`), null);
    }
    // Acknowledgement of an unknown immutable version is intentional (phone outbox drains).
    if (!record || record.outcome != null || record.hash !== undefined && record.hash !== item.hash) continue;
    updates.push({ filename, record: { ...record, status: item.outcome,
      outcome: { outcome: item.outcome, applied: item.applied ?? null, at: item.at } } });
  }
  if (updates.length) {
    await commitProposalUpdates(context, updates, `round ${store.published.meta.round}: ${updates.length} outcomes recorded`);
  }
  return { recorded };
}

export async function commitProposalUpdates(context, updates, message, kind = "outcomes") {
  const { store } = context;
  if (store.published.meta.historyError) fail(503, "history-blocked");
  const journal = { kind, targetRound: store.published.meta.round, step: "journal",
    payload: { updates, next: structuredClone(store.published), message } };
  await store.writeJournal(journal);
  await after(context, "journal");
  await resolveJournal(context);
  await after(context, "response");
}
