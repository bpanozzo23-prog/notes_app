import Dexie from "dexie";
import { notebookAccess } from "../db/db.js";
import { validateBackup } from "../db/backup.js";
import { BACKOFF_MS, MAX_WAIT_MS, QUIET_MS } from "./config.js";
import { createSyncClient } from "./client.js";
import { affectsSync } from "./changes.js";
import { readSyncConfig, saveConnection, forgetToken } from "./prefs.js";
import { canSync, syncLifecycle } from "./lifecycle.js";
import { runSyncRound } from "./round.js";
import { syncSession } from "./session.js";

let active = null;
const cancelled = () => ({ status: "cancelled" });

// No navigation lock: a save may be flushed, but network work never locks the editor.
export function startSync({
  queue, session = syncSession, round = runSyncRound, clientFactory = createSyncClient,
  visibility = document, locks = globalThis.navigator?.locks,
  timers = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) },
} = {}) {
  active?.stop();
  session.reset();
  let stopped = false, connected = false, dismissed = false, connecting = false, disconnecting = false, connectionAttempt = null;
  let dirty = false, firstAt = null, lastAt = null, timer = null, retryAt = 0, failures = 0;
  let flight = null, pending = null, revision = 0;
  const visible = () => visibility.visibilityState !== "hidden";
  const paused = () => stopped || !connected || connecting || dismissed || !!pending ||
    !canSync(notebookAccess.getSnapshot()) || syncLifecycle.isImporting();
  const publishPause = () => session.update({ connected, paused: paused() });
  const clearTimer = () => { if (timer !== null) timers.clearTimeout(timer); timer = null; };
  const markDirty = () => {
    dirty = true;
    lastAt = timers.now();
    firstAt ??= lastAt;
  };
  function schedule() {
    clearTimer();
    if (paused() || flight || !dirty) return;
    if (retryAt && !visible()) return;
    const now = timers.now();
    const deadline = Math.max(retryAt, Math.min((lastAt ?? now) + QUIET_MS, (firstAt ?? now) + MAX_WAIT_MS));
    timer = timers.setTimeout(() => { timer = null; void run(); }, Math.max(0, deadline - now));
  }
  function record(result) {
    const success = result.status === "ok" ? result : result.synced;
    if (success) session.update({
      lastSyncedAt: success.lastRoundAt, counts: success.counts, missingImages: success.missingImages,
    });
    if (result.status === "confirm") {
      pending = result;
      // The retry closure retains a client privately; React receives only the review data.
      session.update({ confirm: { removed: result.removed, changed: result.changed }, lastResult: { status: "confirm" }, error: null });
    } else if (result.status === "error") {
      const kind = result.kind;
      session.update({ lastResult: { status: "error", kind }, error: { kind } });
      retryAt = timers.now() + BACKOFF_MS[Math.min(failures++, BACKOFF_MS.length - 1)];
      markDirty();
    } else if (result.status === "ok") {
      failures = 0; retryAt = 0;
      session.update({ lastResult: success, error: success.historyError ? { kind: "history-blocked" } : null, confirm: null });
      if (success.historyError) {
        retryAt = timers.now() + BACKOFF_MS[failures++];
        markDirty();
      }
    } else if (result.status === "disconnected") {
      connected = false;
      session.update({ lastResult: { status: "disconnected" } });
    }
    publishPause();
  }
  function run(retry) {
    if (paused()) return Promise.resolve({ status: "paused" });
    if (flight) { markDirty(); return flight; }
    clearTimer();
    const started = revision;
    const valid = () => !stopped && revision === started && !paused();
    const execute = async () => {
      if (!valid()) return cancelled();
      await queue?.flush();
      if (!valid()) return cancelled();
      dirty = false; firstAt = null; lastAt = null;
      session.update({ running: true });
      return retry ? retry() : round({
        clientFactory,
        onState: (state) => {
          if (valid()) session.update({ proposals: state.proposals ?? [], counts: state.counts, missingImages: state.missingImages ?? [] });
        },
      });
    };
    // Assign before the first await, including before navigator.locks' callback.
    flight = Promise.resolve().then(async () => {
      if (locks?.request) return locks.request("notes-sync-round", { ifAvailable: true }, async (lock) => {
        if (!lock) { markDirty(); return { status: "busy" }; }
        return execute();
      });
      return execute();
    }).catch(() => ({ status: "error", kind: "invalid" })).then((result) => {
      if (!valid()) return cancelled();
      if (result.status !== "cancelled") record(result);
      return result;
    }).finally(() => {
      flight = null;
      if (!stopped) { session.update({ running: false }); publishPause(); schedule(); }
    });
    return flight;
  }
  function now() {
    markDirty();
    retryAt = 0;
    return run();
  }
  function mutation(parts) {
    if (!affectsSync(parts)) return;
    markDirty(); schedule();
  }
  function visibilityChanged() {
    if (visible()) void now();
    else {
      clearTimer();
      if (dirty) void run();
    }
  }
  const stopAccess = notebookAccess.subscribe(() => { publishPause(); schedule(); });
  const stopLifecycle = syncLifecycle.subscribe((event) => {
    revision++;
    pending = null;
    session.update({ confirm: null, proposals: [] });
    markDirty();
    publishPause();
    schedule();
    if (event === "import-ended" && !flight && !paused()) void now();
  });
  Dexie.on("storagemutated", mutation);
  visibility.addEventListener("visibilitychange", visibilityChanged);

  const controller = {
    now,
    async confirmReplace(confirmToken) {
      if (!pending || flight) return { status: "paused" };
      const confirmation = pending;
      pending = null;
      session.update({ confirm: null });
      return run(() => confirmation.retry(confirmToken ?? confirmation.confirmToken));
    },
    dismissConfirm() {
      dismissed = true;
      pending = null;
      syncLifecycle.invalidate();
      clearTimer();
      session.update({ confirm: null });
      publishPause();
    },
    async disconnect() {
      if (disconnecting) return { status: "paused" };
      disconnecting = true; connectionAttempt = null;
      connected = false; connecting = false; dismissed = false; pending = null;
      syncLifecycle.connectionChanged();
      clearTimer();
      session.reset(); publishPause();
      try {
        const config = await readSyncConfig();
        // Forget locally before waiting on an unreachable XPS.
        await forgetToken();
        if (config.token) await clientFactory(config).unpair();
        return { status: "disconnected" };
      } catch { return { status: "error", kind: "invalid" }; }
      finally { disconnecting = false; }
    },
    async connect({ address, code }) {
      if (connecting || disconnecting || !canSync(notebookAccess.getSnapshot()) || syncLifecycle.isImporting()) return { status: "paused" };
      const attempt = {};
      connectionAttempt = attempt;
      connecting = true; dismissed = false; pending = null;
      syncLifecycle.connectionChanged();
      clearTimer(); publishPause();
      const operation = syncLifecycle.begin();
      try {
        const response = await clientFactory({ address, token: "" }).pair({ code }, operation.controller.signal);
        if (stopped || !syncLifecycle.isCurrent(operation)) return cancelled();
        if (!response.ok) {
          session.update({ error: { kind: response.kind } });
          return { status: "error", kind: response.kind };
        }
        const savedEpoch = await saveConnection({ address, token: response.body.token }, {
          signal: operation.controller.signal,
          check: () => { if (!syncLifecycle.isCurrent(operation)) throw new Error("Sync cancelled."); },
        });
        if (stopped || connectionAttempt !== attempt || savedEpoch !== syncLifecycle.getEpoch()) return cancelled();
        connected = true;
        session.update({ error: null, lastResult: null });
      } catch {
        if (operation.controller.signal.aborted || connectionAttempt !== attempt) return cancelled();
        if (!stopped) session.update({ error: { kind: "invalid" } });
        return { status: "error", kind: "invalid" };
      } finally {
        syncLifecycle.finish(operation);
        if (connectionAttempt === attempt) { connecting = false; connectionAttempt = null; }
        if (!stopped) publishPause();
      }
      // An aborted older round must leave its single-flight slot before the new one.
      await flight;
      return now();
    },
    async restoreBackup() {
      if (!connected || !canSync(notebookAccess.getSnapshot()) || syncLifecycle.isImporting()) return { ok: false, kind: "cancelled" };
      const operation = syncLifecycle.begin();
      try {
        const config = await readSyncConfig();
        if (!syncLifecycle.isCurrent(operation)) return { ok: false, kind: "cancelled" };
        const response = await clientFactory(config).backup(operation.controller.signal);
        if (!syncLifecycle.isCurrent(operation)) return { ok: false, kind: "cancelled" };
        return response.ok ? validateBackup(response.body) : response;
      } catch { return { ok: false, kind: "invalid" }; }
      finally { syncLifecycle.finish(operation); }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      stopAccess(); stopLifecycle();
      Dexie.on.storagemutated.unsubscribe(mutation);
      visibility.removeEventListener("visibilitychange", visibilityChanged);
      clearTimer();
      syncLifecycle.invalidate();
      session.update({ running: false, confirm: null, paused: true });
      if (active === controller) active = null;
    },
  };
  active = controller;
  const started = revision;
  const ready = readSyncConfig().then((config) => {
    if (stopped || started !== revision) return cancelled();
    connected = !!config.token;
    publishPause();
    return now();
  }).catch(() => {
    if (!stopped) session.update({ error: { kind: "invalid" } });
    return { status: "error", kind: "invalid" };
  });
  // React uses the function as an effect cleanup; tests can await the initial round.
  return Object.assign(controller.stop, { ready });
}

export const syncNow = () => active?.now() ?? Promise.resolve({ status: "paused" });
export const confirmReplace = (token) => active?.confirmReplace(token) ?? Promise.resolve({ status: "paused" });
export const dismissConfirm = () => active?.dismissConfirm();
export const disconnect = () => active?.disconnect() ?? Promise.resolve({ status: "paused" });
export const connect = (details) => active?.connect(details) ?? Promise.resolve({ status: "paused" });
export const restoreBackup = () => active?.restoreBackup() ?? Promise.resolve({ ok: false, kind: "cancelled" });
