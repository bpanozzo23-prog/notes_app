import {
  CornerDownLeft, ImagePlus, Bold, Italic, Underline, Strikethrough, Highlighter, Heading, Heading1, Heading2, Heading3, List,
  ListOrdered, ListChecks, ListIndentIncrease, ListIndentDecrease, Quote, Minus, Undo2, Redo2, Eraser, Link, Circle,
  Paintbrush, PaintRoller, Baseline, ALargeSmall, CaseSensitive, ListCollapse, MessageSquare, Info, Lightbulb, TriangleAlert, CircleAlert, SeparatorHorizontal,
} from "lucide-react";

import { applyLook } from "./look.js";
import { normalizeColor, highlightActive } from "./colors.js";

// Build chains inside run: each tap must see the current document.
const action = (id, label, icon, command, active) => ({
  id, label, icon, group: "Text", kind: active ? "toggle" : "command",
  run: ({ editor }) => command(editor.chain().focus()).run(),
  ...(active ? { isActive: active } : {}),
});
const mark = (id, label, icon, command) => action(id, label, icon, command, (editor) => editor.isActive(id));
function colorAction(color, label) {
  return {
    ...action(`color:${color ?? "none"}`, label, Circle,
      (chain) => color ? chain.setColor(color) : chain.unsetColor(),
      (editor) => {
        return normalizeColor(editor.getAttributes("textStyle").color) === color;
      }),
    group: "Colours", color,
  };
}

function highlightAction(color, label, id = `highlight:${color ?? "none"}`) {
  return {
    id, label, icon: Highlighter, color, group: "Colours", kind: "toggle",
    isActive: (editor) => color ? highlightActive(editor, color) : !editor.isActive("highlight"),
    run: ({ editor }) => {
      const remove = !color || highlightActive(editor, color);
      const chain = editor.chain().focus();
      return (remove ? chain.unsetHighlight() : chain.setHighlight({ color })).run();
    },
  };
}
// Indent and outdent move the innermost list line under the cursor (bullet, numbered or
// checklist). Outside a list there is nothing to move, so the button shows as unavailable.
function listItemType(editor) {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (name === "listItem" || name === "taskItem") return name;
  }
  return null;
}
function listAction(id, label, icon, command) {
  const canRun = (editor) => { const type = listItemType(editor); return !!type && editor.can()[command](type); };
  return {
    id, label, icon, group: "Lines & blocks", kind: "command", canRun,
    run: ({ editor }) => canRun(editor) && editor.chain().focus()[command](listItemType(editor)).run(),
  };
}
const picker = (id, label, icon, group) => ({
  id, label, icon, group, kind: "picker", tray: id, run: ({ ui }) => ui?.toggleTray?.(id),
});
const calloutIcons = { note: Info, tip: Lightbulb, warning: TriangleAlert, important: CircleAlert };
const title = (value) => value[0].toUpperCase() + value.slice(1);

export const actions = [
  { id: "image", label: "Image", icon: ImagePlus, group: "Insert", kind: "picker", run: ({ ui }) => ui?.openImagePicker?.() },
  picker("styles", "Named styles", Paintbrush, "Named styles"),
  { id: "painter", label: "Format painter", icon: PaintRoller, group: "Tools", kind: "toggle",
    run: ({ ui }) => ui?.togglePainter?.() },
  picker("textColor", "Text colour", Baseline, "Colours"),
  picker("highlightColor", "Highlight colour", Highlighter, "Colours"),
  picker("fontSize", "Font size", ALargeSmall, "Size & font"),
  picker("fontFamily", "Typeface", CaseSensitive, "Size & font"),
  // One button for Normal text and Heading 1–3 (the owner asked for a combined heading button).
  picker("heading", "Heading", Heading, "Lines & blocks"),
  picker("lineHeight", "Line spacing", ListCollapse, "Lines & blocks"),
  picker("callout", "Callout", MessageSquare, "Lines & blocks"),
  picker("divider", "Divider styles", SeparatorHorizontal, "Lines & blocks"),
  highlightAction(null, "No highlight"),
  highlightAction("#fde68a", "Highlight", "highlight"),
  ...Object.entries(calloutIcons).map(([type, icon]) => ({
    ...action(`callout:${type}`, `${title(type)} callout`, icon, (chain) => chain.toggleCallout(type),
      (editor) => editor.isActive("callout", { type })), group: "Lines & blocks", calloutType: type,
  })),
  ...["thick", "dashed", "dotted"].map((style) => ({
    ...action(`hr:${style}`, `${title(style)} divider`, Minus, (chain) => chain.setDivider(style),
      (editor) => editor.isActive("horizontalRule", { dividerStyle: style })), group: "Lines & blocks", dividerStyle: style,
  })),
  mark("bold", "Bold", Bold, (chain) => chain.toggleBold()),
  mark("italic", "Italic", Italic, (chain) => chain.toggleItalic()),
  mark("underline", "Underline", Underline, (chain) => chain.toggleUnderline()),
  mark("strike", "Strikethrough", Strikethrough, (chain) => chain.toggleStrike()),

  ...[[null, "Default colour"], ["#dc2626", "Red"], ["#15803d", "Green"], ["#2563eb", "Blue"], ["#7c3aed", "Purple"]]
    .map(([color, label]) => colorAction(color, label)),
  action("h1", "Heading 1", Heading1, (chain) => chain.toggleHeading({ level: 1 }), (editor) => editor.isActive("heading", { level: 1 })),
  action("h2", "Heading 2", Heading2, (chain) => chain.toggleHeading({ level: 2 }), (editor) => editor.isActive("heading", { level: 2 })),
  action("h3", "Heading 3", Heading3, (chain) => chain.toggleHeading({ level: 3 }), (editor) => editor.isActive("heading", { level: 3 })),
  mark("bulletList", "Bullet list", List, (chain) => chain.toggleBulletList()),
  mark("orderedList", "Numbered list", ListOrdered, (chain) => chain.toggleOrderedList()),
  mark("taskList", "Checklist", ListChecks, (chain) => chain.toggleTaskList()),
  listAction("indent", "Indent", ListIndentIncrease, "sinkListItem"),
  listAction("outdent", "Outdent", ListIndentDecrease, "liftListItem"),
  { ...action("lineBreak", "Line break", CornerDownLeft, (chain) => chain.setHardBreak()), group: "Lines & blocks" },
  mark("blockquote", "Quote", Quote, (chain) => chain.toggleBlockquote()),
  action("hr", "Divider", Minus, (chain) => chain.setDivider("thin")),
  action("clearFormatting", "Clear formatting", Eraser, (chain) => chain.unsetAllMarks().clearNodes()),
  action("undo", "Undo", Undo2, (chain) => chain.undo()),
  action("redo", "Redo", Redo2, (chain) => chain.redo()),
  { id: "link", group: "Insert", label: "Link to note", icon: Link, kind: "picker", run: ({ editor, ui }) => ui?.openLinkPicker?.(editor) },
].map((entry) => ({ ...entry, group:
  ["h1", "h2", "h3", "bulletList", "orderedList", "taskList", "blockquote", "hr"].includes(entry.id) ? "Lines & blocks"
    : ["clearFormatting", "undo", "redo"].includes(entry.id) ? "Tools"
    : entry.id === "highlight" ? "Colours" : entry.group,
}));

// Imported ids are data, including names such as "constructor"; never inherit object members.
export const ACTIONS = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(actions.map((entry) => [entry.id, entry]))));
export function resolveAction(id, formatting) {
  if (typeof id !== "string") return null;
  if (id.startsWith("style:")) {
    const style = formatting?.namedStyles?.find((entry) => entry.id === id.slice(6));
    return style ? { id, label: style.name, group: "Named styles", kind: "command", look: style.look,
      run: ({ editor }) => applyLook(editor, style.look, { block: style.block, lineHeight: style.lineHeight }) } : null;
  }
  if (id === "highlight") {
    const color = formatting?.highlightColors?.find((entry) => !entry.hidden)?.color ?? "#fde68a";
    const entry = highlightAction(color, "Highlight", id);
    // A legacy plain mark always removes on the first tap, even after reordering the palette.
    const active = (editor) => highlightActive(editor, color) || highlightActive(editor, null);
    return { ...entry, isActive: active, run: ({ editor }) => active(editor)
      ? editor.chain().focus().unsetHighlight().run() : entry.run({ editor }) };
  }
  if (id === "textColor" || id === "highlightColor") {
    const palette = formatting?.[id === "textColor" ? "textColors" : "highlightColors"];
    return { ...ACTIONS[id], barColor: palette?.find((entry) => !entry.hidden)?.color ?? (palette ? null : id === "textColor" ? "#dc2626" : "#fde68a") };
  }
  if (/^(color|highlight):#[0-9a-fA-F]{6}$/.test(id)) {
    if (!formatting && ACTIONS[id]) return ACTIONS[id];
    const [kind, raw] = id.split(":"), color = raw.toLowerCase();
    const name = formatting?.[kind === "color" ? "textColors" : "highlightColors"]?.find((entry) => entry.color === color)?.name;
    return kind === "color" ? colorAction(color, name ?? color) : highlightAction(color, `${name ?? color} highlight`);
  }
  return ACTIONS[id] ?? null;
}

export function availableActions(formatting) {
  return [
    "bold", "italic", "underline", "strike", "textColor", "highlightColor", "highlight", "highlight:none",
    ...(formatting?.highlightColors ?? []).filter((entry) => !entry.hidden).map((entry) => `highlight:${entry.color}`),
    "color:none", ...(formatting?.textColors ?? []).filter((entry) => !entry.hidden).map((entry) => `color:${entry.color}`),
    "fontSize", "fontFamily",
    "heading", "h1", "h2", "h3", "bulletList", "orderedList", "taskList", "indent", "outdent", "lineBreak", "blockquote", "callout",
    ...Object.keys(calloutIcons).map((type) => `callout:${type}`), "hr", "divider", "hr:thick", "hr:dashed", "hr:dotted", "lineHeight",
    "styles", ...(formatting?.namedStyles ?? []).map((style) => `style:${style.id}`),
    "link", "image", "painter", "clearFormatting", "undo", "redo",
  ].map((id) => resolveAction(id, formatting));
}

export const DEFAULT_TOOLBAR = [
  "bold", "italic", "underline", "highlight", "strike", "textColor", "highlightColor", "fontSize", "styles", "painter", "color:none", "color:#dc2626",
  "color:#15803d", "color:#2563eb", "color:#7c3aed", "heading", "bulletList",
  "orderedList", "taskList", "indent", "outdent", "blockquote", "callout", "link", "hr", "clearFormatting", "undo", "redo",
];
export const DEFAULT_SELECTION_MENU = ["bold", "italic", "underline", "highlight", "color:#dc2626", "color:#15803d", "color:#2563eb", "link"];
