export const MORE_BUTTON = "__more";
export const BUTTON_SIZE = 40;
export const BUTTON_GAP = 2;
export const buttonsPerRow = (width) => Math.max(1, Math.floor((width + BUTTON_GAP) / (BUTTON_SIZE + BUTTON_GAP)) || 1);

// Callers resolve ids first: an unavailable action must never consume a visible slot.
export function splitToolbar(ids, perRow, layout) {
  if (!ids.length) return { rows: [], more: [] };
  if (layout === "scroll") return { rows: [[...ids]], more: [] };
  const width = Math.max(1, Math.floor(perRow) || 1);
  const capacity = width * (layout === "rows" ? 2 : 1);
  const overflow = ids.length > capacity;
  const visible = overflow ? [...ids.slice(0, capacity - 1), MORE_BUTTON] : [...ids];
  const rows = [];
  for (let i = 0; i < visible.length; i += width) rows.push(visible.slice(i, i + width));
  return { rows, more: overflow ? ids.slice(capacity - 1) : [] };
}
