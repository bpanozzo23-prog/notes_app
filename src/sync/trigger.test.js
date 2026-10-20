import Dexie, { RangeSet } from "dexie";
import { setImmediate } from "node:timers/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db, notebookAccess } from "../db/db.js";
import { EXPORTED_PREFS, importBackup } from "../db/backup.js";
import { resetDatabase, backupFixture } from "../test/fixtures.js";
import { AT, note, file, PNG } from "../../server/test-support.js";
import { startSync, syncNow, connect, disconnect, restoreBackup, confirmReplace, dismissConfirm, declineRestore, finishRestore } from "./trigger.js";
import { affectsSync } from "./changes.js";
import { saveConnection, readSyncConfig, appendOutbox, readOutbox } from "./prefs.js";
import { syncLifecycle } from "./lifecycle.js";
import { createSyncSession } from "./session.js";
import { deferred, syncFixture } from "./test-support.js";

let stop, session, visibility, timers, queue, server;
const ok = () => ({ status: "ok", round: 1, counts: { notes: 1 }, missingImages: [], lastRoundAt: AT, historyError: false });
const settle = async () => { for (let i = 0; i < 20; i++) await setImmediate(); };
function clock() {
  let time = 0, next = 0;
  const jobs = new Map();
  return {
    now: () => time,
    setTimeout(fn, delay) { const id = ++next; jobs.set(id, { fn, at: time + delay }); return id; },
    clearTimeout(id) { jobs.delete(id); },
    async advance(ms) {
      time += ms;
      for (const [id, job] of [...jobs]) if (job.at <= time) { jobs.delete(id); job.fn(); }
      await settle();
    },
    get size() { return jobs.size; },
  };
}
function fire(table = "notes", keys = ["note-1"], database = "notes_app", index = "") {
  Dexie.on.storagemutated.fire({ [`idb://${database}/${table}/${index}`]: new RangeSet().addKeys(keys) });
}
async function start(round = vi.fn(async () => ok()), extra = {}) {
  stop = startSync({ queue, session, visibility, timers, round, ...extra });
  await stop.ready;
  return round;
}
function show(state) {
  visibility.visibilityState = state;
  visibility.dispatchEvent(new Event("visibilitychange"));
}
beforeEach(async () => {
  await resetDatabase();
  await saveConnection({ address: "https://fixture.invalid", token: "SYNC-TOKEN-SENTINEL" });
  session = createSyncSession();
  visibility = new EventTarget(); visibility.visibilityState = "visible";
  timers = clock();
  queue = { flush: vi.fn(async () => {}) };
});
afterEach(async () => {
  stop?.(); stop = null;
  syncLifecycle.invalidate();
  await settle();
  vi.restoreAllMocks();
  if (server) { await server.clean(); server = null; }
});

it("syncs on start, visibility and Sync now, flushing without a navigation lock", async () => {
  const round = await start();
  expect(round).toHaveBeenCalledTimes(1);
  expect(queue.flush).toHaveBeenCalledTimes(1);
  show("hidden"); await settle();
  expect(round).toHaveBeenCalledTimes(1);
  show("visible"); await settle();
  expect(round).toHaveBeenCalledTimes(2);
  expect(await syncNow()).toMatchObject({ status: "ok" });
  expect(round).toHaveBeenCalledTimes(3);
  expect(session.getSnapshot()).toMatchObject({ connected: true, running: false, lastSyncedAt: AT, error: null });
});

it("debounces 10 seconds of quiet with a 60-second maximum", async () => {
  const round = await start();
  fire();
  await timers.advance(9000);
  expect(round).toHaveBeenCalledTimes(1);
  fire();
  await timers.advance(9999);
  expect(round).toHaveBeenCalledTimes(1);
  await timers.advance(1);
  expect(round).toHaveBeenCalledTimes(2);
  fire();
  for (let i = 0; i < 6; i++) { await timers.advance(9000); fire(); }
  expect(round).toHaveBeenCalledTimes(2);
  await timers.advance(6000);
  expect(round).toHaveBeenCalledTimes(3);
});

it("syncs immediately on hiding only when changes are waiting", async () => {
  const round = await start();
  fire();
  show("hidden"); await settle();
  expect(round).toHaveBeenCalledTimes(2);
  await timers.advance(60_000);
  expect(round).toHaveBeenCalledTimes(2);
});

it("keeps single flight and a dirty flag for changes during a round", async () => {
  const gate = deferred(), started = deferred();
  const round = vi.fn(async () => {
    if (round.mock.calls.length === 2) { started.resolve(); await gate.promise; }
    return ok();
  });
  await start(round);
  const pending = syncNow(); await started.promise;
  fire();
  const second = syncNow();
  await timers.advance(60_000);
  expect(round).toHaveBeenCalledTimes(2);
  gate.resolve(); await pending; await second;
  await timers.advance(10_000);
  expect(round).toHaveBeenCalledTimes(3);
  expect(session.getSnapshot().running).toBe(false);
});

it("uses an optional nonwaiting Web Lock and retries after another window owns it", async () => {
  let held = true;
  const locks = { request: vi.fn(async (_name, _options, fn) => fn(held ? null : {})) };
  const round = await start(undefined, { locks });
  expect(round).not.toHaveBeenCalled();
  expect(locks.request).toHaveBeenCalledWith("notes-sync-round", { ifAvailable: true }, expect.any(Function));
  held = false;
  await timers.advance(10_000);
  expect(round).toHaveBeenCalledTimes(1);
});

it.each([...EXPORTED_PREFS, "syncOutbox"])("schedules formatting/outbox preference %s", async (key) => {
  const round = await start();
  fire("prefs", [key]);
  await timers.advance(10_000);
  expect(round).toHaveBeenCalledTimes(2);
});

it.each(["syncToken", "syncAddress", "claudeSpend", "claudeApiKey", "storagePersisted", "notebookGeneration", "anything"])("ignores preference %s", async (key) => {
  const round = await start();
  fire("prefs", [key]);
  fire("prefs", [key], "notes_app", ":dels");
  await timers.advance(600_000);
  expect(round).toHaveBeenCalledTimes(1);
});

it("recognizes real Dexie formatting and outbox mutations, including deleted preference keys", async () => {
  const round = await start();
  await db.prefs.put({ key: "toolbar", value: ["bold"] });
  await settle(); await timers.advance(10_000);
  expect(round).toHaveBeenCalledTimes(2);
  await appendOutbox({ proposal: "p-one", hash: "a".repeat(64), outcome: "dismissed", at: AT });
  await settle(); await timers.advance(10_000);
  expect(round).toHaveBeenCalledTimes(3);
  await db.prefs.delete("toolbar");
  await settle(); await timers.advance(10_000);
  expect(round).toHaveBeenCalledTimes(4);
});

it("ignores other databases, empty mutation ranges and unrelated indexes", async () => {
  const round = await start();
  for (const table of ["notes", "folders", "tombstones", "files", "fileData", "prefs"]) fire(table, ["toolbar"], "other");
  fire("prefs", ["toolbar"], "notes_app", "not-a-primary-index");
  Dexie.on.storagemutated.fire({ "idb://notes_app/notes/": new RangeSet() });
  await timers.advance(600_000);
  expect(round).toHaveBeenCalledTimes(1);
  for (const table of ["notes", "folders", "tombstones", "files", "fileData"]) {
    expect(affectsSync({ [`idb://notes_app/${table}/`]: new RangeSet("id") })).toBe(true);
  }
});

it.each([{ readOnly: true }, { replaced: true }, { versionChange: "pending" }, { versionChange: "closed" }])("pauses for notebook guard %j", async (guard) => {
  vi.spyOn(notebookAccess, "getSnapshot").mockReturnValue({ readOnly: false, replaced: false, versionChange: null, ...guard });
  const round = await start();
  fire(); show("visible");
  expect(await syncNow()).toEqual({ status: "paused" });
  await timers.advance(600_000);
  expect(round).not.toHaveBeenCalled();
  expect(session.getSnapshot().paused).toBe(true);
});

it("does nothing when disconnected and pauses throughout import", async () => {
  await db.prefs.delete("syncToken");
  const round = await start();
  fire(); await timers.advance(60_000);
  expect(round).not.toHaveBeenCalled();
  stop();
  await saveConnection({ address: "https://fixture.invalid", token: "SYNC-TOKEN-SENTINEL" });
  syncLifecycle.beginImport();
  await start(round);
  fire(); show("visible"); await timers.advance(600_000);
  expect(round).not.toHaveBeenCalled();
  syncLifecycle.endImport();
  await settle();
  expect(round).toHaveBeenCalledTimes(1);
});

it("backs off 30 seconds, 2 minutes and 10 minutes while visible, despite additional edits", async () => {
  const round = await start(vi.fn(async () => ({ status: "error", kind: "unreachable" })));
  fire();
  await timers.advance(29_999); expect(round).toHaveBeenCalledTimes(1);
  await timers.advance(1); expect(round).toHaveBeenCalledTimes(2);
  fire();
  await timers.advance(119_999); expect(round).toHaveBeenCalledTimes(2);
  await timers.advance(1); expect(round).toHaveBeenCalledTimes(3);
  await timers.advance(599_999); expect(round).toHaveBeenCalledTimes(3);
  await timers.advance(1); expect(round).toHaveBeenCalledTimes(4);
  expect(session.getSnapshot().error).toEqual({ kind: "unreachable" });
  show("hidden"); await settle();
  const hiddenCalls = round.mock.calls.length;
  await timers.advance(1_800_000);
  expect(round).toHaveBeenCalledTimes(hiddenCalls);
  show("visible"); await settle();
  expect(round).toHaveBeenCalledTimes(hiddenCalls + 1);
});

it("resets back-off after a success and lets explicit Sync now retry immediately", async () => {
  const round = await start(vi.fn(async () => ({ status: "error", kind: "server" })));
  round.mockResolvedValueOnce(ok());
  await syncNow();
  fire(); await timers.advance(10_000);
  expect(round).toHaveBeenCalledTimes(3);
  await timers.advance(30_000);
  expect(round).toHaveBeenCalledTimes(4);
});

it("pauses on confirmation, privately retains the retry, and dismiss pauses until the next open", async () => {
  const retry = vi.fn(async () => ok());
  const confirmation = { status: "confirm", removed: [{ id: "one", title: "Fixture" }], changed: [], confirmToken: "confirmation-only", retry };
  const round = await start(vi.fn(async () => confirmation));
  expect(session.getSnapshot().confirm).toEqual({ removed: confirmation.removed, changed: [] });
  expect(session.getSnapshot().confirm).not.toHaveProperty("retry");
  fire(); show("visible"); await timers.advance(600_000);
  expect(round).toHaveBeenCalledTimes(1);
  expect(await confirmReplace()).toMatchObject({ status: "ok" });
  expect(retry).toHaveBeenCalledWith("confirmation-only");
  await syncNow(); dismissConfirm();
  expect(await syncNow()).toMatchObject({ status: "paused" });
  show("visible"); fire(); await timers.advance(600_000);
  expect(round).toHaveBeenCalledTimes(2);
  stop();
  const reopened = await start();
  expect(reopened).toHaveBeenCalledTimes(1);
});

it("ignores late results after stop or invalidation and cleans up timers/listeners", async () => {
  const gate = deferred(), started = deferred();
  const round = vi.fn(async () => { started.resolve(); await gate.promise; return ok(); });
  stop = startSync({ queue, session, visibility, timers, round });
  await started.promise;
  stop();
  const snapshot = session.getSnapshot();
  gate.resolve(); await stop.ready;
  fire(); show("visible"); await timers.advance(600_000);
  expect(session.getSnapshot()).toBe(snapshot);
  expect(timers.size).toBe(0);
  expect(round).toHaveBeenCalledTimes(1);
});

it("Connect pairs, stores credentials and runs; Restore returns a validated preview without importing", async () => {
  await db.prefs.delete("syncToken");
  server = await syncFixture();
  const window = await server.context.pairing.openWindow();
  await db.notes.put(note());
  stop = startSync({ queue, session, visibility, timers, clientFactory: server.clientFactory });
  await stop.ready;
  expect(await connect({ address: server.address, code: window.code })).toMatchObject({ status: "ok" });
  expect(session.getSnapshot().connected).toBe(true);
  const secret = (await readSyncConfig()).token;
  expect(secret).toBeTruthy();
  expect(JSON.stringify(session.getSnapshot())).not.toContain(secret);
  await db.notes.put(note({ title: "Still on phone", rev: 2 }));
  const preview = await restoreBackup();
  expect(preview).toMatchObject({ ok: true, errors: [], warnings: [], summary: { notes: 1, images: 0 } });
  expect(preview.envelope.notes[0].title).toBe("Fixture title");
  expect((await db.notes.get("note-1")).title).toBe("Still on phone");
  expect(await disconnect()).toEqual({ status: "disconnected" });
  expect((await readSyncConfig()).token).toBe("");
  expect(session.getSnapshot().connected).toBe(false);
  expect(server.requests.at(-1).method).toBe("DELETE");
});

it("Disconnect aborts an active request, forgets locally even if unpair fails, and ignores the late reply", async () => {
  server = await syncFixture();
  await saveConnection({ address: server.address, token: server.token });
  const gate = deferred(), started = deferred();
  server.before(async (request) => {
    if (request.path === "/v1/state") { started.resolve(); await gate.promise; }
    if (request.method === "DELETE") throw new Error("fixture offline");
  });
  stop = startSync({ queue, session, visibility, timers, clientFactory: server.clientFactory });
  await started.promise;
  const disconnected = disconnect();
  await vi.waitFor(async () => expect((await readSyncConfig()).token).toBe(""));
  gate.resolve();
  expect(await stop.ready).toMatchObject({ status: "cancelled" });
  await disconnected;
  expect(session.getSnapshot()).toMatchObject({ connected: false, running: false, lastSyncedAt: null, lastResult: null });
  expect(server.requests.filter(({ path }) => path === "/v1/push")).toHaveLength(0);
});

it("an import during a real round leaves outcomes queued and schedules the new notebook next", async () => {
  server = await syncFixture();
  await saveConnection({ address: server.address, token: server.token });
  await appendOutbox({ proposal: "p-one", hash: "a".repeat(64), outcome: "dismissed", at: AT });
  let once = true;
  server.after(async (request) => {
    if (request.path === "/v1/outcomes" && once) {
      once = false;
      await importBackup(backupFixture({ notes: [note({ id: "imported" })] }));
    }
  });
  stop = startSync({ queue, session, visibility, timers, clientFactory: server.clientFactory });
  expect(await stop.ready).toMatchObject({ status: "cancelled" });
  expect(await readOutbox()).toHaveLength(1);
  expect(session.getSnapshot().lastSyncedAt).toBeNull();
  await timers.advance(10_000);
  await vi.waitFor(() => expect(session.getSnapshot().lastSyncedAt).toBe(AT));
  expect(await readOutbox()).toEqual([]);
});

it("Disconnect cancels pairing and a late token never reconnects the app", async () => {
  await db.prefs.delete("syncToken");
  server = await syncFixture();
  const window = await server.context.pairing.openWindow();
  const gate = deferred(), started = deferred();
  server.after(async (request) => {
    if (request.path === "/v1/pair" && request.method === "POST") { started.resolve(); await gate.promise; }
  });
  stop = startSync({ queue, session, visibility, timers, clientFactory: server.clientFactory });
  await stop.ready;
  const pending = connect({ address: server.address, code: window.code });
  await started.promise;
  await disconnect();
  gate.resolve();
  expect(await pending).toMatchObject({ status: "cancelled" });
  expect((await readSyncConfig()).token).toBe("");
  expect(session.getSnapshot()).toMatchObject({ connected: false, lastSyncedAt: null });
  expect(server.requests.map(({ path }) => path)).toEqual(["/v1/pair"]);
});

it("does not return a late restore preview after Disconnect", async () => {
  server = await syncFixture();
  await saveConnection({ address: server.address, token: server.token });
  stop = startSync({ queue, session, visibility, timers, clientFactory: server.clientFactory });
  await stop.ready;
  const gate = deferred(), started = deferred();
  server.after(async (request) => {
    if (request.path === "/v1/backup") { started.resolve(); await gate.promise; }
  });
  const pending = restoreBackup();
  await started.promise;
  await disconnect(); gate.resolve();
  expect(await pending).toEqual({ ok: false, kind: "cancelled" });
});

it("a successful push with failed history is retried with back-off", async () => {
  const round = await start(vi.fn(async () => ({ ...ok(), historyError: true })));
  expect(session.getSnapshot()).toMatchObject({ lastSyncedAt: AT, error: { kind: "history-blocked" } });
  await timers.advance(29_999);
  expect(round).toHaveBeenCalledTimes(1);
  await timers.advance(1);
  expect(round).toHaveBeenCalledTimes(2);
});

it("real outbox acknowledgement schedules at most one extra round, never a loop", async () => {
  server = await syncFixture();
  await saveConnection({ address: server.address, token: server.token });
  await appendOutbox({ proposal: "p-one", hash: "a".repeat(64), outcome: "dismissed", at: AT });
  stop = startSync({ queue, session, visibility, timers, clientFactory: server.clientFactory });
  await stop.ready;
  await timers.advance(10_000);
  await vi.waitFor(() => expect(session.getSnapshot().running).toBe(false));
  const rounds = server.requests.filter(({ path }) => path === "/v1/push").length;
  expect(rounds).toBe(2);
  await timers.advance(600_000);
  expect(server.requests.filter(({ path }) => path === "/v1/push")).toHaveLength(rounds);
  expect(await readOutbox()).toEqual([]);
});

async function connectToPopulatedXps(withImage = false) {
  await db.prefs.delete("syncToken");
  server = await syncFixture();
  if (withImage) expect((await server.request("PUT", "/v1/files/image-1?generation=generation-A", PNG)).status).toBe(200);
  const remote = note(withImage ? { html: '<p>Fixture</p><img data-file="image-1">' } : {});
  expect((await server.request("POST", "/v1/push", await server.next([remote], { files: withImage ? [file()] : [] }))).status).toBe(200);
  const pairing = await server.context.pairing.openWindow();
  stop = startSync({ queue, session, visibility, timers, clientFactory: server.clientFactory });
  await stop.ready;
  return connect({ address: server.address, code: pairing.code });
}

it("offers Restore before the first push to an empty phone, and pauses until the owner decides", async () => {
  expect(await connectToPopulatedXps()).toEqual({ status: "restore-offer", notes: 1 });
  expect(session.getSnapshot()).toMatchObject({ connected: true, restoreOffer: { notes: 1 }, paused: true, lastSyncedAt: null });
  fire(); show("hidden"); show("visible");
  await timers.advance(600_000);
  expect(await syncNow()).toMatchObject({ status: "paused" });
  expect(server.requests.filter(({ method }) => method !== "GET")).toHaveLength(1); // Pair only.
  expect(await declineRestore()).toMatchObject({ status: "confirm" });
  expect(session.getSnapshot().restoreOffer).toBeNull();
  expect(session.getSnapshot().confirm.removed).toEqual([{ id: "note-1", title: "Fixture title" }]);
});

it("does not offer an empty-phone Restore when there are notes in Trash", async () => {
  await db.notes.put(note({ id: "phone-trash", deletedAt: AT }));
  expect(await connectToPopulatedXps()).toMatchObject({ status: "confirm" });
  expect(session.getSnapshot().restoreOffer).toBeNull();
});

it("retries the restore check after a failed initial state request without pushing", async () => {
  expect(await connectToPopulatedXps()).toMatchObject({ status: "restore-offer" });
  await disconnect();
  const pairing = await server.context.pairing.openWindow();
  server.before(async (request) => { if (request.path === "/v1/state") throw new Error("offline fixture"); });
  expect(await connect({ address: server.address, code: pairing.code })).toMatchObject({ kind: "unreachable" });
  server.before(async () => {});
  expect(await syncNow()).toMatchObject({ status: "restore-offer" });
  expect(server.requests.filter(({ path }) => path === "/v1/push")).toHaveLength(0);
});

it.each([false, true])("holds pushes during restore preview, then full-pushes an identical import silently in its new generation (images: %s)", async (withImage) => {
  expect(await connectToPopulatedXps(withImage)).toMatchObject({ status: "restore-offer" });
  const preview = await restoreBackup();
  expect(preview.ok).toBe(true);
  fire(); show("visible"); await timers.advance(600_000);
  expect(await syncNow()).toMatchObject({ status: "paused" });
  await importBackup(preview.envelope);
  expect(server.requests.filter(({ path }) => path === "/v1/push")).toHaveLength(0);
  finishRestore({ imported: true });
  await vi.waitFor(() => expect(session.getSnapshot().lastSyncedAt).toBe(AT));
  const push = server.requests.find(({ path }) => path === "/v1/push").body;
  expect(push.rows).toHaveLength(1);
  expect(push.generation).toBe(notebookAccess.getGeneration());
  expect(push.generation).not.toBe("generation-A");
  expect(push).not.toHaveProperty("confirm");
  if (withImage) {
    expect(Buffer.from((await db.fileData.get("image-1")).bytes)).toEqual(PNG);
    expect(server.requests.filter(({ method }) => method === "PUT")).toHaveLength(1);
  }
  expect(session.getSnapshot()).toMatchObject({ restoreOffer: null, confirm: null, paused: false });
  const syncedAt = session.getSnapshot().lastSyncedAt;
  server.before(async () => { throw new Error("offline"); });
  await syncNow();
  expect(session.getSnapshot().lastSyncedAt).toBe(syncedAt);
});

it("cancelling a restore preview preserves the unanswered empty-phone offer", async () => {
  await connectToPopulatedXps();
  await restoreBackup();
  finishRestore();
  show("visible"); fire(); await timers.advance(600_000);
  expect(session.getSnapshot()).toMatchObject({ restoreOffer: { notes: 1 }, paused: true, lastSyncedAt: null });
  expect(server.requests.filter(({ path }) => path === "/v1/push")).toHaveLength(0);
});

it("reopening after intentionally purging the last note syncs its tombstone without a Restore offer", async () => {
  server = await syncFixture();
  await saveConnection({ address: server.address, token: server.token });
  await db.notes.put(note());
  stop = startSync({ queue, session, visibility, timers, clientFactory: server.clientFactory });
  await stop.ready; stop();
  await db.notes.delete("note-1");
  await db.tombstones.put({ id: "note-1", purgedAt: AT });
  stop = startSync({ queue, session, visibility, timers, clientFactory: server.clientFactory });
  expect(await stop.ready).toMatchObject({ status: "ok", counts: { notes: 0 } });
  expect(session.getSnapshot().restoreOffer).toBeNull();
});
