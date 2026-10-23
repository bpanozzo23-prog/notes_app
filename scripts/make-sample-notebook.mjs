// Generate public/sample-notebook.json: a made-up notebook in the app's backup format, for
// `npm run shots` and for trying the app without personal notes (Settings → Import backup).
// Nothing in it comes from the owner's notes. Re-run after changing the content below:
//   node scripts/make-sample-notebook.mjs
import { makePng } from "./image-fixture.mjs";
import { DEFAULT_NAMED_STYLES } from "../src/editor/formatting.js";
import { EMPTY_LOOK } from "../src/editor/look.js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractNoteLinks, htmlToText } from "../src/lib/text.js";

const id = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const folderId = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const day = (d, h = 9) => `2026-10-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;
const link = (n, label) => `<a href="note:${id(n)}">${label}</a>`;

const folders = [
  { id: folderId(1), name: "Español", position: 0 },
  { id: folderId(2), name: "Libros y podcasts", position: 1 },
  { id: folderId(3), name: "Reflexiones", position: 2 },
];

const image = makePng();
const imageId = "sample-landscape";
const notes = [
  { n: 15, title: "Notas de clase", folder: 1, tags: ["spanish"], created: 18, updated: 18,
    html: '<p>ojala que tu vengas mañana. el examen es en el aula grande. Tengo que recivir el correo, pero creo que se escribe recibir.</p><p>Para clase necesito un cuaderno, un lapiz, repasar los verbos y traer el libro.</p>' },
  { n: 16, title: "Libros por leer", folder: 2, tags: ["book"], created: 18, updated: 18,
    html: '<ul><li><p>El principito</p></li><li><p>Pedro Páramo</p></li><li><p>La casa de los espíritus</p></li></ul>' },
  { n: 17, title: "Lista de lecturas", folder: 2, tags: ["book"], created: 19, updated: 19,
    html: '<p>Leer El principito y Pedro Páramo. Después, probar Ficciones.</p>' },
  { n: 18, title: "Ideas para la próxima clase", folder: 1, tags: ["spanish"], created: 19, updated: 19,
    html: '<p>Revisar ser y estar. Buscar ejemplos en Frases útiles y escribir dos frases nuevas.</p>' },
  { n: 19, title: "Recordatorio suelto", folder: null, tags: [], created: 20, updated: 20,
    html: `<p>Llevar el cuaderno azul a la biblioteca el jueves y devolver los libros de la ${link(17, "lista de lecturas")}.</p>` },
  { n: 14, title: "Captura de ejemplo", folder: null, tags: ["test"], created: 17, updated: 17,
    html: `<p>Un paisaje inventado para probar las imágenes.</p><img data-file="${imageId}" width="480" height="270" alt=""><p>Esta imagen se guarda con la nota.</p>` },
  { n: 13, title: "Muestra de formato", folder: 1, tags: ["test"], created: 17, updated: 17,
    html: `<h2>Colores y letras</h2><p><mark data-color="#fde68a" style="background-color: #fde68a; color: inherit">Amarillo</mark> · <mark data-color="#bfdbfe" style="background-color: #bfdbfe; color: inherit">Azul</mark> · <mark data-color="#a7f3d0" style="background-color: #a7f3d0; color: inherit">Verde</mark> · <mark>Resaltado clásico</mark></p><p><span style="font-size: 12pt">Doce puntos</span> · <span style="font-size: 17pt">Diecisiete</span> · <span style="font-size: 24pt">Veinticuatro</span></p><p><span style="font-family: serif">Una frase en serif</span> · <span style="font-family: monospace">Una frase monoespaciada</span></p><p style="line-height: 1.5">Un poco de espacio para leer estas palabras de ejemplo con calma.</p><div data-callout="note"><h3>Recordatorio</h3><p>Estas son palabras de muestra.</p></div><div data-callout="tip"><p>Practica un poco cada día:</p><ul><li><p>Leer una página.</p></li><li><p>Escribir una frase.</p></li></ul></div><div data-callout="warning"><p>Revisa los acentos antes de terminar.</p></div><div data-callout="important"><p>Guarda una copia de tus notas.</p></div><p>Línea fina</p><hr><p>Línea gruesa</p><hr data-style="thick"><p>Línea discontinua</p><hr data-style="dashed"><p>Línea de puntos</p><hr data-style="dotted"><p><span style="color: #15803d; font-size: 17pt"><strong>Una palabra para recordar.</strong></span></p><ul><li data-collapsed="true"><p>Lista plegada</p><ul><li><p>primera línea escondida</p></li><li><p>segunda línea escondida</p></li></ul></li><li><p>Lista abierta</p><ul><li><p>línea visible</p></li></ul></li></ul><ol><li data-collapsed="true"><p>Paso plegado</p><ol><li><p>detalle escondido</p></li></ol></li></ol><ul data-type="taskList"><li data-type="taskItem" data-checked="false" data-collapsed="true"><label><input type="checkbox"><span></span></label><div><p>Tarea plegada</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>subtarea escondida</p></div></li></ul></div></li></ul><p>Fin de la muestra.</p>` },

  { n: 1, title: "Vocabulario — comida", folder: 1, tags: ["spanish", "vocab"], pinned: true, created: 1, updated: 16,
    html: `<h2>Frutas y verduras</h2><ul><li><p><strong>la manzana</strong> — apple</p></li><li><p><strong>el plátano</strong> — banana</p></li><li><p><strong>la zanahoria</strong> — carrot</p></li><li><p><strong>el pimiento</strong> — pepper (the vegetable)</p></li></ul><h2>En el restaurante</h2><ul><li><p><em>la cuenta, por favor</em> — the bill, please</p></li><li><p><em>¿Qué me recomienda?</em> — what do you recommend?</p></li><li><p><span style="color: rgb(21, 128, 61)">¡Buen provecho!</span> — enjoy your meal</p></li></ul><p>Ver también ${link(2, "Gramática — ser y estar")} y ${link(3, "Frases útiles")}.</p>` },
  { n: 2, title: "Gramática — ser y estar", folder: 1, tags: ["spanish", "grammar"], created: 2, updated: 15,
    html: `<h1>Ser vs. estar</h1><p><strong>Ser</strong> for what something <em>is</em>: identity, origin, time, material.</p><p><strong>Estar</strong> for how or where something is: location, condition, ongoing action.</p><blockquote><p>El niño <mark>es</mark> alto. El niño <mark>está</mark> cansado.</p></blockquote><h2>Trampas</h2><ol><li><p>"Estar" for location of people and things, "ser" for events: <em>la fiesta es en mi casa</em>.</p></li><li><p>Adjectives that change meaning: <span style="color: rgb(220, 38, 38)">aburrido</span> (boring / bored), <span style="color: rgb(220, 38, 38)">listo</span> (clever / ready).</p></li></ol><hr><p>Lista de práctica en ${link(4, "Frases para repasar")}.</p>` },
  { n: 3, title: "Frases útiles", folder: 1, tags: ["spanish", "phrases"], created: 3, updated: 10,
    html: `<ul><li><p>¿Me puedes echar una mano? — can you give me a hand?</p></li><li><p>No tengo ni idea. — I have no idea.</p></li><li><p>Vale, nos vemos mañana. — OK, see you tomorrow.</p></li><li><p>Me da igual. — I don't mind.</p></li><li><p><u>Ojalá</u> que llueva café. — if only it rained coffee (from the song).</p></li></ul>` },
  { n: 4, title: "Frases para repasar", folder: 1, tags: ["spanish", "todo"], created: 4, updated: 14,
    html: `<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>subjuntivo después de "ojalá"</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>pretérito vs. imperfecto</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>por vs. para</p></div></li></ul><p>Reglas en ${link(2, "la nota de gramática")}.</p>` },
  { n: 5, title: "Cien años de soledad", folder: 2, tags: ["book", "spanish"], created: 5, updated: 12,
    html: `<p>Gabriel García Márquez, audiolibro. Capítulos 1–4.</p><h2>Personajes</h2><ul><li><p>José Arcadio Buendía — el fundador, obsesionado con la alquimia</p></li><li><p>Úrsula Iguarán — la que mantiene la casa en pie</p></li><li><p>Melquíades — el gitano, trae el hielo y los imanes</p></li></ul><h2>Ideas</h2><blockquote><p>"El mundo era tan reciente, que muchas cosas carecían de nombre."</p></blockquote><p>La repetición de nombres es a propósito: el tiempo en Macondo da vueltas.</p>` },
  { n: 6, title: "Podcast — Hidden Brain, habits", folder: 2, tags: ["podcast"], created: 6, updated: 8,
    html: `<p>Episode on habit formation. Three takeaways:</p><ol><li><p>Cues beat willpower. Change the environment, not the intention.</p></li><li><p>Stack a new habit onto an existing one.</p></li><li><p>Missing once is fine; missing twice starts a new habit.</p></li></ol><p>Episode page: <a href="https://hiddenbrain.org/">hiddenbrain.org</a></p>` },
  { n: 7, title: "", folder: 2, tags: ["book"], created: 7, updated: 7,
    html: `<p>Atomic Habits — reread chapter 3 before the next podcast episode.</p><p>Compare with ${link(6, "the Hidden Brain notes")}.</p>` },
  { n: 8, title: "Reflexión — octubre", folder: 3, tags: ["journal"], created: 8, updated: 13,
    html: `<p>Mes de poner orden. Lo que funcionó: estudiar español diez minutos antes del café. Lo que no: dejar las notas en tres aplicaciones distintas.</p><p><span style="color: rgb(37, 99, 235)">Pregunta abierta:</span> ¿qué quiero que pueda hacer el asistente con estas notas?</p><ul><li><p>buscar entre todas</p></li><li><p>resumir un tema</p></li><li><p>decirme qué repasar</p></li></ul>` },
  { n: 9, title: "Prompts que reutilizo", folder: null, tags: ["prompts", "reuse"], pinned: true, created: 9, updated: 11,
    html: `<p><strong>Explain like a tutor:</strong></p><blockquote><p>Explain this Spanish sentence word by word, then give two similar examples at the same level.</p></blockquote><p><strong>Review my writing:</strong></p><blockquote><p>Correct the grammar, keep my wording where it is natural, and list each change with a one-line reason.</p></blockquote><p><code>Tip:</code> paste the note text after the prompt.</p>` },
  { n: 10, title: "Compras", folder: null, tags: ["list"], created: 10, updated: 9,
    html: `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>pilas AA</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>café de filtro</p></div></li><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>cable USB-C</p></div></li></ul>` },
  { n: 11, title: "Nota larga para probar el scroll", folder: null, tags: ["test"], created: 11, updated: 6,
    html: `<p>Esta nota existe para que el editor tenga que desplazarse con el teclado abierto.</p>${Array.from({ length: 30 }, (_, i) => `<h3>Sección ${i + 1}</h3><p>Párrafo ${i + 1}. El niño come manzanas y la niña lee un libro mientras llueve en la ciudad. Nada de esto es real; es texto de relleno con acentos: á é í ó ú ñ.</p>`).join("")}` },
  { n: 12, title: "Nota en la papelera", folder: 1, tags: ["spanish"], created: 12, updated: 12, deleted: 15,
    html: `<p>Borrada a propósito. Aparece en la Papelera con los días que faltan para que se elimine.</p><p>Enlace a ${link(1, "Vocabulario")}.</p>` },
];

const envelope = {
  format: "notes_app-backup", schemaVersion: 5, exportedAt: day(21, 8), appVersion: "sample",
  notes: notes.map((note) => ({
    id: id(note.n), title: note.title, html: note.html, text: htmlToText(note.html),
    folderId: note.folder ? folderId(note.folder) : null, tags: note.tags, linkedIds: extractNoteLinks(note.html),
    pinned: note.pinned ?? false, rev: 1, createdAt: day(note.created), updatedAt: day(note.updated, 18),
    deletedAt: note.deleted ? day(note.deleted, 20) : null,
  })),
  files: [{ id: imageId, type: "image/png", size: image.length, width: 480, height: 270, createdAt: day(17), data: image.toString("base64") }],
  folders, tombstones: [], preferences: { namedStyles: [...DEFAULT_NAMED_STYLES,
    { id: "sample-palabra", name: "Palabra", look: { ...EMPTY_LOOK, bold: true, color: "#15803d", fontSize: "17pt" }, block: null, lineHeight: null },
    { id: "sample-ejemplo", name: "Ejemplo", look: { ...EMPTY_LOOK, italic: true, color: "#4b5563" }, block: null, lineHeight: null },
  ] },
};

const out = fileURLToPath(new URL("../public/sample-notebook.json", import.meta.url));
writeFileSync(out, JSON.stringify(envelope, null, 2) + "\n");
console.log(`${out}: ${envelope.notes.length} notes, ${folders.length} folders`);
