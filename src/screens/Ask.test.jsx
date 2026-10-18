import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import App from "../App.jsx";
import Ask from "./Ask.jsx";
import Note from "./Note.jsx";
import NotesList from "./NotesList.jsx";
import ClaudeAnswer from "../components/ClaudeAnswer.jsx";
import Sources, { sourceState } from "../components/Sources.jsx";
import { db, notebookAccess } from "../db/db.js";
import { resetDatabase, noteFixture } from "../test/fixtures.js";
import { saveClaudeKey, setClaudeEnabled } from "../claude/prefs.js";
import { claudeSession as session } from "../claude/session.js";
import { captureNotebookPayload, captureNotePayload } from "../claude/payload.js";
import { updateNote } from "../db/notes.js";
import { chunkedFetch } from "../test/anthropic.js";
import { askEvents } from "../claude/fixtures/ask.js";
import { inspect } from "node:util";

const key = "sk-ant-SENTINEL-DO-NOT-LEAK-1234567890";
const note = noteFixture({ title: "Made-up note" });
const events = askEvents({ blocks: [{ type: "text", text: 'An answer. <img src=x onerror=alert(1)> https://example.com', citations: [{ type: "char_location", document_index: 0, document_title: note.title, cited_text: "Hello", start_char_index: 0, end_char_index: 5, file_id: null }] }] });
const queue = () => ({ flush: vi.fn().mockResolvedValue(), schedule: vi.fn(), onBeforeFlush: vi.fn(() => () => {}) });
const props = () => ({ notes: [note], trash: [], folders: [], openNote: vi.fn(), queue: queue(), run: async (task) => { await task(); return true; }, busy: false, claudeReady: true, onBack: vi.fn(), onOpen: vi.fn() });
beforeEach(async () => {
  session.clearSession(); await resetDatabase(); await db.notes.put(note); await saveClaudeKey(key); await setClaudeEnabled(true);
  window.history.replaceState(null, ""); vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(async () => {
  cleanup(); session.clearSession(); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
const button = (name) => screen.getByRole("button", { name, exact: true });
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
async function disclose(question = "What is here?") {
  type("Your question", question); fireEvent.click(button("Send"));
  return screen.findByRole("dialog", { name: "Send to Anthropic?" });
}
it("flushes before capture, fetches nothing during disclosure, keeps Cancel text, and sends the frozen payload", async () => {
  const fixture = chunkedFetch(events); const fetch = vi.fn(fixture.fetch); vi.stubGlobal("fetch", fetch);
  const shared = props(); shared.queue.flush.mockImplementationOnce(() => updateNote(note.id, { html: "<p>Flushed draft</p>" }));
  render(<Ask {...shared} />);
  let dialog = await disclose("First question\nSecond line");
  expect(shared.queue.flush).toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.getByLabelText("Your question").value).toBe("First question\nSecond line");
  fireEvent.click(button("Send")); dialog = await screen.findByRole("dialog");
  await updateNote(note.id, { html: "<p>After disclosure</p>" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));
  await waitFor(() => expect(session.getSnapshot().conversation?.turns[0].status).toBe("completed"));
  expect(fixture.requests[0].body.messages[0].content[0].source.data).toBe("Flushed draft");
  expect(document.querySelector("article img")).toBeNull(); expect(document.querySelector("article a")).toBeNull();
  expect(screen.getByText(/<img src=x/)).toBeTruthy();
});
it("re-captures and re-discloses when images are ticked after a note revision changed", async () => {
  await updateNote(note.id, { html: '<p>First</p><img data-file="image">' });
  await db.files.put({ id: "image", type: "image/png", width: 28, height: 28, size: 3 });
  await db.fileData.put({ id: "image", bytes: new Uint8Array([1,2,3]).buffer });
  session.setPendingScope({ kind: "note", noteId: note.id });
  const fixture = chunkedFetch(events), fetch = vi.fn(fixture.fetch); vi.stubGlobal("fetch", fetch);
  render(<Ask {...props()} />);
  const dialog = await disclose();
  await updateNote(note.id, { html: '<p>New text</p><img data-file="image">' });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  await screen.findByText("The note changed. Review the new disclosure and choose images again.");
  expect(screen.getByRole("checkbox").checked).toBe(false); expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox")); await screen.findByText(/1 image prepared/);
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Send" }));
  await waitFor(() => expect(fixture.requests).toHaveLength(1));
  expect(fixture.requests[0].body.messages[0].content[0].source.data).toContain("New text");
  expect(fixture.requests[0].body.messages[0].content[1].source).toEqual({ type: "base64", media_type: "image/png", data: "AQID" });
  await waitFor(() => expect(session.isBusy()).toBe(false));
});
it.each([{ readOnly: true }, { replaced: true }, { versionChange: "pending" }])("disables Send for guard state %j", (access) => {
  vi.spyOn(notebookAccess, "getSnapshot").mockReturnValue(access); render(<Ask {...props()} />);
  type("Your question", "Hi"); expect(button("Send").disabled).toBe(true); expect(screen.getByRole("status").textContent).toMatch(/Reload/);
});
it("tracks offline events and offers Claude settings when not ready", () => {
  const shared = props(); const view = render(<Ask {...shared} />); type("Your question", "Hi");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  act(() => window.dispatchEvent(new Event("offline")));
  expect(button("Send").disabled).toBe(true); expect(screen.getByText("You're offline. Claude needs a connection.")).toBeTruthy();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true); act(() => window.dispatchEvent(new Event("online")));
  view.rerender(<Ask {...shared} claudeReady={false} />);
  expect(screen.getByText("Turn Claude on in Settings → Claude.")).toBeTruthy(); fireEvent.click(button("Open Settings → Claude"));
  expect(shared.onOpen).toHaveBeenCalledWith({ screen: "settings-claude" });
});
it("sources use current titles/folders and updatedAt, including Trash and missing states", async () => {
  const payload = await captureNotebookPayload(), source = { noteId: note.id, title: "Snapshot", number: 1, quotes: ["Hello"] };
  const current = { ...note, title: "Current", folderId: "folder", rev: 2 };
  expect(sourceState(source,payload,[current],[],[]).label).toBe("");
  const edited = { ...current, updatedAt: "2026-10-19T12:00:00Z" };
  expect(sourceState(source,payload,[edited],[],[]).label).toBe("Edited since Claude read it");
  expect(sourceState(source,payload,[],[edited],[]).label).toBe("In Trash");
  expect(sourceState(source,payload,[],[],[])).toMatchObject({ title: "Snapshot", label: "No longer exists", exists: false });
  const openNote = vi.fn(); const view = render(<Sources sources={[source]} payload={payload} notes={[]} trash={[edited]} folders={[{ id: "folder", name: "Folder" }]} openNote={openNote} />);
  fireEvent.click(screen.getByRole("button")); expect(openNote).toHaveBeenCalledWith(note.id);
  view.rerender(<Sources sources={[source]} payload={payload} notes={[]} trash={[]} folders={[]} openNote={openNote} />);
  expect(screen.queryByRole("button")).toBeNull();
});
it("renders plain text, paragraphs, bullets and superscripts with no HTML or links", () => {
  const text = '<img src=x onerror=alert(1)>\nhttps://example.com\n\n- One\n- Two';
  render(<ClaudeAnswer display={{ text, citations: [{ text, numbers: [1,2] }] }} />);
  expect(document.querySelectorAll("img,a,script")).toHaveLength(0); expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByLabelText("Sources 1, 2")).toBeTruthy(); expect(document.querySelectorAll("p")).toHaveLength(1);
});
it("shows entry buttons only when ready and confirms before replacing a different scope", () => {
  const shared = { ...props(), initialNote: note, status: "idle", onOpenNote: vi.fn() };
  const view = render(<Note {...shared} claudeReady={false} />); expect(screen.queryByRole("button", { name: "Claude", exact: true })).toBeNull();
  view.rerender(<Note {...shared} />); fireEvent.click(button("Claude")); fireEvent.click(button("Ask about this note"));
  expect(session.getSnapshot().pendingScope).toEqual({ kind: "note", noteId: note.id }); expect(shared.onOpen).toHaveBeenCalledWith({ screen: "ask" });
  const request = session.beginRequest("ask"); session.setConversation(request.token, { scope: { kind: "notebook" }, turns: [] }); session.endRequest(request.token);
  fireEvent.click(button("Claude")); fireEvent.click(button("Ask about this note"));
  expect(screen.getByRole("dialog", { name: "Clear the current conversation and ask about this note?" })).toBeTruthy();
  fireEvent.click(button("Cancel")); expect(session.hasContent()).toBe(true);
  fireEvent.click(button("Claude")); fireEvent.click(button("Ask about this note")); fireEvent.click(button("Clear and ask"));
  expect(session.hasContent()).toBe(false); expect(session.getSnapshot().pendingScope.noteId).toBe(note.id);
  view.unmount();
  const listProps = { notes: [], folders: [], filter: { type: "all" }, onOpen: vi.fn() };
  const list = render(<NotesList {...listProps} />); expect(screen.queryByRole("button", { name: "Ask Claude" })).toBeNull();
  list.rerender(<NotesList {...listProps} claudeReady />); fireEvent.click(button("Ask Claude"));
  expect(listProps.onOpen).toHaveBeenCalledWith({ screen: "ask" }); expect(session.getSnapshot().pendingScope.kind).toBe("notebook");
});
it("a full ask, source push/Back and follow-up keep the sentinel out of bodies, output, console and history", async () => {
  const logs = ["log", "warn", "error", "info", "debug"].map((name) => vi.spyOn(console,name).mockImplementation(() => {}));
  const fixture = chunkedFetch(events); vi.stubGlobal("fetch", fixture.fetch);
  render(<App />); await screen.findByRole("button", { name: "Ask Claude" });
  await waitFor(() => expect(button("Ask Claude").disabled).toBe(false)); fireEvent.click(button("Ask Claude"));
  await screen.findByLabelText("Your question");
  const dialog = await disclose(); fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));
  await screen.findByLabelText("Follow-up question");
  fireEvent.click(screen.getByRole("button", { name: /1\. Made-up note/ }));
  await screen.findByLabelText("Title"); fireEvent.click(button("Back")); await screen.findByLabelText("Follow-up question");
  type("Follow-up question", "More please"); fireEvent.click(screen.getByRole("button", { name: /^Send · about/ }));
  await waitFor(() => expect(session.getSnapshot().conversation.turns).toHaveLength(2));
  await waitFor(() => expect(session.isBusy()).toBe(false));
  for (const value of [fixture.requests.map((request) => request.body), document.body.innerHTML, window.history.state, session.getSnapshot(), ...logs.map((log) => log.mock.calls)]) expect(inspect(value,{depth:20})).not.toContain(key);
  expect(window.history.state.notesNavigation.stack.at(-1).screen).toBe("ask");
  expect(JSON.stringify(window.history.state)).not.toContain("More please");
  // A Trash source uses App's existing message and leaves the conversation visible.
  await act(async () => { await db.notes.update(note.id, { deletedAt: new Date().toISOString() }); });
  fireEvent.click(button("Back")); await screen.findByRole("heading", { name: "Notes", exact: true });
  fireEvent.click(button("Ask Claude")); await screen.findAllByText("In Trash");
  fireEvent.click(screen.getAllByRole("button", { name: /1\. Made-up note/ })[0]);
  expect(await screen.findByText("That note is in the Trash. Restore it from the Trash to open it.")).toBeTruthy();
});
it("New question confirms, resets to notebook, and reload-style mount starts empty", async () => {
  const fixture = chunkedFetch(events); vi.stubGlobal("fetch", fixture.fetch);
  session.setPendingScope({ kind: "note", noteId: note.id });
  render(<Ask {...props()} />); const dialog = await disclose(); fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));
  await screen.findByLabelText("Follow-up question"); fireEvent.click(button("New question"));
  expect(screen.getByRole("dialog", { name: "Clear this conversation?" })).toBeTruthy();
  fireEvent.click(button("Clear conversation")); expect(screen.getByText("All your notes")).toBeTruthy(); expect(session.hasContent()).toBe(false);
});
it("keeps a request running across leaving and remounting, and Cancel keeps partial text", async () => {
  const fixture = chunkedFetch(events, { stepped: true }); vi.stubGlobal("fetch", fixture.fetch);
  const view = render(<Ask {...props()} />); const dialog = await disclose(); fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));
  await waitFor(() => expect(fixture.requests).toHaveLength(1));
  await act(async () => { fixture.release(3); });
  await screen.findByText(/^An answer/); view.unmount(); expect(session.isBusy()).toBe(true);
  render(<Ask {...props()} />); expect(screen.getByText(/^An answer/)).toBeTruthy();
  fireEvent.click(button("Cancel")); expect(screen.getByText("Stopped", { exact: true })).toBeTruthy();
  expect(screen.getByText(/^An answer/)).toBeTruthy(); expect(session.isBusy()).toBe(false);
});
it("shows the large-request warning from the actual frozen disclosure", async () => {
  await updateNote(note.id, { html: `<p>${"x".repeat(310000)}</p>` });
  render(<Ask {...props()} />); await disclose(); expect(screen.getByText("This is a large request")).toBeTruthy();
});

it("dates and times the first request at confirmed Send, even if a disclosure spans midnight", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-18T23:59:00"));
  const fixture = chunkedFetch(events); vi.stubGlobal("fetch", fixture.fetch);
  render(<Ask {...props()} />); const dialog = await disclose();
  vi.setSystemTime(new Date("2026-10-19T00:01:00"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));
  await waitFor(() => expect(session.getSnapshot().conversation?.turns[0].status).toBe("completed"));
  expect(fixture.requests[0].body.messages[0].content.at(-1).text).toContain("Today is Monday 19 October 2026.");
  expect(session.getSnapshot().conversation.turns[0].startedAt).toBe(new Date("2026-10-19T00:01:00").toISOString());
});
it("closes the old disclosure if a stale image recapture can no longer find a live note", async () => {
  await updateNote(note.id, { html: '<p>Text</p><img data-file="image">' });
  session.setPendingScope({ kind: "note", noteId: note.id });
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const shared = props(); shared.run = async (task) => { try { await task(); return true; } catch { return false; } };
  render(<Ask {...shared} />); const dialog = await disclose();
  await db.notes.update(note.id, { deletedAt: new Date().toISOString(), rev: 3 });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(fetch).not.toHaveBeenCalled(); expect(screen.getByLabelText("Your question").value).toBe("What is here?");
});
