// The view is untrusted. Pin checked directories with file descriptors on Linux so a
// concurrent symlink replacement cannot redirect a subsequent open/rename into the store.
import fs from "node:fs/promises";
import { constants as C } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function refuse(reason) { throw Object.assign(new Error(reason), { reason }); }
function parts(relative) {
  if (path.isAbsolute(relative) || relative.split("/").some((p) => p === "..")) refuse("unsafe-path");
  return relative.split("/").filter((p) => p && p !== ".");
}
export async function withDirectory(root, relative, operation, { create = false, mode } = {}) {
  const handles = [], checked = [];
  const verify = async () => {
    for (const { filename, stat } of checked) {
      const current = await fs.lstat(filename);
      if (!current.isDirectory() || current.uid !== process.getuid() ||
          current.dev !== stat.dev || current.ino !== stat.ino) refuse("unsafe-directory");
    }
  };
  try {
    let filename = path.resolve(root), absolute = filename;
    for (const part of [null, ...parts(relative)]) {
      if (part !== null) {
        absolute = path.join(absolute, part);
        filename = `/proc/self/fd/${handles.at(-1).fd}/${part}`;
      }
      let stat;
      try { stat = await fs.lstat(filename); }
      catch (error) {
        if (!create || error.code !== "ENOENT") throw error;
        await verify();
        try { await fs.mkdir(filename, { mode: mode ?? 0o755 }); }
        catch (error) { if (error.code !== "EEXIST") throw error; }
        stat = await fs.lstat(filename);
      }
      if (!stat.isDirectory() || stat.uid !== process.getuid()) refuse("unsafe-directory");
      const handle = await fs.open(filename, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW);
      handles.push(handle);
      const opened = await handle.stat();
      if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.uid !== process.getuid()) refuse("unsafe-directory");
      checked.push({ filename: absolute, stat });
      await verify();
      if (mode !== undefined) await handle.chmod(mode);
    }
    await verify();
    return await operation({ directory: `/proc/self/fd/${handles.at(-1).fd}`, verify,
      sync: () => handles.at(-1).sync() });
  } finally { for (const handle of handles.reverse()) await handle.close(); }
}
export const sameFileStat = (a, b) => Boolean(a && b && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino);

export async function readRegular(filename, limit, expected) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile()) refuse("not-regular");
  if (expected && !sameFileStat(stat, expected)) refuse("file-changed");
  const handle = await fs.open(filename, C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) refuse("not-regular");
    if (expected && !sameFileStat(opened, expected)) refuse("file-changed");
    if (opened.size > limit) refuse("too-large");
    // readFile alone could grow without bound if a writer extends the file after fstat.
    const chunks = [];
    let size = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, limit + 1 - size));
      const { bytesRead } = await handle.read(chunk);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > limit) refuse("too-large");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    if (expected && !sameFileStat(await handle.stat(), expected)) refuse("file-changed");
    return Buffer.concat(chunks, size);
  } finally { await handle.close(); }
}
export const readViewFile = (root, relative, limit) => withDirectory(root, path.dirname(relative),
  ({ directory }) => readRegular(path.join(directory, path.basename(relative)), limit));

export async function writeInDirectory(dir, name, data, mode = 0o600) {
  if (parts(name).length !== 1 || path.basename(name) !== name) refuse("unsafe-path");
  await dir.verify();
  const temporary = path.join(dir.directory, `.notes-sync-tmp-${randomUUID()}`);
  const handle = await fs.open(temporary, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, mode);
  try {
    try {
      await handle.chmod(mode);
      await handle.writeFile(data);
      await handle.sync();
    } finally { await handle.close(); }
    await dir.verify();
    await fs.rename(temporary, path.join(dir.directory, name));
    await dir.sync();
  } finally { await fs.rm(temporary, { force: true }); }
}
export const writeViewFile = (root, relative, data, mode = 0o600) =>
  withDirectory(root, path.dirname(relative), (dir) => writeInDirectory(dir, path.basename(relative), data, mode));

export async function unlinkInDirectory(dir, name, expected) {
  if (parts(name).length !== 1 || path.basename(name) !== name) refuse("unsafe-path");
  await dir.verify();
  const filename = path.join(dir.directory, name);
  let stat;
  try { stat = await fs.lstat(filename); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  if (expected && (!stat.isFile() || !sameFileStat(stat, expected))) refuse("file-changed");
  if (!stat.isFile() && !stat.isSymbolicLink()) refuse("not-regular");
  await fs.unlink(filename);
  await dir.sync();
}
