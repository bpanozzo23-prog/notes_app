import { askEvents } from "./ask.js";
export const classBefore = '<p>ojala que tu vengas mañana. el examen es en el aula grande. Tengo que recivir el correo, pero creo que se escribe recibir.</p><p>Para clase necesito un cuaderno, un lapiz, repasar los verbos y traer el libro.</p>';
export const classProposal = {
  summary: "Fixed spelling and accents, and made the class supplies a list.",
  title: null, titleReason: null,
  html: '<p>Ojalá que tú vengas mañana. El examen es en el aula grande. Tengo que recibir el correo, pero creo que se escribe recibir.</p><ul><li><p>Un cuaderno</p></li><li><p>Un lápiz</p></li><li><p>Repasar los verbos</p></li><li><p>Traer el libro</p></li></ul>',
  htmlReason: "Correct accents and spelling; list what to bring to class.",
  tags: ["spanish", "clase"], tagsReason: "Make class notes easier to find.",
  folder: { action: "keep", name: null }, folderReason: null,
};
export const tidyEvents = (proposal = classProposal, options = {}) => askEvents({ id: "msg_tidy_fixture", counts: { input_tokens: 5000, output_tokens: 4500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, blocks: [{ type: "text", text: JSON.stringify(proposal) }], ...options });
export const tidyClass = tidyEvents();
export const imageProposal = { ...classProposal, summary: "Removed the picture at your request.", html: '<p>Un paisaje inventado para probar las imágenes.</p><p>Esta imagen se guarda con la nota.</p>', htmlReason: "Remove the image as requested.", tags: null, tagsReason: null };
export const tidyImage = tidyEvents(imageProposal, { id: "msg_tidy_image" });
export const tidyUnknown = tidyEvents({ ...classProposal, html: '<p><a href="note:12345678-1234-4234-8234-123456789abc">Existing text</a></p><img data-file="I999">' });
export const tidyCut = tidyEvents(classProposal, { stop: "max_tokens" });
export const tidyMalformed = tidyEvents(classProposal, { blocks: [{ type: "text", text: '{"summary":' }] });
export const tidyRefusal = tidyEvents(classProposal, { stop: "refusal", blocks: [] });
