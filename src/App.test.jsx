import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App.jsx";
import { db, getPref, setPref } from "./db/db.js";
import { createNote, getNote } from "./db/notes.js";
import { backupFixture, resetDatabase } from "./test/fixtures.js";
import { downloadJson } from "./lib/file.js";

vi.mock("./lib/file.js", async (importOriginal) => ({ ...await importOriginal(), downloadJson: vi.fn() }));
let persist;
beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  persist = vi.fn().mockResolvedValue(true);
  Object.defineProperty(navigator, "storage", { configurable: true, value: { persist } });
});
afterEach(async () => {
  cleanup();
  // Let unmount's flush finish before the next test deletes the database.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete navigator.storage;
});
async function start() {
  render(<StrictMode><App /></StrictMode>);
  await waitFor(() => expect(screen.getByRole("button", { name: "+ New note" }).disabled).toBe(false));
}
async function back() {
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByRole("button", { name: "+ New note" });
}
async function settings() {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("button", { name: "Export backup" });
}
async function upload(raw) {
  fireEvent.change(screen.getByLabelText("Import backup"), { target: { files: [new File([typeof raw === "string" ? raw : JSON.stringify(raw)], "fixture.json", { type: "application/json" })] } });
  await screen.findByText("fixture.json");
}

it("creates, autosaves, leaves/reopens, exports and trashes a real fixture note", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await start();
  fireEvent.click(screen.getByRole("button", { name: "+ New note" }));
  const title = await screen.findByLabelText("Title");
  await waitFor(() => expect(screen.getByRole("button", { name: "Back" }).disabled).toBe(false));
  fireEvent.change(title, { target: { value: "Fixture title" } });
  act(() => screen.getByLabelText("Note body").editor.commands.insertContent("Fixture body"));
  await back();
  const [stored] = await db.notes.toArray();
  expect(stored).toMatchObject({ title: "Fixture title", text: "Fixture body" });
  expect(persist).toHaveBeenCalledTimes(1);
  expect(await getPref("storagePersisted")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Fixture title" }));
  expect(screen.getByLabelText("Note body").textContent).toBe("Fixture body");
  await back();
  await settings();
  fireEvent.click(screen.getByRole("button", { name: "Export backup" }));
  await screen.findByText("Backup download started.");
  expect(downloadJson.mock.calls[0][0].notes).toEqual([stored]);
  expect(await getPref("lastBackupAt")).toBeTruthy();
  await back();
  fireEvent.click(screen.getByRole("button", { name: "Fixture title" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await screen.findByText("No notes yet.");
  expect((await getNote(stored.id)).deletedAt).not.toBeNull();
});
it("previews import and cancellation; downloads a safety copy before replacing all tables", async () => {
  const original = await createNote({ title: "Original" });
  await setPref("privateKey", "fixture-only");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await start();
  await settings();
  await upload(backupFixture());
  expect(screen.getByText("1 notes (0 in Trash), 0 folders, 0 deletion records.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Replace notebook" }));
  await waitFor(() => expect(confirm).toHaveBeenCalledWith("Replace 1 notes and 0 folders with 1 notes and 0 folders?"));
  expect(await db.notes.toArray()).toEqual([original]);
  expect(downloadJson).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole("button", { name: "Replace notebook" }).disabled).toBe(false));
  confirm.mockReturnValue(true);
  const writes = [];
  downloadJson.mockImplementationOnce((backup, filename) => {
    writes.push("download");
    expect(backup.notes).toEqual([original]);
    expect(backup.preferences).not.toHaveProperty("privateKey");
    expect(filename).toMatch(/^before-import-notes-backup-/);
  });
  const bulk = db.notes.bulkAdd.bind(db.notes);
  vi.spyOn(db.notes, "bulkAdd").mockImplementation((rows) => { writes.push("import"); return bulk(rows); });
  fireEvent.click(screen.getByRole("button", { name: "Replace notebook" }));
  await screen.findByText(/Backup imported/);
  expect(writes).toEqual(["download", "import"]);
  expect(await db.notes.toArray()).toEqual(backupFixture().notes);
  // Device-local settings are not in the file and survive a restore.
  expect(await getPref("privateKey")).toBe("fixture-only");
});
it("shows invalid-file errors without offering replacement, and aborts if the safety download fails", async () => {
  const original = await createNote({ title: "Keep" });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await start();
  await settings();
  await upload("not JSON");
  expect(screen.getByRole("alert").textContent).toContain("not valid JSON");
  expect(screen.queryByRole("button", { name: "Replace notebook" })).toBeNull();
  await upload(backupFixture());
  downloadJson.mockImplementationOnce(() => { throw new Error("Download failed"); });
  fireEvent.click(screen.getByRole("button", { name: "Replace notebook" }));
  await screen.findByText("Download failed");
  expect(await db.notes.toArray()).toEqual([original]);
});
it("shows persistent save failure, keeps the editor open, and retries before navigation", async () => {
  const original = await createNote({ title: "Original" });
  await start();
  fireEvent.click(screen.getByRole("button", { name: "Original" }));
  const put = vi.spyOn(db.notes, "put").mockRejectedValue(new Error("Quota exceeded"));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Unsaved title" } });
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByText("Not saved");
  expect(screen.getByLabelText("Title").value).toBe("Unsaved title");
  expect((await getNote(original.id)).title).toBe("Original");
  put.mockRestore();
  await waitFor(() => expect(screen.getByRole("button", { name: "Retry save" }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(screen.queryByText("Not saved")).toBeNull());
  await back();
  expect((await getNote(original.id)).title).toBe("Unsaved title");
});
it.each(["blur", "hidden", "pagehide"])("flushes pending title edits on %s", async (event) => {
  const original = await createNote({ title: "Original" });
  await start();
  fireEvent.click(screen.getByRole("button", { name: "Original" }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Flush me" } });
  if (event === "blur") fireEvent.blur(screen.getByLabelText("Title"));
  if (event === "hidden") {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
  }
  if (event === "pagehide") fireEvent(window, new Event("pagehide"));
  // Less than the 400 ms debounce: this must be the event's explicit flush.
  await waitFor(async () => expect((await getNote(original.id)).title).toBe("Flush me"), { timeout: 300 });
});
it("purges expired fixture notes on startup and reads the saved toolbar", async () => {
  const old = await createNote({ title: "Old" });
  await db.notes.update(old.id, { deletedAt: "2020-01-01T00:00:00.000Z" });
  await createNote({ title: "Live" });
  await setPref("toolbar", ["h1"]);
  await start();
  expect(await getNote(old.id)).toBeUndefined();
  expect(await db.tombstones.get(old.id)).toMatchObject({ id: old.id });
  fireEvent.click(screen.getByRole("button", { name: "Live" }));
  const toolbar = screen.getByRole("toolbar");
  expect(toolbar.querySelectorAll("button")).toHaveLength(1);
  expect(toolbar.textContent).not.toContain("Bold");
});

it("does not claim persistence from an imported preference when this browser lacks the API", async () => {
  delete navigator.storage;
  await setPref("storagePersisted", true);
  await start();
  await settings();
  expect(screen.getByText("Persistent storage: Unavailable in this browser")).toBeTruthy();
});
