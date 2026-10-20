// Made-up proposal versions shared by the model and screen tests.
import { AT } from "../test/fixtures.js";

export function proposalFixture(note, extra = {}) {
  return { proposal: `p-${note.id}`, hash: "a".repeat(64), note: note.id, basedOnRev: note.rev, generation: null,
    title: note.title, folderId: note.folderId, tags: [...note.tags], why: "Make the fixture clearer.",
    body: note.html, ingestedAt: AT, sequence: 1, status: "pending", ...extra };
}
