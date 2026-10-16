import { afterEach, expect, it, vi } from "vitest";
import { newId } from "./ids.js";
import { nowIso } from "./dates.js";

afterEach(() => vi.restoreAllMocks());
it("generates unique UUID v4 ids even without randomUUID", () => {
  const original = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
  try {
    const ids = Array.from({ length: 1000 }, newId);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(ids).size).toBe(ids.length);
  } finally {
    if (original) Object.defineProperty(crypto, "randomUUID", original);
    else delete crypto.randomUUID;
  }
});
it("uses getRandomValues and sets version and variant bits", () => {
  vi.spyOn(crypto, "getRandomValues").mockImplementation((bytes) => bytes.fill(255));
  expect(newId()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
});
it("returns an ISO UTC timestamp", () => {
  const at = nowIso();
  expect(new Date(at).toISOString()).toBe(at);
  expect(Math.abs(Date.now() - Date.parse(at))).toBeLessThan(1000);
});
