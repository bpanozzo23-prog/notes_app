import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SCHEMA_VERSION, UPLOAD_RETENTION_MS, extractFileIds, isSafeId } from "./constants.mjs";
import { atomicWrite, keyFor, mkdir, readJson, removeFile, sha256, stableStringify, writeJson } from "./fsutil.mjs";

const execute = promisify(execFile);
export function createGit(cwd, run = execute) {
  const git = (args) => run("git", args, { cwd, maxBuffer: 1024 * 1024 });
  return {
    async init() {
      await git(["init", "-q"]);
      for (const [key, value] of [["user.name", "notes-sync"], ["user.email", "notes-sync@localhost"], ["core.fsync", "committed"]]) {
        await git(["config", "--local", key, value]);
      }
    },
    async hasRemote() { return Boolean((await git(["remote"])).stdout.trim()); },
    async commit(message) {
      await git(["add", "-A"]);
      try { await git(["diff", "--cached", "--quiet"]); return; }
      catch (error) { if (error.code !== 1) throw error; }
      await git(["commit", "-q", "-m", message]);
    },
  };
}
export const uploadKey = (generation, id) => stableStringify([generation, id]);
const initialSnapshot = () => ({
  meta: { round: 0, generation: null, schemaVersion: SCHEMA_VERSION, appVersion: "0",
    lastRoundAt: null, historyError: false, missingImages: [] },
  notes: [], folders: [], tombstones: [], preferences: {}, files: {}, notebookMd: "",
});
export function countsFor(snapshot) {
  const trashed = snapshot.notes.filter((n) => n.deletedAt !== null).length;
  return { notes: snapshot.notes.length, live: snapshot.notes.length - trashed, trashed,
    folders: snapshot.folders.length, images: Object.keys(snapshot.files).length };
}

// Only openStore/initStore touch disk; constructing a Store is inert.
export class Store {
  constructor(storeDir, { git } = {}) {
    this.dir = storeDir;
    this.repo = path.join(storeDir, "store");
    this.objects = path.join(storeDir, "objects");
    this.backups = path.join(storeDir, "backups");
    this.journalPath = path.join(storeDir, "journal.json");
    this.uploadsPath = path.join(storeDir, "uploads.json");
    this.git = git ?? createGit(this.repo);
    this.published = null;
  }
  file(name) { return path.join(this.repo, name); }
  async readJournal() { return readJson(this.journalPath, null); }
  async writeJournal(journal) { await writeJson(this.journalPath, journal); }
  async clearJournal() { await removeFile(this.journalPath); }
  async readSnapshot() {
    const notes = [];
    for (const entry of await fs.readdir(this.file("notes"), { withFileTypes: true })) {
      if (entry.name.startsWith(".notes-sync-tmp-")) continue;
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) throw new Error("invalid-note-file");
      const row = await readJson(this.file(`notes/${entry.name}`));
      if (!isSafeId(row?.id) || `${keyFor(row.id)}.json` !== entry.name) throw new Error("note-key-mismatch");
      notes.push(row);
    }
    const [meta, folders, tombstones, preferences, files, notebookMd] = await Promise.all([
      readJson(this.file("meta.json")), readJson(this.file("folders.json")),
      readJson(this.file("tombstones.json")), readJson(this.file("preferences.json")),
      readJson(this.file("files.json")), fs.readFile(this.file("notebook.md"), "utf8"),
    ]);
    return { meta, notes, folders, tombstones, preferences, files, notebookMd };
  }
  async load() {
    const journal = await this.readJournal();
    const meta = await readJson(this.file("meta.json"));
    // Disk rows may be partially applied. The journal preserves the last complete read view.
    if (journal?.kind === "round" && meta.round < journal.targetRound) {
      this.published = journal.payload.previous;
    } else {
      this.published = await this.readSnapshot();
    }
    return this;
  }
  async apply(snapshot) {
    const keep = new Set(snapshot.notes.map((n) => `${keyFor(n.id)}.json`));
    for (const note of snapshot.notes) await writeJson(this.file(`notes/${keyFor(note.id)}.json`), note);
    for (const name of await fs.readdir(this.file("notes"))) {
      if (/^[a-f0-9]{64}\.json$/.test(name) && !keep.has(name)) await removeFile(this.file(`notes/${name}`));
    }
    for (const key of ["folders", "tombstones", "preferences", "files"]) await writeJson(this.file(`${key}.json`), snapshot[key]);
    await atomicWrite(this.file("notebook.md"), snapshot.notebookMd);
  }
  async publish(snapshot) {
    await writeJson(this.file("meta.json"), snapshot.meta);
    this.published = structuredClone(snapshot);
  }
  async setHistoryError(value) {
    await this.publish({ ...this.published, meta: { ...this.published.meta, historyError: value } });
  }
  async putObject(bytes) {
    const hash = sha256(bytes);
    await atomicWrite(path.join(this.objects, hash), bytes, { once: true });
    return hash;
  }
  async readObject(hash) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("invalid-object-hash");
    try {
      const bytes = await fs.readFile(path.join(this.objects, hash));
      // An object damaged on disk is missing, never silently included in a backup.
      return sha256(bytes) === hash ? bytes : null;
    } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  async uploads(now) {
    const entries = await readJson(this.uploadsPath);
    return Object.fromEntries(Object.entries(entries).filter(([, value]) =>
      Date.parse(value.at) >= new Date(now).getTime() - UPLOAD_RETENTION_MS));
  }
  async recordUpload(generation, id, bytes, detectedType, now) {
    const hash = await this.putObject(bytes);
    const entries = await this.uploads(now);
    entries[uploadKey(generation, id)] = { sha256: hash, size: bytes.length, detectedType, at: new Date(now).toISOString() };
    await writeJson(this.uploadsPath, entries);
    return { sha256: hash, size: bytes.length };
  }
  async pruneUploads(keys, now) {
    const entries = await this.uploads(now);
    for (const key of keys) delete entries[key];
    await writeJson(this.uploadsPath, entries);
  }
  state() {
    const s = this.published;
    return { round: s.meta.round, generation: s.meta.generation,
      notes: Object.fromEntries(s.notes.map((n) => [n.id, n.rev])), files: Object.keys(s.files),
      counts: countsFor(s), missingImages: s.meta.missingImages, lastRoundAt: s.meta.lastRoundAt,
      historyError: s.meta.historyError, proposals: [] };
  }
}
export async function initStore(storeDir, options) {
  const store = new Store(storeDir, options);
  for (const directory of [store.dir, store.repo, store.file("notes"), store.file("proposals"), store.objects, store.backups]) await mkdir(directory);
  // Never initialise over a damaged store. Only a wholly new repo may get an empty snapshot.
  const meta = await readJson(store.file("meta.json"), null);
  if (!meta) {
    const entries = (await fs.readdir(store.repo)).filter((name) => !["notes", "proposals"].includes(name));
    if (entries.length || (await fs.readdir(store.file("notes"))).length ||
        (await fs.readdir(store.file("proposals"))).length) throw new Error("store-not-empty");
    const snapshot = initialSnapshot();
    await store.apply(snapshot);
    await store.publish(snapshot);
    await writeJson(store.uploadsPath, {});
  }
  await store.git.init();
  await store.load();
  return store;
}
export async function openStore(storeDir, options) { return new Store(storeDir, options).load(); }

export async function bindFiles(store, push, notes, now) {
  const uploads = await store.uploads(now);
  const metadata = new Map(push.files.map((file) => [file.id, file]));
  const referenced = new Set(notes.flatMap((n) => extractFileIds(n.html)));
  const files = Object.create(null), missingImages = [], boundUploads = [];
  for (const id of referenced) {
    const file = metadata.get(id);
    const existing = store.published.meta.generation === push.generation && store.published.files[id];
    let binding;
    if (file) {
      const { type, size, width, height, createdAt } = file;
      const fields = { type, size, width, height, createdAt };
      if (existing && Object.entries(fields).every(([key, value]) => existing[key] === value)) {
        binding = existing;
        const key = uploadKey(push.generation, id);
        if (uploads[key]?.sha256 === existing.sha256) boundUploads.push(key);
      } else {
        const key = uploadKey(push.generation, id), upload = uploads[key];
        if (upload && upload.size === size && upload.detectedType === type) {
          binding = { sha256: upload.sha256, ...fields };
          boundUploads.push(key);
        }
      }
      if (binding) {
        const bytes = await store.readObject(binding.sha256);
        if (!bytes || bytes.length !== file.size) binding = null;
      }
    }
    if (binding) files[id] = binding;
    else missingImages.push(id);
  }
  return { files, missingImages, boundUploads };
}
