import { Extension, getRenderedAttributes } from "@tiptap/core";
import Heading from "@tiptap/extension-heading";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { FOLD_META, foldTransaction, changedRanges, leafLines } from "./fold.js";

const key = new PluginKey("headingFold");

// Sections consist only of siblings: a heading never reaches outside its parent.
export function headingSections(doc) {
  const sections = [];
  function walk(parent, start) {
    const children = [];
    parent.forEach((node, offset) => children.push({ node, pos: start + offset }));
    children.forEach(({ node, pos }, index) => {
      if (node.type.name === "heading") {
        let end = index + 1;
        while (end < children.length && !(children[end].node.type.name === "heading" && children[end].node.attrs.level <= node.attrs.level)) end++;
        const blocks = children.slice(index + 1, end);
        sections.push({ node, pos, from: pos + node.nodeSize, to: end < children.length ? children[end].pos : start + parent.content.size, blocks, foldable: blocks.length > 0 });
      }
      if (!node.isLeaf && !node.isTextblock) walk(node, pos + 1);
    });
  }
  walk(doc, 0);
  return sections;
}

export function hidingHeadings($pos) {
  return headingSections($pos.doc).filter(({ node, from, to, foldable }) => foldable && node.attrs.collapsed && $pos.pos >= from && $pos.pos < to);
}

function setSections(view, sections, collapsed) {
  if (!view.editable) return false;
  const tr = foldTransaction(view.state.tr);
  // Outermost/earliest heading wins when several sections would hide the selection.
  const hiding = collapsed && sections.find(({ from, to }) => tr.selection.to >= from && tr.selection.from < to);
  if (hiding) tr.setSelection(TextSelection.create(tr.doc, hiding.pos + hiding.node.nodeSize - 1));
  for (const { node, pos } of sections) if (node.attrs.collapsed !== collapsed) tr.setNodeMarkup(pos, undefined, { ...node.attrs, collapsed });
  if (tr.docChanged) view.dispatch(tr);
  return sections.length > 0;
}

export function toggleHeading(view, pos) {
  const section = headingSections(view.state.doc).find((section) => section.pos === pos && section.foldable);
  return section ? setSections(view, [section], !section.node.attrs.collapsed) : false;
}

export function foldAllHeadings(view, collapsed) {
  return setSections(view, headingSections(view.state.doc).filter(({ foldable }) => foldable), collapsed);
}

function decorations(doc) {
  const result = [], hidden = new Map();
  for (const section of headingSections(doc)) {
    if (!section.foldable) continue;
    const count = section.node.attrs.collapsed ? section.blocks.reduce((total, { node }) => total + leafLines(node), 0) : 0;
    result.push(Decoration.node(section.pos, section.pos + section.node.nodeSize, { class: "heading-foldable",
      ...(section.node.attrs.collapsed ? { "data-count": `${count} ${count === 1 ? "line" : "lines"}` } : {}),
    }, { foldable: true }));
    if (section.node.attrs.collapsed) for (const { node, pos } of section.blocks) hidden.set(pos, node.nodeSize);
  }
  for (const [pos, size] of hidden) result.push(Decoration.node(pos, pos + size, { class: "fold-hidden" }));
  return DecorationSet.create(doc, result);
}

function normalise(transactions, newState) {
  if (transactions.every((tr) => tr.getMeta(FOLD_META))) return null;
  const expand = new Set();
  for (const $point of [newState.selection.$anchor, newState.selection.$head]) {
    for (const { pos } of hidingHeadings($point)) expand.add(pos);
  }
  const edits = transactions.filter((tr) => !tr.getMeta(FOLD_META));
  if (edits.some((tr) => tr.docChanged) && !transactions.some((tr) => tr.getMeta("history$"))) {
    const ranges = changedRanges(edits);
    for (const { node, pos, from, to, foldable } of headingSections(newState.doc)) {
      if (node.attrs.collapsed && (!foldable || ranges.some((range) => (range.from === range.to ? range.to >= from : range.to > from) && range.from < to))) expand.add(pos);
    }
  }
  if (!expand.size) return null;
  const tr = foldTransaction(newState.tr);
  for (const pos of expand) {
    const node = tr.doc.nodeAt(pos);
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, collapsed: false });
  }
  return tr;
}

export const HeadingFold = Extension.create({
  name: "headingFold",
  priority: 120,
  addGlobalAttributes() {
    return [{ types: ["heading"], attributes: { collapsed: {
      default: false, keepOnSplit: false,
      parseHTML: (element) => element.getAttribute("data-collapsed") === "true",
      renderHTML: ({ collapsed }) => collapsed === true ? { "data-collapsed": "true" } : {},
    } } }];
  },
  addKeyboardShortcuts() {
    return { Enter: () => {
      const { state, view } = this.editor, { $from, $to, empty } = state.selection;
      if (!(view.editable && state.selection instanceof TextSelection && $from.sameParent($to) && $from.parent.type.name === "heading" && $from.parent.attrs.collapsed && (!empty || $from.parentOffset > 0 || !$from.parent.content.size))) return false;
      // Open the fold and run the ordinary Enter in ONE transaction, and report it handled.
      // Dispatching the opening separately and returning false broke Android Chrome: there
      // ProseMirror runs Enter from a DOM change the browser already made, and the extra
      // dispatch flushed that half-made change (a cloned, still-folded heading) into the note.
      const pos = $from.before(), attrs = { ...$from.parent.attrs, collapsed: false };
      return this.editor.chain()
        .command(({ tr }) => { tr.setNodeMarkup(pos, undefined, attrs); return true; })
        .first(({ commands }) => [() => commands.newlineInCode(), () => commands.createParagraphNear(), () => commands.liftEmptyBlock(), () => commands.splitBlock()])
        .run();
    } };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({ key, state: {
      init: (_config, state) => decorations(state.doc),
      apply: (tr, set) => tr.docChanged ? decorations(tr.doc) : set,
    }, props: { decorations: (state) => editor.isEditable ? key.getState(state) : null,
      handleDOMEvents: {
        // Deletes that join a heading with its neighbour, or reach into hidden lines. On Android
        // Chrome ProseMirror lets the browser edit the page and interprets the change after;
        // with the heading's wrapper (and across hidden blocks) Chrome's edit left an empty
        // heading or was read as Enter. Run the editor's own Backspace/Delete instead. Only when
        // the browser lets us cancel its edit, so nothing can be deleted twice.
        beforeinput: (view, event) => {
          const back = event.inputType === "deleteContentBackward", forward = event.inputType === "deleteContentForward";
          if (!(back || forward) || !event.cancelable || !view.editable) return false;
          const { selection, doc } = view.state;
          if (!(selection instanceof TextSelection)) return false;
          const { $from, $to, empty } = selection;
          let ours = false;
          if (!empty) {
            if (!$from.sameParent($to)) doc.nodesBetween(selection.from, selection.to, (node) => { if (node.type.name === "heading") ours = true; });
          } else if (back && $from.parentOffset === 0) {
            const before = $from.before();
            ours = before > 0 && ($from.parent.type.name === "heading" || hidingHeadings(doc.resolve(before - 1)).length > 0);
          } else if (forward && $from.parentOffset === $from.parent.content.size) {
            const after = $from.after();
            ours = after < doc.content.size && ($from.parent.type.name === "heading" || doc.resolve(after).nodeAfter?.type.name === "heading" ||
              hidingHeadings(doc.resolve(after + 1)).length > 0);
          }
          if (!ours) return false;
          event.preventDefault();
          editor.commands.keyboardShortcut(back ? "Backspace" : "Delete");
          return true;
        },
      } },
    appendTransaction: (transactions, _oldState, newState) => editor.isEditable ? normalise(transactions, newState) : null })];
  },
});

// The <hN> holds its text directly, exactly as a stock heading does: Chrome on Android handles
// Enter by editing the page itself, and ProseMirror only recognises that as Enter for a plain
// block. An inner text <span> made Enter at the end of any heading clone the heading instead.
// So the button and the "…" marker sit beside the <hN> in a thin wrapper that the node view
// owns, never in the text the keyboard edits. The <hN> is updated in place while folding and
// typing (no element swap under the keyboard). Decoration classes land on the wrapper.
export const FoldableHeading = Heading.extend({
  addNodeView() {
    return ({ node, editor, getPos, decorations }) => {
      const dom = document.createElement("div"), heading = document.createElement(`h${node.attrs.level}`);
      const button = document.createElement("button"), marker = document.createElement("div");
      dom.classList.add("heading-fold-wrap"); dom.dataset.level = String(node.attrs.level);
      button.type = "button"; button.tabIndex = -1; button.contentEditable = "false";
      button.className = "heading-fold-toggle";
      button.setAttribute("aria-label", "Fold or unfold this section");
      marker.className = "heading-fold-marker"; marker.contentEditable = "false"; marker.setAttribute("aria-hidden", "true");
      for (const type of ["pointerdown", "mousedown"]) button.addEventListener(type, (event) => event.preventDefault());
      button.addEventListener("click", (event) => { event.preventDefault(); const pos = getPos(); if (typeof pos === "number") toggleHeading(editor.view, pos); });
      dom.append(heading);
      let previous = {};
      const apply = (next, decos) => {
        const attrs = getRenderedAttributes(next, editor.extensionManager.attributes);
        for (const name of Object.keys(previous)) if (!(name in attrs)) heading.removeAttribute(name);
        for (const [name, value] of Object.entries(attrs)) if (value != null) heading.setAttribute(name, value);
        previous = attrs;
        // Centre the button on the first line even when the heading has its own line spacing.
        button.style.lineHeight = heading.style.lineHeight;
        const fold = decos.find((deco) => deco.spec.foldable);
        const foldable = editor.isEditable && !!fold;
        if (foldable && next.attrs.collapsed) marker.dataset.count = fold.type.attrs["data-count"];
        else delete marker.dataset.count;
        dom.classList.toggle("is-folded", foldable && next.attrs.collapsed === true);
        if (foldable) { if (button.parentNode !== dom) dom.append(button); button.setAttribute("aria-expanded", String(!next.attrs.collapsed)); }
        else button.remove();
        if (foldable && next.attrs.collapsed) { if (marker.parentNode !== dom) dom.append(marker); } else marker.remove();
      };
      apply(node, decorations);
      const owned = (target) => button.contains(target) || marker.contains(target);
      return { dom, contentDOM: heading,
        update(next, decos) { if (next.type !== node.type || next.attrs.level !== node.attrs.level) return false; node = next; apply(next, decos); return true; },
        stopEvent: (event) => owned(event.target),
        ignoreMutation: (mutation) => owned(mutation.target) || (mutation.type === "attributes" && (mutation.target === dom || mutation.target === heading)),
      };
    };
  },
});
