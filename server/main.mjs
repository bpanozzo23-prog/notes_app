import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createContext, createHandler } from "./handler.mjs";
import { loadConfig, validateConfig } from "./config.mjs";
import { createGit, initStore } from "./store.mjs";
import { createPairing } from "./pairing.mjs";
import { createServer } from "./http.mjs";
import { isEntryPoint, mkdir, removeTemps } from "./fsutil.mjs";
import { resolveJournal, retryHistory } from "./round.mjs";
import { enqueueInboxScan } from "./inbox.mjs";
import path from "node:path";

const execute = promisify(execFile);
export function createTailscale(run = execute) {
  const read = async (name) => JSON.parse((await run("tailscale", [name, "status", "--json"], { maxBuffer: 1024 * 1024 })).stdout);
  return { funnelStatus: () => read("funnel"), serveStatus: () => read("serve") };
}
export function checkFunnel(status, config) {
  if (!status || typeof status !== "object" || Array.isArray(status)) throw new Error("funnel-unreadable");
  // AllowFunnel keys name the public listener (normally :8443), not the loopback port.
  // An unrelated public service is allowed only when its mapping is unambiguous.
  function unrelated(scope, listener) {
    if (Number(listener.split(":").at(-1)) === config.port) return false;
    const handlers = scope.Web?.[listener]?.Handlers;
    if (handlers && Object.keys(handlers).length) {
      return Object.values(handlers).every((handler) => {
        if (typeof handler?.Proxy !== "string") return false;
        try {
          const target = new URL(handler.Proxy);
          return ["http:", "https:"].includes(target.protocol) &&
            ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) &&
            Number(target.port || (target.protocol === "https:" ? 443 : 80)) !== config.port;
        } catch { return false; }
      });
    }
    const forward = scope.TCP?.[listener.split(":").at(-1)]?.TCPForward;
    if (typeof forward === "string") {
      try {
        const target = new URL(`http://${forward}`);
        return ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) && Number(target.port) !== config.port;
      } catch { return false; }
    }
    return false;
  }
  function enabled(value) {
    if (!value || typeof value !== "object") return false;
    for (const [key, child] of Object.entries(value)) {
      if (key === "AllowFunnel") {
        if (!child || typeof child !== "object" || Array.isArray(child) ||
            Object.entries(child).some(([listener, flag]) => flag !== false && (flag !== true || !unrelated(value, listener)))) return true;
      } else if (enabled(child)) return true;
    }
    return false;
  }
  if (enabled(status)) throw new Error("funnel-enabled");
}
export async function startupChecks(config, { git = createGit(path.join(config.storeDir, "store")),
  tailscale = createTailscale(), env = process.env } = {}) {
  validateConfig(config);
  if (await git.hasRemote()) throw new Error("git-remote");
  if (env.NOTES_SYNC_TEST === "1" && env.NOTES_SYNC_SKIP_TAILSCALE === "1") return;
  let status;
  try { status = await tailscale.funnelStatus(); } catch { throw new Error("funnel-unreadable"); }
  checkFunnel(status, config);
}
export async function serve(config, overrides = {}) {
  await startupChecks(config, overrides);
  const context = await createContext(config, overrides);
  await context.enqueue(async () => {
    await resolveJournal(context);
    await retryHistory(context);
    await removeTemps(config.storeDir);
    await removeTemps(config.configDir);
    await context.store.pruneUploads([], context.now());
    await context.rebuildView(context.store.published);
  });
  const server = (overrides.serverFactory ?? createServer)(createHandler(context), config);
  await server.start();
  const stopInboxTimer = startInboxTimer(context);
  server.once?.("close", stopInboxTimer);
  return { context, server, stopInboxTimer };
}
export function startInboxTimer(context, { schedule = setInterval, cancel = clearInterval } = {}) {
  const timer = schedule(() => {
    if (context.inboxScans) return;
    return enqueueInboxScan(context, async () => {
      await resolveJournal(context);
      await retryHistory(context);
      if (!context.store.published.meta.historyError) await context.scanInbox(context);
    }).catch(() => {
      // Never log paths, proposal contents, or arbitrary exception messages.
      try { context.logger(JSON.stringify({ event: "inbox-scan-failed" })); } catch { /* Best effort. */ }
    });
  }, 3000);
  timer.unref();
  return () => cancel(timer);
}
export async function status(config, overrides = {}) {
  const context = await createContext(config, overrides);
  const device = await context.pairing.device();
  const tailscale = overrides.tailscale ?? createTailscale();
  const read = async (fn) => { try { return await fn(); } catch { return null; } };
  const [funnel, serving] = await Promise.all([read(() => tailscale.funnelStatus()), read(() => tailscale.serveStatus())]);
  let funnelState = "unreadable";
  if (funnel) {
    try { checkFunnel(funnel, config); funnelState = "off"; } catch { funnelState = "on"; }
  }
  const s = context.store.state();
  return { round: s.round, counts: s.counts, lastRoundAt: s.lastRoundAt,
    missingImages: s.missingImages.length, historyError: s.historyError,
    paired: device ? { label: device.label, pairedAt: device.pairedAt } : null,
    journalPending: Boolean(await context.store.readJournal()),
    serve: serving === null ? "unreadable" : Object.keys(serving).length ? "configured" : "off", funnel: funnelState };
}
export async function main(args = process.argv.slice(2), overrides = {}) {
  const env = overrides.env ?? process.env;
  const config = overrides.config ?? await loadConfig(env);
  validateConfig(config);
  const print = overrides.print ?? ((line) => process.stdout.write(`${line}\n`));
  switch (args[0]) {
    case "init-store":
      await mkdir(config.configDir);
      await initStore(config.storeDir, { git: overrides.git });
      return;
    case "pair": {
      const window = await createPairing(config.configDir, overrides.now).openWindow();
      print(`${window.code} ${window.expiresAt}`);
      return;
    }
    case "status": print(JSON.stringify(await status(config, overrides))); return;
    case "serve": return serve(config, {
      logger: print, ...overrides,
      // The only environment-driven crash injection; library code never looks at process.env.
      afterStep: overrides.afterStep ?? ((step) => {
        if (env.NOTES_SYNC_TEST_CRASH_AFTER === step) process.exit(86);
      }),
    });
    default: throw new Error("unknown-command");
  }
}
if (isEntryPoint(import.meta.url)) {
  main().catch((error) => {
    // Never print child-process stderr or arbitrary exception messages: they can contain data.
    const safe = ["invalid-config", "invalid-config-paths", "git-remote", "funnel-unreadable", "funnel-enabled", "unknown-command"];
    process.stderr.write(`${JSON.stringify({ error: safe.includes(error.message) ? error.message : "startup-failed" })}\n`);
    process.exitCode = 1;
  });
}
