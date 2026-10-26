import { expect, it } from "vitest";
import { findRanges, normalizeWithMap, queryWords, snippet } from "./searchMatch.js";
import { searchNotes } from "./notebookView.js";

const matches = (text, query) => findRanges(text, queryWords(query)).map(({ from, to }) => text.slice(from, to));
it.each([["café", "cafe"], ["cafe", "CAFÉ"], ["cafe\u0301", "é"], ["é\u0301\u0327", "e"], ["ΟΣ ος οσ", "οσ"], ["한글", "한"], ["a😀b", "😀"]])("maps %s / %s back to complete original characters", (text, query) => {
  const expected = text === "cafe\u0301" ? ["e\u0301"] : text === "ΟΣ ος οσ" ? ["ΟΣ", "ος", "οσ"] : text === "한글" ? ["한"] : text === "a😀b" ? ["😀"] : [text];
  expect(matches(text, query)).toEqual(expected);
});
it("maps every UTF-16 unit of decomposed Korean and emoji to its original character", () => {
  expect(normalizeWithMap("한😀")).toEqual({ normalized: "한😀", map: [0, 0, 0, 1, 1], ends: [1, 1, 1, 3, 3] });
});
it("deduplicates words, merges overlapping matches, and orders separate words", () => {
  expect(queryWords(" Niño NINO cafe ")).toEqual(["nino", "cafe"]);
  expect(matches("banana café niño", "ana nana nino cafe")).toEqual(["anana", "café", "niño"]);
});
it("chooses the most distinct words, with the earliest line winning ties", () => {
  expect(snippet("cat cat cat\ncat dog\ndog cat", queryWords("cat dog"))).toMatchObject({ text: "cat dog", parts: [{ text: "cat", match: true }, { text: " ", match: false }, { text: "dog", match: true }] });
});
it("prefers a line's start, centres a deep match, and marks only cut edges", () => {
  expect(snippet("hello cat and more words", ["cat"], 12).text).toBe("hello cat an…");
  expect(snippet("0123456789 cat 0123456789012345", ["cat"], 10).text).toBe("…6789 cat 0…");
  expect(snippet("0123456789 cat", ["cat"], 10).text).toBe("…456789 cat");
  expect(snippet("cat", ["cat"]).text).toBe("cat");
});
it("returns no snippet for a title-only hit; list search and ranges agree on sigma and accents", () => {
  const notes = [{ title: "ΟΣ café", text: "No body hit" }, { title: "Title", text: "ος cafe\u0301" }];
  expect(searchNotes(notes, "οσ CAFE")).toEqual(notes);
  expect(snippet(notes[0].text, queryWords("οσ cafe"))).toBeNull();
  expect(matches(notes[1].text, "ΟΣ café")).toEqual(["ος", "cafe\u0301"]);
});
