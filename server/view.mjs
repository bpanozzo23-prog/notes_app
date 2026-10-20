import fs from "node:fs/promises";
import { constants as C } from "node:fs";
import path from "node:path";
import { Store } from "./store.mjs";
import { extractFileIds } from "./constants.mjs";
import { keyFor, sha256, readJson, stableStringify, writeJson } from "./fsutil.mjs";
import { readProposals } from "./proposals.mjs";
import { loadViewTemplates } from "./templates.mjs";
import { withDirectory, readViewFile, writeViewFile, unlinkInDirectory } from "./view-fs.mjs";

const DIRECTORIES = ["", "notebook", "notebook/notes", "notebook/images", ".claude", "inbox", "inbox/drafts", "inbox/pending"];
const NOTE_NAME = /^[a-f0-9]{64}\.html$/;
const IMAGE_NAME = /^[a-f0-9]{64}\.(?:webp|jpg|png|gif)$/;
const FIXED = ["notebook/notebook.md", "notebook/index.json", "notebook/folders.json",
  "notebook/proposals.json", "notebook/proposals-log.md", "CLAUDE.md", "AGENTS.md", ".claude/settings.json", "propose"];
const expected = (name) => FIXED.includes(name) ||
  name.startsWith("notebook/notes/") && NOTE_NAME.test(name.slice(15)) ||
  name.startsWith("notebook/images/") && IMAGE_NAME.test(name.slice(16));
export const IMAGE_EXT = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif" };
export async function viewLog(storeDir, event, relative, now = new Date()) {
  const handle = await fs.open(path.join(storeDir, "view-log.jsonl"), C.O_WRONLY | C.O_APPEND | C.O_CREAT | C.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify({ event, path: relative, at: new Date(now).toISOString() })}\n`);
    await handle.sync();
  } finally { await handle.close(); }
}
const json = (value) => `${stableStringify(value)}\n`;
const oneLine = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/[\\`*_<>[\]]/g, "\\$&");

export async function rebuildView({ storeDir, viewDir, templates, now = new Date() }) {
  // Read only the trusted store. No content from the view is ever used as input.
  const store = new Store(storeDir);
  const snapshot = await store.readSnapshot();
  templates ??= await loadViewTemplates({ storeDir, viewDir, configDir: path.join(path.dirname(viewDir), ".config/notes_app-sync") });
  const files = new Map();
  for (const name of ["CLAUDE.md", "AGENTS.md", ".claude/settings.json", "propose"]) {
    if (typeof templates[name] !== "string") throw new Error("missing-view-template");
    files.set(name, templates[name]);
  }
  const live = snapshot.notes.filter((n) => n.deletedAt === null);
  const folders = new Map(snapshot.folders.map((f) => [f.id, f.name]));
  const notes = live.map(({ id, title, folderId, tags, pinned, createdAt, updatedAt, rev, html }) => ({
    id, file: keyFor(id), title, folderId, folder: folders.get(folderId) ?? null,
    tags, pinned, createdAt, updatedAt, rev, images: extractFileIds(html),
  }));
  files.set("notebook/notebook.md", snapshot.notebookMd);
  files.set("notebook/index.json", json({ generation: snapshot.meta.generation, round: snapshot.meta.round, notes }));
  files.set("notebook/folders.json", json(snapshot.folders));
  for (const note of live) files.set(`notebook/notes/${keyFor(note.id)}.html`, note.html);
  for (const id of new Set(notes.flatMap((n) => n.images))) {
    const binding = Object.hasOwn(snapshot.files, id) && snapshot.files[id];
    if (!binding) continue;
    const bytes = await store.readObject(binding.sha256);
    if (bytes && bytes.length === binding.size && IMAGE_EXT[binding.type]) {
      files.set(`notebook/images/${keyFor(id)}.${IMAGE_EXT[binding.type]}`, bytes);
    }
  }
  const proposals = (await readProposals(storeDir)).map(({ record }) => {
    // No proposed bodies in this index. In particular it cannot re-expose a trashed note's text.
    const { proposal, hash, note, status, ingestedAt, sequence, handledAt, reason, outcome } = record;
    const title = live.find((n) => n.id === note)?.title ?? "";
    return Object.fromEntries(Object.entries({ proposal, hash, note, title, status, ingestedAt, sequence, handledAt, reason, outcome })
      .filter(([, value]) => value !== undefined));
  });
  files.set("notebook/proposals.json", json(proposals));
  files.set("notebook/proposals-log.md", "# Proposal outcomes\n\n" + proposals.filter((p) => p.status !== "pending").map((p) =>
    `- ${oneLine(p.outcome?.at ?? p.handledAt ?? p.ingestedAt)} · ${oneLine(p.title || "(note unavailable)")} · ${oneLine(p.status)}` +
    ` · applied: ${(p.outcome?.applied ?? []).map(oneLine).join(", ") || "none"}\n`).join(""));

  for (const directory of DIRECTORIES) {
    try { await withDirectory(viewDir, directory, async () => {}, { create: true, mode: 0o755 }); }
    catch (error) { await viewLog(storeDir, "unsafe-directory", directory || ".", now); throw error; }
  }
  const manifest = await readJson(path.join(storeDir, "view-manifest.json"), {});
  const intact = new Set();
  for (const [name, hash] of Object.entries(manifest)) {
    if (!expected(name)) continue; // Even a damaged manifest cannot point outside the view.
    let matches = false;
    try { matches = sha256(await readViewFile(viewDir, name, 64 * 1024 * 1024)) === hash; }
    catch { /* Missing, symlinked and oversized files are also damage. */ }
    if (matches) intact.add(name);
    else await viewLog(storeDir, "tampered", name, now);
  }
  for (const [name, contents] of files) {
    // A file that is intact and already holds this content isn't rewritten (pictures add up).
    if (intact.has(name) && manifest[name] === sha256(contents)) continue;
    try { await writeViewFile(viewDir, name, contents, name === "propose" ? 0o555 : 0o444); }
    catch (error) { await viewLog(storeDir, "write-refused", name, now); throw error; }
  }
  for (const [directory, pattern] of [["notebook/notes", NOTE_NAME], ["notebook/images", IMAGE_NAME]]) {
    await withDirectory(viewDir, directory, async (dir) => {
      for (const entry of await fs.readdir(dir.directory, { withFileTypes: true })) {
        if (pattern.test(entry.name) && !files.has(`${directory}/${entry.name}`) && (entry.isFile() || entry.isSymbolicLink())) {
          await unlinkInDirectory(dir, entry.name);
        }
      }
    });
  }
  await writeJson(path.join(storeDir, "view-manifest.json"), Object.fromEntries([...files].map(([name, contents]) => [name, sha256(contents)])));
}
