// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { AT, fixture, push } from "./test-support.js";
import { loadConfig, validateConfig } from "./config.mjs";
import { main, serve, startupChecks, status, createTailscale } from "./main.mjs";
import { createServer } from "./http.mjs";
import { TEMP_PREFIX, writeJson } from "./fsutil.mjs";

let f;
beforeEach(async () => { f = await fixture(); });
afterEach(async () => { await f?.clean(); });
const tailscale = () => ({ funnelStatus: vi.fn(async () => ({})), serveStatus: vi.fn(async () => ({})) });
it("loads config only from the explicit fixture path", async () => {
  const filename = path.join(f.root, "fixture-config.json");
  await writeJson(filename, f.config);
  expect(await loadConfig({ NOTES_SYNC_CONFIG: filename })).toEqual(f.config);
  await expect(loadConfig({ NOTES_SYNC_CONFIG: path.join(f.root, "missing") })).rejects.toThrow();
});
it.each([
  ["origin", "https://fixture.invalid/path"], ["origin", "file:///test"], ["origin", "null"],
  ["hosts", []], ["hosts", ["bad host"]], ["hosts", ["fixture", "fixture"]],
  ["listen", "0.0.0.0"], ["listen", "::"], ["port", 0], ["port", 65536], ["port", "8790"],
  ["storeDir", "relative"], ["configDir", "/"], ["viewDir", "/bad\0path"],
])("refuses invalid config %s=%j", (key, value) => {
  expect(() => validateConfig({ ...f.config, [key]: value })).toThrow("invalid-config");
});
it("refuses overlapping trusted and view paths", () => {
  expect(() => validateConfig({ ...f.config, viewDir: path.join(f.config.storeDir, "view") })).toThrow("invalid-config-paths");
  expect(() => validateConfig({ ...f.config, configDir: f.config.storeDir })).toThrow("invalid-config-paths");
});
it("refuses a remote before starting a listener or checking Tailscale", async () => {
  const ts = tailscale(), serverFactory = vi.fn();
  f.git.hasRemote.mockResolvedValue(true);
  await expect(serve(f.config, { git: f.git, tailscale: ts, serverFactory, env: {} })).rejects.toThrow("git-remote");
  expect(serverFactory).not.toHaveBeenCalled();
  expect(ts.funnelStatus).not.toHaveBeenCalled();
});
it.each([
  { AllowFunnel: { "fixture.invalid:8443": true } },
  { Foreground: { fixture: { AllowFunnel: { "fixture.invalid:8443": true } } } },
  { AllowFunnel: { "fixture.invalid:8443": "unexpected" } },
])("refuses enabled or ambiguous Funnel %j", async (value) => {
  const ts = tailscale(); ts.funnelStatus.mockResolvedValue(value);
  await expect(startupChecks(f.config, { git: f.git, tailscale: ts, env: {} })).rejects.toThrow("funnel-enabled");
});
it("fails closed when Funnel status cannot be read", async () => {
  const ts = tailscale(); ts.funnelStatus.mockRejectedValue(new Error("private CLI stderr"));
  await expect(startupChecks(f.config, { git: f.git, tailscale: ts, env: {} })).rejects.toThrow("funnel-unreadable");
  ts.funnelStatus.mockResolvedValue(null);
  await expect(startupChecks(f.config, { git: f.git, tailscale: ts, env: {} })).rejects.toThrow("funnel-unreadable");
});
it("checks the public listener's proxy target, allowing an unambiguously unrelated service", async () => {
  const ts = tailscale();
  const value = { AllowFunnel: { "fixture.invalid:8443": true },
    Web: { "fixture.invalid:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8790" } } } } };
  ts.funnelStatus.mockResolvedValue(value);
  await expect(startupChecks(f.config, { git: f.git, tailscale: ts, env: {} })).rejects.toThrow("funnel-enabled");
  value.Web["fixture.invalid:8443"].Handlers["/"].Proxy = "http://127.0.0.1:8787";
  await expect(startupChecks(f.config, { git: f.git, tailscale: ts, env: {} })).resolves.toBeUndefined();
  value.Web["fixture.invalid:8443"].Handlers["/notes"] = { Proxy: "http://127.0.0.1:8790" };
  await expect(startupChecks(f.config, { git: f.git, tailscale: ts, env: {} })).rejects.toThrow("funnel-enabled");
});
it("requires both test flags to bypass Tailscale and never bypasses remote/config checks", async () => {
  const ts = tailscale(); ts.funnelStatus.mockRejectedValue(new Error("unavailable"));
  for (const env of [{ NOTES_SYNC_SKIP_TAILSCALE: "1" }, { NOTES_SYNC_TEST: "1" }]) {
    await expect(startupChecks(f.config, { git: f.git, tailscale: ts, env })).rejects.toThrow("funnel-unreadable");
  }
  const env = { NOTES_SYNC_SKIP_TAILSCALE: "1", NOTES_SYNC_TEST: "1" };
  await expect(startupChecks(f.config, { git: f.git, tailscale: ts, env })).resolves.toBeUndefined();
  f.git.hasRemote.mockResolvedValue(true);
  await expect(startupChecks(f.config, { git: f.git, tailscale: ts, env })).rejects.toThrow("git-remote");
  await expect(startupChecks({ ...f.config, listen: "::" }, { git: f.git, tailscale: ts, env })).rejects.toThrow("invalid-config");
});
it("resolves a journal, removes temp files and rebuilds before listening (injected listener)", async () => {
  f.context.afterStep = (step) => { if (step === "apply") throw new Error("crash"); };
  await f.request("POST", "/v1/push", push());
  const temp = path.join(f.config.configDir, `${TEMP_PREFIX}fixture`);
  await fs.writeFile(temp, "partial");
  const rebuildView = vi.fn(async () => {});
  const start = vi.fn(async () => {
    expect(await f.context.store.readJournal()).toBeNull();
    await expect(fs.stat(temp)).rejects.toHaveProperty("code", "ENOENT");
    expect(rebuildView).toHaveBeenCalled();
  });
  const serverFactory = vi.fn(() => ({ start }));
  const result = await serve(f.config, { git: f.git, tailscale: tailscale(), env: {}, now: () => new Date(AT), serverFactory, rebuildView });
  expect(result.context.store.state().round).toBe(1);
  expect(start).toHaveBeenCalledOnce();
  expect(serverFactory.mock.calls[0][1].listen).toBe("127.0.0.1");
});
it("prints status counts/dates without note content, ids, tokens or arbitrary errors", async () => {
  await f.request("POST", "/v1/push", push());
  const output = await status(f.config, { git: f.git, tailscale: tailscale() });
  expect(output).toMatchObject({ round: 1, counts: { notes: 1 }, lastRoundAt: AT, missingImages: 0,
    paired: { label: "Fixture phone", pairedAt: AT }, historyError: false, journalPending: false, serve: "off", funnel: "off" });
  const json = JSON.stringify(output);
  expect(json).not.toContain("Fixture title");
  expect(json).not.toContain("note-1");
  expect(json).not.toContain(f.token);
  expect(json).not.toContain((await f.context.pairing.device()).tokenSha256);
});
it("CLI pair prints only the code and expiry", async () => {
  const print = vi.fn();
  await main(["pair"], { config: f.config, print, now: () => new Date(AT) });
  expect(print).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^\d{6} 2026-10-19T12:10:00.000Z$/));
});
it("uses execFile arguments for Tailscale, and the HTTP adapter refuses non-loopback", async () => {
  const run = vi.fn(async () => ({ stdout: "{}" }));
  const ts = createTailscale(run);
  await ts.funnelStatus();
  await ts.serveStatus();
  expect(run.mock.calls.map((args) => args.slice(0, 2))).toEqual([
    ["tailscale", ["funnel", "status", "--json"]], ["tailscale", ["serve", "status", "--json"]],
  ]);
  expect(() => createServer(() => {}, { listen: "0.0.0.0" })).toThrow("invalid-listen");
});
