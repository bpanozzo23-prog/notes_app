import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Note from "./Note.jsx";
import { db } from "../db/db.js";
import { updateNote } from "../db/notes.js";
import { noteFixture, resetDatabase } from "../test/fixtures.js";
import { SaveQueue } from "../lib/saveQueue.js";
import { readFileAsText } from "../lib/file.js";

const blobs = [];
beforeEach(async () => {
  await resetDatabase();
  await db.notes.add(noteFixture());
  blobs.length = 0;
  URL.createObjectURL = vi.fn((blob) => { blobs.push(blob); return `blob:fixture-${blobs.length}`; });
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  delete navigator.share; delete navigator.canShare; delete navigator.clipboard;
  delete URL.createObjectURL; delete URL.revokeObjectURL;
});

function stubShare(share, canShare = () => true) {
  Object.defineProperty(navigator, "share", { configurable: true, value: share });
  Object.defineProperty(navigator, "canShare", { configurable: true, value: canShare });
}

function start({ initialNote = noteFixture(), notes = [noteFixture()], readOnly = false, save = updateNote } = {}) {
  const queue = new SaveQueue({ save });
  const downloads = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () { downloads.push(this.download); });
  function Harness() {
    const [message, setMessage] = useState("");
    return <><p data-testid="message">{message}</p><Note initialNote={initialNote} notes={notes} folders={[]}
      queue={queue} readOnly={readOnly} run={(task) => task()} setMessage={setMessage} /></>;
  }
  render(<Harness />);
  const options = screen.getByRole("button", { name: "Note options" });
  function choose(name) {
    options.focus();
    fireEvent.click(options);
    fireEvent.click(screen.getByRole("button", { name }));
  }
  return { queue, options, choose, downloads, message: () => screen.getByTestId("message").textContent };
}

it("asks for the share sheet inside the tap, before any save finishes, with the screen's text as a .txt file", async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  stubShare(share);
  const { queue, options, choose } = start();
  const flush = vi.spyOn(queue, "flush").mockReturnValue(new Promise(() => {}));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Fresh title" } });
  const editor = screen.getByLabelText("Note body").editor;
  act(() => { editor.view.dom.querySelector("p").textContent = "Held edit"; });
  editor.view.domObserver.flushSoon();
  choose("Share…");
  // No await above: Chrome refuses a share that isn't started by the tap itself.
  expect(share).toHaveBeenCalledOnce();
  expect(flush).toHaveBeenCalled();
  const [{ files, ...rest }] = share.mock.calls[0];
  expect(rest).toEqual({});
  expect(files).toHaveLength(1);
  expect(files[0]).toMatchObject({ name: "Fresh title.txt", type: "text/plain" });
  expect(await readFileAsText(files[0])).toBe("# Fresh title\n\nHeld edit\n");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(options);
});

it("shares what is on screen while the save is failing, and keeps the unsaved edit queued", async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  stubShare(share);
  const save = vi.fn().mockRejectedValue(new Error("Disk full"));
  const { queue, choose, message } = start({ save });
  const editor = screen.getByLabelText("Note body").editor;
  act(() => { editor.view.dom.querySelector("p").textContent = "Unsaved edit"; });
  editor.view.domObserver.flushSoon();
  choose("Share…");
  expect(await readFileAsText(share.mock.calls[0][0].files[0])).toBe("# Fixture\n\nUnsaved edit\n");
  await waitFor(() => expect(queue.status).toBe("error"));
  expect(save).toHaveBeenCalled();
  expect(save.mock.calls.at(-1)[1].html).toContain("Unsaved edit");
  expect([...queue.entries.values()][0].pending.html).toContain("Unsaved edit");
  expect(message()).toBe("");
});

it.each([
  ["has no Web Share", () => {}],
  ["can't share files", () => stubShare(vi.fn(), () => false)],
])("downloads the .md instead when the browser %s", async (_, setup) => {
  setup();
  const { choose, downloads, message } = start();
  choose("Share…");
  expect(downloads).toEqual(["Fixture.md"]);
  expect(await readFileAsText(blobs[0])).toBe("# Fixture\n\nHello\n");
  expect(message()).toBe("This browser can't share files, so “Fixture.md” was downloaded instead.");
});

it("says nothing when the owner cancels the share sheet, and offers Save as .md when sharing fails", async () => {
  stubShare(vi.fn().mockRejectedValue(new DOMException("Share canceled", "AbortError")));
  const first = start();
  first.choose("Share…");
  await act(async () => {});
  expect(first.message()).toBe("");
  cleanup();
  stubShare(vi.fn().mockRejectedValue(new DOMException("Permission denied", "NotAllowedError")));
  const second = start();
  second.choose("Share…");
  await waitFor(() => expect(second.message()).toBe("Couldn't share. Use Save as .md instead."));
  expect(second.downloads).toEqual([]);
});

it("saves, shares and copies the same bytes, read-only too", async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  stubShare(share);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const target = noteFixture({ id: "target", title: "Other note" });
  const initialNote = noteFixture({ html: '<h1>Plan</h1><p><strong>Bold</strong> see <a href="note:target">this</a></p>' });
  const { choose, downloads, message } = start({ initialNote, notes: [initialNote, target], readOnly: true });
  choose("Save as .md");
  expect(downloads).toEqual(["Fixture.md"]);
  expect(message()).toBe("Download started: “Fixture.md”.");
  const saved = await readFileAsText(blobs[0]);
  expect(saved).toBe("# Fixture\n\n## Plan\n\n**Bold** see this [→ Other note]\n");
  choose("Share…");
  expect(await readFileAsText(share.mock.calls[0][0].files[0])).toBe(saved);
  choose("Copy as text");
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  expect(writeText.mock.calls[0][0]).toBe(saved);
});

it("names an untitled note's file after its first line and writes its body as it stands", async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  stubShare(share);
  const initialNote = noteFixture({ title: "", html: "<h1>Trip: Lisbon/Porto</h1><p>Pack light</p>", text: "Trip: Lisbon/Porto\nPack light" });
  start({ initialNote, notes: [initialNote] }).choose("Share…");
  const [file] = share.mock.calls[0][0].files;
  expect(file.name).toBe("Trip- Lisbon-Porto.txt");
  expect(await readFileAsText(file)).toBe("# Trip: Lisbon/Porto\n\nPack light\n");
});
