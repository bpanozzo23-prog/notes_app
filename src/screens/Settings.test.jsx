import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Settings from "./Settings.jsx";
import { db, getPref, setPref } from "../db/db.js";
import { noteFixture, resetDatabase } from "../test/fixtures.js";
import { readFileAsText } from "../lib/file.js";
import * as filesDb from "../db/files.js";

beforeEach(resetDatabase);
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const props = () => ({
  notebook: { notes: [], trash: [], folders: [], prefs: {}, refresh: vi.fn() },
  queue: { status: "idle", flush: vi.fn() },
});

it.each([
  [false, false], [true, false], [false, true], [true, true],
])("opens the labelled hidden import input only when enabled (busy=%s, readOnly=%s)", async (busy, readOnly) => {
  render(<Settings {...props()} busy={busy} readOnly={readOnly} />);
  await screen.findByText("Images: 0 (1 KB)");
  const input = screen.getByLabelText("Import backup");
  const click = vi.spyOn(input, "click").mockImplementation(() => {});
  const button = screen.getByRole("button", { name: "Choose a backup file…" });
  expect(input.type).toBe("file");
  expect(input.classList.contains("sr-only")).toBe(true);
  expect(input.disabled).toBe(busy || readOnly);
  expect(button.disabled).toBe(busy || readOnly);
  fireEvent.click(button);
  expect(click).toHaveBeenCalledTimes(busy || readOnly ? 0 : 1);
});

it("shows the image count with its formatted size in parentheses", async () => {
  vi.spyOn(filesDb, "fileStats").mockResolvedValue({ count: 1, bytes: 5 * 1024, base64Bytes: 7 * 1024 });
  render(<Settings {...props()} />);
  expect(await screen.findByText("Images: 1 (5 KB)")).toBeTruthy();
});

it.each([
  [true, "Yes"], [false, "No (export backups regularly)"],
  [undefined, "Not asked yet"], ["unavailable", "Not available in this browser"],
])("explains storage protection for %s", async (persisted, label) => {
  const settings = props();
  settings.notebook.persisted = persisted;
  render(<Settings {...settings} />);
  await screen.findByText("Images: 0 (1 KB)");
  expect(screen.getByText(`Protected from automatic clearing: ${label}`)).toBeTruthy();
});

it.each([
  ["idle", "Saved"], ["pending", "Saving…"], ["saving", "Saving…"], ["error", "Not saved — Disk full"],
])("labels the App save status %s and retains any error detail", async (status, label) => {
  const settings = props();
  settings.queue.status = status;
  settings.queue.error = new Error("Disk full");
  render(<Settings {...settings} />);
  await screen.findByText("Images: 0 (1 KB)");
  const saved = screen.getByText(`Save status: ${label}`);
  expect(saved.classList.contains("text-red-700")).toBe(status === "error");
  expect(saved.classList.contains("font-semibold")).toBe(status === "error");
  expect(saved.classList.contains("text-[var(--color-muted)]")).toBe(status !== "error");
});

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
