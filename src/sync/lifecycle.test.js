import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db, notebookAccess } from "../db/db.js";
import { resetDatabase } from "../test/fixtures.js";
import { createSyncLifecycle } from "./lifecycle.js";

let lifecycle, channel;
beforeEach(async () => {
  await resetDatabase();
  channel = { postMessage() {}, close() {} };
  lifecycle = createSyncLifecycle(notebookAccess, channel);
});
afterEach(() => lifecycle.dispose());

it("identifies rounds by a unique id, connection counter and generation without storing secrets", () => {
  const first = lifecycle.begin();
  expect(first.identity).toEqual({ id: expect.any(String), connection: 0, generation: null });
  lifecycle.connectionChanged();
  const next = lifecycle.begin();
  expect(first.controller.signal.aborted).toBe(true);
  expect(lifecycle.isCurrent(first)).toBe(false);
  expect(next.identity.connection).toBe(1);
  expect(next.identity.id).not.toBe(first.identity.id);
  expect(lifecycle.isCurrent(next)).toBe(true);
});

it("invalidates on both replacement and connection broadcasts, and ignores unrelated broadcasts", () => {
  const listener = vi.fn(); lifecycle.subscribe(listener);
  const first = lifecycle.begin();
  channel.onmessage({ data: { type: "unrelated" } });
  expect(lifecycle.isCurrent(first)).toBe(true);
  channel.onmessage({ data: { type: "notebook-replaced", generation: "new" } });
  expect(first.controller.signal.aborted).toBe(true);
  const next = lifecycle.begin();
  channel.onmessage({ data: { type: "sync-connection-changed" } });
  expect(next.controller.signal.aborted).toBe(true);
  expect(listener.mock.calls.map(([event]) => event)).toEqual(["invalidated", "connection-changed"]);
  expect(lifecycle.begin().identity.connection).toBe(1);
});

it("an activated update invalidates outstanding work and stays paused until explicitly released", () => {
  const operation = lifecycle.begin();
  lifecycle.beginUpdate();
  expect(operation.controller.signal.aborted).toBe(true);
  expect(lifecycle.isCurrent(operation)).toBe(false);
  expect(lifecycle.isUpdating()).toBe(true);
  const later = lifecycle.begin();
  expect(lifecycle.isCurrent(later)).toBe(false);
  lifecycle.invalidate();
  expect(lifecycle.isUpdating()).toBe(true);
  const listener = vi.fn(); lifecycle.subscribe(listener);
  lifecycle.endUpdate();
  expect(listener).toHaveBeenCalledWith("update-ended");
  expect(lifecycle.isUpdating()).toBe(false);
  expect(lifecycle.isCurrent(operation)).toBe(false);
  expect(lifecycle.isCurrent(lifecycle.begin())).toBe(true);
});

it("database versionchange cancels active work before closing the database", () => {
  const operation = lifecycle.begin();
  db.on.versionchange.fire({});
  expect(notebookAccess.getSnapshot().versionChange).toBe("pending");
  expect(db.isOpen()).toBe(true);
  expect(operation.controller.signal.aborted).toBe(true);
  expect(lifecycle.isCurrent(operation)).toBe(false);
});
