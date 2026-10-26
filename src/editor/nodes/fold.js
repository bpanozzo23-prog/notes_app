// All folding is a saved view preference, not an edit to the hidden text.
export const FOLD_META = "fold";
export const foldTransaction = (tr) => tr.setMeta(FOLD_META, true).setMeta("addToHistory", false).setMeta("skipTrailingNode", true);

export function leafLines(node) {
  if (node.isTextblock || node.type.name === "image") return 1;
  let count = 0;
  node.forEach((child) => { count += leafLines(child); });
  return count;
}

// Ranges each transaction changed, expressed in the final document.
export function changedRanges(transactions) {
  let ranges = [];
  for (const tr of transactions) {
    ranges = ranges.map(({ from, to }) => ({ from: tr.mapping.map(from, -1), to: tr.mapping.map(to, 1) }));
    tr.mapping.maps.forEach((map, index) => {
      const rest = tr.mapping.slice(index + 1);
      map.forEach((_oldStart, _oldEnd, start, end) => ranges.push({ from: rest.map(start, -1), to: rest.map(end, 1) }));
    });
  }
  return ranges;
}
