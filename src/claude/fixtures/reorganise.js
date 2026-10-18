import { askEvents } from "./ask.js";
const keep = { action: "keep", name: null };
export const reorganiseProposal = {
  summary: "Give the reading reminder a title, group errands, and tag class notes.",
  changes: [
    { note: "N7", title: "Atomic Habits — chapter 3", folder: keep, addTags: [], removeTags: [], reason: "Name the book and chapter to find this reminder." },
    { note: "N18", title: "Cuaderno para la biblioteca", folder: { action: "create", name: "Pendientes" }, addTags: ["todo"], removeTags: [], reason: "Make the reminder easy to find with the other errands." },
    { note: "N10", title: null, folder: { action: "create", name: "Pendientes" }, addTags: [], removeTags: [], reason: "Keep errands together." },
    { note: "N14", title: null, folder: keep, addTags: ["clase"], removeTags: [], reason: "Find class notes together." },
    { note: "N17", title: null, folder: keep, addTags: ["clase"], removeTags: [], reason: "Find class preparation with class notes." },
  ],
};
export const reorganiseEvents = (proposal = reorganiseProposal, options = {}) => askEvents({ id: "msg_reorganise_fixture", counts: { input_tokens: 8000, output_tokens: 1500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, blocks: [{ type: "text", text: JSON.stringify(proposal) }], ...options });
export const reorganiseNotebook = reorganiseEvents();
export const unknownProposal = { ...reorganiseProposal, changes: [{ ...reorganiseProposal.changes[0], note: "N999" }] };
export const duplicateProposal = { ...reorganiseProposal, changes: [reorganiseProposal.changes[0], reorganiseProposal.changes[0]] };
export const excessiveProposal = { ...reorganiseProposal, changes: Array.from({ length: 41 }, (_, i) => reorganiseProposal.changes[i % reorganiseProposal.changes.length]) };
export const reorganiseUnknown = reorganiseEvents(unknownProposal);
export const reorganiseDuplicate = reorganiseEvents(duplicateProposal);
export const reorganiseExcessive = reorganiseEvents(excessiveProposal);
export const reorganiseRefusal = reorganiseEvents(reorganiseProposal, { stop: "refusal", blocks: [] });
export const reorganiseCut = reorganiseEvents(reorganiseProposal, { stop: "max_tokens" });
