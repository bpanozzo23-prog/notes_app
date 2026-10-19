import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { db } from "../db/db.js";
import { createNote, updateNote, trashNote, purgeNow } from "../db/notes.js";
import { resetDatabase } from "../test/fixtures.js";
import { chunkedFetch } from "../test/anthropic.js";
import { askEvents } from "./fixtures/ask.js";
import { captureNotebookPayload } from "./payload.js";
import { runAsk } from "./ask.js";
import { captureTidyPayload, runTidy } from "./proposals.js";
import { captureReorganisePayload, runReorganise } from "./reorganise.js";
import { captureLinksPayload, runLinks } from "./links.js";
import { captureDuplicatesPayload, runDuplicates } from "./duplicates.js";
import { captureMergePayload, runMerge } from "./merge.js";
import { captureSplitPayload, runSplit } from "./split.js";
import { claudeSession as session } from "./session.js";
import { saveClaudeKey } from "./prefs.js";

const message = "A note changed since you saw what would be sent. Review it again.";
const kinds = [
  ["ask", () => captureNotebookPayload(), runAsk],
  ["tidy", (a) => captureTidyPayload(a.id), runTidy],
  ["reorganise", () => captureReorganisePayload(), runReorganise],
  ["links", () => captureLinksPayload(), runLinks],
  ["duplicates", () => captureDuplicatesPayload(), runDuplicates],
  ["merge", (a, b) => captureMergePayload([a.id, b.id]), runMerge],
  ["split", (a) => captureSplitPayload(a.id), runSplit],
];
beforeEach(async () => { session.clearSession(); await resetDatabase(); await saveClaudeKey("sk-ant-MADE-UP-FIXTURE"); });
afterEach(() => { session.clearSession(); vi.restoreAllMocks(); });
for (const [kind, capture, run] of kinds) {
  it.each(["trash", "purge", "generation", "edit"])(`${kind} rechecks disclosure liveness after %s`, async (change) => {
    const a = await createNote({ title: "A", html: "<p>Disclosed body</p>" }), b = await createNote({ title: "B" });
    const payload = await capture(a, b), fixture = chunkedFetch(askEvents({ blocks: [{ type: "text", text: "{}" }] })), fetch = vi.fn(fixture.fetch);
    if (change === "generation") await db.prefs.put({ key: "notebookGeneration", value: "missed-import" });
    if (change === "edit") await updateNote(a.id, { title: "Later edit", html: "<p>Later undisclosed body</p>" });
    if (["trash", "purge"].includes(change)) { await trashNote(a.id); if (change === "purge") await purgeNow(a.id); }
    const result = await run({ payload, question: "Question", fetch, maxRetries: 0 });
    if (change === "edit") {
      expect(fetch).toHaveBeenCalledTimes(1);
      const content = fixture.requests[0].body.messages[0].content;
      if (kind === "ask") expect(content[0].source.data).toBe(payload.entries[0].text);
      else expect(content).toBe(payload.requestText);
      expect(JSON.stringify(content)).not.toContain("Later undisclosed body");
    } else {
      expect(fetch).not.toHaveBeenCalled();
      if (kind === "ask") { expect(result).toEqual({ refused: true }); expect(session.getSnapshot().conversation).toBeNull(); }
      else expect(session.getSnapshot().proposal).toMatchObject({ status: "failed", error: message });
    }
    expect(session.isBusy()).toBe(false);
  });
}
it.each(kinds.filter(([kind]) => ["tidy", "merge", "split"].includes(kind)))("%s refuses a title-only otherNotes entry moved to Trash", async (_kind, capture, run) => {
  const a = await createNote({ title: "A" }), b = await createNote({ title: "B" }), other = await createNote({ title: "Title only" });
  const payload = await capture(a, b), fetch = vi.fn(async () => { throw new Error("Fixture only"); });
  expect(payload.otherNotes.some((note) => note.id === other.id)).toBe(true);
  await trashNote(other.id);
  await run({ payload, fetch, maxRetries: 0 });
  expect(fetch).not.toHaveBeenCalled();
  expect(session.getSnapshot().proposal).toMatchObject({ status: "failed", error: message });
});
