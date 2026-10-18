import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Note from "./Note.jsx";
import { db, setPref } from "../db/db.js";
import { updateNote } from "../db/notes.js";
import { noteFixture, resetDatabase } from "../test/fixtures.js";
import { SaveQueue } from "../lib/saveQueue.js";

beforeEach(async () => {
  await resetDatabase();
  await db.notes.add(noteFixture());
  await setPref("claudeApiKey", "sk-ant-SENTINEL");
  await setPref("other", "PREF-SENTINEL");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete navigator.clipboard; delete document.execCommand; });

function start(readOnly = false, queue = new SaveQueue({ save: updateNote })) {
  const flush = vi.spyOn(queue, "flush");
  function Harness() {
    const [message, setMessage] = useState("");
    return <><p>{message}</p><Note initialNote={noteFixture()} notes={[noteFixture()]} folders={[]}
      queue={queue} readOnly={readOnly} run={(task) => task()} setMessage={setMessage} /></>;
  }
  render(<Harness />);
  return { queue, flush, button: screen.getByRole("button", { name: "Copy as text" }) };
}

it("copies freshly saved title and held editor input via the clipboard, without preferences", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const { flush, button } = start();
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Fresh title" } });
  const editor = screen.getByLabelText("Note body").editor;
  act(() => { editor.view.dom.querySelector("p").textContent = "Held edit"; });
  editor.view.domObserver.flushSoon();
  fireEvent.click(button);
  await screen.findByText("Copied as text.");
  expect(flush).toHaveBeenCalled();
  expect(writeText).toHaveBeenCalledTimes(1);
  const text = writeText.mock.calls[0][0];
  expect(text).toContain("# Fresh title\nFolder: No folder");
  expect(text).toContain("Held edit");
  expect(text).not.toMatch(/sk-ant|PREF-SENTINEL/);
  expect((await db.notes.get(noteFixture().id)).html).toBe("<p>Held edit</p>");
});

it.each(["unavailable", "rejected"])("falls back when clipboard is %s, works read-only, and removes its textarea", async (mode) => {
  if (mode === "rejected") Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: vi.fn().mockRejectedValue(new Error("Denied")),
  } });
  else Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  const exec = vi.fn(() => {
    const textarea = document.activeElement;
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea.value).toContain("# Fixture\nFolder: No folder");
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(textarea.value.length);
    return true;
  });
  document.execCommand = exec;
  const { button, flush } = start(true);
  const before = await db.notes.toArray();
  expect(button.disabled).toBe(false);
  expect(screen.getByRole("button", { name: "Pin note" }).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Choose folder" }).matches(":disabled")).toBe(true);
  expect(screen.getByLabelText("Add tag").matches(":disabled")).toBe(true);
  button.focus();
  fireEvent.click(button);
  await screen.findByText("Copied as text.");
  expect(flush).toHaveBeenCalled();
  expect(exec).toHaveBeenCalledExactlyOnceWith("copy");
  expect(document.querySelector("textarea")).toBeNull();
  expect(document.activeElement).toBe(button);
  expect(await db.notes.toArray()).toEqual(before);
});

it.each([false, "throws"])("reports an unsuccessful fallback (%s) and cleans up", async (result) => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  document.execCommand = vi.fn(() => { if (result === "throws") throw new Error("Denied"); return false; });
  fireEvent.click(start().button);
  await screen.findByText("Couldn't copy. Use Settings → Export notes as text.");
  expect(screen.queryByText("Copied as text.")).toBeNull();
  expect(document.querySelector("textarea")).toBeNull();
});

it("keeps folder, tags, pin and delete disabled in read-only mode while Copy as text stays available", async () => {
  const { render: draw, screen: view, cleanup: clear } = await import("@testing-library/react");
  const { default: NoteScreen } = await import("./Note.jsx");
  const { noteFixture: fixture } = await import("../test/fixtures.js");
  clear();
  const queue = { schedule: () => {}, flush: async () => {}, onBeforeFlush: () => () => {} };
  draw(<NoteScreen initialNote={fixture({ tags: ["uno"] })} notes={[]} folders={[]} queue={queue} readOnly run={(task) => task()} setMessage={() => {}} />);
  expect(view.getByRole("button", { name: "Copy as text" }).disabled).toBe(false);
  for (const name of ["Pin note", "Delete"]) expect(view.getByRole("button", { name }).disabled).toBe(true);
  for (const field of view.getAllByRole("group")) expect(field.disabled).toBe(true);
});
