// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fixture, push, PNG, AT } from "./test-support.js";
import { createHandler } from "./handler.mjs";
import { MAX_IMAGE_BYTES, MAX_JSON_BYTES, PAIRING_WINDOW_MS } from "./constants.mjs";
import { readJson, sha256 } from "./fsutil.mjs";
import { readLimitedBody } from "./http.mjs";
import { detectImage } from "./validate.mjs";

let f;
beforeEach(async () => {
  vi.stubGlobal("fetch", () => { throw new Error("network-forbidden"); });
  f = await fixture();
});
afterEach(async () => { await f?.clean(); vi.unstubAllGlobals(); });
describe("checks before the lazy body reader", () => {
  it.each([
    ["Origin absent", "POST", "/v1/push", { origin: undefined }, 403, "origin"],
    ["Origin different", "POST", "/v1/pair", { origin: "https://evil.invalid" }, 403, "origin"],
    ["Origin trailing slash", "POST", "/v1/pair", { origin: "https://fixture.invalid/" }, 403, "origin"],
    ["Host different", "POST", "/v1/pair", { host: "fixture.invalid" }, 403, "host"],
    ["Host absent", "POST", "/v1/pair", { host: undefined }, 403, "host"],
    ["token absent", "POST", "/v1/push", { authorization: undefined }, 401, "unauthorized"],
    ["token wrong", "POST", "/v1/push", { authorization: `Bearer ${"a".repeat(43)}` }, 401, "unauthorized"],
    ["unpair requires token", "DELETE", "/v1/pair", { authorization: undefined }, 401, "unauthorized"],
    ["state requires token", "GET", "/v1/state", { authorization: undefined }, 401, "unauthorized"],
    ["backup requires token", "GET", "/v1/backup", { authorization: undefined }, 401, "unauthorized"],
    ["JSON content type", "POST", "/v1/push", { "content-type": "text/plain" }, 415, "content-type"],
    ["JSON content type absent", "POST", "/v1/pair", { "content-type": undefined }, 415, "content-type"],
    ["upload content type", "PUT", "/v1/files/image", { "content-type": "image/png" }, 415, "content-type"],
    ["oversized announced JSON", "POST", "/v1/push", { "content-length": String(MAX_JSON_BYTES + 1) }, 413, "too-large"],
    ["oversized announced upload", "PUT", "/v1/files/image", { "content-length": String(MAX_IMAGE_BYTES + 1) }, 413, "too-large"],
    ["bad image id", "PUT", "/v1/files/%00", {}, 400, "invalid-id"],
    ["malformed escape", "PUT", "/v1/files/%QQ", {}, 400, "invalid-id"],
    ["duplicate generation", "PUT", "/v1/files/x?generation=a&generation=b", {}, 400, "invalid-generation"],
    ["unknown endpoint", "POST", "/v1/nope", {}, 404, "not-found"],
    ["unknown method", "PATCH", "/v1/push", {}, 404, "not-found"],
  ])("%s", async (_, method, url, headers, status, error) => {
    const result = await f.request(method, url, { sentinel: "Never read me" }, headers);
    expect(result.status).toBe(status);
    expect(result.body).toEqual({ error });
    expect(result.readBody).not.toHaveBeenCalled();
    expect(result.headers["Cache-Control"]).toBe("no-store");
    if (error !== "origin") {
      expect(result.headers["Access-Control-Allow-Origin"]).toBe(f.config.origin);
      expect(result.headers.Vary).toBe("Origin");
    } else expect(result.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
  it("allows only valid preflights without a token and supports private-network requests", async () => {
    const result = await f.request("OPTIONS", "/v1/push", {}, { authorization: undefined,
      "access-control-request-method": "POST", "access-control-request-headers": "Authorization, Content-Type",
      "access-control-request-private-network": "true" });
    expect(result.status).toBe(204);
    expect(result.readBody).not.toHaveBeenCalled();
    expect(result.headers).toMatchObject({ "Access-Control-Allow-Private-Network": "true",
      "Access-Control-Max-Age": "600", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE" });
  });
  it.each([
    {}, { "access-control-request-method": "PATCH" },
    { "access-control-request-method": "POST", "access-control-request-headers": "x-other" },
    { "access-control-request-method": "POST", "access-control-request-headers": "authorization," },
  ])("rejects invalid preflight %j without reading", async (headers) => {
    const response = await f.request("OPTIONS", "/v1/push", {}, headers);
    expect(response.status).toBe(403);
    expect(response.readBody).not.toHaveBeenCalled();
  });
  it("accepts header name case and charset parameters", async () => {
    const response = await f.request("POST", "/v1/outcomes", [], { "Content-Type": "Application/JSON; charset=utf-8" });
    expect(response.status).toBe(200);
    expect(response.readBody).toHaveBeenCalledWith(MAX_JSON_BYTES);
  });
});
describe("pairing", () => {
  it("opens a private, hashed, ten-minute window and installs only the token hash", async () => {
    const { code, expiresAt } = await f.context.pairing.openWindow();
    expect(code).toMatch(/^\d{6}$/);
    expect(Date.parse(expiresAt) - Date.parse(AT)).toBe(PAIRING_WINDOW_MS);
    const window = await readJson(path.join(f.config.configDir, "pairing.json"));
    expect(window).toEqual({ codeSha256: sha256(code), expiresAt, tries: 0 });
    const result = await f.request("POST", "/v1/pair", { code, label: "Second fixture" }, { authorization: undefined });
    expect(result.status).toBe(200);
    expect(result.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const device = await f.context.pairing.device();
    expect(device).toEqual({ tokenSha256: sha256(result.body.token), pairedAt: AT, label: "Second fixture", firstPushPending: true });
    expect((await fs.stat(path.join(f.config.configDir, "device.json"))).mode & 0o777).toBe(0o600);
    expect((await f.request("POST", "/v1/pair", { code, label: "Again" })).body.error).toBe("no-pairing");
    expect((await f.request("GET", "/v1/state")).status).toBe(401); // Previous token replaced.
  });
  it("expires at ten minutes", async () => {
    const { code } = await f.context.pairing.openWindow();
    f.setTime(Date.parse(AT) + PAIRING_WINDOW_MS);
    expect((await f.request("POST", "/v1/pair", { code, label: "Phone" })).body.error).toBe("no-pairing");
  });
  it("closes after exactly five wrong codes", async () => {
    const { code } = await f.context.pairing.openWindow();
    for (let i = 1; i <= 5; i++) {
      expect((await f.request("POST", "/v1/pair", { code: "wrong", label: "Phone" })).body.error).toBe("wrong-code");
      if (i < 5) expect((await readJson(path.join(f.config.configDir, "pairing.json"))).tries).toBe(i);
    }
    expect((await f.request("POST", "/v1/pair", { code, label: "Phone" })).body.error).toBe("no-pairing");
  });
  it("serialises simultaneous uses of one code", async () => {
    const { code } = await f.context.pairing.openWindow();
    const responses = await Promise.all([1, 2].map(() => f.request("POST", "/v1/pair", { code, label: "Phone" })));
    expect(responses.map((r) => r.status)).toEqual([200, 403]);
  });
  it("unpairs without deleting the store", async () => {
    expect((await f.request("DELETE", "/v1/pair")).status).toBe(200);
    expect((await f.request("GET", "/v1/state")).status).toBe(401);
    expect(await readJson(f.context.store.file("meta.json"))).toHaveProperty("round", 0);
  });
});
it("logs only method, query-free path, status, elapsed time and byte counts", async () => {
  f.logger.mockClear();
  await f.request("PUT", "/v1/files/fixture-image?generation=DO-NOT-LOG", PNG);
  await f.request("POST", "/v1/push", { secretBody: "DO-NOT-LOG" });
  expect(f.logger).toHaveBeenCalledTimes(2);
  for (const [line] of f.logger.mock.calls) {
    expect(line).not.toContain("DO-NOT-LOG");
    expect(line).not.toContain(f.token);
    expect(Object.keys(JSON.parse(line)).sort()).toEqual(["bytesIn", "bytesOut", "method", "ms", "path", "status"]);
  }
  expect(JSON.parse(f.logger.mock.calls[0][0])).toMatchObject({ bytesIn: PNG.length, status: 200, path: "/v1/files/fixture-image" });
});
it("rejects invalid JSON and invalid UTF-8 without echoing the body", async () => {
  for (const bytes of [Buffer.from("not-json-sensitive"), Buffer.from([255]), Buffer.from('{"preferences":{"toolbar":[1e999]}}')]) {
    expect((await f.request("POST", "/v1/push", bytes)).body).toEqual({ error: "invalid-json" });
  }
});
it("enforces actual upload and JSON limits even without a Content-Length", async () => {
  for (const [method, url, size] of [["PUT", "/v1/files/i", MAX_IMAGE_BYTES], ["POST", "/v1/push", MAX_JSON_BYTES]]) {
    const result = await f.request(method, url, Buffer.alloc(size + 1));
    expect(result.status).toBe(413);
  }
});
it("checks image signatures and rejects empty or unrelated bytes", async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from("not an image")]) {
    expect((await f.request("PUT", "/v1/files/i", bytes)).body.error).toBe("invalid-image");
  }
  for (const [bytes, type] of [[PNG, "image/png"], [Buffer.from([255, 216, 255]), "image/jpeg"],
    [Buffer.from("RIFF1234WEBPbytes"), "image/webp"], [Buffer.from("GIF87a"), "image/gif"], [Buffer.from("GIF89a"), "image/gif"]]) {
    expect(detectImage(bytes)).toBe(type);
    expect((await f.request("PUT", "/v1/files/i", bytes)).status).toBe(200);
  }
  expect(detectImage(Buffer.from("RIFFbad"))).toBeNull();
});
it("streams a limited body without opening any socket", async () => {
  expect(await readLimitedBody(Readable.from([Buffer.from("abc"), Buffer.from("de")]), 5)).toEqual(Buffer.from("abcde"));
  await expect(readLimitedBody(Readable.from([Buffer.alloc(3), Buffer.alloc(3)]), 5)).rejects.toMatchObject({ status: 413, bytesIn: 6 });
});

describe("review fixes (Claude Code, 4a)", () => {
  const headers = (extra = {}) => ({ origin: f.config.origin, host: f.config.hosts[0],
    authorization: `Bearer ${f.token}`, "content-type": "application/json", ...extra });
  it("answers a preflight without waiting for the mutation queue", async () => {
    let release;
    const blocker = f.context.enqueue(() => new Promise((resolve) => { release = resolve; }));
    const handle = createHandler(f.context);
    const result = await handle({ method: "OPTIONS", path: "/v1/push", readBody: vi.fn(), headers: {
      origin: f.config.origin, host: f.config.hosts[0], "access-control-request-method": "POST",
      "access-control-request-headers": "authorization, content-type" } });
    expect(result.status).toBe(204);
    release();
    await blocker;
  });
  it("reads a slow body outside the queue, so other requests aren't held up", async () => {
    const handle = createHandler(f.context);
    let deliver;
    const slow = handle({ method: "POST", path: "/v1/push", headers: headers(),
      readBody: () => new Promise((resolve) => { deliver = resolve; }) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const state = await handle({ method: "GET", path: "/v1/state", headers: headers(), readBody: vi.fn() });
    expect(state.status).toBe(200);
    deliver(Buffer.from(JSON.stringify(push())));
    expect((await slow).status).toBe(200);
  });
  it("re-checks the token inside the queue after the body arrives", async () => {
    const handle = createHandler(f.context);
    let deliver;
    const pending = handle({ method: "POST", path: "/v1/push", headers: headers(),
      readBody: () => new Promise((resolve) => { deliver = resolve; }) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await handle({ method: "DELETE", path: "/v1/pair", headers: headers(), readBody: vi.fn() })).status).toBe(200);
    deliver(Buffer.from(JSON.stringify(push())));
    expect((await pending).status).toBe(401);
    expect(f.context.store.published.meta.round).toBe(0);
  });
  it("logs unexpected failures by kind only, never their message", async () => {
    const failing = Object.assign(new Error("Secret note text in a path"), { code: "EIO" });
    f.context.store.recordUpload = async () => { throw failing; };
    const result = await f.request("PUT", "/v1/files/image-1", PNG);
    expect(result.status).toBe(503);
    const lines = f.logger.mock.calls.map(([line]) => line).join("\n");
    expect(lines).toContain('"code":"EIO"');
    expect(lines).not.toContain("Secret note text");
  });
  it("tells a newly paired phone to send every row, until its first push lands", async () => {
    expect((await f.request("GET", "/v1/state")).body.fullPush).toBe(true);
    expect((await f.request("POST", "/v1/push", push())).status).toBe(200);
    expect((await f.request("GET", "/v1/state")).body.fullPush).toBe(false);
  });
});
