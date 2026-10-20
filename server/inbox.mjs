import fs from "node:fs/promises";
import path from "node:path";
import { MAX_PENDING_PROPOSALS, MAX_PROPOSAL_DETAILS_BYTES } from "./constants.mjs";
import { sha256 } from "./fsutil.mjs";
import { INBOX_NAME, MAX_BODY_BYTES, proposalFilename, proposalHash,
  proposalKind, recordKind, proposalProblem, referenceProblem, readProposals } from "./proposals.mjs";
import { readRegular, sameFileStat, withDirectory, unlinkInDirectory } from "./view-fs.mjs";
import { commitProposalUpdates } from "./round.mjs";
import { viewLog } from "./view.mjs";
import { isObject } from "./validate.mjs";

export const HALF_PAIR_TIMEOUT_MS = 10 * 60 * 1000;
const decode = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const stamp = ({ size, mtimeMs, ino }) => ({ size, mtimeMs, ino });
const samePair = (a, b) => ["json", "html"].every((ext) =>
  !a[ext] && !b[ext] || sameFileStat(a[ext], b[ext]));

async function inspectPair(dir, pid) {
  const pair = {};
  for (const ext of ["json", "html"]) {
    try {
      const stat = await fs.lstat(path.join(dir.directory, `${pid}.${ext}`));
      // A matching symlink/special file is never read, removed, or treated as half a pair.
      if (!stat.isFile()) return null;
      pair[ext] = stamp(stat);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return pair;
}

async function capture(dir, proposal, pair, missing, stable) {
  let details, body, reason = missing;
  const read = async (ext, limit) => {
    if (!pair[ext]) return;
    try { return await readRegular(path.join(dir.directory, `${proposal}.${ext}`), limit, pair[ext]); }
    catch (error) {
      // A raced replacement is not a proposal. Observe it afresh on a later scan.
      if (["file-changed", "not-regular"].includes(error.reason) || ["ENOENT", "ELOOP"].includes(error.code)) throw error;
      reason ??= error.reason === "too-large" ? "too-large" : "unreadable";
    }
  };
  const jsonBytes = await read("json", MAX_PROPOSAL_DETAILS_BYTES);
  const htmlBytes = await read("html", MAX_BODY_BYTES);
  if (jsonBytes) {
    try { details = JSON.parse(decode(jsonBytes)); }
    catch { reason ??= "invalid-json"; }
  }
  const trash = isObject(details) && proposalKind(details) === "trash";
  // A stable lone JSON is only a complete submission when it declares Trash.
  if (!pair.html && (trash ? !stable : !missing)) return null;
  if (trash) reason = pair.html ? "trash-with-body" : null;
  const shape = details === undefined ? "invalid-shape" : proposalProblem(details);
  reason ??= trash && shape ? "invalid-shape" : shape;
  if (htmlBytes) {
    try { body = decode(htmlBytes); }
    catch { reason ??= "invalid-body"; }
  }
  const value = !shape ? trash && !pair.html ? details : body !== undefined ? { ...details, body } : null : null;
  // Use the canonical fields/body even for invalid fields. Excessively deep JSON, broken
  // UTF-8 or unreadable files need a bounded byte/marker hash instead.
  let hash;
  if (trash && !shape && !pair.html || isObject(details) && body !== undefined) {
    try { hash = proposalHash(trash && !shape && !pair.html ? details : { ...details, body }); }
    catch { reason ??= "invalid-shape"; }
  }
  hash ??= proposalHash({
    json: jsonBytes ? sha256(jsonBytes) : `refused:${reason}`,
    html: htmlBytes ? sha256(htmlBytes) : `refused:${reason}`,
  });
  return { proposal, hash, value, details: !shape ? details : null, reason, pair };
}

// Must run inside the mutation queue, after journal recovery and history retry.
export async function scanInbox(context) {
  const { store, config, now } = context;
  const records = await readProposals(config.storeDir);
  const pending = () => records.filter(({ record }) => record.status === "pending").map(({ record }) => record);
  if (store.published.meta.historyError) return [];
  if (await store.readJournal()) throw new Error("journal-pending");
  const observations = context.inboxObservations ??= new Map();
  const entries = [], seen = new Set();
  try {
    await withDirectory(config.viewDir, "inbox", async (dir) => {
      const ids = new Set((await fs.readdir(dir.directory)).sort().map((name) => INBOX_NAME.exec(name)?.[1]).filter(Boolean));
      for (const pid of ids) {
        await dir.verify();
        const pair = await inspectPair(dir, pid);
        if (!pair || !pair.json && !pair.html) continue;
        seen.add(pid);
        const previous = observations.get(pid);
        const firstSeen = previous && Boolean(previous.json) === Boolean(pair.json) &&
          Boolean(previous.html) === Boolean(pair.html) ? previous.firstSeen : new Date(now()).getTime();
        observations.set(pid, { ...pair, firstSeen });
        const complete = pair.json && pair.html;
        const stable = previous && samePair(previous, pair);
        const expired = new Date(now()).getTime() - firstSeen > HALF_PAIR_TIMEOUT_MS;
        if (complete ? !stable : !expired && !(pair.json && stable)) continue;
        try {
          const entry = await capture(dir, pid, pair,
            !complete && expired ? pair.json ? "missing-body" : "missing-details" : null, stable);
          const current = await inspectPair(dir, pid);
          if (current && samePair(pair, current)) { if (entry) entries.push(entry); }
          else observations.delete(pid);
        } catch (error) {
          if (!["file-changed", "not-regular"].includes(error.reason) && !["ENOENT", "ELOOP"].includes(error.code)) throw error;
          observations.delete(pid);
        }
      }
      await dir.verify();
    });
  } catch {
    observations.clear();
    await viewLog(config.storeDir, "inbox-skipped", "inbox", now());
    return pending();
  }
  for (const pid of observations.keys()) if (!seen.has(pid)) observations.delete(pid);
  const updates = new Map();
  let sequence = records.reduce((max, { record }) => Math.max(max, record.sequence ?? 0), 0);
  let added = 0;
  for (const entry of entries) {
    const { proposal, hash, value, details } = entry;
    // Replaying even a handled or superseded version only removes the inbox files.
    if (records.some(({ record }) => record.proposal === proposal && record.hash === hash)) continue;
    let reason = entry.reason ?? referenceProblem({ ...value, proposal }, store.published, records);
    const replaced = !reason ? records.filter(({ record }) => record.status === "pending" &&
      (proposalKind(value) === "new" ? recordKind(record) === "new" && record.proposal === proposal :
        recordKind(record) !== "new" && record.note === value.note)) : [];
    if (!reason && pending().length - replaced.length >= MAX_PENDING_PROPOSALS) reason = "too-many";
    const ingestedAt = new Date(now()).toISOString();
    if (!reason) {
      for (const old of replaced) {
        old.record = { ...old.record, status: "superseded", handledAt: ingestedAt };
        updates.set(old.filename, old);
      }
    }
    const record = { ...(reason ? details : value), proposal, hash, status: reason ? "refused" : "pending",
      ...(reason ? { reason } : {}), ingestedAt, sequence: ++sequence };
    const filename = proposalFilename(proposal, hash);
    if (records.some((r) => r.filename === filename)) throw new Error("proposal-hash-collision");
    const stored = { filename, record };
    records.push(stored);
    updates.set(filename, stored);
    added++;
  }
  if (updates.size) await commitProposalUpdates(context, [...updates.values()], `inbox: ${added} new versions`, "inbox");
  // A failed history commit leaves files available until history has been repaired.
  if (store.published.meta.historyError) return [];
  if (entries.length) {
    // Commit's journal has rebuilt the view; repeats also repair it before cleanup.
    if (!updates.size) await context.rebuildView();
    await withDirectory(config.viewDir, "inbox", async (dir) => {
      for (const { proposal, pair } of entries) {
        const current = await inspectPair(dir, proposal);
        // Preserve edits/replacements made while the commit or view rebuild was running.
        if (!current || !samePair(pair, current)) { observations.delete(proposal); continue; }
        try {
          for (const ext of ["json", "html"]) if (pair[ext]) await unlinkInDirectory(dir, `${proposal}.${ext}`, pair[ext]);
        } catch (error) { if (error.reason !== "file-changed") throw error; }
        observations.delete(proposal);
      }
    });
  }
  return pending();
}

// Count queued state scans too, so polling cannot pile up behind a slow round/request.
export function enqueueInboxScan(context, task) {
  context.inboxScans = (context.inboxScans ?? 0) + 1;
  return context.enqueue(task).finally(() => { context.inboxScans--; });
}
