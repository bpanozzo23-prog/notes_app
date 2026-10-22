import { notebookAccess } from "../db/db.js";
import { newId } from "../lib/ids.js";

export const canSync = (state) => !state.readOnly && !state.replaced && !state.versionChange;

// Kept outside React and the scheduler: imports and updates also cancel a round that is
// waiting for confirmation, or a request started without a mounted app.
export function createSyncLifecycle(access = notebookAccess, channel = null) {
  let epoch = 0, connection = 0, importing = 0, updating = false;
  const active = new Set(), listeners = new Set();
  const emit = (event) => { for (const listener of listeners) listener(event); };
  function invalidate(event = "invalidated") {
    epoch++;
    const previous = [...active];
    active.clear();
    for (const operation of previous) operation.controller.abort();
    emit(event);
  }
  const stopAccess = access.subscribe(() => { if (!canSync(access.getSnapshot())) invalidate(); });
  if (channel) channel.onmessage = ({ data }) => {
    if (data?.type === "notebook-replaced" && typeof data.generation === "string" && data.generation !== access.getGeneration()) invalidate();
    if (data?.type === "sync-connection-changed") { connection++; invalidate("connection-changed"); }
  };
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    isImporting: () => importing > 0,
    isUpdating: () => updating,
    getEpoch: () => epoch,
    invalidate,
    connectionChanged() {
      connection++; invalidate();
      channel?.postMessage({ type: "sync-connection-changed" });
      return epoch;
    },
    beginImport() { importing++; invalidate(); },
    endImport() { importing--; emit("import-ended"); },
    beginUpdate() { updating = true; invalidate(); },
    endUpdate() { if (updating) { updating = false; emit("update-ended"); } },
    begin() {
      const operation = {
        identity: Object.freeze({ id: newId(), connection, generation: access.getGeneration() ?? null }),
        controller: new AbortController(), epoch,
      };
      active.add(operation);
      return operation;
    },
    isCurrent(operation) {
      return active.has(operation) && operation.epoch === epoch && !operation.controller.signal.aborted &&
        !importing && !updating && canSync(access.getSnapshot()) && operation.identity.generation === (access.getGeneration() ?? null);
    },
    finish(operation) { active.delete(operation); },
    dispose() { invalidate(); stopAccess(); channel?.close(); },
  };
}

const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("notes_app");
channel?.unref?.();
export const syncLifecycle = createSyncLifecycle(notebookAccess, channel);
