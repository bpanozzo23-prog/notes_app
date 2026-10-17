// Generate public/sample-notebook.json: a made-up notebook in the app's backup format, for
// `npm run shots` and for trying the app without personal notes (Settings → Import backup).
// Nothing in it comes from the owner's notes. Re-run after changing the content below:
//   node scripts/make-sample-notebook.mjs
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

const notes = [
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
  format: "notes_app-backup", schemaVersion: 2, exportedAt: day(17, 8), appVersion: "sample",
  notes: notes.map((note) => ({
    id: id(note.n), title: note.title, html: note.html, text: htmlToText(note.html),
    folderId: note.folder ? folderId(note.folder) : null, tags: note.tags, linkedIds: extractNoteLinks(note.html),
    pinned: note.pinned ?? false, rev: 1, createdAt: day(note.created), updatedAt: day(note.updated, 18),
    deletedAt: note.deleted ? day(note.deleted, 20) : null,
  })),
  folders, tombstones: [], preferences: {},
};

const out = fileURLToPath(new URL("../public/sample-notebook.json", import.meta.url));
writeFileSync(out, JSON.stringify(envelope, null, 2) + "\n");
console.log(`${out}: ${envelope.notes.length} notes, ${folders.length} folders`);
