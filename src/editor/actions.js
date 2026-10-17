import {
  Bold, Italic, Underline, Strikethrough, Highlighter, Heading1, Heading2, List,
  ListOrdered, ListChecks, Quote, Minus, Undo2, Redo2, Eraser, Link, Circle,
} from "lucide-react";

// Build chains inside run: each tap must see the current document.
const action = (id, label, icon, command, active) => ({
  id, label, icon, kind: active ? "toggle" : "command",
  run: ({ editor }) => command(editor.chain().focus()).run(),
  ...(active ? { isActive: active } : {}),
});
const mark = (id, label, icon, command) => action(id, label, icon, command, (editor) => editor.isActive(id));
// HTML parsing normalises saved hex colours to rgb(). Both forms mean the same swatch.
const rgb = (hex) => `rgb(${hex.slice(1).match(/../g).map((part) => parseInt(part, 16)).join(", ")})`;

export const actions = [
  mark("bold", "Bold", Bold, (chain) => chain.toggleBold()),
  mark("italic", "Italic", Italic, (chain) => chain.toggleItalic()),
  mark("underline", "Underline", Underline, (chain) => chain.toggleUnderline()),
  mark("strike", "Strikethrough", Strikethrough, (chain) => chain.toggleStrike()),
  mark("highlight", "Highlight", Highlighter, (chain) => chain.toggleHighlight()),
  ...[[null, "Default colour"], ["#dc2626", "Red"], ["#15803d", "Green"], ["#2563eb", "Blue"], ["#7c3aed", "Purple"]]
    .map(([color, label]) => ({
      ...action(`color:${color ?? "none"}`, label, Circle,
        (chain) => color ? chain.setColor(color) : chain.unsetColor(),
        (editor) => {
          const actual = editor.getAttributes("textStyle").color ?? null;
          return actual === color || (color !== null && actual === rgb(color));
        }),
      color,
    })),
  action("h1", "Heading 1", Heading1, (chain) => chain.toggleHeading({ level: 1 }), (editor) => editor.isActive("heading", { level: 1 })),
  action("h2", "Heading 2", Heading2, (chain) => chain.toggleHeading({ level: 2 }), (editor) => editor.isActive("heading", { level: 2 })),
  mark("bulletList", "Bullet list", List, (chain) => chain.toggleBulletList()),
  mark("orderedList", "Numbered list", ListOrdered, (chain) => chain.toggleOrderedList()),
  mark("taskList", "Checklist", ListChecks, (chain) => chain.toggleTaskList()),
  mark("blockquote", "Quote", Quote, (chain) => chain.toggleBlockquote()),
  action("hr", "Divider", Minus, (chain) => chain.setHorizontalRule()),
  action("clearFormatting", "Clear formatting", Eraser, (chain) => chain.unsetAllMarks().clearNodes()),
  action("undo", "Undo", Undo2, (chain) => chain.undo()),
  action("redo", "Redo", Redo2, (chain) => chain.redo()),
  { id: "link", label: "Link to note", icon: Link, kind: "picker", run: ({ editor, ui }) => ui?.openLinkPicker?.(editor) },
];

// Imported ids are data, including names such as "constructor"; never inherit object members.
export const ACTIONS = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(actions.map((entry) => [entry.id, entry]))));
export const DEFAULT_TOOLBAR = [
  "bold", "italic", "underline", "highlight", "strike", "color:none", "color:#dc2626",
  "color:#15803d", "color:#2563eb", "color:#7c3aed", "h1", "h2", "bulletList",
  "orderedList", "taskList", "blockquote", "link", "hr", "clearFormatting", "undo", "redo",
];
export const DEFAULT_SELECTION_MENU = ["bold", "italic", "underline", "highlight", "color:#dc2626", "color:#15803d", "color:#2563eb", "link"];
