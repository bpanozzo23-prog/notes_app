// Made-up proposal versions shared by the model and screen tests.
import { AT } from "../test/fixtures.js";

export function proposalFixture(note, extra = {}) {
  return { proposal: `p-${note.id}`, hash: "a".repeat(64), note: note.id, basedOnRev: note.rev, generation: null,
    title: note.title, folderId: note.folderId, tags: [...note.tags], why: "Make the fixture clearer.",
    body: note.html, ingestedAt: AT, sequence: 1, status: "pending", ...extra };
}
export function newProposalFixture(extra = {}) {
  return { proposal: "p-new-fixture", hash: "b".repeat(64), generation: null, title: "New fixture", folderId: null,
    tags: ["new"], why: "Collect this fixture.", body: "<p>New fixture body</p>", ingestedAt: AT, sequence: 2, status: "pending", ...extra };
}
export function trashProposalFixture(note, extra = {}) {
  return { proposal: `p-trash-${note.id}`, hash: "c".repeat(64), generation: null, note: note.id, basedOnRev: note.rev,
    trash: true, why: "This fixture is finished.", ingestedAt: AT, sequence: 3, status: "pending", ...extra };
}
