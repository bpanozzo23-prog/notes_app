import { db, allPrefs, notebookAccess, writeTransaction, announceReplacement } from "./db.js";
import { APP_VERSION, SCHEMA_VERSION } from "../version.js";
import { nowIso } from "../lib/dates.js";
import { extractNoteLinks, htmlToText } from "../lib/text.js";
import { isSafeId, newId } from "../lib/ids.js";
import { FORMATTING_KEYS, sanitizePreference } from "../editor/formatting.js";

const V1_EXPORTED_PREFS = Object.freeze(["lastBackupAt", "toolbar"]);
export const EXPORTED_PREFS = Object.freeze(["lastBackupAt", ...FORMATTING_KEYS]);
// Device-local preferences that older backups contained: accepted with a warning, never restored.
export const IGNORED_PREFS = Object.freeze(["storagePersisted"]);
export const BACKUP_FORMAT = "notes_app-backup";

export async function buildBackup() {
  return db.transaction("r", db.notes, db.folders, db.tombstones, db.prefs, async () => {
    await notebookAccess.check();
    const [notes, folders, tombstones, prefs] = await Promise.all([
      db.notes.toArray(), db.folders.toArray(), db.tombstones.toArray(), allPrefs(),
    ]);
    const envelope = {
      format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: nowIso(), appVersion: APP_VERSION,
      notes, folders, tombstones,
      preferences: Object.fromEntries(EXPORTED_PREFS.filter((key) => Object.hasOwn(prefs, key)).map((key) => [key, prefs[key]])),
    };
    const result = validateBackup(envelope);
    if (!result.ok) throw new Error(`Could not back up notebook: ${result.errors.join(" ")}`);
    return result.envelope;
  });
}

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

const UPGRADES = Object.freeze({ 1: (envelope) => ({ ...envelope, schemaVersion: 2 }) });
const VALIDATORS = Object.freeze({ 1: validateV1, 2: validateV2 });

export function upgradeEnvelope(envelope, targetVersion = SCHEMA_VERSION, upgrades = UPGRADES, validators = VALIDATORS) {
  let current = structuredClone(envelope);
  const errors = [];
  let warnings = [];
  while (true) {
    const validate = validators[current.schemaVersion];
    if (!validate) throw new Error(`Schema version ${current.schemaVersion} is not supported.`);
    warnings = [];
    validate(current, errors, warnings);
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
  const summary = { notes: 0, folders: 0, tombstones: 0, trashed: 0, willUpgrade: false };
  let warnings = [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!isObject(parsed)) throw new Error("The file is not a backup envelope.");
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
    return { ok: !errors.length, errors, warnings, envelope: errors.length ? null : upgraded.envelope, summary };
  } catch (error) {
    errors.push(error instanceof SyntaxError ? "The file is not valid JSON." : error instanceof Error ? error.message : "Could not read this backup.");
    return { ok: false, errors, warnings, envelope: null, summary };
  }
}

export async function importBackup(envelope) {
  const checked = validateBackup(envelope);
  if (!checked.ok) throw new Error(`Refusing to import: ${checked.errors.join(" ")}`);
  const clean = checked.envelope;
  const notes = clean.notes.map((note) => ({ ...note, text: htmlToText(note.html), linkedIds: extractNoteLinks(note.html) }));
  const prefs = Object.entries(clean.preferences).filter(([key]) => EXPORTED_PREFS.includes(key)).map(([key, value]) => ({ key, value }));
  const generation = newId();
  await writeTransaction([db.notes, db.folders, db.tombstones, db.prefs], async () => {
    // Only the exportable preferences are replaced: device-local ones such as a future API key
    // are not in any backup and must survive a restore.
    await Promise.all([db.notes.clear(), db.folders.clear(), db.tombstones.clear(), db.prefs.bulkDelete([...EXPORTED_PREFS])]);
    await db.notes.bulkAdd(notes);
    await db.folders.bulkAdd(clean.folders);
    await db.tombstones.bulkAdd(clean.tombstones);
    await db.prefs.bulkAdd(prefs);
    await db.prefs.put({ key: "notebookGeneration", value: generation });
  });
  notebookAccess.adopt(generation);
  announceReplacement(generation);
  return checked.summary;
}
