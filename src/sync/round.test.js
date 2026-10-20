import Dexie from "dexie";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db, notebookAccess } from "../db/db.js";
import { importBackup } from "../db/backup.js";
import { backupFixture, resetDatabase } from "../test/fixtures.js";
import { AT, note, file, PNG } from "../../server/test-support.js";
import { captureNotebook, runSyncRound } from "./round.js";
import { saveConnection, appendOutbox, readOutbox, forgetToken } from "./prefs.js";
import { syncLifecycle } from "./lifecycle.js";
import { syncFixture } from "./test-support.js";

let server;
const round = (extra) => runSyncRound({ clientFactory: server.clientFactory, ...extra });
const pushes = () => server.requests.filter((request) => request.path === "/v1/push").map((request) => request.body);
const uploads = () => server.requests.filter((request) => request.method === "PUT");
const outcome = (proposal = "p-fixture") => ({ proposal, hash: "a".repeat(64), outcome: "dismissed", at: AT });
async function imageNote() {
  await db.notes.put(note({ html: '<p>Picture</p><img data-file="image-1">' }));
  await db.files.put(file());
  await db.fileData.put({ id: "image-1", bytes: Uint8Array.from(PNG) });
}
beforeEach(async () => {
  await resetDatabase();
  server = await syncFixture();
  await saveConnection({ address: server.address, token: server.token });
});
afterEach(async () => {
  syncLifecycle.invalidate();
  vi.restoreAllMocks();
  await server.clean();
});

it("captures every stored row and only exportable prefs in one read transaction", async () => {
  await imageNote();
  await db.notes.put(note({ id: "trash", deletedAt: AT }));
  await db.folders.put({ id: "folder", name: "Fixture", position: 0 });
  await db.tombstones.put({ id: "purged", purgedAt: AT });
  await db.prefs.put({ key: "toolbar", value: ["bold"] });
  await db.prefs.put({ key: "claudeApiKey", value: "DO-NOT-SEND" });
  const transactions = [];
  for (const table of [db.notes, db.folders, db.tombstones]) {
    const original = table.toArray.bind(table);
    vi.spyOn(table, "toArray").mockImplementation(() => { transactions.push(Dexie.currentTransaction); return original(); });
  }
  const original = db.files.bulkGet.bind(db.files);
  vi.spyOn(db.files, "bulkGet").mockImplementation((ids) => { transactions.push(Dexie.currentTransaction); return original(ids); });
  const captured = await captureNotebook();
  expect(captured.notes).toHaveLength(2);
  expect(captured.tombstones).toHaveLength(1);
  expect(captured.files).toEqual([file()]);
  expect(captured.preferences).toEqual({ toolbar: ["bold"] });
  expect(captured.generation).toBeNull();
  expect(captured.notebookMd).toContain("id: note-1");
  expect(captured.notebookMd).not.toContain("id: trash");
  expect(new Set(transactions).size).toBe(1);
  expect(transactions[0].mode).toBe("readonly");
  expect(transactions[0].storeNames.sort()).toEqual(["notes", "folders", "tombstones", "prefs", "files"].sort());
  expect(JSON.stringify(captured)).not.toContain(server.token);
});

it("pushes live and trashed notes, then only differing revisions, without writing any notebook table", async () => {
  await imageNote();
  await db.notes.put(note({ id: "trash", deletedAt: AT }));
  const before = await Promise.all([db.notes.toArray(), db.folders.toArray(), db.tombstones.toArray(), db.files.toArray(), db.fileData.toArray()]);
  expect(await round()).toMatchObject({ status: "ok", round: 1, missingImages: [], historyError: false });
  expect(pushes()[0].rows).toHaveLength(2);
  expect(uploads()).toHaveLength(1);
  expect(await round()).toMatchObject({ status: "ok", round: 2 });
  expect(pushes()[1].rows).toEqual([]);
  expect(pushes()[1].ids).toHaveLength(2);
  expect(pushes()[0].notebookMd).toBe(pushes()[1].notebookMd);
  expect(uploads()).toHaveLength(1);
  expect(await Promise.all([db.notes.toArray(), db.folders.toArray(), db.tombstones.toArray(), db.files.toArray(), db.fileData.toArray()])).toEqual(before);
  await db.notes.update("note-1", { rev: 2, title: "Changed" });
  expect(await round()).toMatchObject({ status: "ok", round: 3 });
  expect(pushes()[2].rows.map(({ id }) => id)).toEqual(["note-1"]);
  for (const request of server.requests) expect(JSON.stringify(request.body) ?? "").not.toContain(server.token);
  expect(JSON.stringify(server.logger.mock.calls)).not.toContain(server.token);
});

it("a save between capture and push never leaks into that push or its Markdown", async () => {
  await imageNote();
  server.before(async (request) => {
    if (request.method === "PUT") {
      await db.notes.update("note-1", { title: "New title", rev: 2, html: "<p>New body</p>" });
      await db.prefs.put({ key: "toolbar", value: ["italic"] });
    }
  });
  expect(await round()).toMatchObject({ status: "ok" });
  expect(pushes()[0].rows[0]).toMatchObject({ rev: 1, title: "Fixture title" });
  expect(pushes()[0].notebookMd).not.toContain("New");
  expect(pushes()[0].preferences).toEqual({});
  expect((await db.notes.get("note-1")).rev).toBe(2);
  expect(await round()).toMatchObject({ status: "ok" });
  expect(pushes()[1].rows[0]).toMatchObject({ rev: 2, title: "New title" });
});

it("recaptures after a real 409 changed caused by a concurrent push", async () => {
  await db.notes.put(note());
  let once = true;
  server.before(async (request) => {
    if (request.path === "/v1/push" && once) {
      once = false;
      const other = await server.next([note()], { generation: null });
      expect((await server.request("POST", "/v1/push", other)).status).toBe(200);
      await db.notes.update("note-1", { rev: 2, title: "Saved meanwhile" });
    }
  });
  expect(await round()).toMatchObject({ status: "ok", round: 2 });
  expect(pushes()).toHaveLength(2);
  expect(pushes()[0].rows[0].rev).toBe(1);
  expect(pushes()[1].rows[0]).toMatchObject({ rev: 2, title: "Saved meanwhile" });
  expect(pushes()[1].base.round).toBe(1);
});

it("limits changed restarts to three and recaptures each time", async () => {
  await db.notes.put(note());
  server.before(async (request) => request.path === "/v1/push" ? { status: 409, body: { error: "changed" } } : undefined);
  expect(await round()).toEqual({ status: "error", kind: "changed" });
  expect(pushes()).toHaveLength(4);
  expect(server.requests.filter((request) => request.path === "/v1/state")).toHaveLength(4);
});

it("recovers from a reply lost after the server accepted a push", async () => {
  await db.notes.put(note());
  let lost = true;
  server.after(async (request) => { if (request.path === "/v1/push" && lost) { lost = false; throw new Error("fixture lost response"); } });
  expect(await round()).toEqual({ status: "error", kind: "unreachable" });
  expect(await round()).toMatchObject({ status: "ok", round: 2 });
  expect(pushes()[1].rows).toEqual([]);
});

it("sends all rows and referenced images again after new pairing, even within one generation", async () => {
  await imageNote();
  expect(await round()).toMatchObject({ status: "ok" });
  const token = await server.pair();
  await saveConnection({ address: server.address, token });
  expect(await round()).toMatchObject({ status: "ok" });
  expect(pushes()[1].rows).toHaveLength(1);
  expect(uploads()).toHaveLength(2);
});

it("after import sends every row and rebinds same-id images to the imported generation", async () => {
  await imageNote();
  expect(await round()).toMatchObject({ status: "ok" });
  const changedBytes = Buffer.concat([PNG.subarray(0, 8), Buffer.from([9, 8, 7, 6])]);
  await importBackup(backupFixture({ schemaVersion: 4, notes: [note({ html: '<img data-file="image-1">' })], files: [{ ...file(), data: changedBytes.toString("base64") }] }));
  const result = await round();
  expect(result.status).toBe("confirm");
  expect(pushes()[1].rows).toHaveLength(1);
  expect(uploads()).toHaveLength(2);
  expect(uploads()[1].path).toContain(`generation=${notebookAccess.getGeneration()}`);
  expect(await result.retry()).toMatchObject({ status: "ok", round: 2 });
  expect(pushes()[2]).toEqual({ ...pushes()[1], confirm: result.confirmToken });
});

it("counts missing metadata and missing bytes once each, including images referenced only in Trash", async () => {
  await db.notes.put(note({ html: '<img data-file="no-meta"><img data-file="no-meta">' }));
  await db.notes.put(note({ id: "trash", deletedAt: AT, html: '<img data-file="no-bytes">' }));
  await db.files.put(file({ id: "no-bytes" }));
  const result = await round();
  expect(result.status).toBe("ok");
  expect(result.missingImages.sort()).toEqual(["no-bytes", "no-meta"]);
  expect(uploads()).toHaveLength(0);
  expect(pushes()[0].files).toEqual([file({ id: "no-bytes" })]);
});

it("posts outcomes after push and acknowledges only sent, recorded versions while preserving additions", async () => {
  await appendOutbox(outcome());
  server.after(async (request, response) => {
    if (request.path === "/v1/outcomes") {
      await appendOutbox(outcome("p-new"));
      response.body.recorded.push({ proposal: "p-new", hash: "a".repeat(64) });
    }
  });
  expect(await round()).toMatchObject({ status: "ok" });
  expect(server.requests.map(({ path }) => path)).toEqual(["/v1/state", "/v1/push", "/v1/outcomes"]);
  expect(await readOutbox()).toEqual([outcome("p-new")]);
});

it("leaves failed outcomes queued and retains the successful push in the result", async () => {
  await appendOutbox(outcome());
  server.before(async (request) => request.path === "/v1/outcomes" ? { status: 503, body: { error: "history-blocked" } } : undefined);
  expect(await round()).toMatchObject({ status: "error", kind: "history-blocked", synced: { status: "ok", round: 1 } });
  expect(await readOutbox()).toEqual([outcome()]);
});

it.each(["/v1/state", "/v1/files/image-1", "/v1/push", "/v1/outcomes"])("local import invalidates an outstanding %s, with no late acknowledgement", async (path) => {
  await imageNote(); await appendOutbox(outcome());
  server.after(async (request) => {
    if (request.path === path) await importBackup(backupFixture({ notes: [note({ id: "imported" })] }));
  });
  expect(await round()).toMatchObject({ status: "cancelled" });
  expect((await db.notes.toArray()).map(({ id }) => id)).toEqual(["imported"]);
  expect(await readOutbox()).toEqual([outcome()]);
  const last = server.requests.at(-1);
  expect(last.path).toBe(path);
  expect(last.signal.aborted).toBe(true);
});

it.each(["disconnect", "broadcast", "replacement", "update"])("invalidates a round on %s", async (event) => {
  await imageNote(); await appendOutbox(outcome());
  server.after(async (request) => {
    if (request.path !== "/v1/state") return;
    if (event === "disconnect") await forgetToken();
    if (event === "replacement") {
      await db.prefs.put({ key: "notebookGeneration", value: "elsewhere" });
      await notebookAccess.check().catch(() => {});
    }
    if (event === "update") db.on.versionchange.fire({});
    if (event === "broadcast") {
      const channel = new BroadcastChannel("notes_app");
      await new Promise((resolve) => {
        const stop = syncLifecycle.subscribe(() => { stop(); resolve(); });
        channel.postMessage({ type: "notebook-replaced", generation: "elsewhere" });
      });
      channel.close();
    }
  });
  expect(await round()).toMatchObject({ status: "cancelled" });
  expect(server.requests).toHaveLength(1);
  expect(server.requests[0].signal.aborted).toBe(true);
  expect(await readOutbox()).toEqual([outcome()]);
});

it("checks generation in the byte transaction and immediately before push", async () => {
  await imageNote();
  const original = db.fileData.get.bind(db.fileData);
  const reads = [];
  vi.spyOn(db.fileData, "get").mockImplementation((id) => {
    reads.push({ transaction: Dexie.currentTransaction, generation: notebookAccess.getGeneration() });
    return original(id);
  });
  server.after(async (request) => {
    if (request.method === "PUT") await db.prefs.put({ key: "notebookGeneration", value: "changed-without-broadcast" });
  });
  expect(await round()).toMatchObject({ status: "cancelled" });
  expect(reads).toHaveLength(1);
  expect(reads[0].transaction.storeNames.sort()).toEqual(["fileData", "prefs"]);
  expect(pushes()).toHaveLength(0);
});

it("does not read image bytes when the generation changed after capture", async () => {
  await imageNote();
  const original = db.transaction.bind(db);
  let swapped = false;
  vi.spyOn(db, "transaction").mockImplementation(async (...args) => {
    const result = await original(...args);
    if (!swapped && args.includes(db.notes)) {
      swapped = true;
      await db.prefs.put({ key: "notebookGeneration", value: "changed-after-capture" });
    }
    return result;
  });
  const bytes = vi.spyOn(db.fileData, "get");
  expect(await round()).toMatchObject({ status: "cancelled" });
  expect(bytes).not.toHaveBeenCalled();
  expect(pushes()).toHaveLength(0);
});

async function confirmation() {
  await db.notes.put(note());
  expect(await round()).toMatchObject({ status: "ok" });
  await importBackup(backupFixture({ notes: [note({ title: "Imported change" })] }));
  const result = await round();
  expect(result).toMatchObject({ status: "confirm", changed: [{ id: "note-1", title: "Fixture title" }] });
  return result;
}

it("retries exactly the approved push, then makes that retry single-use", async () => {
  const result = await confirmation();
  expect(await result.retry(result.confirmToken)).toMatchObject({ status: "ok" });
  expect(pushes()[2]).toEqual({ ...pushes()[1], confirm: result.confirmToken });
  expect(await result.retry()).toMatchObject({ status: "cancelled" });
});

it("requires a fresh confirmation if anything changed while the owner was reviewing", async () => {
  const result = await confirmation();
  await db.notes.update("note-1", { title: "Newer edit", rev: 2 });
  const next = await result.retry();
  expect(next.status).toBe("confirm");
  expect(pushes()[2]).not.toHaveProperty("confirm");
  expect(pushes()[2].rows[0].title).toBe("Newer edit");
  expect(await next.retry()).toMatchObject({ status: "ok" });
});

it("invalidates a retained confirmation on import", async () => {
  const result = await confirmation();
  await importBackup(backupFixture({ notes: [] }));
  const count = server.requests.length;
  expect(await result.retry()).toMatchObject({ status: "cancelled" });
  expect(server.requests).toHaveLength(count);
});

it("forwards only state status data to the in-memory consumer", async () => {
  const onState = vi.fn();
  expect(await round({ onState })).toMatchObject({ status: "ok" });
  expect(onState).toHaveBeenCalledWith(expect.objectContaining({ proposals: [], counts: expect.any(Object) }));
  expect(JSON.stringify(onState.mock.calls)).not.toContain(server.token);
});
