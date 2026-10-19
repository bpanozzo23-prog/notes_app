import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { db, notebookAccess } from "../db/db.js";
import { resetDatabase, backupFixture } from "../test/fixtures.js";
import { importBackup } from "../db/backup.js";
import { claudeSession as session, canStartClaudeRequest, createClaudeSession } from "./session.js";

beforeEach(async () => { session.clearSession(); await resetDatabase(); });
afterEach(() => { session.clearSession(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("permits one request and rejects obsolete end/content callbacks", () => {
  const listener = vi.fn(), unsubscribe = session.subscribe(listener);
  const first = session.beginRequest("question");
  expect(session.isBusy()).toBe(true);
  expect(session.beginRequest("proposal")).toBeNull();
  expect(session.getSnapshot().request.generation).toBe(notebookAccess.getGeneration());
  session.setConversation(first.token, { text: "Fixture" });
  expect(session.hasContent()).toBe(true);
  session.endRequest(first.token);
  expect(session.isBusy()).toBe(false);
  const second = session.beginRequest("proposal");
  const before = session.getSnapshot();
  session.endRequest(first.token); session.setConversation(first.token, { text: "late" }); session.setProposal(first.token, { text: "late" });
  expect(session.getSnapshot()).toBe(before);
  session.setProposal(second.token, { title: "Fixture proposal" });
  expect(session.getSnapshot().proposal).toMatchObject({ title: "Fixture proposal", token: second.token });
  expect(listener).toHaveBeenCalled(); unsubscribe();
});
it.each(["clearSession", "cancelRequest", "invalidateSession", "notebookReplaced"])("%s aborts and rejects late writes", (method) => {
  const request = session.beginRequest("question");
  session.setConversation(request.token, { text: "Partial fixture" });
  session[method]("fixture");
  expect(request.signal.aborted).toBe(true);
  expect(session.isCurrent(request.token)).toBe(false);
  expect(session.isBusy()).toBe(false);
  const before = session.getSnapshot();
  session.setConversation(request.token, { text: "late" }); session.endRequest(request.token);
  expect(session.getSnapshot()).toBe(before);
  expect(session.hasContent()).toBe(method === "cancelRequest");
});
it("invalidates after local import commits, but not after a rolled-back import", async () => {
  const request = session.beginRequest("question");
  session.setConversation(request.token, { text: "Fixture" });
  vi.spyOn(db.notes, "bulkAdd").mockRejectedValueOnce(new Error("Disk full"));
  await expect(importBackup(backupFixture())).rejects.toThrow("Disk full");
  expect(session.isCurrent(request.token)).toBe(true);
  expect(request.signal.aborted).toBe(false);
  await importBackup(backupFixture());
  expect(session.hasContent()).toBe(false);
  expect(session.isBusy()).toBe(false);
  expect(request.signal.aborted).toBe(true);
});
it("invalidates on a replacement broadcast", () => {
  let channel;
  vi.stubGlobal("BroadcastChannel", class { constructor() { channel = this; } close() {} });
  const stop = notebookAccess.listen();
  const request = session.beginRequest("question");
  session.setProposal(request.token, { text: "Fixture" });
  channel.onmessage({ data: { type: "notebook-replaced", generation: "fixture-import" } });
  expect(request.signal.aborted).toBe(true);
  expect(session.hasContent()).toBe(false);
  expect(session.beginRequest("test-key")).toBeNull();
  stop();
});
it("invalidates on versionchange and rejects a changed generation even without a broadcast", () => {
  const request = session.beginRequest("question");
  notebookAccess.adopt("changed");
  expect(session.isCurrent(request.token)).toBe(false);
  session.setConversation(request.token, { text: "late" });
  expect(session.hasContent()).toBe(false);
  db.on("versionchange").fire({ oldVersion: 40, newVersion: 50 });
  expect(request.signal.aborted).toBe(true);
  expect(session.beginRequest("test-key")).toBeNull();
});
it.each([{ readOnly: true }, { replaced: true }, { versionChange: "pending" }, { versionChange: "closed" }])("disables new requests for %j", (state) => {
  expect(canStartClaudeRequest(state)).toBe(false);
});
it("allows an ordinary writable notebook", () => expect(canStartClaudeRequest({ readOnly: false, replaced: false, versionChange: null })).toBe(true));

it('retains ready duplicate suggestions with ticks across merge cancel, discard and recapture, and clears them for other work', () => {
  const session = createClaudeSession();
  const payload = { kind: 'duplicates', generation: null };
  session.prepareProposal(payload); const id = session.getSnapshot().proposal.id;
  session.updateProposal(id, { status: 'ready', proposal: { groups: [] }, ticked: ['g1:N1'] }); const original = session.getSnapshot().proposal;
  session.prepareProposal({ kind: 'merge', generation: null }, { keepSuggestions: true }); expect(session.getSnapshot().suggestions).toEqual(original);
  expect(session.hasContent()).toBe(true); session.discardProposal(); expect(session.getSnapshot().suggestions).toEqual(original);
  session.prepareProposal({ kind: 'merge', generation: null }); expect(session.getSnapshot().suggestions).toEqual(original);
  const request = session.beginRequest('merge'); expect(request).toBeTruthy(); expect(session.restoreSuggestions()).toBe(false); session.cancelRequest();
  expect(session.restoreSuggestions()).toBe(true); expect(session.getSnapshot().proposal.ticked).toEqual(['g1:N1']); expect(session.getSnapshot().suggestions).toBeNull();
  for (const kind of ['duplicates', 'tidy', 'links', 'reorganise', 'split']) {
    session.updateProposal(session.getSnapshot().proposal.id, { kind: 'duplicates', status: 'ready' });
    session.prepareProposal({ kind: 'merge', generation: null }, { keepSuggestions: true });
    session.prepareProposal({ kind, generation: null }); expect(session.getSnapshot().suggestions).toBeNull();
  }
  session.invalidateSession(); expect(session.getSnapshot().suggestions).toBeNull(); session.dispose();
});
