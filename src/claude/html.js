import { generateJSON, generateHTML, getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { extensions } from "../editor/extensions.js";

export const noteSchema = getSchema(extensions);
export const parseBody = (html) => generateJSON(html, extensions);
export function serializeBody(json) {
  Node.fromJSON(noteSchema, json).check();
  return generateHTML(json, extensions);
}
// The editor appends an empty paragraph when a note ends with any block except a paragraph or
// a callout (StarterKit's TrailingNode with notAfter: ["callout"], src/editor/extensions.js), on
// its first transaction. Whole bodies get the same here; otherwise merely opening a note Claude
// changed would add it and save, which looks like an edit and turns a clean Undo into a conflict.
// html.test.js checks this against a real editor. Single blocks (diff keys) never get it.
const TRAILING_FREE = new Set(["paragraph", "callout"]);
export function withTrailingParagraph(json) {
  const last = json.content?.at(-1);
  if (last && !TRAILING_FREE.has(last.type)) json.content = [...json.content, { type: "paragraph" }];
  return json;
}
export const normalizeBody = (html) => serializeBody(withTrailingParagraph(parseBody(html)));
function walk(node, visit) {
  const next = visit(node);
  if (!next) return null;
  if (next.content) next.content = next.content.map((child) => walk(child, visit)).filter(Boolean);
  return next;
}
export function toClaudeHtml(html, { noteHandles, imageHandles = new Map() }) {
  const json = walk(parseBody(html), (node) => {
    if (node.type === "image") {
      const id = node.attrs.file;
      if (!imageHandles.has(id)) imageHandles.set(id, `I${imageHandles.size + 1}`);
      node.attrs.file = imageHandles.get(id);
    }
    for (const mark of node.marks ?? []) if (mark.type === "link" && /^note:/i.test(mark.attrs.href)) {
      const handle = noteHandles.get(mark.attrs.href.slice(5));
      if (!handle) throw new Error("Missing note handle");
      mark.attrs.href = `note:${handle}`;
    }
    return node;
  });
  return { html: serializeBody(json), imageHandles };
}
export function fromClaudeHtml(html, { imageHandles, noteHandles }, { dropLinksTo = new Set() } = {}) {
  const images = new Map([...imageHandles].map(([id, handle]) => [handle, id]));
  const notes = new Map([...noteHandles].map(([id, handle]) => [handle, id]));
  const report = [];
  const defaults = Object.fromEntries(Object.entries(noteSchema.marks.link.spec.attrs).map(([key, spec]) => [key, spec.default]));
  const json = walk(parseBody(html), (node) => {
    if (node.type === "image") {
      const id = images.get(node.attrs.file);
      if (!id) { report.push({ type: "removed-image", value: node.attrs.file }); return null; }
      node.attrs.file = id;
    }
    if (node.marks) node.marks = node.marks.filter((mark) => {
      if (mark.type !== "link") return true;
      let href = mark.attrs.href;
      if (/^note:/i.test(href)) {
        const id = notes.get(href.slice(5));
        if (!id) { report.push({ type: "removed-note-link", value: href }); return false; }
        if (dropLinksTo.has(id)) { report.push({ type: "removed-group-link", value: id }); return false; }
        href = `note:${id}`;
      } else if (/^(https:|mailto:)/i.test(href)) report.push({ type: "web-link", value: href });
      else return false;
      mark.attrs = { ...defaults, href };
      return true;
    });
    return node;
  });
  if (!json.content?.length) json.content = [{ type: "paragraph" }];
  return { html: serializeBody(withTrailingParagraph(json)), report };
}
