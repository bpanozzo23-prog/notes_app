import { closeHistory } from "@tiptap/pm/history";
import { normalizeColor } from "./colors.js";
import { applyLineSpacing } from "./nodes/LineSpacing.js";
import { applyBlockType } from "./blockType.js";

export const EMPTY_LOOK = Object.freeze({ bold: false, italic: false, underline: false, strike: false,
  color: null, highlight: null, fontSize: null, fontFamily: null });
const replacedMarks = ["bold", "italic", "underline", "strike", "highlight", "textStyle"];

function pointSize(value) {
  const match = typeof value === "string" && value.trim().match(/^(\d+(?:\.\d+)?|\.\d+)(pt|px)$/i);
  return match ? `${Math.max(6, Math.min(72, Math.round(Number(match[1]) * (match[2].toLowerCase() === "px" ? 0.75 : 1))))}pt` : null;
}

export function captureLook(state) {
  const { selection, doc, storedMarks } = state;
  let marks = selection.empty ? storedMarks ?? selection.$from.marks() : null;
  if (!selection.empty) doc.nodesBetween(selection.from, selection.to, (node) => {
    if (marks || node.type.spec.code) return false;
    if (node.isText && !node.marks.some((mark) => mark.type.name === "code")) marks = node.marks;
  });
  const look = { ...EMPTY_LOOK };
  if (!marks) return look;
  for (const key of ["bold", "italic", "underline", "strike"]) look[key] = marks.some((mark) => mark.type.name === key);
  const text = marks.find((mark) => mark.type.name === "textStyle")?.attrs;
  const highlight = marks.find((mark) => mark.type.name === "highlight");
  look.color = normalizeColor(text?.color);
  look.highlight = highlight ? normalizeColor(highlight.attrs.color) ?? "#fde68a" : normalizeColor(text?.backgroundColor);
  look.fontSize = pointSize(text?.fontSize);
  look.fontFamily = text?.fontFamily?.split(",").map((family) => family.trim().replace(/^['"]|['"]$/g, "").toLowerCase())
    .find((family) => ["serif", "sans-serif", "monospace"].includes(family)) ?? null;
  return look;
}

// Shared capped preview for rows/trays/forms; toolbar icons deliberately omit size.
export function lookStyle(look, size = true) {
  return { fontWeight: look.bold ? "bold" : "normal", fontStyle: look.italic ? "italic" : "normal",
    textDecoration: [look.underline && "underline", look.strike && "line-through"].filter(Boolean).join(" ") || "none",
    color: look.color ?? undefined, backgroundColor: look.highlight ?? undefined,
    fontFamily: look.fontFamily ?? undefined,
    ...(size ? { fontSize: look.fontSize ? `${Math.min(parseInt(look.fontSize), 20)}pt` : undefined } : {}),
  };
}

export function applyLook(editor, look, options = {}) {
  if (!editor.isEditable) return false;
  const { block = null, lineHeight = null } = options;
  return editor.chain().focus().command(({ tr, dispatch }) => {
    if (!dispatch) return true;
    closeHistory(tr);
    const { selection } = tr;
    let { from, to } = selection;
    if (selection.empty) {
      if (!["paragraph", "heading"].includes(selection.$from.parent.type.name)) return true;
      from = selection.$from.start(); to = selection.$from.end();
    }
    const schema = tr.doc.type.schema;
    const marks = ["bold", "italic", "underline", "strike"].filter((key) => look[key]).map((key) => schema.marks[key].create());
    if (look.highlight) marks.push(schema.marks.highlight.create({ color: look.highlight }));
    const attrs = { color: look.color, fontSize: look.fontSize, fontFamily: look.fontFamily };
    if (Object.values(attrs).some((value) => value !== null)) marks.push(schema.marks.textStyle.create(attrs));
    const stored = tr.storedMarks ?? selection.$from.marks();
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.spec.code) return false;
      if (!node.isInline || node.marks.some((mark) => mark.type.name === "code")) return;
      const start = Math.max(from, pos), end = Math.min(to, pos + node.nodeSize);
      for (const name of replacedMarks) tr.removeMark(start, end, schema.marks[name]);
      for (const mark of marks) tr.addMark(start, end, mark);
    });
    if (block) applyBlockType(tr, block, from, to);
    // Omitted spacing (painter) leaves lines alone; an explicit null (style Default) clears it.
    if (Object.hasOwn(options, "lineHeight")) applyLineSpacing(tr, lineHeight, from, to);
    // Match StarterKit’s trailing paragraph in this transaction, before stored marks.
    // Its appended transaction would otherwise discard an empty heading’s next-typing look.
    if (tr.docChanged && tr.doc.lastChild.type.name === "heading") tr.insert(tr.doc.content.size, schema.nodes.paragraph.create());
    if (from === to && !stored.some((mark) => mark.type.name === "code")) {
      tr.setStoredMarks([...stored.filter((mark) => !replacedMarks.includes(mark.type.name)), ...marks]);
    }
    return true;
  }).run();
}
