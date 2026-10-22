import Dexie from "dexie";
import { db, writeTransaction } from "../db/db.js";
import { DEFAULT_SYNC_ADDRESS, normalizeAddress } from "./config.js";
import { syncLifecycle } from "./lifecycle.js";

export const syncAddress = "syncAddress";
export const syncToken = "syncToken";
export const syncOutbox = "syncOutbox";
export const syncHandled = "syncHandled";
export const SYNC_PREFS = Object.freeze([syncAddress, syncToken, syncOutbox, syncHandled]);
export const PROPOSAL_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const HASH = /^[a-f0-9]{64}$/;
export const isReportable = (version) => typeof version?.proposal === "string" && PROPOSAL_ID.test(version.proposal) &&
  typeof version.hash === "string" && HASH.test(version.hash);

// Call only at the point of use. Neither value belongs in a UI snapshot.
export function readSyncConfig() {
  return db.transaction("r", db.prefs, async () => {
    const [address, token] = await db.prefs.bulkGet([syncAddress, syncToken]);
    return {
      address: typeof address?.value === "string" ? address.value : DEFAULT_SYNC_ADDRESS,
      token: typeof token?.value === "string" ? token.value : "",
    };
  });
}
// Keep cancellation attached until commit, not merely until the last put resolves.
async function cancellableWrite(task, check = () => {}, signal) {
  let abort;
  try {
    return await writeTransaction([db.prefs], async () => {
      const transaction = Dexie.currentTransaction;
      abort = () => transaction.abort();
      signal?.addEventListener("abort", abort, { once: true });
      signal?.throwIfAborted();
      await check();
      const result = await task();
      await check();
      return result;
    });
  } finally { if (abort) signal?.removeEventListener("abort", abort); }
}
export async function saveConnection({ address, token }, { check, signal } = {}) {
  const normalized = normalizeAddress(address);
  if (typeof token !== "string" || !token.trim()) throw new Error("The XPS did not return a connection token.");
  await cancellableWrite(() => db.prefs.bulkPut([
    { key: syncAddress, value: normalized }, { key: syncToken, value: token.trim() },
  ]), check, signal);
  return syncLifecycle.connectionChanged();
}
export async function forgetToken() {
  syncLifecycle.invalidate();
  await writeTransaction([db.prefs], () => db.prefs.delete(syncToken));
  syncLifecycle.connectionChanged(); // Other windows must read the committed connection.
}
export const outboxId = ({ proposal, hash }) => JSON.stringify([proposal, hash]);
export async function readOutbox() {
  const saved = (await db.prefs.get(syncOutbox))?.value;
  return Array.isArray(saved) ? saved : [];
}
export async function readHandled() {
  const saved = (await db.prefs.get(syncHandled))?.value;
  return Array.isArray(saved) ? saved : [];
}
export async function appendHandledInTransaction(entries) {
  const generation = (await db.prefs.get("notebookGeneration"))?.value ?? null;
  const saved = (await readHandled()).filter((entry) => entry.generation === generation), ids = new Set(saved.map(outboxId));
  for (const entry of entries) if (entry.generation === generation && !ids.has(outboxId(entry))) {
    saved.push(entry); ids.add(outboxId(entry));
  }
  await db.prefs.put({ key: syncHandled, value: saved });
}
export function appendOutbox(entries) {
  return writeTransaction([db.prefs], () => appendOutboxInTransaction(entries));
}
// Apply uses this inside its notes + Undo transaction. Dismiss uses the guarded wrapper.
export async function appendOutboxInTransaction(entries) {
  const saved = await readOutbox(), ids = new Set(saved.map(outboxId));
  for (const entry of Array.isArray(entries) ? entries : [entries]) {
    // The server records the first outcome for an immutable proposal version.
    if (!ids.has(outboxId(entry))) { saved.push(entry); ids.add(outboxId(entry)); }
  }
  await db.prefs.put({ key: syncOutbox, value: saved });
}
export function acknowledgeOutbox(ids, check = () => {}, signal) {
  return cancellableWrite(async () => {
    await check();
    const acknowledged = new Set(ids.map(outboxId));
    const saved = await readOutbox(), remaining = saved.filter((entry) => !acknowledged.has(outboxId(entry)));
    // An empty/repeated acknowledgement need not trigger another sync.
    if (remaining.length !== saved.length) {
      await check();
      await db.prefs.put({ key: syncOutbox, value: remaining });
    }
  }, check, signal);
}
