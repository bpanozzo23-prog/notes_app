import Dexie from "dexie";
import { db, notebookAccess } from "../db/db.js";
import { EXPORTED_PREFS } from "../db/backup.js";
import { APP_VERSION, SCHEMA_VERSION } from "../version.js";
import { extractFileIds } from "../lib/text.js";
import { notebookToText } from "../lib/textExport.js";
import { readSyncConfig, readOutbox, acknowledgeOutbox, outboxId, syncToken, syncAddress } from "./prefs.js";
import { createSyncClient } from "./client.js";
import { syncLifecycle } from "./lifecycle.js";
import { affectsSync } from "./changes.js";
import { DEFAULT_SYNC_ADDRESS } from "./config.js";

const CANCELLED = Symbol("cancelled");
const asResult = (response) => ({ status: response.kind === "cancelled" ? "cancelled" : "error", kind: response.kind });

export function captureNotebook() {
  return db.transaction("r", db.notes, db.folders, db.tombstones, db.prefs, db.files, async () => {
    await notebookAccess.check();
    const [notes, folders, tombstones, values, savedGeneration] = await Promise.all([
      db.notes.toArray(), db.folders.toArray(), db.tombstones.toArray(),
      db.prefs.bulkGet(EXPORTED_PREFS), db.prefs.get("notebookGeneration"),
    ]);
    const referenced = [...new Set(notes.flatMap((note) => extractFileIds(note.html)))];
    const metadata = await db.files.bulkGet(referenced);
    const files = metadata.filter(Boolean).map(({ id, type, size, width, height, createdAt }) => ({ id, type, size, width, height, createdAt }));
    return {
      notes, folders, tombstones, referenced, files,
      preferences: Object.fromEntries(values.filter(Boolean).map(({ key, value }) => [key, value])),
      generation: savedGeneration?.value ?? null,
      notebookMd: notebookToText({ notes, folders, view: true }),
    };
  });
}

// The only write in a round is an exact acknowledgement of captured outbox entries.
// A confirmation keeps this operation alive; invalidate() also aborts that suspended work.
export async function runSyncRound({ clientFactory = createSyncClient, onState = () => {} } = {}) {
  const options = { clientFactory, onState };
  const operation = syncLifecycle.begin(), signal = operation.controller.signal;
  let retained = false, changes = 0, config;
  const mutated = (parts) => { if (affectsSync(parts)) changes++; };
  Dexie.on("storagemutated", mutated);
  const finish = () => {
    Dexie.on.storagemutated.unsubscribe(mutated);
    signal.removeEventListener("abort", finish);
    syncLifecycle.finish(operation);
  };
  signal.addEventListener("abort", finish, { once: true });
  const current = () => {
    if (!syncLifecycle.isCurrent(operation)) throw CANCELLED;
  };
  async function checkGeneration() {
    current();
    await notebookAccess.check();
    const generation = (await db.prefs.get("notebookGeneration"))?.value ?? null;
    const [token, address] = await db.prefs.bulkGet([syncToken, syncAddress]);
    current();
    if (generation !== operation.identity.generation || token?.value !== config.token ||
      (address?.value ?? DEFAULT_SYNC_ADDRESS) !== config.address) {
      operation.controller.abort();
      throw CANCELLED;
    }
  }
  async function checkedRequest(send) {
    await checkGeneration();
    const response = await send();
    await checkGeneration();
    return response;
  }
  try {
    current();
    config = await readSyncConfig();
    current();
    if (!config.token) return { status: "disconnected" };
    const client = clientFactory(config);

    async function outcomes(success) {
      const entries = await readOutbox();
      current();
      if (!entries.length) return success;
      const response = await checkedRequest(() => client.outcomes(entries, signal));
      if (!response.ok) return { ...asResult(response), synced: success };
      // Never let a response acknowledge entries that weren't in this request.
      const sent = new Set(entries.map(outboxId));
      const recorded = (response.body.recorded ?? []).filter((id) => sent.has(outboxId(id)));
      await acknowledgeOutbox(recorded, checkGeneration, signal);
      current();
      return success;
    }

    async function pushCaptured(push, capture, localMissing, capturedChanges, restarts) {
      const response = await checkedRequest(() => client.push(push, signal));
      if (!response.ok) {
        if (response.kind === "changed" && restarts < 3) return attempt(restarts + 1);
        if (response.kind !== "confirm") return asResult(response);
        retained = true;
        let used = false;
        const { removed, changed, confirm } = response.details;
        return {
          status: "confirm", removed, changed, confirmToken: confirm,
          async retry(confirmToken = confirm) {
            if (used) return { status: "cancelled" };
            used = true;
            retained = false;
            try {
              await checkGeneration();
              const latest = await captureNotebook();
              current();
              if (changes !== capturedChanges || JSON.stringify(latest) !== JSON.stringify(capture)) {
                finish();
                return runSyncRound(options); // A new capture needs its own approval.
              }
              return await pushCaptured({ ...push, confirm: confirmToken }, capture, localMissing, capturedChanges, restarts);
            } catch { return { status: syncLifecycle.isCurrent(operation) ? "error" : "cancelled", kind: "invalid" }; }
            finally { if (!retained) finish(); }
          },
        };
      }
      const { round, counts, missingImages, lastRoundAt, historyError } = response.body;
      return outcomes({ status: "ok", round, counts, missingImages: [...new Set([...localMissing, ...missingImages])], lastRoundAt, historyError });
    }

    async function attempt(restarts = 0) {
      const response = await checkedRequest(() => client.state(signal));
      if (!response.ok) return asResult(response);
      const state = response.body;
      current();
      onState({ proposals: state.proposals, counts: state.counts, missingImages: state.missingImages, lastRoundAt: state.lastRoundAt, historyError: state.historyError });
      const capturedChanges = changes;
      const capture = await captureNotebook();
      current();
      if (capture.generation !== operation.identity.generation) {
        finish();
        return runSyncRound(options);
      }
      const all = state.generation !== capture.generation || state.fullPush;
      const present = new Set(state.files), metadata = new Set(capture.files.map(({ id }) => id)), localMissing = [];
      for (const id of capture.referenced) {
        if (!metadata.has(id)) { localMissing.push(id); continue; }
        if (!all && present.has(id)) continue;
        // The generation and byte read share a transaction: an import cannot swap them.
        const data = await db.transaction("r", db.prefs, db.fileData, async () => {
          await checkGeneration();
          return db.fileData.get(id);
        });
        current();
        if (!data?.bytes?.byteLength) { localMissing.push(id); continue; }
        const uploaded = await checkedRequest(() => client.upload(id, data.bytes, capture.generation, signal));
        if (!uploaded.ok) return asResult(uploaded);
      }
      const push = {
        base: { round: state.round, generation: state.generation },
        generation: capture.generation, schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION,
        ids: capture.notes.map(({ id, rev }) => ({ id, rev })),
        rows: capture.notes.filter((note) => all || !Object.hasOwn(state.notes, note.id) || state.notes[note.id] !== note.rev),
        folders: capture.folders, tombstones: capture.tombstones, preferences: capture.preferences,
        files: capture.files, notebookMd: capture.notebookMd,
      };
      return pushCaptured(push, capture, localMissing, capturedChanges, restarts);
    }
    return await attempt();
  } catch {
    // No database, network or injected error text crosses this boundary.
    return { status: syncLifecycle.isCurrent(operation) ? "error" : "cancelled", kind: "invalid" };
  } finally { if (!retained) finish(); }
}
