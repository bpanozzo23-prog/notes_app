import { DOMParser as SchemaParser } from "@tiptap/pm/model";
import { noteSchema, normalizeBody } from "../claude/html.js";
import { SUPPORTED_HTML_SAMPLES } from "../editor/extensions.js";
import { CALLOUT_TYPES } from "../editor/nodes/Callout.js";
import { DIVIDER_STYLES } from "../editor/nodes/Divider.js";
import { LINE_SPACINGS } from "../editor/nodes/LineSpacing.js";

const parse = (html) => new DOMParser().parseFromString(html, "text/html");
const rules = SchemaParser.schemaRules(noteSchema);
let vocabulary;
function allowList() {
  if (vocabulary) return vocabulary;
  // Learn attributes and inline styles from the editor's supported vocabulary, including
  // its serialized task-list scaffolding and link defaults. Tag aliases (b, i, del…) and
  // style-based marks come directly from the schema's parsing rules.
  const tags = new Map();
  for (const sample of SUPPORTED_HTML_SAMPLES) for (const html of [sample, normalizeBody(sample)]) {
    for (const el of parse(html).body.querySelectorAll("*")) {
      const entry = tags.get(el.localName) ?? { attrs: new Set(), styles: new Set() };
      for (const attr of el.attributes) if (attr.name !== "style") entry.attrs.add(attr.name);
      for (const property of Array.from(el.style)) entry.styles.add(property);
      tags.set(el.localName, entry);
    }
  }
  vocabulary = tags;
  return tags;
}
const accepts = (rule, el) => el.matches(rule.tag) && (!rule.getAttrs || rule.getAttrs(el) !== false);
// Count authored declarations, not CSSOM's expanded shorthand (margin is one style).
function styleProperties(value) {
  let quote = "", depth = 0, start = 0;
  const properties = new Set();
  for (let i = 0; i <= value.length; i++) {
    const char = value[i];
    if (quote) { if (char === "\\") i++; else if (char === quote) quote = ""; }
    else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (i === value.length || char === ";" && !depth) {
      const property = /^\s*([\w-]+)\s*:/.exec(value.slice(start, i))?.[1];
      if (property) properties.add(property.toLowerCase());
      start = i + 1;
    }
  }
  return properties;
}
const styleAccepted = (el, property, value, known) => {
  if (!value) return false;
  if (property === "line-height" && /^(p|h[1-3])$/.test(el.localName)) return LINE_SPACINGS.includes(value);
  if (known?.styles.has(property)) return true;
  return rules.some((rule) => rule.style && rule.style.split("=")[0] === property &&
    (!rule.style.includes("=") || rule.style.slice(rule.style.indexOf("=") + 1) === value) &&
    (!rule.getAttrs || rule.getAttrs(value) !== false));
};

// This document is inert and is never attached to the page. Audit before the editor parser:
// that parser silently drops scripts, unsafe URLs and unsupported formatting.
export function auditBody(html, { imageHandles, noteHandles }) {
  const document = parse(html), allowed = allowList(), counts = {};
  const add = (kind) => { counts[kind] = (counts[kind] ?? 0) + 1; };
  function visit(el) {
    const tag = el.localName, known = allowed.get(tag);
    if (tag === "script") { add("script"); return; }
    if (tag === "style") { add("style"); return; }
    if (tag === "img" && !imageHandles.has(el.getAttribute("data-file"))) { add("image"); return; }
    if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      if (/^note:/i.test(href) && !noteHandles.has(href.slice(5))) add("note-link");
      else if (!/^(https:|mailto:|note:)/i.test(href) || /[\u0000-\u0020\u007f]/.test(href)) add("link");
    }
    // label/input/div/span here are the editor's own task-list rendering, not general HTML.
    const taskScaffold = (tag === "label" && el.parentElement?.matches('li[data-type="taskItem"]')) ||
      (tag === "input" && el.matches('label > input[type="checkbox"]') && el.closest('li[data-type="taskItem"]')) ||
      (tag === "span" && el.matches("label > span") && el.closest('li[data-type="taskItem"]')) ||
      (tag === "div" && el.parentElement?.matches('li[data-type="taskItem"]'));
    const supported = taskScaffold || rules.some((rule) => rule.tag && accepts(rule, el)) ||
      (tag === "span" && !el.attributes.length); // harmless empty mark wrapper
    if (!supported && tag !== "a") add("element");
    for (const { name, value } of el.attributes) {
      if (name === "style") {
        for (const property of styleProperties(value)) {
          if (!styleAccepted(el, property, el.style.getPropertyValue(property), supported ? known : null)) add("style");
        }
      } else if (!known?.attrs.has(name) ||
        (name === "data-callout" && !CALLOUT_TYPES.includes(value)) ||
        (name === "data-style" && !DIVIDER_STYLES.includes(value)) ||
        (name === "class" && !(tag === "code" && el.parentElement?.localName === "pre" && /^language-\S+$/.test(value))) ||
        (["width", "height"].includes(name) && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0))) add("attribute");
    }
    for (const child of el.children) visit(child);
    if (tag === "template") for (const child of el.content.children) visit(child);
  }
  for (const root of [document.head, document.body]) for (const child of root.children) visit(child);
  return counts;
}

export function auditList(audit, report = []) {
  const counts = { ...audit };
  // The raw walk already counts these references. The editor report is a fallback, not
  // another occurrence of the same removal (a link can also span several text nodes).
  for (const [type, kind] of [["removed-image", "image"], ["removed-note-link", "note-link"]]) {
    const removed = new Set(report.filter((item) => item.type === type).map((item) => item.value)).size;
    counts[kind] = Math.max(counts[kind] ?? 0, removed);
  }
  const labels = {
    script: ["script", "scripts"],
    style: ["style the app doesn't support", "styles the app doesn't support"],
    element: ["element the app doesn't support", "elements the app doesn't support"],
    attribute: ["attribute the app doesn't support", "attributes the app doesn't support"],
    image: ["picture from outside the note", "pictures from outside the note"],
    link: ["link with an address the app doesn't allow", "links with addresses the app doesn't allow"],
    "note-link": ["link to a missing or trashed note", "links to missing or trashed notes"],
  };
  return Object.entries(labels).filter(([kind]) => counts[kind]).map(([kind, words]) => `${counts[kind]} ${words[counts[kind] === 1 ? 0 : 1]}`);
}
