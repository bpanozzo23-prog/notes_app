// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { AT, fixture, push } from "./test-support.js";
import { loadConfig, validateConfig } from "./config.mjs";
import { main, serve, startupChecks, status, createTailscale, startInboxTimer } from "./main.mjs";
import { createServer } from "./http.mjs";
import { TEMP_PREFIX, writeJson } from "./fsutil.mjs";
import { enqueueInboxScan } from "./inbox.mjs";
import { readProposals } from "./proposals.mjs";

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
  result.stopInboxTimer();
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

it("polls every 3 seconds with an unreferenced timer, skips queued/running scans, and survives errors", async () => {
  let tick;
  const timer = { unref: vi.fn() };
  const schedule = vi.fn((callback) => { tick = callback; return timer; });
  const cancel = vi.fn();
  const stop = startInboxTimer(f.context, { schedule, cancel });
  expect(schedule).toHaveBeenCalledWith(expect.any(Function), 3000);
  expect(timer.unref).toHaveBeenCalledOnce();
  let releaseQueue, releaseScan;
  const queued = f.context.enqueue(() => new Promise((resolve) => { releaseQueue = resolve; }));
  await Promise.resolve();
  const scanStarted = new Promise((resolve) => {
    f.context.scanInbox = vi.fn(() => { resolve(); return new Promise((done) => { releaseScan = done; }); });
  });
  const scan = tick();
  expect(f.context.inboxScans).toBe(1);
  tick(); tick();
  expect(f.context.scanInbox).not.toHaveBeenCalled();
  releaseQueue(); await queued; await scanStarted;
  tick(); tick();
  expect(f.context.scanInbox).toHaveBeenCalledOnce();
  releaseScan(); await scan;
  expect(f.context.inboxScans).toBe(0);
  f.context.scanInbox.mockRejectedValueOnce(new Error("PRIVATE SENTINEL"));
  await tick();
  expect(f.context.inboxScans).toBe(0);
  expect(f.logger).toHaveBeenCalledWith('{"event":"inbox-scan-failed"}');
  expect(JSON.stringify(f.logger.mock.calls)).not.toContain("PRIVATE SENTINEL");
  f.context.scanInbox.mockResolvedValue([]);
  await tick();
  expect(f.context.scanInbox).toHaveBeenCalledTimes(3);
  stop(); expect(cancel).toHaveBeenCalledWith(timer);
});
it("skips timer ticks while a state scan is queued or running, including a failed request", async () => {
  let tick, release;
  const stop = startInboxTimer(f.context, { schedule: (callback) => { tick = callback; return { unref() {} }; }, cancel() {} });
  const queued = f.context.enqueue(() => new Promise((resolve) => { release = resolve; }));
  await Promise.resolve();
  // Same queue wrapper used by GET /v1/state; no HTTP socket is involved.
  const scan = enqueueInboxScan(f.context, async () => { throw new Error("failed-state"); });
  const rejected = expect(scan).rejects.toThrow("failed-state");
  expect(tick()).toBeUndefined();
  expect(f.context.inboxScans).toBe(1);
  release(); await queued; await rejected;
  expect(f.context.inboxScans).toBe(0);
  stop();
});
it("timer ingestion uses journal recovery and history blocking before scanning", async () => {
  await f.request("POST", "/v1/push", push());
  f.context.afterStep = (name) => { if (name === "apply") throw new Error("crash"); };
  await f.request("POST", "/v1/push", push([], { base: { round: 1, generation: "generation-A" },
    tombstones: [{ id: "note-1", purgedAt: AT }] }));
  delete f.context.afterStep;
  let tick;
  const stop = startInboxTimer(f.context, { schedule: (callback) => { tick = callback; return { unref() {} }; }, cancel() {} });
  f.context.scanInbox = vi.fn(async () => {
    expect(await f.context.store.readJournal()).toBeNull();
    expect(f.context.store.state().round).toBe(2);
  });
  f.git.commit.mockRejectedValue(new Error("git-failed"));
  await tick();
  expect(f.context.scanInbox).not.toHaveBeenCalled();
  expect(f.context.store.published.meta.historyError).toBe(true);
  f.git.commit.mockResolvedValue();
  await tick();
  expect(f.context.scanInbox).toHaveBeenCalledOnce();
  stop();
});
it("ingests and cleans up a stable pair by timer alone with no state request", async () => {
  await f.request("POST", "/v1/push", push());
  const inbox = path.join(f.config.viewDir, "inbox");
  await fs.writeFile(path.join(inbox, "p-timer.html"), "<p>Timer fixture</p>");
  await fs.writeFile(path.join(inbox, "p-timer.json"), JSON.stringify({ note: "note-1", basedOnRev: 1,
    generation: "generation-A", title: "Timer", folderId: null, tags: [], why: "" }));
  let tick;
  const stop = startInboxTimer(f.context, { schedule: (callback) => { tick = callback; return { unref() {} }; }, cancel() {} });
  await tick();
  expect(await readProposals(f.config.storeDir)).toEqual([]);
  await tick();
  expect((await readProposals(f.config.storeDir))[0].record).toMatchObject({ status: "pending", proposal: "p-timer" });
  expect(await fs.readdir(inbox)).toEqual([]);
  stop();
});

it("runs as a program when reached through a symlink, as the deployed service is", async () => {
  const { spawn } = await import("node:child_process");
  const link = path.join(f.root, "current");
  await fs.symlink(path.resolve("server"), link);
  // This sandbox suppresses child-process pipe output. A temporary file still checks the
  // actual CLI exit and JSON error, without falling back to an assertion on exit alone.
  const stderrPath = path.join(f.root, "stderr.txt");
  const stderr = await fs.open(stderrPath, "w", 0o600);
  try {
    // An unknown command proves main() ran: it refuses with a JSON error and exit code 1.
    const child = spawn(process.execPath, [path.join(link, "main.mjs"), "no-such-command"],
      { env: { ...process.env, NOTES_SYNC_CONFIG: path.join(f.root, "missing.json") }, stdio: ["ignore", "ignore", stderr.fd] });
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    expect(code).toBe(1);
  } finally { await stderr.close(); }
  expect(JSON.parse(await fs.readFile(stderrPath, "utf8"))).toEqual({ error: "startup-failed" });
});
