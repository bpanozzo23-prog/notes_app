import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../App.jsx";
import { resetDatabase } from "../test/fixtures.js";
import { buildBackup } from "../db/backup.js";
import { db } from "../db/db.js";
import { note } from "../../server/test-support.js";
import { saveConnection } from "./prefs.js";
import { syncSession } from "./session.js";
import { syncFixture } from "./test-support.js";

let server;
beforeEach(async () => {
  await resetDatabase();
  window.history.replaceState(null, "");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  server = await syncFixture();
});
afterEach(async () => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  await server.clean();
});

it("boots the engine without UI and never renders or logs the sentinel connection token", async () => {
  const token = "SYNC-TOKEN-SENTINEL";
  await saveConnection({ address: server.address, token });
  await db.notes.put(note());
  const logs = ["log", "warn", "error", "info", "debug"].map((name) => vi.spyOn(console, name));
  vi.stubGlobal("fetch", server.fetch);
  await act(async () => { render(<App />); });
  await screen.findByRole("button", { name: "Fixture title" });
  await waitFor(() => expect(syncSession.getSnapshot().error).toEqual({ kind: "unauthorized" }));
  expect(document.body.textContent).not.toContain(token);
  expect(JSON.stringify(syncSession.getSnapshot())).not.toContain(token);
  expect(JSON.stringify(await buildBackup())).not.toContain(token);
  expect(JSON.stringify(logs.flatMap((log) => log.mock.calls))).not.toContain(token);
  expect(JSON.stringify(server.logger.mock.calls)).not.toContain(token);
  expect(server.requests).toHaveLength(1);
  expect(server.requests[0].headers.authorization).toBe(`Bearer ${token}`);
  expect(server.requests[0].body).toBeUndefined();
  expect(screen.queryByRole("button", { name: /sync/i })).toBeNull();
});
