import fs from "node:fs/promises";
import path from "node:path";
import { isSafeId, extractFileIds, extractNoteLinks } from "./constants.mjs";
import { readJson, stableStringify, sha256 } from "./fsutil.mjs";
import { isObject, OUTCOMES } from "./validate.mjs";

export const INBOX_NAME = /^(p-[a-z0-9-]{3,80})\.(json|html)$/;
export const proposalFilename = (proposal, hash) => `${proposal}-${hash.slice(0, 16)}.json`;
export const proposalHash = (value) => sha256(stableStringify(value));
export const MAX_BODY_BYTES = 512 * 1024;
export const proposalKind = (details) => Object.hasOwn(details, "trash") ? "trash" : Object.hasOwn(details, "note") ? "edit" : "new";
// A version refused for its shape is stored without details, so its kind is unknown.
export const recordKind = (record) => Object.hasOwn(record, "generation") ? proposalKind(record) : null;
const FIELDS = {
  edit: ["note", "basedOnRev", "generation", "title", "folderId", "tags", "why"],
  new: ["generation", "title", "folderId", "tags", "why"],
  trash: ["note", "basedOnRev", "generation", "trash", "why"],
};
export function proposalProblem(value) {
  if (!isObject(value)) return "invalid-shape";
  const kind = proposalKind(value), fields = FIELDS[kind];
  if (Object.keys(value).some((k) => !fields.includes(k) && !(kind !== "trash" && k === "newFolder")) ||
      fields.some((k) => !Object.hasOwn(value, k)) || kind === "trash" && value.trash !== true) return "invalid-shape";
  if (kind !== "new" && !isSafeId(value.note)) return "invalid-note";
  if (kind !== "new" && (!Number.isSafeInteger(value.basedOnRev) || value.basedOnRev < 1)) return "invalid-rev";
  if (value.generation !== null && typeof value.generation !== "string") return "invalid-generation";
  if (kind !== "trash") {
    if (typeof value.title !== "string" || value.title.length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(value.title)) return "invalid-title";
    if (value.folderId !== null && !isSafeId(value.folderId) || Object.hasOwn(value, "newFolder") &&
        (value.folderId !== null || !isSafeId(value.newFolder) || value.newFolder !== value.newFolder.trim())) return "invalid-folder";
    if (!Array.isArray(value.tags) || value.tags.length > 50 || new Set(value.tags).size !== value.tags.length ||
        value.tags.some((t) => !isSafeId(t) || t !== t.trim())) return "invalid-tags";
  }
  if (typeof value.why !== "string" || value.why.length > 300) return "invalid-why";
  return null;
}
export function referenceProblem(value, snapshot, records = []) {
  const kind = proposalKind(value);
  const note = snapshot.notes.find((n) => n.id === value.note);
  if (kind !== "new" && !note) return "unknown-note";
  if (kind !== "new" && note.deletedAt !== null) return "note-in-trash";
  if (kind !== "new" && value.basedOnRev !== note.rev || value.generation !== snapshot.meta.generation) return "changed-since-read";
  if (kind === "trash") return null;
  if (value.folderId !== null && !snapshot.folders.some((f) => f.id === value.folderId)) return "unknown-folder";
  if (Object.hasOwn(value, "newFolder") && snapshot.folders.some((f) => f.name.toLowerCase() === value.newFolder.toLowerCase())) return "folder-exists";
  const live = snapshot.notes.filter((n) => n.deletedAt === null);
  const ids = new Set(live.map((n) => n.id));
  if (extractNoteLinks(value.body).some((id) => !ids.has(id))) return "unknown-note-link";
  const images = new Set(kind === "new" ? live.flatMap((n) => extractFileIds(n.html)) : extractFileIds(note.html));
  if (extractFileIds(value.body).some((id) => !images.has(id))) return "new-image";
  if (kind === "new" && records.some(({ record }) => recordKind(record) === "new" &&
      record.proposal === value.proposal && OUTCOMES.includes(record.status))) return "pid-used";
  return null;
}
export async function readProposals(storeDir) {
  const directory = path.join(storeDir, "store/proposals");
  const records = [];
  for (const filename of (await fs.readdir(directory)).sort()) {
    if (!/^[A-Za-z0-9_-]{1,128}-(?:[a-f0-9]{16}|[a-f0-9]{64})\.json$/.test(filename)) continue;
    records.push({ filename, record: await readJson(path.join(directory, filename)) });
  }
  return records.sort((a, b) => (a.record.sequence ?? 0) - (b.record.sequence ?? 0) ||
    (a.record.ingestedAt ?? "").localeCompare(b.record.ingestedAt ?? "") || a.filename.localeCompare(b.filename));
}
