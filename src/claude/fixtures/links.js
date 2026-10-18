import { askEvents } from "./ask.js";
const link = (from, to, phrase, reason = "Estas notas tratan temas relacionados.") => ({ from, to, phrase, reason });
export const linksProposal = { summary: "Connect related class notes and reading reminders.", links: [
  link("N17", "N2", "ser y estar"), link("N17", "N3", "Frases útiles"), link("N16", "N15", "El principito"),
  link("N3", "N4", "Ojalá"), link("N4", "N14", "ojalá"), link("N14", "N4", "repasar los verbos"),
  link("N14", "N2", "los verbos"), link("N6", "N7", "habit"), link("N11", "N1", "manzanas"),
  link("N1", "N4", "Frases"), link("N9", "N12", "Tip"), link("N9", "N8", null), link("N13", "N12", null),
  link("N15", "N16", null), link("N17", "N12", "frase"),
  link("N2", "N2", "Ser"), link("N7", "N6", "Hidden Brain"), link("N17", "N2", "Revisar"),
] };
export const linksShots = { summary: "Relacionar la preparación de clase y las listas de lectura.", links: [
  link("N17", "N3", "Frases útiles", "Consultar las frases al preparar ejemplos para la clase."),
  link("N17", "N2", "ser y estar", "Repasar la explicación antes de la próxima clase."),
  link("N17", "N14", null, "Tener a mano las notas de la clase anterior."),
  link("N16", "N15", "El principito", "Comparar las dos listas de libros."),
  link("N15", "N16", null, "Consultar las lecturas que aparecen en la otra lista."),
  link("N18", "N14", "cuaderno azul", "Llevar el cuaderno con las notas a clase."),
  link("N9", "N8", null, "Reutilizar el comentario con ayuda del prompt."),
] };
export const linksEvents = (proposal = linksProposal, options = {}) => askEvents({ id: "msg_links_fixture", counts: { input_tokens: 8000, output_tokens: 1500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, blocks: [{ type: "text", text: JSON.stringify(proposal) }], ...options });
export const linksNotebook = linksEvents();
export const linksShotsEvents = linksEvents(linksShots);
export const unknownProposal = { ...linksProposal, links: [{ ...linksProposal.links[0], to: "N19" }] };
export const excessiveProposal = { ...linksProposal, links: Array.from({ length: 31 }, () => linksProposal.links[0]) };
export const linksUnknown = linksEvents(unknownProposal);
export const linksExcessive = linksEvents(excessiveProposal);
export const linksRefusal = linksEvents(linksProposal, { stop: "refusal", blocks: [] });
export const linksCut = linksEvents(linksProposal, { stop: "max_tokens" });
