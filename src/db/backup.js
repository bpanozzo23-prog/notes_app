import { db, notebookAccess, writeTransaction, announceReplacement } from "./db.js";
import { APP_VERSION, SCHEMA_VERSION } from "../version.js";
import { nowIso } from "../lib/dates.js";
import { extractFileIds, extractNoteLinks, htmlToText } from "../lib/text.js";
import { isSafeId, newId } from "../lib/ids.js";
import { FORMATTING_KEYS, sanitizePreference } from "../editor/formatting.js";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "./files.js";
import { toBase64, fromBase64, base64Size } from "../lib/base64.js";
import { clearFileUrls } from "../editor/fileUrls.js";

import { claudeApiKey, claudeEnabled, claudeSpend, claudeLastChange } from "../claude/prefs.js";
import { claudeSession } from "../claude/session.js";
import { syncAddress, syncToken, syncOutbox, syncHandled } from "../sync/prefs.js";
import { syncLifecycle } from "../sync/lifecycle.js";

// Measured on the owner's phone (2026-10-18): 40 MB and 118 MB backups each took about 1–2 s to
// import and export. The warning starts just above the largest size proven comfortable.
export const COMFORTABLE_BACKUP_BYTES = 150 * 1024 * 1024;
const V1_EXPORTED_PREFS = Object.freeze(["lastBackupAt", "toolbar"]);
export const EXPORTED_PREFS = Object.freeze(["lastBackupAt", ...FORMATTING_KEYS]);
// Device-local preferences that older backups contained: accepted with a warning, never restored.
export const IGNORED_PREFS = Object.freeze(["storagePersisted", claudeEnabled, claudeSpend, claudeLastChange, syncAddress, syncOutbox, syncHandled]);
export const BACKUP_FORMAT = "notes_app-backup";

async function readBackupRows(includeData = false) {
  const [notes, folders, tombstones, prefs] = await Promise.all([
    db.notes.toArray(), db.folders.toArray(), db.tombstones.toArray(), db.prefs.bulkGet(EXPORTED_PREFS),
  ]);
  const files = [];
  for (const id of [...new Set(notes.flatMap((note) => extractFileIds(note.html)))].sort()) {
    const file = await db.files.get(id), data = await db.fileData.get(id);
    const metadata = file ? Object.fromEntries(["id", "type", "size", "width", "height", "createdAt"].map((key) => [key, file[key]])) : null;
    files.push({ id, metadata, size: data?.bytes?.byteLength ?? null,
      ...(includeData && file && data ? { data: toBase64(data.bytes) } : {}) });
  }
  return { notes, folders, tombstones, files, preferences: Object.fromEntries(prefs.filter(Boolean).map(({ key, value }) => [key, value])) };
}
function backupFingerprint({ files, ...rows }) {
  // Picture bytes are immutable under an id. Include missing halves and sizes, but not
  // unused-image clocks or device-local preferences. No asynchronous hash inside Dexie.
  return JSON.stringify({ ...rows, files: files.map(({ id, metadata, size }) => ({ id, metadata, size })) },
    (_key, value) => value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value);
}
export async function buildSafetyBackup() {
  return db.transaction("r", db.notes, db.folders, db.tombstones, db.prefs, db.files, db.fileData, async () => {
    await notebookAccess.check();
    const rows = await readBackupRows(true), fingerprint = backupFingerprint(rows);
    // Keep missing references in the notes so validation can report either missing half.
    const files = rows.files.filter(({ data }) => data !== undefined).map(({ metadata, data }) => ({ ...metadata, data }));
    const envelope = {
      format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: nowIso(), appVersion: APP_VERSION,
      ...rows, files,
    };
    const result = validateBackup(envelope);
    if (!result.ok) throw new Error(`Could not back up notebook: ${result.errors.join(" ")}`);
    return { envelope: result.envelope, fingerprint };
  });
}
export async function buildBackup() { return (await buildSafetyBackup()).envelope; }

export function backupFilename() {
  return `notes-backup-${nowIso().slice(0, 19).replaceAll(":", "-")}.json`;
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isString = (value) => typeof value === "string";
const isId = isSafeId;
// Canonical UTC timestamps keep the database's string indexes chronologically ordered.
const isDate = (value) => isString(value) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const isStrings = (value) => Array.isArray(value) && value.every(isId);

function validateV1(envelope, errors, warnings) {
  const { notes, folders, tombstones, preferences } = envelope;
  for (const key of ["notes", "folders", "tombstones"]) {
    if (!Array.isArray(envelope[key])) errors.push(`${key} must be an array.`);
  }
  if (!isObject(preferences)) errors.push("preferences must be an object.");
  if (errors.length) return;

  const seen = new Set();
  for (const [table, rows] of [["notes", notes], ["folders", folders], ["tombstones", tombstones]]) {
    rows.forEach((row, index) => {
      const where = `${table}[${index}]`;
      if (!isObject(row)) { errors.push(`${where} must be an object.`); return; }
      if (!isId(row.id)) errors.push(`${where}.id must be a nonblank string.`);
      else if (seen.has(row.id)) errors.push(`Duplicate id: ${row.id}.`);
      else seen.add(row.id);
      if (table === "notes") {
        for (const field of ["title", "html", "text"]) {
          if (!isString(row[field])) errors.push(`${where}.${field} must be a string.`);
        }
        if (row.folderId !== null && !isId(row.folderId)) errors.push(`${where}.folderId must be an id or null.`);
        for (const field of ["tags", "linkedIds"]) {
          if (!isStrings(row[field])) errors.push(`${where}.${field} must be an array of nonblank strings.`);
          else if (new Set(row[field]).size !== row[field].length || row[field].some((value) => value !== value.trim())) {
            errors.push(`${where}.${field} must be trimmed and unique.`);
          }
        }
        if (typeof row.pinned !== "boolean") errors.push(`${where}.pinned must be a boolean.`);
        if (!Number.isSafeInteger(row.rev) || row.rev < 1) errors.push(`${where}.rev must be a positive integer.`);
        for (const field of ["createdAt", "updatedAt"]) {
          if (!isDate(row[field])) errors.push(`${where}.${field} must be an ISO UTC timestamp.`);
        }
        if (row.deletedAt !== null && !isDate(row.deletedAt)) errors.push(`${where}.deletedAt must be an ISO UTC timestamp or null.`);
      } else if (table === "folders") {
        if (!isId(row.name)) errors.push(`${where}.name must be a nonblank string.`);
        if (!Number.isSafeInteger(row.position) || row.position < 0) errors.push(`${where}.position must be a nonnegative integer.`);
      } else if (!isDate(row.purgedAt)) errors.push(`${where}.purgedAt must be an ISO UTC timestamp.`);
    });
  }
  const folderIds = new Set(folders.filter(isObject).map((row) => row.id));
  const noteIds = new Set(notes.filter(isObject).map((row) => row.id));
  for (const note of notes.filter(isObject)) {
    if (isId(note.folderId) && !folderIds.has(note.folderId)) errors.push(`Note ${note.id} has a dangling folderId.`);
    const linked = new Set([
      ...(isStrings(note.linkedIds) ? note.linkedIds : []),
      ...(isString(note.html) ? extractNoteLinks(note.html) : []),
    ]);
    for (const id of linked) {
      if (!noteIds.has(id)) warnings.push(`Note ${note.id} links to missing note ${id}.`);
    }
  }
  for (const [key, value] of Object.entries(preferences)) {
    if (IGNORED_PREFS.includes(key)) warnings.push(`Preference ${key} is specific to the device it was exported from and will be ignored.`);
    else if (!V1_EXPORTED_PREFS.includes(key)) errors.push(`Preference ${key} is not allowed in backups.`);
    else if (key === "lastBackupAt" && !isDate(value)) errors.push("lastBackupAt must be an ISO UTC timestamp.");
    else if (key === "toolbar" && !isStrings(value)) errors.push("toolbar must be an array of action ids.");
  }
}

function validateV2(envelope, errors, warnings) {
  // Run exactly the v1 table checks, then handle v2's cosmetic preferences separately.
  validateV1({ ...envelope, preferences: isObject(envelope.preferences) ? {} : envelope.preferences }, errors, warnings);
  if (!isObject(envelope.preferences)) return;
  for (const [key, value] of Object.entries(envelope.preferences)) {
    if (IGNORED_PREFS.includes(key)) {
      warnings.push(`Preference ${key} is specific to the device it was exported from and will be ignored.`);
      delete envelope.preferences[key];
    } else if (key === "lastBackupAt") {
      if (!isDate(value)) errors.push("lastBackupAt must be an ISO UTC timestamp.");
    } else {
      const result = sanitizePreference(key, value);
      warnings.push(...result.warnings);
      if (result.value === undefined) delete envelope.preferences[key];
      else envelope.preferences[key] = result.value;
    }
  }
}

function validateV4(envelope, errors, warnings) {
  validateV2(envelope, errors, warnings);
  // Derive references before inspecting files; stored projections are never authoritative.
  const references = new Map();
  for (const note of Array.isArray(envelope.notes) ? envelope.notes : []) {
    if (typeof note?.html === "string") references.set(note.id, extractFileIds(note.html));
  }
  const referenced = new Set([...references.values()].flat());
  if (!Array.isArray(envelope.files)) { errors.push("files must be an array."); return; }
  const seen = new Set([envelope.notes, envelope.folders, envelope.tombstones].flatMap((rows) => Array.isArray(rows) ? rows.map((row) => row?.id) : []));
  const fileIds = new Set();
  for (const [index, file] of envelope.files.entries()) {
    const where = `files[${index}]`;
    if (!isObject(file)) { errors.push(`${where} must be an object.`); continue; }
    if (!isId(file.id)) errors.push(`${where}.id must be a safe id.`);
    else if (seen.has(file.id)) errors.push(`Duplicate id: ${file.id}.`);
    else seen.add(file.id);
    fileIds.add(file.id);
    if (!IMAGE_TYPES.includes(file.type)) errors.push(`${where}.type is not supported.`);
    const size = base64Size(file.data);
    if (size === null) errors.push(`${where}.data must be valid base64.`);
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_IMAGE_BYTES || size !== file.size) errors.push(`${where}.size must match the image data and be at most 10 MB.`);
    for (const key of ["width", "height"]) if (!Number.isInteger(file[key]) || file[key] <= 0 || file[key] > 10000) errors.push(`${where}.${key} must be a positive integer at most 10,000.`);
    if (!isDate(file.createdAt)) errors.push(`${where}.createdAt must be an ISO UTC timestamp.`);
    if (!referenced.has(file.id)) warnings.push(`Image ${file.id} is not used by any note and will be skipped.`);
  }
  for (const [note, ids] of references) if (ids.some((id) => !fileIds.has(id))) warnings.push(`Note ${note} shows a missing image.`);
  envelope.files = envelope.files.filter((file) => isObject(file) && referenced.has(file.id));
}

const UPGRADES = Object.freeze({
  1: (envelope) => ({ ...envelope, schemaVersion: 2 }),
  2: (envelope) => ({ ...envelope, schemaVersion: 3 }),
  3: (envelope) => ({ ...envelope, schemaVersion: 4, files: [] }),
  4: (envelope) => ({ ...envelope, schemaVersion: 5 }),
  5: (envelope) => ({ ...envelope, schemaVersion: 6 }),
});
const VALIDATORS = Object.freeze({ 1: validateV1, 2: validateV2, 3: validateV2, 4: validateV4, 5: validateV4, 6: validateV4 });

export function upgradeEnvelope(envelope, targetVersion = SCHEMA_VERSION, upgrades = UPGRADES, validators = VALIDATORS) {
  const { files, ...rest } = envelope;
  let current = structuredClone(rest);
  if (Object.hasOwn(envelope, "files")) current.files = Array.isArray(files) ? [...files] : files;
  const errors = [];
  let warnings = [];
  while (true) {
    const validate = validators[current.schemaVersion];
    if (!validate) throw new Error(`Schema version ${current.schemaVersion} is not supported.`);
    const currentWarnings = [];
    validate(current, errors, currentWarnings);
    warnings = [...new Set([...warnings, ...currentWarnings])];
    if (errors.length || current.schemaVersion === targetVersion) return { envelope: current, errors, warnings };
    const upgrade = upgrades[current.schemaVersion];
    if (!upgrade) throw new Error(`No upgrade from schema version ${current.schemaVersion}.`);
    const next = upgrade(current);
    if (next.schemaVersion !== current.schemaVersion + 1) throw new Error("Backup upgrade must advance one schema version.");
    current = next;
  }
}

export function validateBackup(raw) {
  const errors = [];
  const summary = { notes: 0, folders: 0, tombstones: 0, trashed: 0, images: 0, imageBytes: 0, willUpgrade: false };
  let warnings = [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!isObject(parsed)) throw new Error("The file is not a backup envelope.");
    if (isObject(parsed.preferences) && Object.hasOwn(parsed.preferences, claudeApiKey)) {
      errors.push("This file contains an Anthropic API key, so it was not made by this app's export. Nothing was imported.");
    }
    if (isObject(parsed.preferences) && Object.hasOwn(parsed.preferences, syncToken)) {
      errors.push("This file contains a sync token, so it was not made by this app's export. Nothing was imported.");
    }
    for (const key of ["notes", "folders", "tombstones"]) {
      summary[key] = Array.isArray(parsed[key]) ? parsed[key].length : 0;
    }
    summary.trashed = Array.isArray(parsed.notes) ? parsed.notes.filter((note) => isObject(note) && isDate(note.deletedAt)).length : 0;
    summary.willUpgrade = Number.isInteger(parsed.schemaVersion) && parsed.schemaVersion >= 1 && parsed.schemaVersion < SCHEMA_VERSION;
    if (parsed.format !== BACKUP_FORMAT) errors.push("Not a notes_app backup.");
    if (!Number.isInteger(parsed.schemaVersion) || parsed.schemaVersion < 1) errors.push("schemaVersion must be a supported positive integer.");
    else if (parsed.schemaVersion > SCHEMA_VERSION) errors.push("This backup is newer than this app. Update the app first.");
    if (!isDate(parsed.exportedAt)) errors.push("exportedAt must be an ISO UTC timestamp.");
    if (!isId(parsed.appVersion)) errors.push("appVersion must be a nonblank string.");
    if (errors.length) return { ok: false, errors, warnings, envelope: null, summary };
    const upgraded = upgradeEnvelope(parsed);
    errors.push(...upgraded.errors);
    warnings = upgraded.warnings;
    summary.images = upgraded.envelope.files?.length ?? 0;
    summary.imageBytes = Array.isArray(upgraded.envelope.files) ? upgraded.envelope.files.reduce((sum, file) => sum + (Number.isSafeInteger(file?.size) ? file.size : 0), 0) : 0;
    return { ok: !errors.length, errors, warnings, envelope: errors.length ? null : upgraded.envelope, summary };
  } catch (error) {
    errors.push(error instanceof SyntaxError ? "The file is not valid JSON." : error instanceof Error ? error.message : "Could not read this backup.");
    return { ok: false, errors, warnings, envelope: null, summary };
  }
}

// Every UI path passes expected from its safety backup; fixture scripts may omit it.
export async function importBackup(envelope, { expected } = {}) {
  const checked = validateBackup(envelope);
  if (!checked.ok) throw new Error(`Refusing to import: ${checked.errors.join(" ")}`);
  const clean = checked.envelope;
  const notes = clean.notes.map((note) => ({ ...note, text: htmlToText(note.html), linkedIds: extractNoteLinks(note.html) }));
  const prefs = Object.entries(clean.preferences).filter(([key]) => EXPORTED_PREFS.includes(key)).map(([key, value]) => ({ key, value }));
  const generation = newId();
  syncLifecycle.beginImport();
  try {
    await writeTransaction([db.notes, db.folders, db.tombstones, db.prefs, db.files, db.fileData], async () => {
      if (expected !== undefined && backupFingerprint(await readBackupRows()) !== expected) {
        throw new Error("Your notebook changed in another window while the safety backup was made. Nothing was replaced. Tap Import and replace again.");
      }
      // Only exported preferences and the old Undo slot are replaced. Device-local
      // connection credentials, outbox entries and Claude settings survive a restore.
      await Promise.all([db.files.clear(), db.fileData.clear(), db.notes.clear(), db.folders.clear(), db.tombstones.clear(), db.prefs.bulkDelete([...EXPORTED_PREFS, claudeLastChange])]);
      await db.notes.bulkAdd(notes);
      await db.folders.bulkAdd(clean.folders);
      await db.tombstones.bulkAdd(clean.tombstones);
      for (const file of clean.files) {
        const { id, type, size, width, height, createdAt, data } = file;
        await db.files.add({ id, type, size, width, height, createdAt, unusedSince: null });
        await db.fileData.add({ id, bytes: fromBase64(data) });
      }
      await db.prefs.bulkAdd(prefs);
      await db.prefs.put({ key: "notebookGeneration", value: generation });
    });
    clearFileUrls();
    notebookAccess.adopt(generation);
    claudeSession.notebookReplaced();
    syncLifecycle.invalidate(); // Local, after commit; BroadcastChannel does not echo to its sender.
    announceReplacement(generation);
    return checked.summary;
  } finally { syncLifecycle.endImport(); }
}
