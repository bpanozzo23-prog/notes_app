import { db, notebookAccess } from "../db/db.js";

export async function resetDatabase() {
  await db.delete();
  await notebookAccess.load();
}

export const AT = "2026-10-16T12:00:00.000Z";
export function noteFixture(overrides = {}) {
  return {
    id: "12345678-1234-4234-8234-123456789abc", title: "Fixture", html: "<p>Hello</p>", text: "Hello",
    folderId: null, tags: [], linkedIds: [], pinned: false, rev: 1,
    createdAt: AT, updatedAt: AT, deletedAt: null, ...overrides,
  };
}

export function backupFixture(overrides = {}) {
  return {
    format: "notes_app-backup", schemaVersion: 1, exportedAt: AT, appVersion: "0.0.1",
    notes: [noteFixture()], folders: [], tombstones: [], preferences: {}, ...overrides,
  };
}
