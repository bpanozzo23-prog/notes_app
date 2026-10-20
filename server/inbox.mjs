import fs from "node:fs/promises";
import path from "node:path";
import { MAX_PENDING_PROPOSALS, MAX_PROPOSAL_BYTES } from "./constants.mjs";
import { sha256 } from "./fsutil.mjs";
import { PENDING_NAME, proposalFilename, proposalHash, proposalProblem, readProposals } from "./proposals.mjs";
import { readRegular, withDirectory } from "./view-fs.mjs";
import { openStore } from "./store.mjs";
import { commitProposalUpdates } from "./round.mjs";
import { rebuildView, viewLog } from "./view.mjs";

export async function ingest({ storeDir, viewDir, context, now = () => new Date() }) {
  context ??= { store: await openStore(storeDir), now, rebuildView: () => rebuildView({ storeDir, viewDir }) };
  const records = await readProposals(storeDir);
  const pending = () => records.filter(({ record }) => record.status === "pending").map(({ record }) => record);
  if (context.store.published.meta.historyError) return pending();
  // The handler resolves recovery first. A standalone invocation must not replace a journal.
  if (await context.store.readJournal()) throw new Error("journal-pending");
  const entries = [];
  try {
    await withDirectory(viewDir, "inbox/pending", async ({ directory, verify }) => {
      for (const name of (await fs.readdir(directory)).sort()) {
        if (!PENDING_NAME.test(name)) continue;
        const proposal = name.slice(0, -5);
        let bytes, value, hash, reason;
        try {
          await verify();
          bytes = await readRegular(path.join(directory, name), MAX_PROPOSAL_BYTES);
          try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
          catch { reason = "invalid-json"; }
          // Excessively deep JSON can exceed the canonical serializer's stack. Refuse it.
          if (!reason) {
            try { hash = proposalHash(value); reason = proposalProblem(value, proposal); }
            catch { reason = "invalid-shape"; }
          }
        } catch (error) {
          reason = error.reason ?? (error.code === "ENOENT" ? "disappeared" : "unreadable");
        }
        if (reason === "disappeared") continue;
        // Unreadable entries have no content hash. Hash a fixed refusal marker, never their target.
        hash ??= sha256(bytes ?? `refused:${reason}`);
        entries.push({ proposal, hash, value, reason });
      }
      await verify();
    });
  } catch (error) {
    // Do not infer withdrawal from an unreadable directory, or read/write any linked target.
    await viewLog(storeDir, "inbox-skipped", "inbox/pending", context.now());
    return pending();
  }
  const updates = new Map();
  const update = (entry, status) => {
    entry.record = { ...entry.record, status, handledAt: new Date(context.now()).toISOString() };
    updates.set(entry.filename, entry);
  };
  const present = new Set(entries.map((e) => e.proposal));
  for (const entry of records) {
    if (entry.record.status === "pending" && !entry.record.outcome && !present.has(entry.record.proposal)) update(entry, "withdrawn");
  }
  let sequence = Math.max(0, ...records.map(({ record }) => record.sequence ?? 0));
  let added = 0;
  for (const entry of entries) {
    const oldPending = records.find(({ record }) => record.proposal === entry.proposal && record.status === "pending");
    if (oldPending && oldPending.record.hash !== entry.hash) update(oldPending, "superseded");
    // Returning to an already handled byte-for-byte version never resurrects it.
    if (records.some(({ record }) => record.proposal === entry.proposal && record.hash === entry.hash)) continue;
    let reason = entry.reason;
    if (!reason && pending().some((r) => r.note === entry.value.note)) reason = "note-busy";
    if (!reason && pending().length >= MAX_PENDING_PROPOSALS) reason = "too-many";
    const ingestedAt = new Date(context.now()).toISOString();
    const record = reason
      ? { proposal: entry.proposal, hash: entry.hash, status: "refused", reason, ingestedAt, sequence: ++sequence }
      : { ...entry.value, proposal: entry.proposal, hash: entry.hash, status: "pending", ingestedAt, sequence: ++sequence };
    const filename = proposalFilename(entry.proposal, entry.hash);
    // A truncated-hash collision must never replace a previously captured version.
    if (records.some((r) => r.filename === filename)) throw new Error("proposal-hash-collision");
    const stored = { filename, record };
    records.push(stored);
    updates.set(filename, stored);
    added++;
  }
  if (updates.size) await commitProposalUpdates(context, [...updates.values()], `inbox: ${added} new versions`, "inbox");
  return pending();
}
