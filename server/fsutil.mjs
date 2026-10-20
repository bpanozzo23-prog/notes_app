import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const keyFor = (id) => sha256(Buffer.from(id, "utf8"));
export const TEMP_PREFIX = ".notes-sync-tmp-";
export async function mkdir(directory, mode = 0o700) {
  await fs.mkdir(directory, { recursive: true, mode });
  await fs.chmod(directory, mode);
}
export async function syncDirectory(directory) {
  const handle = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}
export async function atomicWrite(filename, data, { mode = 0o600, once = false } = {}) {
  const directory = path.dirname(filename);
  const temporary = path.join(directory, `${TEMP_PREFIX}${randomUUID()}`);
  const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, mode);
  try {
    await handle.chmod(mode);
    await handle.writeFile(data);
    await handle.sync();
  } finally { await handle.close(); }
  try {
    if (once) {
      // link is an atomic, no-replace publication. A second upload cannot overwrite an object.
      try { await fs.link(temporary, filename); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
      await fs.unlink(temporary);
    } else {
      await fs.rename(temporary, filename);
    }
    await syncDirectory(directory);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
export async function removeFile(filename) {
  await fs.rm(filename, { force: true });
  await syncDirectory(path.dirname(filename));
}
export async function readJson(filename, fallback) {
  try { return JSON.parse(await fs.readFile(filename, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT" && arguments.length > 1) return fallback;
    throw error;
  }
}
export function stableStringify(value) {
  // Write sorted keys directly: JSON.stringify reorders integer-looking object keys.
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
export const writeJson = (filename, value, options) => atomicWrite(filename, `${stableStringify(value)}\n`, options);
export async function removeTemps(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.startsWith(TEMP_PREFIX)) await removeFile(path.join(directory, entry.name));
    else if (entry.isDirectory() && entry.name !== ".git") await removeTemps(path.join(directory, entry.name));
  }
}
