import { askEvents } from "./ask.js";
export const duplicatesProposal = { summary: "Hay dos grupos que se pueden combinar.", groups: [
  { notes: ["N15", "N16"], reason: "Las dos listas repiten libros por leer." },
  { notes: ["N3", "N4"], reason: "Estas frases se pueden repasar juntas." },
] };
export const duplicatesVariants = {
  unknown: { ...duplicatesProposal, groups: [{ notes: ["N15", "N99"], reason: "Unknown" }] },
  excessive: { ...duplicatesProposal, groups: Array.from({ length: 11 }, () => duplicatesProposal.groups[0]) },
  repeats: { ...duplicatesProposal, groups: [{ notes: ["N15", "N15", "N16"], reason: "Repeat" }] },
  overlap: { ...duplicatesProposal, groups: [duplicatesProposal.groups[0], { notes: ["N16", "N3", "N4"], reason: "Overlap" }] },
  six: { ...duplicatesProposal, groups: [{ notes: ["N1", "N2", "N3", "N4", "N5", "N6"], reason: "Six" }] },
  empty: { summary: "No duplicates.", groups: [] },
};
export const duplicatesEvents = (proposal = duplicatesProposal, options = {}) => askEvents({ id: "msg_duplicates_fixture", counts: { input_tokens: 6000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, blocks: [{ type: "text", text: JSON.stringify(proposal) }], ...options });
export const duplicatesShotsEvents = duplicatesEvents();
export const duplicatesRefusal = duplicatesEvents(duplicatesProposal, { stop: "refusal", blocks: [] });
export const duplicatesCut = duplicatesEvents(duplicatesProposal, { stop: "max_tokens" });
