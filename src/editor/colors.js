// Saved HTML may contain hex or browser-normalised rgb() values.
export function normalizeColor(value) {
  if (typeof value !== "string") return null;
  const color = value.toLowerCase().trim();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color)) return `#${[...color.slice(1)].map((part) => part + part).join("")}`;
  const match = color.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  return match && match.slice(1).every((part) => Number(part) <= 255)
    ? `#${match.slice(1).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}` : null;
}

export function highlightActive(editor, color) {
  const matches = (marks) => marks.some((mark) => mark.type.name === "highlight" &&
    (color === null ? !mark.attrs.color : (normalizeColor(mark.attrs.color) ?? "#fde68a") === color));
  const { selection, doc, storedMarks } = editor.state;
  if (selection.empty) return matches(storedMarks ?? selection.$from.marks());
  let found = false, all = true;
  doc.nodesBetween(selection.from, selection.to, (node) => {
    if (!node.isInline) return;
    found = true;
    if (!matches(node.marks)) all = false;
  });
  return found && all;
}
