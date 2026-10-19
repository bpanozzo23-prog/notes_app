import { askEvents } from "./ask.js";
export const mergeProposal = { summary: "Una lista con los cuatro libros.", title: "Libros por leer", tags: ["book"], folder: { action: "keep", name: null },
  html: '<ul><li><p>El principito</p></li><li><p>Pedro Páramo</p></li><li><p>La casa de los espíritus</p></li><li><p>Ficciones — probar después</p></li></ul>', reason: "Reunir las lecturas sin repetir títulos." };
export const mergeVariants = {
  unknownImage: { ...mergeProposal, html: '<p>Books</p><img data-file="I404">' },
  unknownNote: { ...mergeProposal, html: '<p><a href="note:N404">Books</a></p>' },
  groupLink: { ...mergeProposal, html: '<p><a href="note:N16">Lista</a> y <a href="note:N15">Libros</a></p>' },
  empty: { ...mergeProposal, html: '' }, badTitle: { ...mergeProposal, title: 'x'.repeat(201) },
  badTags: { ...mergeProposal, tags: ['book', ' book '] }, badFolder: { ...mergeProposal, folder: { action: 'existing', name: 'Missing' } },
  newFolder: { ...mergeProposal, folder: { action: 'create', name: 'Lecturas pendientes' } },
};
export const mergeEvents = (proposal = mergeProposal, options = {}) => askEvents({ id: "msg_merge_fixture", counts: { input_tokens: 2500, output_tokens: 700, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, blocks: [{ type: "text", text: JSON.stringify(proposal) }], ...options });
export const mergeShotsEvents = mergeEvents();
export const mergeRefusal = mergeEvents(mergeProposal, { stop: "refusal", blocks: [] });
export const mergeCut = mergeEvents(mergeProposal, { stop: "max_tokens" });
