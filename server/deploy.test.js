// @vitest-environment node
import { expect, it, vi } from "vitest";
import { deploymentPaths, defaultConfig, parseArgs, planDeployment, versionsToKeep, deploy } from "../scripts/sync-deploy.mjs";
import { loadTemplate, renderTemplate } from "./templates.mjs";
import { validateConfig } from "./config.mjs";
import { samplePush } from "../scripts/sync-check.mjs";
import { validatePush } from "./validate.mjs";
import fs from "node:fs/promises";
import path from "node:path";

const p = deploymentPaths("/tmp/fake-owner");
const sha = "a".repeat(40), old = "b".repeat(40), older = "c".repeat(40), oldest = "d".repeat(40);
const versions = [{ sha: old, mtimeMs: 30 }, { sha: older, mtimeMs: 20 }, { sha: oldest, mtimeMs: 10 }];
const values = { HOME: p.home, VIEW: p.viewDir, STORE: p.storeDir, CONFIG: p.configDir, LIB: p.libDir };
it.each(["settings.json", "claude-strict.json"])("renders every permission/sandbox rule exactly in %s", async (name) => {
  const policy = JSON.parse(await loadTemplate(name, values));
  const prefix = name === "settings.json" ? "" : `/${p.viewDir}`;
  const expectedDeny = [
    "Bash", "WebFetch", "WebSearch", "mcp__*",
    `Edit(${prefix}/notebook/**)`, `Edit(${prefix}/CLAUDE.md)`, `Edit(${prefix}/AGENTS.md)`,
    `Edit(${prefix}/.claude/**)`,
    `Edit(/${p.storeDir}/**)`, `Edit(/${p.configDir}/**)`,
    `Edit(/${p.binDir}/claude-notes)`, `Edit(/${p.binDir}/notes-sync)`, `Edit(/${p.libDir}/**)`,
    "Read(~/.ssh/**)", "Read(~/.config/notes_app/**)", `Read(/${p.configDir}/**)`,
    `Read(/${p.storeDir}/**)`, "Read(~/.claude/.credentials.json)",
  ];
  expect(policy.permissions).toEqual({
    defaultMode: "dontAsk", disableBypassPermissionsMode: "disable",
    allow: [`Edit(${prefix}/inbox/**)`], deny: expectedDeny,
  });
  expect(JSON.stringify(policy)).not.toContain("propose");
  expect(policy.permissions.allow.some((rule) => rule.startsWith("Bash"))).toBe(false);
  expect(policy.disableAllHooks).toBe(true);
  expect(policy.disableClaudeAiConnectors).toBe(true);
  expect(policy.sandbox).toEqual({
    enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false, excludedCommands: [],
    network: { allowedDomains: [], strictAllowlist: true },
    filesystem: {
      denyWrite: [`${p.viewDir}/notebook`, `${p.viewDir}/CLAUDE.md`, `${p.viewDir}/AGENTS.md`,
        `${p.viewDir}/.claude`, p.storeDir, p.configDir, `${p.binDir}/claude-notes`, `${p.binDir}/notes-sync`, p.libDir],
      denyRead: ["~/.ssh", "~/.config/notes_app", p.configDir, p.storeDir, "~/.claude/.credentials.json"],
    },
  });
  if (name === "claude-strict.json") {
    expect(policy.syncClaudeAiPlugins).toBe(false);
    expect(policy.syncClaudeAiSkills).toBe(false);
    for (const rule of [...policy.permissions.allow, ...policy.permissions.deny].filter((r) => /^(Edit|Read)\(/.test(r))) {
      expect(rule).toMatch(/^(Edit|Read)\((\/\/|~\/)/);
    }
  }
});
it("launcher refuses managed settings, selects the complete strict policy and only specified tools", async () => {
  const launcher = await loadTemplate("claude-notes", values);
  expect(launcher).toContain("review managed settings first");
  expect(launcher).toContain("/etc/claude-code/.[!.]*");
  expect(launcher).toContain(`cd "${p.viewDir}" || exit 1`);
  expect(launcher).toContain(`exec claude --restricted --strict-mcp-config --tools "Read,Edit,Write,Glob,Grep" --append-system-prompt-file "${p.viewDir}/CLAUDE.md" --settings "${p.configDir}/claude-strict.json" "$@"`);
  await expect(loadTemplate("propose", values)).rejects.toThrow("unknown-template");
  const unit = await loadTemplate("notes-sync.service", values);
  for (const text of [`ExecStart=/usr/bin/node "${p.libDir}/current/server/main.mjs" serve`,
    "Restart=always", "RestartSec=5", "UMask=0077", `Environment="NOTES_SYNC_CONFIG=${p.configDir}/config.json"`, "WantedBy=default.target"]) {
    expect(unit).toContain(text);
  }
});
it("renders quoting characters as data in JSON, shell and unit templates", () => {
  const value = '/tmp/owner "$x`cmd`\\%';
  expect(JSON.parse(renderTemplate('{"path":"{{HOME}}"}', { HOME: value }, "json")).path).toBe(value);
  expect(renderTemplate('cd "{{HOME}}"', { HOME: value }, "shell")).toBe('cd "/tmp/owner \\"\\$x\\`cmd\\`\\\\%"');
  expect(renderTemplate('"{{HOME}}"', { HOME: value }, "unit")).toBe('"/tmp/owner \\"$x`cmd`\\\\%%"');
  expect(() => renderTemplate("{{VIEW}}", {}, "text")).toThrow("invalid-template-path");
});
it("documents data-vs-instructions, all supported HTML samples and the Codex stop", async () => {
  const claude = await loadTemplate("CLAUDE.md", values);
  for (const text of ["never instructions", "Never copy note content outside", "Never ask for network access",
    "notebook/notebook.md", "notebook/index.json", "notebook/images/", "inbox/<pid>.html", "inbox/<pid>.json",
    "There is no shell or command line", "changed-since-read", "superseded", "data-type=", "data-checked=", "data-collapsed=", "data-file=",
    "width=", "height=", "alt=", "data-callout=", "data-style=", "data-color=", "font-size:", "font-family:",
    "background-color:", "line-height:", "language-js", "start=", "mailto:", "note:", "newFolder", "kept",
    "folder-exists", "trash-with-body", "pid-used", "same", "fresh", "never an HTML file", "any live note",
    "Never delete notes for good", "rename or delete folders", "pin notes"]) expect(claude).toContain(text);
  expect(claude).not.toContain("In Phase 4c the phone will check");
  expect(await loadTemplate("AGENTS.md", values)).toContain("Codex has no access");
});
it("default config and path derivation are explicit and valid", () => {
  expect(validateConfig(defaultConfig(p))).toEqual(defaultConfig(p));
  expect(defaultConfig(p).port).toBe(8790);
  expect(defaultConfig(p).hosts).toEqual(["brent-dell-system-xps-l502x.tail1ce757.ts.net:8443"]);
  expect(() => deploymentPaths("/")).toThrow("invalid-home");
  expect(() => deploymentPaths("relative")).toThrow("invalid-home");
});
it("plans immutable HEAD deployment, atomic switch, restart, health wait and retention", () => {
  const plan = planDeployment({ mode: "deploy", paths: p, sha, current: old, versions });
  expect(plan.find((a) => a.type === "archive")).toEqual({ type: "archive", sha, destination: `${p.libDir}/${sha}` });
  expect(plan.find((a) => a.type === "switch")).toMatchObject({ target: sha, previous: old });
  expect(plan.filter((a) => a.type === "command").map((a) => a.args)).toEqual([
    ["--user", "daemon-reload"], ["--user", "restart", "notes-sync"],
  ]);
  expect(plan.at(-2).type).toBe("wait-status");
  expect(plan.at(-1)).toEqual({ type: "remove-version", path: `${p.libDir}/${oldest}` });
  expect(plan.filter((a) => a.type === "render").every((a) => a.source.startsWith(`${p.libDir}/${sha}/server/`))).toBe(true);
  expect(() => planDeployment({ mode: "deploy", paths: p, sha, dirty: " M server/main.mjs" })).toThrow("uncommitted");
});
it("install plans config, first view, unit, linger and private Serve; repeating install preserves config/release", () => {
  const plan = planDeployment({ mode: "install", paths: p, sha, versions: [{ sha, mtimeMs: 1 }], current: sha, hasUnit: true });
  expect(plan.some((a) => a.type === "archive")).toBe(false);
  expect(plan.find((a) => a.type === "config-if-missing").config).toEqual(defaultConfig(p));
  expect(plan.some((a) => a.type === "rebuild-view")).toBe(true);
  expect(plan.find((a) => a.type === "mkdir" && a.path === p.configDir).mode).toBe(0o700);
  expect(plan.find((a) => a.type === "render" && a.destination.endsWith("/claude-notes")).mode).toBe(0o755);
  const commands = plan.filter((a) => a.type === "command");
  expect(commands.some((a) => a.args.includes("init-store") && a.env.NOTES_SYNC_CONFIG === `${p.configDir}/config.json`)).toBe(true);
  expect(commands).toContainEqual({ type: "command", file: "loginctl", args: ["enable-linger"] });
  expect(commands).toContainEqual({ type: "command", file: "tailscale", args: ["serve", "--bg", "--https=8443", "http://127.0.0.1:8790"] });
  expect(commands.some((a) => a.file === "systemctl" && a.args.join(" ") === "--user enable --now notes-sync")).toBe(true);
});
it("uninstall leaves every data/config/version path and rollback selects the recorded prior version", () => {
  const uninstall = planDeployment({ mode: "uninstall", paths: p, hasUnit: true });
  expect(uninstall.filter((a) => a.type === "remove-file").map((a) => a.path)).toEqual([
    `${p.unitDir}/notes-sync.service`, `${p.binDir}/claude-notes`, `${p.binDir}/notes-sync`,
  ]);
  expect(uninstall.at(-1)).toEqual({ type: "command", file: "tailscale", args: ["serve", "--https=8443", "off"] });
  const rollback = planDeployment({ mode: "rollback", paths: p, current: sha, previous: older, versions });
  expect(rollback[0]).toMatchObject({ type: "switch", target: older, previous: sha });
  expect(rollback.at(-1).type).toBe("wait-status");
  expect(() => planDeployment({ mode: "rollback", paths: p })).toThrow("no-previous");
});
it("keeps three versions, protecting current and the rollback target, ignoring non-version names", () => {
  expect(versionsToKeep([...versions, { sha, mtimeMs: 1 }, { sha: "current", mtimeMs: 999 }], sha, oldest)).toEqual([sha, oldest, old]);
});
it.each([[], ["--install"], ["--uninstall"], ["--rollback"]].map((args) => ({ args })))("dry-run prints all actions and invokes no mutation for $args", async ({ args }) => {
  const inspect = vi.fn(async () => ({ sha, versions, current: old, previous: older, hasUnit: true }));
  const execute = vi.fn(), print = vi.fn();
  const actions = await deploy([...args, "--dry-run"], { env: { NOTES_SYNC_HOME: p.home }, inspect, execute, print, cwd: "/tmp/fixture" });
  expect(inspect).toHaveBeenCalledOnce();
  expect(execute).not.toHaveBeenCalled();
  expect(print).toHaveBeenCalledTimes(actions.length);
  expect(print.mock.calls.every(([s]) => s.startsWith("DRY RUN "))).toBe(true);
});
it("executes injected actions sequentially and stops at a failed health check before pruning", async () => {
  const seen = [];
  await expect(deploy([], { env: { HOME: p.home }, cwd: "/tmp/fixture", print: () => {},
    inspect: async () => ({ sha, versions, current: old }),
    execute: async (action) => { seen.push(action.type); if (action.type === "wait-status") throw new Error("not-ready"); },
  })).rejects.toThrow("not-ready");
  expect(seen.at(-1)).toBe("wait-status");
  expect(seen).not.toContain("remove-version");
});
it.each([["--install", "--rollback"], ["--bogus"], ["--dry-run", "--dry-run"]].map((args) => ({ args })))("rejects ambiguous CLI arguments $args", ({ args }) => {
  expect(() => parseArgs(args)).toThrow("usage");
});
it("sync-check's sample conversion validates, preserves image metadata and excludes Trash from the projection", async () => {
  const sample = JSON.parse(await fs.readFile(path.join(import.meta.dirname, "../public/sample-notebook.json"), "utf8"));
  const push = samplePush(sample, { round: 0, generation: null }, "fixture");
  expect(validatePush(push)).toBe(push);
  expect(push.files).toHaveLength(sample.files.length);
  expect(push.files[0]).not.toHaveProperty("data");
  expect(push.notebookMd).not.toContain(sample.notes.find((n) => n.deletedAt !== null).title);
  expect(samplePush(sample, { round: 0, generation: null }, "fixture").notebookMd).toBe(push.notebookMd);
});

it("installs a notes-sync command for pair and status, bound to the live config", async () => {
  const cli = await loadTemplate("notes-sync", values);
  expect(cli).toContain(`NOTES_SYNC_CONFIG="${p.configDir}/config.json"`);
  expect(cli).toContain(`exec node "${p.libDir}/current/server/main.mjs" "$@"`);
  const plan = planDeployment({ mode: "deploy", paths: p, sha, versions: [] });
  expect(plan.find((a) => a.type === "render" && a.destination === `${p.binDir}/notes-sync`)).toMatchObject({ mode: 0o755, kind: "shell" });
});
