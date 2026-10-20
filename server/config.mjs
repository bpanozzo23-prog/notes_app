import os from "node:os";
import path from "node:path";
import { readJson } from "./fsutil.mjs";
import { isObject } from "./validate.mjs";

export function validateConfig(config) {
  let validOrigin = false;
  try {
    const url = new URL(config?.origin);
    validOrigin = ["https:", "http:"].includes(url.protocol) && url.origin === config.origin;
  } catch { /* Refuse malformed origins. */ }
  if (!isObject(config) || !validOrigin ||
      !Array.isArray(config.hosts) || !config.hosts.length || new Set(config.hosts).size !== config.hosts.length ||
      !config.hosts.every((v) => {
        if (typeof v !== "string" || !/^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(v)) return false;
        const port = v.includes(":") ? Number(v.split(":")[1]) : null;
        return port === null || port >= 1 && port <= 65535;
      }) ||
      config.listen !== "127.0.0.1" || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 ||
      !["storeDir", "viewDir", "configDir"].every((k) => typeof config[k] === "string" &&
        path.isAbsolute(config[k]) && !/[\u0000-\u001f\u007f]/.test(config[k]) && path.resolve(config[k]) !== "/")) {
    throw new Error("invalid-config");
  }
  // A rebuild must never overwrite the trusted store or configuration.
  const paths = ["storeDir", "viewDir", "configDir"].map((k) => path.resolve(config[k]));
  if (paths.some((p, i) => paths.some((q, j) => i !== j && (p === q || p.startsWith(`${q}/`))))) throw new Error("invalid-config-paths");
  return config;
}
export async function loadConfig(env = process.env) {
  const filename = env.NOTES_SYNC_CONFIG ?? path.join(os.homedir(), ".config/notes_app-sync/config.json");
  return validateConfig(await readJson(filename));
}
