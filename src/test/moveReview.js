import { act, cleanup } from "@testing-library/react";
import { vi } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "../db/db.js";
import { resetDatabase } from "./fixtures.js";
import { saveClaudeKey, setClaudeEnabled } from "../claude/prefs.js";
import { claudeSession } from "../claude/session.js";
export async function seedMoveReview() {
  claudeSession.clearSession(); await resetDatabase(); await saveClaudeKey('sk-ant-MOVE-FIXTURE'); await setClaudeEnabled(true);
  const sample = JSON.parse(readFileSync('public/sample-notebook.json', 'utf8'));
  await db.notes.bulkPut(sample.notes); await db.folders.bulkPut(sample.folders);
  window.history.replaceState(null, ''); vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  return sample;
}
export const reviewProps = (notes = []) => ({ notes: notes.filter((n) => n.deletedAt === null), trash: [], folders: [], openNote: vi.fn(), onOpen: vi.fn(), queue: { flush: vi.fn(async () => {}) }, run: async (task) => { await task(); return true; }, refresh: vi.fn(async () => {}), onBack: vi.fn(), busy: false, claudeReady: true });
export async function cleanupMoveReview() {
  cleanup(); claudeSession.clearSession(); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); vi.restoreAllMocks(); vi.unstubAllGlobals();
}
