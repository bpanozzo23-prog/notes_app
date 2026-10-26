import { Extension, getRenderedAttributes, getSplittedAttributes } from "@tiptap/core";
import { FOLD_META, foldTransaction, changedRanges, leafLines } from "./fold.js";
import ListItem from "@tiptap/extension-list-item";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Collapsible list lines (OneNote-style −/+). A bullet, numbered or checklist line with lines
// under it can be collapsed; the state is saved as <li data-collapsed="true">. Hiding is CSS in
// an editable editor only, so read-only notes and Claude's review previews always show every line.

export const COLLAPSIBLE_TYPES = ["listItem", "taskItem"];
const key = new PluginKey("collapsible");

const isItem = (node) => COLLAPSIBLE_TYPES.includes(node.type.name);
// listItem and taskItem content is `paragraph block*`: everything after the first line hides.
export const hasSubLines = (node) => isItem(node) && node.childCount > 1;
const hiddenRange = (node, pos) => ({ from: pos + 1 + node.firstChild.nodeSize, to: pos + node.nodeSize - 1 });
const endOfFirstLine = (node, pos) => pos + node.firstChild.nodeSize;

export function toggleCollapsed(view, pos) {
  const node = view.state.doc.nodeAt(pos);
  if (!node || !hasSubLines(node)) return false;
  const collapsed = !node.attrs.collapsed;
  const tr = foldTransaction(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, collapsed }));
  if (collapsed) {
    // The cursor must never be left inside lines that are about to be hidden.
    const hidden = hiddenRange(node, pos), { from, to } = tr.selection;
    if (to >= hidden.from && from <= hidden.to) tr.setSelection(TextSelection.create(tr.doc, endOfFirstLine(node, pos)));
  }
  view.dispatch(tr);
  return true;
}

function toggleButton(view, getPos, count) {
  const button = document.createElement("button");
  button.type = "button";
  button.tabIndex = -1;
  button.contentEditable = "false";
  button.className = "collapse-toggle";
  if (count !== undefined) button.dataset.count = String(count);
  // No text inside: the −/+ is drawn by CSS from the line's data-collapsed, so the phone
  // keyboard's predictions never read the toggle or its count.
  button.setAttribute("aria-label", "Show or hide the lines under this one");
  // Keep focus where it is: with the keyboard closed a tap must not open it, and vice versa.
  // Same as the toolbar buttons: cancel the press, never the touch. Cancelling touchstart
  // would also cancel the tap's click on Android, so the toggle would rarely fire.
  for (const type of ["pointerdown", "mousedown"]) button.addEventListener(type, (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    if (!view.editable) return;
    const pos = getPos();
    if (typeof pos === "number") toggleCollapsed(view, pos - 1);
  });
  return button;
}

function toggles(doc) {
  const decorations = [];
  doc.descendants((node, pos) => {
    if (hasSubLines(node)) {
      const count = node.attrs.collapsed ? leafLines(node) - leafLines(node.firstChild) : undefined;
      decorations.push(Decoration.widget(pos + 1, (view, getPos) => toggleButton(view, getPos, count),
        { side: -1, ignoreSelection: true, stopEvent: () => true, key: count === undefined ? "collapse-toggle" : `collapse-toggle-${count}` }));
    }
  });
  return DecorationSet.create(doc, decorations);
}

function itemsAround(doc, { from, to }, visit) {
  const size = doc.content.size;
  const a = Math.max(0, Math.min(from, size)), b = Math.max(0, Math.min(to, size));
  doc.nodesBetween(a, Math.min(size, Math.max(b, a + 1)), (node, pos) => { if (isItem(node)) visit(node, pos); });
  for (const point of [a, b]) {
    const $point = doc.resolve(point);
    for (let depth = $point.depth; depth > 0; depth--) if (isItem($point.node(depth))) visit($point.node(depth), $point.before(depth));
  }
}

// Keeps two promises: the cursor is never inside hidden lines, and a change to hidden lines
// (Indent into a collapsed line, Outdent taking the lines below, Backspace joining into one)
// shows them. Also drops the mark from a line that no longer has lines under it.
function normalise(transactions, newState) {
  if (transactions.every((tr) => tr.getMeta(FOLD_META))) return null;
  const docChanged = transactions.some((tr) => tr.docChanged);
  const expand = new Set(), clear = new Set();
  const { $anchor, $head } = newState.selection;
  for (const $point of [$anchor, $head]) {
    for (let depth = $point.depth; depth > 0; depth--) {
      const node = $point.node(depth);
      if (isItem(node) && node.attrs.collapsed && $point.index(depth) > 0) expand.add($point.before(depth));
    }
  }
  // Undo and Redo restore an earlier, consistent document; only the cursor rule applies to them.
  if (docChanged && !transactions.some((tr) => tr.getMeta("history$"))) {
    for (const range of changedRanges(transactions.filter((tr) => !tr.getMeta(FOLD_META)))) {
      itemsAround(newState.doc, range, (node, pos) => {
        if (!node.attrs.collapsed) return;
        if (!hasSubLines(node)) { clear.add(pos); return; }
        const hidden = hiddenRange(node, pos);
        if (range.to >= hidden.from && range.from <= hidden.to) expand.add(pos);
      });
    }
  }
  if (!expand.size && !clear.size) return null;
  const tr = newState.tr;
  for (const pos of new Set([...expand, ...clear])) {
    const node = tr.doc.nodeAt(pos);
    if (node && isItem(node) && node.attrs.collapsed) tr.setNodeMarkup(pos, undefined, { ...node.attrs, collapsed: false });
  }
  return tr.docChanged ? foldTransaction(tr) : null;
}

// Enter at the end of a collapsed line starts a new line after the whole hidden group.
// The default split would carry the hidden lines into the new line and show them.
function enterAfterCollapsed(editor) {
  return editor.commands.command(({ state, tr, dispatch }) => {
    const { selection } = state;
    if (!(selection instanceof TextSelection)) return false;
    const { $from, $to } = selection;
    const depth = $from.depth - 1;
    if (depth < 1 || !$from.sameParent($to)) return false;
    const item = $from.node(depth);
    if (!hasSubLines(item) || !item.attrs.collapsed || $from.index(depth) !== 0) return false;
    // At the very start of a non-empty line the default adds an empty line above; keep that.
    if ($from.parentOffset === 0 && $from.parent.content.size > 0) return false;
    if (!dispatch) return true;
    const attributes = editor.extensionManager.attributes;
    const paragraph = $from.parent, after = $from.before(depth) + item.nodeSize;
    const tail = paragraph.content.cut($to.parentOffset);
    const marks = state.storedMarks || ($to.parentOffset ? $to.marks() : null);
    tr.delete($from.pos, $from.end());
    const line = paragraph.type.create(getSplittedAttributes(attributes, paragraph.type.name, paragraph.attrs), tail);
    const next = item.type.create(getSplittedAttributes(attributes, item.type.name, item.attrs), line);
    const at = tr.mapping.map(after);
    tr.insert(at, next).setSelection(TextSelection.create(tr.doc, at + 2));
    if (marks) tr.ensureMarks(marks);
    tr.scrollIntoView();
    return true;
  });
}

export const Collapsible = Extension.create({
  name: "collapsible",
  // Above ListItem/TaskItem (100), so Enter on a collapsed line is ours first.
  priority: 110,
  addGlobalAttributes() {
    return [{ types: COLLAPSIBLE_TYPES, attributes: { collapsed: {
      default: false,
      keepOnSplit: false,
      parseHTML: (element) => element.getAttribute("data-collapsed") === "true",
      // Leave it out when false, so every note without collapsed lines saves exactly as before.
      renderHTML: ({ collapsed }) => collapsed === true ? { "data-collapsed": "true" } : {},
    } } }];
  },
  addKeyboardShortcuts() {
    return { Enter: () => enterAfterCollapsed(this.editor) };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      key,
      state: {
        init: (_config, state) => toggles(state.doc),
        apply: (tr, set) => tr.docChanged ? toggles(tr.doc) : set,
      },
      props: { decorations: (state) => editor.isEditable ? key.getState(state) : null },
      appendTransaction: (transactions, _oldState, newState) => normalise(transactions, newState),
    })];
  },
});

// A bullet line keeps its <li> when collapsed or expanded: the stock listItem would replace
// the element (moving the line being typed), which can upset the phone keyboard mid-word.
export const CollapsibleListItem = ListItem.extend({
  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement("li");
      const apply = (next) => {
        const attrs = getRenderedAttributes(next, editor.extensionManager.attributes);
        for (const { name } of [...dom.attributes]) if (!(name in attrs)) dom.removeAttribute(name);
        for (const [name, value] of Object.entries(attrs)) if (value !== null && value !== undefined) dom.setAttribute(name, value);
      };
      apply(node);
      return {
        dom, contentDOM: dom,
        update: (next) => { if (next.type !== node.type) return false; node = next; apply(next); return true; },
        ignoreMutation: (mutation) => mutation.type === "attributes" && mutation.target === dom,
      };
    };
  },
});
