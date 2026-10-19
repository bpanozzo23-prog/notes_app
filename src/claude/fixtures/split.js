import { askEvents } from "./ask.js";
export const splitProposal = { summary: "Separar las frases del restaurante del vocabulario de comida.", title: null,
  html: '<h2>Frutas y verduras</h2><ul><li><p><strong>la manzana</strong> — apple</p></li><li><p><strong>el plátano</strong> — banana</p></li><li><p><strong>la zanahoria</strong> — carrot</p></li><li><p><strong>el pimiento</strong> — pepper (the vegetable)</p></li></ul><p>Ver también <a href="note:N2">Gramática — ser y estar</a> y <a href="note:N3">Frases útiles</a>.</p>',
  notes: [{ title: "En el restaurante", tags: ["spanish", "vocab"], folder: { action: "keep", name: null }, reason: "Tener las frases a mano en el restaurante.",
    html: '<h2>En el restaurante</h2><ul><li><p><em>la cuenta, por favor</em> — the bill, please</p></li><li><p><em>¿Qué me recomienda?</em> — what do you recommend?</p></li><li><p><span style="color: rgb(21, 128, 61)">¡Buen provecho!</span> — enjoy your meal</p></li></ul>' }],
};
export const splitVariants = {
  zero: { ...splitProposal, notes: [] }, eleven: { ...splitProposal, notes: Array.from({ length: 11 }, () => splitProposal.notes[0]) },
  empty: { ...splitProposal, notes: [{ ...splitProposal.notes[0], html: '' }] },
  self: { ...splitProposal, html: '<p><a href="note:N1">Original</a></p>' },
  folders: { ...splitProposal, notes: ['Temas', 'temas'].map((name) => ({ ...splitProposal.notes[0], folder: { action: 'create', name } })) },
  imageMoved: { ...splitProposal, html: '<p>Original</p>', notes: [{ ...splitProposal.notes[0], html: '<img data-file="I1">' }] },
  imageDropped: { ...splitProposal, html: '<p>Original</p>' },
};
export const splitEvents = (proposal = splitProposal, options = {}) => askEvents({ id: "msg_split_fixture", counts: { input_tokens: 3000, output_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, blocks: [{ type: "text", text: JSON.stringify(proposal) }], ...options });
export const splitShotsEvents = splitEvents();
export const splitRefusal = splitEvents(splitProposal, { stop: "refusal", blocks: [] });
export const splitCut = splitEvents(splitProposal, { stop: "max_tokens" });
