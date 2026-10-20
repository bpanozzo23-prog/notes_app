import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db, getPref } from "../db/db.js";
import { resetDatabase, backupFixture } from "../test/fixtures.js";
import { buildBackup, importBackup, validateBackup } from "../db/backup.js";
import useNotebook from "../lib/useNotebook.js";
import { appendOutbox, acknowledgeOutbox, readOutbox, saveConnection, readSyncConfig, forgetToken, SYNC_PREFS } from "./prefs.js";
import { createSyncSession } from "./session.js";
import { syncLifecycle } from "./lifecycle.js";

const token = "SYNC-TOKEN-SENTINEL", address = "https://fixture.invalid";
const entry = (proposal, hash = "a".repeat(64)) => ({ proposal, hash, outcome: "dismissed", at: "2026-10-20T00:00:00.000Z" });
beforeEach(resetDatabase);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("keeps local preferences through import and strips them from exports, hook state and rendered output", async () => {
  const logs = ["log", "warn", "error", "info", "debug"].map((method) => vi.spyOn(console, method));
  await saveConnection({ address, token });
  await appendOutbox(entry("p-one"));
  await db.prefs.put({ key: "toolbar", value: ["bold"] });
  const backup = await buildBackup();
  expect(JSON.stringify(backup)).not.toContain(token);
  for (const key of SYNC_PREFS) expect(backup.preferences).not.toHaveProperty(key);
  const { result } = renderHook(useNotebook);
  let refreshed;
  await act(async () => { refreshed = await result.current.refresh(); });
  expect(refreshed.prefs).toEqual({ toolbar: ["bold"] });
  expect(result.current.prefs).toEqual({ toolbar: ["bold"] });
  render(<output>{JSON.stringify(result.current.prefs)}</output>);
  expect(screen.getByRole("status").textContent).not.toContain(token);
  await importBackup(backupFixture());
  expect(await readSyncConfig()).toEqual({ address, token });
  expect(await readOutbox()).toEqual([entry("p-one")]);
  expect(await getPref("toolbar")).toBeUndefined();
  await forgetToken();
  expect(await readSyncConfig()).toEqual({ address, token: "" });
  expect(JSON.stringify(logs.flatMap((log) => log.mock.calls))).not.toContain(token);
});

it.each([1, 2, 3, 4, 5, 0, undefined])("refuses a token before upgrades at schema %s", (schemaVersion) => {
  const result = validateBackup(backupFixture({ schemaVersion, preferences: { syncToken: token } }));
  expect(result.ok).toBe(false);
  expect(result.envelope).toBeNull();
  expect(result.errors).toContain("This file contains a sync token, so it was not made by this app's export. Nothing was imported.");
  expect(JSON.stringify(result)).not.toContain(token);
});

it.each([1, 2, 3, 4])("ignores nonsecret sync preferences in an old backup at schema %s", (schemaVersion) => {
  const result = validateBackup(backupFixture({ schemaVersion, files: [], preferences: { syncAddress: address, syncOutbox: [] } }));
  expect(result.ok).toBe(true);
  expect(result.warnings).toHaveLength(2);
  expect(result.envelope.preferences).toEqual({});
});

it("acknowledges exact immutable versions, keeps concurrent additions and makes duplicate append harmless", async () => {
  const a = entry("p-one"), b = entry("p-one", "b".repeat(64)), c = entry("p-two");
  await appendOutbox([a, b]);
  await Promise.all([acknowledgeOutbox([a]), appendOutbox([c, b])]);
  expect(await readOutbox()).toEqual([b, c]);
  await acknowledgeOutbox([a]);
  expect(await readOutbox()).toEqual([b, c]);
});

it("guards every local write and leaves all prefs intact on replacement", async () => {
  await saveConnection({ address, token });
  await appendOutbox(entry("p-one"));
  await db.prefs.put({ key: "notebookGeneration", value: "elsewhere" });
  const before = await db.prefs.toArray();
  for (const write of [() => saveConnection({ address, token: "new" }), forgetToken,
    () => appendOutbox(entry("p-two")), () => acknowledgeOutbox([entry("p-one")])]) {
    await expect(write()).rejects.toThrow("replaced");
  }
  expect(await db.prefs.toArray()).toEqual(before);
});

it("the external status store has no credential fields and supports unsubscribe", () => {
  const session = createSyncSession(), listener = vi.fn(), stop = session.subscribe(listener);
  session.update({ connected: true, token, address, syncToken: token });
  expect(session.getSnapshot().connected).toBe(true);
  expect(JSON.stringify(session.getSnapshot())).not.toContain(token);
  expect(JSON.stringify(session.getSnapshot())).not.toContain(address);
  expect(listener).toHaveBeenCalledTimes(1);
  stop(); session.reset();
  expect(listener).toHaveBeenCalledTimes(1);
});

it("cancellation rolls an outbox acknowledgement back even after its put resolves", async () => {
  const item = entry("p-one");
  await appendOutbox(item);
  const controller = new AbortController(), original = db.prefs.put.bind(db.prefs);
  vi.spyOn(db.prefs, "put").mockImplementation(async (row) => {
    const result = await original(row);
    if (row.key === "syncOutbox") controller.abort();
    return result;
  });
  await expect(acknowledgeOutbox([item], () => {}, controller.signal)).rejects.toThrow();
  expect(await readOutbox()).toEqual([item]);
});

it("cancellation rolls pairing credentials back before commit", async () => {
  const operation = syncLifecycle.begin(), original = db.prefs.bulkPut.bind(db.prefs);
  vi.spyOn(db.prefs, "bulkPut").mockImplementation(async (rows) => {
    const result = await original(rows);
    syncLifecycle.invalidate();
    return result;
  });
  await expect(saveConnection({ address, token }, { signal: operation.controller.signal })).rejects.toThrow();
  expect((await readSyncConfig()).token).toBe("");
});
it("keeps handled-version history out of the notebook hook's React state and rendered preferences", async () => {
  const handled = [{ proposal: "HANDLED-STATE-SENTINEL", hash: "a".repeat(64), generation: null, outcome: "applied" }];
  await db.prefs.put({ key: "syncHandled", value: handled });
  const { result } = renderHook(useNotebook);
  let refreshed;
  await act(async () => { refreshed = await result.current.refresh(); });
  expect(refreshed.prefs).not.toHaveProperty("syncHandled");
  expect(result.current.prefs).not.toHaveProperty("syncHandled");
  render(<output>{JSON.stringify(result.current)}</output>);
  expect(screen.getByRole("status").textContent).not.toContain("HANDLED-STATE-SENTINEL");
  expect(await getPref("syncHandled")).toEqual(handled);
});
it.each([1, 2, 3, 4])("ignores handled-version history in a schema %s backup", (schemaVersion) => {
  const result = validateBackup(backupFixture({ schemaVersion, files: [], preferences: { syncHandled: [{ proposal: "p-old" }] } }));
  expect(result.ok).toBe(true);
  expect(result.warnings).toEqual(["Preference syncHandled is specific to the device it was exported from and will be ignored."]);
  expect(result.envelope.preferences).toEqual({});
});
