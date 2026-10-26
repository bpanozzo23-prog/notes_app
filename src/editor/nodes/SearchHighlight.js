import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { findRanges, queryWords } from "../../lib/searchMatch.js";
import { hasSubLines, toggleCollapsed } from "./Collapsible.js";

import { hidingHeadings, toggleHeading } from "./HeadingFold.js";

export function documentRanges(doc, words) {
  const ranges = [];
  if (!words.length) return ranges;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    let text = "";
    const positions = [];
    node.forEach((child, offset) => {
      const value = child.isText ? child.text : " ";
      for (let i = 0; i < value.length; i++) positions.push(pos + 1 + offset + i);
      text += value;
    });
    for (const range of findRanges(text, words)) ranges.push({ from: positions[range.from], to: positions[range.to - 1] + 1 });
    return false;
  });
  return ranges;
}

export function searchState(editor) {
  const store = editor.storage.searchHighlight, doc = editor.state.doc;
  if (store.doc !== doc || store.cachedWords !== store.words) {
    store.ranges = documentRanges(doc, store.words);
    store.doc = doc;
    store.cachedWords = store.words;
    store.current = Math.min(store.current, Math.max(0, store.ranges.length - 1));
    store.decorations = null;
  }
  return store;
}

// This deliberately bypasses dispatch: even an empty transaction can append a
// trailing paragraph. Search state and decorations must never enter saved HTML.
export function setSearch(editor, query, current = 0) {
  const store = editor.storage.searchHighlight, words = queryWords(query);
  if (JSON.stringify(words) !== JSON.stringify(store.words)) store.words = words;
  store.current = current;
  store.decorations = null;
  const state = searchState(editor);
  state.current = Math.max(0, Math.min(current, state.ranges.length - 1));
  editor.view.setProps({});
  return state;
}

// Returns true only when the match remains hidden. Read-only editors show all lines.
export function revealSearchMatch(editor, range, mayUnfold) {
  if (!range || !editor.isEditable) return false;
  const $pos = editor.state.doc.resolve(range.from), folds = [];
  for (let depth = 1; depth <= $pos.depth; depth++) {
    const node = $pos.node(depth);
    if (hasSubLines(node) && node.attrs.collapsed && $pos.index(depth) > 0) folds.push($pos.before(depth));
  }
  const headings = hidingHeadings($pos);
  if (!mayUnfold) return folds.length > 0 || headings.length > 0;
  for (const { pos } of headings) toggleHeading(editor.view, pos);
  for (const pos of folds) toggleCollapsed(editor.view, pos);
  return false;
}

export const SearchHighlight = Extension.create({
  name: "searchHighlight",
  addStorage() { return { words: [], current: 0, ranges: [], doc: null, cachedWords: null, decorations: null }; },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({ props: { decorations: () => {
      const store = searchState(editor);
      if (!store.decorations) store.decorations = DecorationSet.create(editor.state.doc, store.ranges.map((range, index) =>
        Decoration.inline(range.from, range.to, { class: `search-match${index === store.current ? " search-match-current" : ""}` })));
      return store.decorations;
    } } })];
  },
});
