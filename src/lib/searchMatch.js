// Offsets are UTF-16 offsets, as in strings and ProseMirror. Each normalised unit
// remembers the whole original character, including any following combining marks.
export function normalizeWithMap(text) {
  let normalized = "", offset = 0;
  const map = [], ends = [];
  for (const character of text) {
    const start = offset;
    offset += character.length;
    const folded = character.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/ς/g, "σ");
    if (!folded) {
      for (let i = ends.length - 1; i >= 0 && ends[i] === start; i--) ends[i] = offset;
    }
    for (let i = 0; i < folded.length; i++) { map.push(start); ends.push(offset); }
    normalized += folded;
  }
  return { normalized, map, ends };
}

export const queryWords = (query = "") => [...new Set(normalizeWithMap(query).normalized.trim().split(/\s+/).filter(Boolean))];

export function findRanges(text, words) {
  if (!words.length) return [];
  const { normalized, map, ends } = normalizeWithMap(text), ranges = [];
  for (const word of words) {
    if (!word) continue;
    for (let from = normalized.indexOf(word); from !== -1; from = normalized.indexOf(word, from + 1)) {
      ranges.push({ from: map[from], to: ends[from + word.length - 1] });
    }
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.from < last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

export function snippet(text, words, width = 80) {
  let best = null, score = 0;
  for (const line of text.split(/\r?\n/)) {
    const normalized = normalizeWithMap(line).normalized;
    const count = words.filter((word) => normalized.includes(word)).length;
    if (count > score) { best = line; score = count; }
  }
  if (best === null) return null;
  const ranges = findRanges(best, words), first = ranges[0];
  let from = first.to <= width ? 0 : Math.max(0, first.from - Math.floor(width / 2));
  let to = Math.min(best.length, from + width);
  if (to === best.length) from = Math.max(0, to - width);
  // Never cut a match (or a surrogate pair / combining sequence) at the window edge.
  for (const range of ranges) {
    if (range.from < from && range.to > from) from = range.from;
    if (range.from < to && range.to > to) to = range.to;
  }
  if (/[\uDC00-\uDFFF]/.test(best[from] ?? "")) from--;
  if (/[\uDC00-\uDFFF]/.test(best[to] ?? "")) to++;
  while (from > 0 && /\p{M}/u.test(best[from] ?? "")) from--;
  while (to < best.length && /\p{M}/u.test(best[to])) to++;
  const parts = [];
  if (from > 0) parts.push({ text: "…", match: false });
  let cursor = from;
  for (const range of ranges.filter((range) => range.from >= from && range.to <= to)) {
    if (cursor < range.from) parts.push({ text: best.slice(cursor, range.from), match: false });
    parts.push({ text: best.slice(range.from, range.to), match: true });
    cursor = range.to;
  }
  if (cursor < to) parts.push({ text: best.slice(cursor, to), match: false });
  if (to < best.length) parts.push({ text: "…", match: false });
  return { text: parts.map((part) => part.text).join(""), parts };
}
