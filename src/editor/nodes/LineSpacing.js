import { Extension } from "@tiptap/core";

export const LINE_SPACINGS = ["1", "1.15", "1.5", "2"];

function spacing(value) {
  return ({ tr, dispatch }) => {
    if (value !== null && !LINE_SPACINGS.includes(value)) return false;
    if (!dispatch) return true;
    const { from, to } = tr.selection;
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (!["paragraph", "heading"].includes(node.type.name)) return;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, lineHeight: value });
      node.descendants((child, offset) => {
        const mark = child.marks.find((mark) => mark.type.name === "textStyle" && mark.attrs.lineHeight);
        if (!mark) return;
        const start = pos + 1 + offset, end = start + child.nodeSize;
        tr.removeMark(start, end, mark);
        const attrs = { ...mark.attrs, lineHeight: null };
        if (Object.values(attrs).some((attr) => attr !== null)) tr.addMark(start, end, mark.type.create(attrs));
      });
      return false;
    });
    // Also clear a cursor's stored inline spacing, so subsequent typing stays on this line's spacing.
    if (tr.selection.empty && tr.storedMarks) {
      tr.setStoredMarks(tr.storedMarks.flatMap((mark) => {
        if (mark.type.name !== "textStyle" || !mark.attrs.lineHeight) return [mark];
        const attrs = { ...mark.attrs, lineHeight: null };
        return Object.values(attrs).some((attr) => attr !== null) ? [mark.type.create(attrs)] : [];
      }));
    }
    return true;
  };
}

export default Extension.create({
  name: "lineSpacing",
  addGlobalAttributes() {
    return [{ types: ["paragraph", "heading"], attributes: { lineHeight: {
      default: null,
      parseHTML: (element) => LINE_SPACINGS.includes(element.style.lineHeight) ? element.style.lineHeight : null,
      renderHTML: ({ lineHeight }) => LINE_SPACINGS.includes(lineHeight) ? { style: `line-height: ${lineHeight}` } : {},
    } } }];
  },
  addCommands() {
    return { setLineSpacing: (value) => spacing(value), unsetLineSpacing: () => spacing(null) };
  },
});
