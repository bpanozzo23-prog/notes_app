import { afterEach, expect, it, vi } from "vitest";
import { composeShared, takeShared, SHARE_CACHE, QUICK_ADD_MAX } from "./shareTarget.js";
import { fakeCaches, storeShare } from "../test/cacheStorage.js";

afterEach(() => vi.unstubAllGlobals());
it.each([
  [{ title: "An article", text: "https://example.com/a" }, "An article\nhttps://example.com/a"],
  [{ title: "An article", text: "Read An article at https://example.com/a" }, "Read An article at https://example.com/a"],
  [{ text: "A quote", url: "https://example.com/a" }, "A quote\nhttps://example.com/a"],
  [{ title: "T", text: "See https://example.com/a", url: "https://example.com/a" }, "T\nSee https://example.com/a"],
  [{ title: "https://example.com/a", url: "https://example.com/a" }, "https://example.com/a"],
  [{ title: "  Only a title  " }, "Only a title"],
  [{ text: "one\r\ntwo\rthree" }, "one\ntwo\nthree"],
  [{ title: 7, text: null, url: undefined }, ""],
  [undefined, ""],
])("puts each part on its own line unless another part holds it: %j", (shared, text) => expect(composeShared(shared)).toEqual({ text, cut: false }));
it("cuts long text to the sheet's limit, never through a two-unit character", () => {
  expect(composeShared({ text: "a".repeat(QUICK_ADD_MAX) })).toEqual({ text: "a".repeat(QUICK_ADD_MAX), cut: false });
  expect(composeShared({ text: "a".repeat(QUICK_ADD_MAX + 1) })).toEqual({ text: "a".repeat(QUICK_ADD_MAX), cut: true });
  const emoji = composeShared({ text: `${"a".repeat(QUICK_ADD_MAX - 1)}😀 more` });
  expect(emoji).toEqual({ text: "a".repeat(QUICK_ADD_MAX - 1), cut: true });
});
it("reads the waiting share once and empties the box", async () => {
  const caches = fakeCaches(); vi.stubGlobal("caches", caches);
  await storeShare(caches, SHARE_CACHE, { title: "An article", text: "https://example.com/a", url: "" });
  expect(await takeShared()).toEqual({ text: "An article\nhttps://example.com/a", cut: false });
  expect(caches.boxes.has(SHARE_CACHE)).toBe(false);
  expect(await takeShared()).toBeNull();
});
it("empties a leftover without reading it when the start was not a share", async () => {
  const caches = fakeCaches(); vi.stubGlobal("caches", caches);
  await storeShare(caches, SHARE_CACHE, { text: "Left behind" });
  expect(await takeShared(false)).toBeNull();
  expect(caches.boxes.has(SHARE_CACHE)).toBe(false);
});
it.each([["an unreadable entry", "not json"], ["an empty share", { title: "", text: " ", url: "" }]])("returns nothing for %s and still empties the box", async (_, value) => {
  const caches = fakeCaches(); vi.stubGlobal("caches", caches);
  await storeShare(caches, SHARE_CACHE, value);
  expect(await takeShared()).toBeNull();
  expect(caches.boxes.has(SHARE_CACHE)).toBe(false);
});
it("returns nothing where Cache Storage is missing or failing", async () => {
  vi.stubGlobal("caches", undefined);
  expect(await takeShared()).toBeNull();
  vi.stubGlobal("caches", { has: () => Promise.reject(new Error("blocked")), delete: () => Promise.reject(new Error("blocked")) });
  expect(await takeShared()).toBeNull();
});
it("empties the box entry by entry when the whole box cannot be deleted", async () => {
  const caches = fakeCaches(); vi.stubGlobal("caches", caches);
  caches.failDelete = true;
  await storeShare(caches, SHARE_CACHE, { text: "Read once" });
  expect(await takeShared()).toEqual({ text: "Read once", cut: false });
  expect(caches.boxes.get(SHARE_CACHE).size).toBe(0);
  await storeShare(caches, SHARE_CACHE, { text: "Left behind" });
  expect(await takeShared(false)).toBeNull();
  expect(caches.boxes.get(SHARE_CACHE).size).toBe(0);
});
