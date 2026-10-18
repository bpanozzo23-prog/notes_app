import { act, cleanup, renderHook } from "@testing-library/react";
import { beforeEach, afterEach, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { db, getPref, setPref, notebookAccess } from "../db/db.js";
import { resetDatabase } from "../test/fixtures.js";
import { CLAUDE_PREFS, claudeApiKey, claudeEnabled, claudeSpend, saveClaudeKey, setClaudeEnabled, removeClaudeKey, getClaudeStatus, readClaudeSpend, addClaudeSpend } from "./prefs.js";
import { PRICES, priceUsage } from "./config.js";
import useNotebook from "../lib/useNotebook.js";

beforeEach(resetDatabase);
afterEach(cleanup);
it("keeps key reads private and requires both enabled and a nonblank key", async () => {
  expect(await getClaudeStatus()).toEqual({ enabled: false, hasKey: false, ready: false });
  await saveClaudeKey("  "); await setClaudeEnabled(true);
  expect(await getClaudeStatus()).toEqual({ enabled: true, hasKey: false, ready: false });
  await saveClaudeKey(" sk-ant-FAKE ");
  expect(await getClaudeStatus()).toEqual({ enabled: true, hasKey: true, ready: true });
  await setClaudeEnabled(false);
  expect(await getPref(claudeApiKey)).toBe("sk-ant-FAKE");
  await removeClaudeKey();
  expect(await db.prefs.get(claudeApiKey)).toBeUndefined();
  expect(await getPref(claudeEnabled)).toBe(false);
});
it("strips every Claude preference from both the hook state and refresh result", async () => {
  for (const key of CLAUDE_PREFS) await setPref(key, "SENTINEL");
  await setPref("toolbar", ["bold"]);
  const { result } = renderHook(useNotebook);
  let refreshed;
  await act(async () => { refreshed = await result.current.refresh(); });
  expect(refreshed.prefs).toEqual({ toolbar: ["bold"] });
  expect(result.current.prefs).toEqual({ toolbar: ["bold"] });
});
it("adds spend once per request in a transaction, rolls months locally, and bounds remembered ids", async () => {
  const october = new Date(2026, 9, 31, 23, 59), november = new Date(2026, 10, 1);
  expect(await readClaudeSpend(october)).toBe(0);
  await Promise.all([addClaudeSpend("req_one", 0.2, october), addClaudeSpend("req_one", 0.2, october), addClaudeSpend("req_two", 0.3, october)]);
  expect(await readClaudeSpend(october)).toBe(0.5);
  expect(await readClaudeSpend(november)).toBe(0);
  await addClaudeSpend("req_one", 1, november);
  expect(await getPref(claudeSpend)).toEqual({ month: "2026-11", dollars: 1, counted: ["req_one"] });
  for (let i = 0; i < 101; i++) await addClaudeSpend(`req_${i}`, 0, november);
  expect((await getPref(claudeSpend)).counted).toEqual(Array.from({ length: 100 }, (_, i) => `req_${i + 1}`));
  expect(() => addClaudeSpend("bad", NaN, november)).toThrow("Invalid Claude usage");
});
it("guards all preference writes, including the spend total", async () => {
  await db.prefs.put({ key: "notebookGeneration", value: "replaced" });
  for (const write of [() => saveClaudeKey("fake"), () => setClaudeEnabled(true), removeClaudeKey, () => addClaudeSpend("req_one", 1)]) await expect(write()).rejects.toThrow("replaced");
  expect(notebookAccess.getSnapshot().replaced).toBe(true);
  expect(await db.prefs.toArray()).toEqual([{ key: "notebookGeneration", value: "replaced" }]);
});
it.each(Object.entries(PRICES))("prices all four token counts for %s", (model, prices) => {
  expect(priceUsage(model, { input_tokens: 1e6, cache_creation_input_tokens: 2e6, cache_read_input_tokens: 3e6, output_tokens: 4e6 })).toBeCloseTo(prices[0] + 2 * prices[1] + 3 * prices[2] + 4 * prices[3]);
});
it("returns unknown cost for missing counts or model, including inherited property names", () => {
  const usage = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
  expect(priceUsage("claude-opus-5-5", usage)).toBe(0);
  for (const key of Object.keys(usage)) for (const bad of [undefined, null, NaN, -1, "0"]) expect(priceUsage("claude-opus-5-5", { ...usage, [key]: bad })).toBeNull();
  expect(priceUsage("claude-opus-5-5")).toBeNull();
  expect(priceUsage("unknown", usage)).toBeNull();
  expect(priceUsage("toString", usage)).toBeNull();
});
it("only client.js imports readClaudeKey in the non-test src tree", () => {
  const root = resolve(process.cwd(), "src");
  const files = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(resolve(directory, entry.name)) : [resolve(directory, entry.name)]);
  const readers = files(root).filter((file) => /\.[jt]sx?$/.test(file) && !/\.test\./.test(file)).filter((file) => {
    const imports = readFileSync(file, "utf8").match(/import\s[\s\S]*?from\s*["'][^"']+["']/g) ?? [];
    return imports.some((statement) => /\breadClaudeKey\b/.test(statement));
  }).map((file) => relative(root, file));
  expect(readers).toEqual(["claude/client.js"]);
});
