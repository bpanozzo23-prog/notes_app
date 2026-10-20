import { afterEach, expect, it, vi } from "vitest";
import { createSyncClient } from "./client.js";
import { NETWORK_PERMISSION, TIMEOUTS } from "./config.js";
import { syncFixture } from "./test-support.js";

const address = "https://fixture.invalid:8443", token = "SYNC-TOKEN-SENTINEL";
const response = (status, body) => async () => new Response(JSON.stringify(body), { status });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  [401, { error: token }, "unauthorized"],
  [403, { error: "no-pairing", debug: token }, "pairing", { reason: "no-pairing" }],
  [403, { error: "wrong-code" }, "pairing", { reason: "wrong-code" }],
  [409, { error: "changed" }, "changed"],
  [409, { error: "confirm", confirm: "confirmation", removed: [{ id: "x", title: "X", debug: token }], changed: [], debug: token }, "confirm", { removed: [{ id: "x", title: "X" }], changed: [], confirm: "confirmation" }],
  [409, { error: "update-service" }, "update-service"],
  [409, { error: "update-app" }, "update-app"],
  [503, { error: "history-blocked" }, "history-blocked"],
  [503, { error: "storage-problem" }, "server"],
  [500, { error: token }, "server"],
  [403, { error: "origin", debug: token }, "invalid"],
  [400, { error: token }, "invalid"],
  [404, { error: token }, "invalid"],
])("maps HTTP %s %j to fixed data", async (status, body, kind, details) => {
  const actual = await createSyncClient({ address, token, fetch: response(status, body) }).state();
  expect(actual).toEqual({ ok: false, kind, status, ...(details ? { details } : {}) });
  expect(JSON.stringify(actual)).not.toContain(token);
});

it.each(["denied", "granted", "prompt", "throws", "absent"])("maps network failure with permission %s", async (state) => {
  const query = vi.fn(async () => { if (state === "throws") throw new Error(token); return { state }; });
  vi.stubGlobal("navigator", state === "absent" ? {} : { permissions: { query } });
  const client = createSyncClient({ address, token, fetch: async () => { throw new Error(token); } });
  expect(await client.state()).toEqual({ ok: false, kind: state === "denied" ? "blocked" : "unreachable" });
  if (state !== "absent") expect(query).toHaveBeenCalledWith({ name: NETWORK_PERMISSION });
});

it("uses the round signal and each endpoint's timeout, sends secrets only in the auth header", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const controller = new AbortController();
  const fetch = vi.fn(response(200, { fine: true }));
  const client = createSyncClient({ address, token, fetch });
  const bytes = new Uint8Array([1, 2, 3]);
  await client.pair({ code: "123456" }, controller.signal);
  await client.state(controller.signal);
  await client.upload("image / ñ?", bytes, "gen /?", controller.signal);
  await client.upload("image", bytes, null, controller.signal);
  await client.push({ rows: [] }, controller.signal);
  await client.outcomes([], controller.signal);
  await client.backup(controller.signal);
  await client.unpair(controller.signal);
  expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([TIMEOUTS.pair, TIMEOUTS.state, TIMEOUTS.upload, TIMEOUTS.upload, TIMEOUTS.push, TIMEOUTS.outcomes, TIMEOUTS.backup, TIMEOUTS.unpair]);
  expect(fetch.mock.calls[2][0]).toBe(`${address}/v1/files/image%20%2F%20%C3%B1%3F?generation=gen%20%2F%3F`);
  expect(fetch.mock.calls[3][0]).toBe(`${address}/v1/files/image`);
  for (const [i, [, options]] of fetch.mock.calls.entries()) {
    expect(options.signal.aborted).toBe(false);
    expect(JSON.stringify(options.body) ?? "").not.toContain(token);
    expect(options.headers.Authorization).toBe(i === 0 ? undefined : `Bearer ${token}`);
    if (options.body) expect(options.headers["Content-Type"]).toBe(i === 2 || i === 3 ? "application/octet-stream" : "application/json");
    expect(options.redirect).toBe("error");
  }
  controller.abort();
  for (const [, options] of fetch.mock.calls) expect(options.signal.aborted).toBe(true);
  expect(await client.state(controller.signal)).toEqual({ ok: false, kind: "cancelled" });
  expect(fetch).toHaveBeenCalledTimes(8);
});

it("cancels late replies and maps a timeout without exposing its error", async () => {
  const controller = new AbortController();
  const client = createSyncClient({ address, token, fetch: async () => {
    controller.abort(); return new Response(JSON.stringify({ secret: token }));
  } });
  expect(await client.state(controller.signal)).toEqual({ ok: false, kind: "cancelled" });
  const expired = new AbortController(); expired.abort(new DOMException(token, "TimeoutError"));
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(expired.signal);
  const timed = createSyncClient({ address, token, fetch: async (_, { signal }) => { signal.throwIfAborted(); } });
  expect(await timed.state()).toEqual({ ok: false, kind: "unreachable" });
});

it("maps malformed JSON, unsafe addresses and thrown body reads without raw text", async () => {
  const fetch = vi.fn(async () => new Response(token));
  expect(await createSyncClient({ address, token, fetch }).state()).toEqual({ ok: false, kind: "invalid", status: 200 });
  expect(await createSyncClient({ address: "https://user:password@fixture.invalid", token, fetch }).state()).toEqual({ ok: false, kind: "invalid" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("pairs, reads state, records outcomes, downloads a backup and disconnects through the real handler", async () => {
  const server = await syncFixture();
  try {
    const window = await server.context.pairing.openWindow();
    const client = server.clientFactory({ address: server.address, token: "" });
    const paired = await client.pair({ code: window.code });
    expect(paired.ok).toBe(true);
    const connected = server.clientFactory({ address: server.address, token: paired.body.token });
    expect(await connected.state()).toMatchObject({ ok: true, body: { round: 0, fullPush: true } });
    expect(await connected.outcomes([])).toMatchObject({ ok: true, body: { recorded: [] } });
    expect(await connected.backup()).toMatchObject({ ok: true, body: { format: "notes_app-backup" } });
    expect(await connected.unpair()).toMatchObject({ ok: true });
    expect(await connected.state()).toMatchObject({ kind: "unauthorized" });
  } finally { await server.clean(); }
});

it("test setup refuses real tailnet fetch and XHR, including Request inputs", () => {
  for (const input of ["https://test.ts.net:8443/v1/state", new URL("https://test.ts.net."), new Request("https://test.ts.net")]) {
    expect(() => globalThis.fetch(input)).toThrow("Real Tailscale request in a test");
  }
  expect(() => new XMLHttpRequest().open("GET", "https://test.ts.net/v1/state")).toThrow("Real Tailscale request in a test");
});
