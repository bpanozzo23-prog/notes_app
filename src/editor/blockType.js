// Change only eligible line types. Never lift a line out of its parent, and keep
// attributes shared by paragraphs/headings (such as lineHeight).
export function applyBlockType(tr, block, from = tr.selection.from, to = tr.selection.to) {
  const type = tr.doc.type.schema.nodes[block === "paragraph" ? "paragraph" : "heading"];
  const level = block === "paragraph" ? null : Number(block.slice(1));
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.spec.code) return false;
    if (!["paragraph", "heading"].includes(node.type.name)) return;
    if (node.type === type && (level === null || node.attrs.level === level)) return false;
    const $pos = tr.doc.resolve(pos), index = $pos.index();
    if ($pos.parent.canReplaceWith(index, index + 1, type)) {
      tr.setNodeMarkup(pos, type, { ...node.attrs, ...(level === null ? {} : { level }) });
    }
    return false;
  });
}
