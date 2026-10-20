import { EXPORTED_PREFS, IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_NOTEBOOK_BYTES, isSafeId } from "./constants.mjs";
import { keyFor } from "./fsutil.mjs";

export class HttpError extends Error {
  constructor(status, error, details = {}) {
    super(error);
    this.status = status;
    this.body = { error, ...details };
  }
}
export const fail = (status, error, details) => { throw new HttpError(status, error, details); };
export const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const isDate = (v) => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const natural = (v) => Number.isSafeInteger(v) && v >= 0;
const revision = (v) => natural(v) && v > 0;
const generation = (v) => v === null || typeof v === "string";
const strings = (v) => Array.isArray(v) && v.every((s) => isSafeId(s) && s === s.trim()) && new Set(v).size === v.length;
function check(ok, error) { if (!ok) fail(400, error); }

export function validatePush(body) {
  check(isObject(body), "invalid-push");
  check(generation(body.generation), "invalid-generation");
  check(Number.isSafeInteger(body.schemaVersion) && body.schemaVersion > 0, "invalid-schema-version");
  check(isSafeId(body.appVersion), "invalid-app-version");
  check(isObject(body.base) && natural(body.base.round) && generation(body.base.generation), "invalid-base");
  check(typeof body.notebookMd === "string" && Buffer.byteLength(body.notebookMd) <= MAX_NOTEBOOK_BYTES, "invalid-notebook");
  check(body.confirm === undefined || typeof body.confirm === "string", "invalid-confirm");
  for (const name of ["rows", "ids", "folders", "tombstones", "files"]) check(Array.isArray(body[name]), `invalid-${name}`);
  check(isObject(body.preferences) && Object.keys(body.preferences).every((key) => EXPORTED_PREFS.includes(key)), "invalid-preferences");
  const seen = new Set();
  const folderIds = new Set(body.folders.map((row) => row?.id));
  for (const table of ["rows", "folders", "tombstones", "files"]) {
    for (const row of body[table]) {
      check(isObject(row) && isSafeId(row.id), `invalid-${table}`);
      check(!seen.has(row.id), "duplicate-id");
      seen.add(row.id);
      if (table === "rows") {
        check(["title", "html", "text"].every((k) => typeof row[k] === "string") &&
          (row.folderId === null || isSafeId(row.folderId) && folderIds.has(row.folderId)) &&
          strings(row.tags) && strings(row.linkedIds) && typeof row.pinned === "boolean" &&
          revision(row.rev) && isDate(row.createdAt) && isDate(row.updatedAt) &&
          (row.deletedAt === null || isDate(row.deletedAt)), "invalid-note");
      } else if (table === "folders") {
        check(isSafeId(row.name) && natural(row.position), "invalid-folder");
      } else if (table === "tombstones") {
        check(isDate(row.purgedAt), "invalid-tombstone");
      } else {
        check(IMAGE_TYPES.includes(row.type) && revision(row.size) && row.size <= MAX_IMAGE_BYTES &&
          [row.width, row.height].every((n) => Number.isInteger(n) && n > 0 && n <= 10000) &&
          isDate(row.createdAt), "invalid-file");
      }
    }
  }
  const ids = new Map(), keys = new Set();
  const otherIds = new Set([...body.folders, ...body.tombstones, ...body.files].map((r) => r.id));
  for (const row of body.ids) {
    check(isObject(row) && isSafeId(row.id) && revision(row.rev), "invalid-ids");
    check(!ids.has(row.id) && !otherIds.has(row.id), "duplicate-id");
    // UTF-8 replaces lone UTF-16 surrogates. Two such JS strings can have the same
    // filename without a cryptographic collision; never let one overwrite the other.
    const key = keyFor(row.id);
    check(!keys.has(key), "id-key-collision");
    keys.add(key);
    ids.set(row.id, row.rev);
  }
  check(body.rows.every((row) => ids.get(row.id) === row.rev), "invalid-ids");
  return body;
}

export const PROPOSAL_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const HASH = /^[a-f0-9]{64}$/;
export const OUTCOMES = Object.freeze(["applied", "kept", "dismissed", "stale"]);
export function validateOutcomes(body) {
  check(Array.isArray(body), "invalid-outcomes");
  for (const item of body) {
    check(isObject(item) && typeof item.proposal === "string" && PROPOSAL_ID.test(item.proposal) &&
      typeof item.hash === "string" && HASH.test(item.hash) &&
      OUTCOMES.includes(item.outcome) && isDate(item.at) &&
      (item.applied === undefined || item.applied === null ||
        Array.isArray(item.applied) && item.applied.length <= 500 && item.applied.every((tick) => isSafeId(tick) && tick.length <= 200)),
      "invalid-outcome");
  }
  return body;
}

export function detectImage(bytes) {
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "image/gif";
  return null;
}
