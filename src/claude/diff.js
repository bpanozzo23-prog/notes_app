import { diffArrays, diffWords } from "diff";
import { parseBody, serializeBody, normalizeBody, withTrailingParagraph } from "./html.js";
import { htmlToText } from "../lib/text.js";

const doc = (content) => ({ type: "doc", content: content.length ? content : [{ type: "paragraph" }] });
const blocks = (html) => parseBody(html).content.map((node) => serializeBody(doc([node])));
const text = (items) => items.map(htmlToText).join("\n");
function references(items) {
  const parsed = new DOMParser().parseFromString(items.join(""), "text/html");
  return {
    images: [...parsed.querySelectorAll("img[data-file]")].map((el) => el.getAttribute("data-file")),
    links: [...parsed.querySelectorAll("a[href]")].map((el) => ({ href: el.getAttribute("href"), text: el.textContent })),
  };
}
// Multiset subtraction: cancelling one occurrence must never cancel its duplicates.
function subtract(before, after, same) {
  const added = [...after];
  const removed = before.filter((old) => { const index = added.findIndex((next) => same(old, next)); if (index < 0) return true; added.splice(index, 1); return false; });
  return { removed, added };
}
function effects(before, after) {
  const a = references(before), b = references(after), result = [];
  const images = subtract(a.images, b.images, (x, y) => x === y);
  for (const id of images.removed) result.push({ type: "image-removed", id });
  for (const id of images.added) result.push({ type: "image-added", id });
  const links = subtract(a.links, b.links, (x, y) => x.href === y.href);
  for (const old of links.removed) {
    const index = links.added.findIndex((next) => next.text === old.text);
    if (index >= 0) {
      const next = links.added.splice(index, 1)[0];
      result.push({ type: "link-retargeted", before: old.href, after: next.href });
      if (!next.href.startsWith("note:")) result.push({ type: "web-link-added", href: next.href });
    } else result.push({ type: "link-removed", href: old.href });
  }
  for (const next of links.added) result.push({ type: next.href.startsWith("note:") ? "note-link-added" : "web-link-added", href: next.href });
  return result;
}
function formatLabels(before, after) {
  const a = parseBody(before.join("") || "<p></p>"), b = parseBody(after.join("") || "<p></p>");
  const shape = (n) => [n.type, n.attrs, n.marks, n.content?.filter((c) => c.type !== "text").map(shape)];
  const labels = [];
  if (JSON.stringify(a.content.map(shape)) !== JSON.stringify(b.content.map(shape))) {
    const names = { heading: "a heading", bulletList: "a bulleted list", orderedList: "a numbered list", taskList: "a task list", callout: "a callout", blockquote: "a quote" };
    for (const node of b.content) if (names[node.type] && !a.content.some((old) => old.type === node.type)) labels.push(`now ${names[node.type]}`);
  }
  if (!before.join("").includes("<strong>") && after.join("").includes("<strong>")) labels.push("bold added");
  // Mark changes can be inside text nodes, which the structural comparison deliberately omits.
  const stripped = (n) => ({ ...n, text: undefined, content: n.content?.map(stripped) });
  if (!labels.length && (text(before) === text(after) || JSON.stringify(stripped(a)) !== JSON.stringify(stripped(b)))) labels.push("formatting changed");
  return labels;
}
export function diffNoteBodies(currentHtml, proposedHtml) {
  const parts = diffArrays(blocks(currentHtml), blocks(proposedHtml));
  const runs = []; let pending = null, number = 0;
  const finish = () => {
    if (!pending) return;
    // Neighbouring blocks each edited in place pair one-to-one, so each gets its own tick; an
    // uneven group (a block split, merged, added or removed) stays one change.
    // Trailing empty paragraphs (the editor's end-of-note line) don't count for pairing; they
    // travel with the last pair.
    const { before: b, after: a } = pending;
    const filled = (list) => { let n = list.length; while (n && list[n - 1] === "<p></p>") n--; return n; };
    const nb = filled(b), na = filled(a);
    const groups = nb > 1 && nb === na
      ? b.slice(0, nb).map((block, i) => ({ before: [block, ...(i === nb - 1 ? b.slice(nb) : [])], after: [a[i], ...(i === na - 1 ? a.slice(na) : [])] }))
      : [pending];
    for (const { before, after } of groups) runs.push({ id: `body-${++number}`, before, after,
      words: text(before) === text(after) ? [] : diffWords(text(before), text(after)),
      formatting: formatLabels(before, after), effects: effects(before, after) });
    pending = null;
  };
  for (const part of parts) {
    if (!part.added && !part.removed) { finish(); runs.push({ unchanged: part.value }); continue; }
    for (const block of part.value) {
      // Standalone images always get their own tick, even beside another changed block.
      const image = parseBody(block).content[0].type === "image";
      if (image) finish();
      pending ??= { before: [], after: [] };
      pending[part.removed ? "before" : "after"].push(block);
      if (image) finish();
    }
  }
  finish(); return runs;
}
export function assembleBody(currentHtml, changes, ticked) {
  const original = changes.flatMap((run) => run.unchanged ?? run.before);
  // The diff was computed on the normalised body (which may add the editor's trailing paragraph).
  if (JSON.stringify(original) !== JSON.stringify(blocks(normalizeBody(currentHtml)))) throw new Error("Body changed since review");
  const selected = ticked instanceof Set ? ticked : new Set(ticked);
  const result = changes.flatMap((run) => run.unchanged ?? (selected.has(run.id) ? run.after : run.before));
  return serializeBody(withTrailingParagraph(doc(result.flatMap((html) => parseBody(html).content))));
}
