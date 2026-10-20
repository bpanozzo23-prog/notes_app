// Importing this module is inert. Tests inject inspection and execution; no service runs.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { atomicWrite, isEntryPoint, mkdir, readJson, syncDirectory } from "../server/fsutil.mjs";
import { renderTemplate } from "../server/templates.mjs";
import { validateConfig } from "../server/config.mjs";

const run = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/;
export function deploymentPaths(home) {
  if (typeof home !== "string" || !path.isAbsolute(home) || /[\r\n\0]/.test(home) || path.resolve(home) === "/") {
    throw new Error("invalid-home");
  }
  home = path.resolve(home);
  return { home, viewDir: path.join(home, "notes"), storeDir: path.join(home, ".local/share/notes_app-sync"),
    configDir: path.join(home, ".config/notes_app-sync"), libDir: path.join(home, ".local/lib/notes_app-sync"),
    binDir: path.join(home, ".local/bin"), unitDir: path.join(home, ".config/systemd/user") };
}
export function defaultConfig(p) {
  return { origin: "https://bpanozzo23-prog.github.io", hosts: ["brent-dell-system-xps-l502x.tail1ce757.ts.net:8443"],
    listen: "127.0.0.1", port: 8790, home: p.home, storeDir: p.storeDir, viewDir: p.viewDir,
    configDir: p.configDir, libDir: p.libDir };
}
export function parseArgs(args) {
  const modes = args.filter((a) => ["--install", "--uninstall", "--rollback"].includes(a));
  if (modes.length > 1 || args.some((a) => !["--install", "--uninstall", "--rollback", "--dry-run"].includes(a)) ||
      new Set(args).size !== args.length) throw new Error("usage: sync-deploy [--install|--uninstall|--rollback] [--dry-run]");
  return { mode: modes[0]?.slice(2) ?? "deploy", dryRun: args.includes("--dry-run") };
}
export function versionsToKeep(versions, current, previous, count = 3) {
  const sorted = [...versions].filter((v) => SHA.test(v.sha)).sort((a, b) => b.mtimeMs - a.mtimeMs || a.sha.localeCompare(b.sha));
  return [...new Set([current, previous, ...sorted.map((v) => v.sha)].filter((s) => s && sorted.some((v) => v.sha === s)))].slice(0, count);
}
export function planDeployment({ mode, paths: p, sha, dirty = "", current = null, previous = null, versions = [], hasUnit = false }) {
  const actions = [];
  const command = (file, args, extra = {}) => actions.push({ type: "command", file, args, ...extra });
  const unit = path.join(p.unitDir, "notes-sync.service"), launcher = path.join(p.binDir, "claude-notes");
  const renderPolicies = (release) => {
    const values = { HOME: p.home, VIEW: p.viewDir, STORE: p.storeDir, CONFIG: p.configDir, LIB: p.libDir };
    for (const [name, destination, mode, kind] of [
      ["claude-strict.json", path.join(p.configDir, "claude-strict.json"), 0o600, "json"],
      ["claude-notes", launcher, 0o755, "shell"],
      ["notes-sync", path.join(p.binDir, "notes-sync"), 0o755, "shell"],
      ["notes-sync.service", unit, 0o644, "unit"],
    ]) actions.push({ type: "render", source: path.join(release, "server/view", name), destination, values, mode, kind });
  };
  if (mode === "uninstall") {
    if (hasUnit) command("systemctl", ["--user", "disable", "--now", "notes-sync"]);
    actions.push({ type: "remove-file", path: unit }, { type: "remove-file", path: launcher },
      { type: "remove-file", path: path.join(p.binDir, "notes-sync") });
    command("systemctl", ["--user", "daemon-reload"]);
    command("tailscale", ["serve", "--https=8443", "off"]);
    return actions;
  }
  if (mode === "rollback") {
    const target = previous ?? [...versions].sort((a, b) => b.mtimeMs - a.mtimeMs).find((v) => v.sha !== current)?.sha;
    if (!target || !SHA.test(target) || !versions.some((v) => v.sha === target)) throw new Error("no-previous-version");
    actions.push({ type: "switch", libDir: p.libDir, target, previous: current });
    renderPolicies(path.join(p.libDir, target));
    command("systemctl", ["--user", "daemon-reload"]);
    command("systemctl", ["--user", "restart", "notes-sync"]);
    actions.push({ type: "wait-status", paths: p });
    return actions;
  }
  if (dirty.trim()) throw new Error("server-has-uncommitted-changes");
  if (!SHA.test(sha)) throw new Error("invalid-head");
  actions.push({ type: "mkdir", path: p.libDir, mode: 0o700 });
  const release = path.join(p.libDir, sha);
  if (!versions.some((v) => v.sha === sha)) actions.push({ type: "archive", sha, destination: release });
  if (mode === "install") {
    if (hasUnit) command("systemctl", ["--user", "stop", "notes-sync"]);
    for (const [directory, mode] of [[p.configDir, 0o700], [p.binDir, 0o755], [p.unitDir, 0o755]]) {
      actions.push({ type: "mkdir", path: directory, mode });
    }
    actions.push({ type: "config-if-missing", path: path.join(p.configDir, "config.json"), config: defaultConfig(p) });
  }
  actions.push({ type: "switch", libDir: p.libDir, target: sha, previous: current !== sha ? current : previous });
  // Refresh policy and launcher on updates too, so a policy fix ships with its server version.
  renderPolicies(release);
  if (mode === "install") {
    command(process.execPath, [path.join(release, "server/main.mjs"), "init-store"],
      { env: { NOTES_SYNC_CONFIG: path.join(p.configDir, "config.json") } });
    actions.push({ type: "rebuild-view", release, configFile: path.join(p.configDir, "config.json") });
    command("loginctl", ["enable-linger"]);
  }
  command("systemctl", ["--user", "daemon-reload"]);
  if (mode === "install") command("systemctl", ["--user", "enable", "--now", "notes-sync"]);
  command("systemctl", ["--user", "restart", "notes-sync"]);
  if (mode === "install") command("tailscale", ["serve", "--bg", "--https=8443", "http://127.0.0.1:8790"]);
  actions.push({ type: "wait-status", paths: p });
  const all = versions.some((v) => v.sha === sha) ? versions : [...versions, { sha, mtimeMs: Number.MAX_SAFE_INTEGER }];
  const keep = versionsToKeep(all, sha, current !== sha ? current : previous);
  for (const version of all) if (!keep.includes(version.sha) && SHA.test(version.sha)) {
    actions.push({ type: "remove-version", path: path.join(p.libDir, version.sha) });
  }
  return actions;
}
async function exists(filename) {
  try { return await fs.lstat(filename); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
export async function inspectDeployment(p, mode, cwd) {
  const result = { versions: [], current: null, previous: null, hasUnit: Boolean(await exists(path.join(p.unitDir, "notes-sync.service"))) };
  if (mode === "uninstall") return result;
  if (await exists(p.libDir)) {
    for (const entry of await fs.readdir(p.libDir, { withFileTypes: true })) {
      if (entry.isDirectory() && SHA.test(entry.name)) {
        result.versions.push({ sha: entry.name, mtimeMs: (await fs.stat(path.join(p.libDir, entry.name))).mtimeMs });
      }
    }
    const current = path.join(p.libDir, "current"), stat = await exists(current);
    if (stat) {
      if (!stat.isSymbolicLink()) throw new Error("invalid-current");
      result.current = await fs.readlink(current);
      if (!SHA.test(result.current) || !result.versions.some((v) => v.sha === result.current)) throw new Error("invalid-current");
    }
    result.previous = await readJson(path.join(p.libDir, "previous.json"), null);
    if (result.previous !== null && !SHA.test(result.previous)) throw new Error("invalid-previous");
  }
  if (mode !== "rollback") {
    result.dirty = (await run("git", ["status", "--porcelain", "--", "server"], { cwd })).stdout;
    result.sha = (await run("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();
  }
  return result;
}
function childDone(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("archive-failed")));
  });
}
async function archive(cwd, sha, destination) {
  const staging = `${destination}.tmp-${randomUUID()}`;
  await fs.mkdir(staging, { mode: 0o700 });
  try {
    const git = spawn("git", ["archive", "--format=tar", sha, "server"], { cwd, stdio: ["ignore", "pipe", "ignore"] });
    const tar = spawn("tar", ["-x", "-C", staging], { stdio: ["pipe", "ignore", "ignore"] });
    const results = await Promise.allSettled([childDone(git), childDone(tar), pipeline(git.stdout, tar.stdin)]);
    if (results.some((r) => r.status === "rejected")) throw new Error("archive-failed");
    await fs.rename(staging, destination);
    await syncDirectory(path.dirname(destination));
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}
export async function executeAction(action, { cwd, env = process.env } = {}) {
  switch (action.type) {
    case "mkdir": await mkdir(action.path, action.mode); break;
    case "archive": await archive(cwd, action.sha, action.destination); break;
    case "command":
      await run(action.file, action.args, { cwd, env: { ...env, ...action.env }, timeout: 60000, maxBuffer: 1024 * 1024 });
      break;
    case "config-if-missing": {
      const existing = await readJson(action.path, null);
      if (existing) {
        validateConfig(existing);
        for (const key of ["storeDir", "viewDir", "configDir"]) if (existing[key] !== action.config[key]) throw new Error("config-path-mismatch");
      } else await atomicWrite(action.path, `${JSON.stringify(action.config, null, 2)}\n`, { once: true });
      break;
    }
    case "switch": {
      const temporary = path.join(action.libDir, `.current-${randomUUID()}`);
      if (action.previous) await atomicWrite(path.join(action.libDir, "previous.json"), JSON.stringify(action.previous));
      try {
        await fs.symlink(action.target, temporary);
        await fs.rename(temporary, path.join(action.libDir, "current"));
        await syncDirectory(action.libDir);
      } finally { await fs.rm(temporary, { force: true }); }
      break;
    }
    case "render":
      await atomicWrite(action.destination, renderTemplate(await fs.readFile(action.source, "utf8"), action.values, action.kind), { mode: action.mode });
      break;
    case "rebuild-view": {
      const config = validateConfig(await readJson(action.configFile));
      const { createContext } = await import(pathToFileURL(path.join(action.release, "server/handler.mjs")));
      const { resolveJournal } = await import(pathToFileURL(path.join(action.release, "server/round.mjs")));
      const context = await createContext(config);
      await context.enqueue(async () => { await resolveJournal(context); await context.rebuildView(context.store.published); });
      break;
    }
    case "wait-status": {
      const p = action.paths;
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          await run("systemctl", ["--user", "is-active", "--quiet", "notes-sync"], { timeout: 5000 });
          const { stdout } = await run(process.execPath, [path.join(p.libDir, "current/server/main.mjs"), "status"],
            { env: { ...env, NOTES_SYNC_CONFIG: path.join(p.configDir, "config.json") }, timeout: 5000 });
          const status = JSON.parse(stdout);
          if (status.journalPending || status.historyError || status.funnel !== "off" || status.serve !== "configured") throw new Error("not-ready");
          return;
        } catch { if (attempt === 19) throw new Error("status-failed-use-rollback"); }
        await delay(500);
      }
      break;
    }
    case "remove-file": {
      const stat = await exists(action.path);
      if (stat && !stat.isFile() && !stat.isSymbolicLink()) throw new Error("unsafe-removal");
      await fs.rm(action.path, { force: true });
      break;
    }
    case "remove-version":
      if (!SHA.test(path.basename(action.path)) || !(await fs.lstat(action.path)).isDirectory()) throw new Error("unsafe-removal");
      await fs.rm(action.path, { recursive: true });
      break;
    default: throw new Error("unknown-action");
  }
}
export async function deploy(args = process.argv.slice(2), {
  env = process.env, cwd = fileURLToPath(new URL("..", import.meta.url)), inspect = inspectDeployment,
  execute = executeAction, print = (s) => process.stdout.write(`${s}\n`),
} = {}) {
  const { mode, dryRun } = parseArgs(args);
  const paths = deploymentPaths(env.NOTES_SYNC_HOME ?? env.HOME);
  const state = await inspect(paths, mode, cwd);
  const actions = planDeployment({ mode, paths, ...state });
  for (const action of actions) {
    print(`${dryRun ? "DRY RUN " : ""}${JSON.stringify(action)}`);
    if (!dryRun) await execute(action, { cwd, env });
  }
  return actions;
}
if (isEntryPoint(import.meta.url)) {
  deploy().catch((error) => {
    const safe = /^[a-z][a-z -]{1,100}$/.test(error.message) ? error.message : "deployment-failed; current version kept for diagnosis";
    process.stderr.write(`Refused: ${safe}\n`);
    process.exitCode = 1;
  });
}
