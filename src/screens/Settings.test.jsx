import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Settings from "./Settings.jsx";
import { db, getPref, setPref } from "../db/db.js";
import { noteFixture, resetDatabase } from "../test/fixtures.js";
import { readFileAsText } from "../lib/file.js";

beforeEach(resetDatabase);
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([false, true])("exports fresh text after flush, with no preference values or backup timestamp change (readOnly=%s)", async (readOnly) => {
  await db.notes.bulkAdd([noteFixture(), noteFixture({ id: "trash", title: "TRASH-SENTINEL", deletedAt: "2026-10-18" })]);
  await setPref("claudeApiKey", "sk-ant-SENTINEL");
  await setPref("someOtherPreference", "PREF-SENTINEL");
  await setPref("lastBackupAt", "2025-01-02T12:00:00Z");
  const beforePrefs = await db.prefs.toArray();
  const create = vi.fn(() => "blob:fixture"), run = vi.fn((task) => task()), setMessage = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
  let filename;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () { filename = this.download; });
  const queue = { status: "idle", flush: vi.fn(async () => {
    // Rows change during flush; stale notebook props must never be used.
    await db.notes.update(noteFixture().id, { title: "Fresh title", html: "<p>Fresh body</p>", folderId: "fresh" });
    await db.folders.put({ id: "fresh", name: "Fresh folder", position: 0 });
  }) };
  render(<Settings notebook={{ notes: [], trash: [], folders: [], prefs: {}, refresh: vi.fn() }}
    queue={queue} run={run} setMessage={setMessage} readOnly={readOnly} />);
  const button = screen.getByRole("button", { name: "Export notes as text" });
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  await waitFor(() => expect(setMessage).toHaveBeenCalledWith("Text download started."));
  expect(run).toHaveBeenCalledTimes(1);
  expect(queue.flush).toHaveBeenCalledTimes(1);
  expect(filename).toMatch(/^notes-text-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.md$/);
  const blob = create.mock.calls[0][0];
  expect(blob.type).toBe("text/markdown;charset=utf-8");
  const text = await readFileAsText(blob);
  expect(text).toContain("## Fresh folder\n\n### Fresh title");
  expect(text).toContain("Fresh body");
  expect(text).not.toMatch(/sk-ant|PREF-SENTINEL|TRASH-SENTINEL|2025-01-02/);
  expect(await getPref("lastBackupAt")).toBe("2025-01-02T12:00:00Z");
  expect(await db.prefs.toArray()).toEqual(beforePrefs);
});
