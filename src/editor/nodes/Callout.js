import { Node } from "@tiptap/core";
import { NodeRange } from "@tiptap/pm/model";

export const CALLOUT_TYPES = ["note", "tip", "warning", "important"];

function touchedCallouts(tr) {
  const { from, to, empty } = tr.selection;
  const touched = [];
  tr.doc.forEach((node, pos) => {
    if (node.type.name === "callout" && (empty ? from > pos && from < pos + node.nodeSize : pos < to && pos + node.nodeSize > from)) {
      touched.push({ node, pos });
    }
  });
  return touched;
}

function unwrap(tr, callouts) {
  // Reverse order keeps the earlier positions valid; lift maps the selection through each change.
  for (const { node, pos } of [...callouts].reverse()) {
    tr.lift(new NodeRange(tr.doc.resolve(pos + 1), tr.doc.resolve(pos + node.nodeSize - 1), 1), 0);
  }
}

export default Node.create({
  name: "callout",
  content: "block+",
  defining: true,
  addAttributes() {
    return { type: {
      default: "note",
      parseHTML: (element) => CALLOUT_TYPES.includes(element.getAttribute("data-callout")) ? element.getAttribute("data-callout") : "note",
      renderHTML: ({ type }) => ({ "data-callout": type }),
    } };
  },
  parseHTML() { return [{ tag: "div[data-callout]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", HTMLAttributes, 0]; },
  addKeyboardShortcuts() {
    return { Enter: () => this.editor.commands.command(({ tr, dispatch }) => {
      const { $from, empty } = tr.selection;
      if (!empty || $from.depth !== 2 || $from.node(1).type !== this.type || $from.parent.content.size) return false;
      // ProseMirror's default middle-line Enter only splits the wrapper. Lifting the line
      // directly also leaves the required plain paragraph between the two callouts.
      if (dispatch) tr.lift($from.blockRange(), 0);
      return true;
    }) };
  },
  addCommands() {
    return {
      unsetCallout: () => ({ tr, dispatch }) => {
        const touched = touchedCallouts(tr);
        if (!touched.length) return false;
        if (dispatch) unwrap(tr, touched);
        return true;
      },
      toggleCallout: (type) => ({ tr, dispatch }) => {
        if (!CALLOUT_TYPES.includes(type)) return false;
        if (!dispatch) return true;
        const touched = touchedCallouts(tr);
        const { from, to } = tr.selection;
        if (touched.length === 1 && from > touched[0].pos && to < touched[0].pos + touched[0].node.nodeSize) {
          const { node, pos } = touched[0];
          if (node.attrs.type === type) unwrap(tr, touched);
          else tr.setNodeMarkup(pos, undefined, { type });
          return true;
        }
        // Flatten whole touched callouts before wrapping the selected top-level blocks.
        const original = new NodeRange(tr.selection.$from, tr.selection.$to, 0);
        const start = original.start, end = original.end, step = tr.steps.length;
        unwrap(tr, touched);
        const mapping = tr.mapping.slice(step);
        const range = new NodeRange(tr.doc.resolve(mapping.map(start, -1)), tr.doc.resolve(mapping.map(end, 1)), 0);
        tr.wrap(range, [{ type: this.type, attrs: { type } }]);
        return true;
      },
    };
  },
});
