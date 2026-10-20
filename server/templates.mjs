import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function templatePaths(config) {
  const HOME = config.home ?? os.homedir();
  return { HOME, VIEW: config.viewDir, STORE: config.storeDir, CONFIG: config.configDir,
    LIB: config.libDir ?? path.join(HOME, ".local/lib/notes_app-sync") };
}
export function renderTemplate(source, values, kind = "text") {
  return source.replace(/\{\{([A-Z]+)\}\}/g, (_match, key) => {
    const value = values[key];
    if (typeof value !== "string" || !path.isAbsolute(value) || /[\r\n\0]/.test(value)) throw new Error("invalid-template-path");
    if (kind === "json") return JSON.stringify(value).slice(1, -1);
    if (kind === "shell") return value.replace(/[\\"$`]/g, "\\$&");
    if (kind === "unit") return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%");
    return value;
  });
}
export async function loadTemplate(name, values) {
  if (!["CLAUDE.md", "AGENTS.md", "settings.json", "claude-strict.json", "propose", "claude-notes", "notes-sync.service"].includes(name)) {
    throw new Error("unknown-template");
  }
  const source = await fs.readFile(path.join(import.meta.dirname, "view", name), "utf8");
  return renderTemplate(source, values, name.endsWith(".json") ? "json" :
    ["propose", "claude-notes"].includes(name) ? "shell" : name.endsWith(".service") ? "unit" : "text");
}
export async function loadViewTemplates(config) {
  const values = templatePaths(config);
  return Object.fromEntries(await Promise.all([
    ["CLAUDE.md", "CLAUDE.md"], ["AGENTS.md", "AGENTS.md"],
    [".claude/settings.json", "settings.json"], ["propose", "propose"],
  ].map(async ([target, name]) => [target, await loadTemplate(name, values)])));
}
