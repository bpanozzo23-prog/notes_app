// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { AT, fixture, note, push } from "./test-support.js";
import { readJson, sha256, stableStringify } from "./fsutil.mjs";
import { buildBackup } from "./backup.mjs";
import { ingest } from "./inbox.mjs";
import { readProposals, proposalFilename } from "./proposals.mjs";
import { OUTCOME_STEPS } from "./round.mjs";

let f;
beforeEach(async () => {
  f = await fixture();
  expect((await f.request("POST", "/v1/push", push())).status).toBe(200);
  f.git.commit.mockClear();
});
afterEach(async () => { await f?.clean(); });
const value = (extra = {}) => ({ proposal: "p-fixture-0001", note: "note-1", basedOnRev: 1,
  generation: "generation-A", title: "Suggested", folderId: null, tags: [], why: "", body: "<p>Suggestion</p>", ...extra });
const pendingFile = (pid = "p-fixture-0001") => path.join(f.config.viewDir, "inbox/pending", `${pid}.json`);
const put = (v = value()) => fs.writeFile(pendingFile(v.proposal), JSON.stringify(v));
const state = () => f.request("GET", "/v1/state");
const records = async () => (await readProposals(f.config.storeDir)).map((e) => e.record);

it("ingests canonical immutable versions in order and commits once, without modifying inbox bytes", async () => {
  const v = value();
  await put(v);
  const before = await fs.readFile(pendingFile());
  const response = await state();
  const hash = sha256(stableStringify(v));
  expect(response.body.proposals).toEqual([{ ...v, hash, status: "pending", ingestedAt: AT, sequence: 1 }]);
  expect(await fs.readdir(f.context.store.file("proposals"))).toEqual([proposalFilename(v.proposal, hash)]);
  expect(f.git.commit).toHaveBeenCalledExactlyOnceWith("inbox: 1 new versions");
  expect(await fs.readFile(pendingFile())).toEqual(before);
  await fs.writeFile(pendingFile(), JSON.stringify(Object.fromEntries(Object.entries(v).reverse()), null, 2));
  expect((await state()).body.proposals).toHaveLength(1);
  expect(f.git.commit).toHaveBeenCalledTimes(1);
  expect((await readJson(path.join(f.config.viewDir, "notebook/proposals.json")))[0].status).toBe("pending");
});
it("changed content supersedes the pending version; removal withdraws; old bytes never resurrect", async () => {
  const before = await buildBackup(f.context.store, AT);
  await put();
  const a = (await state()).body.proposals[0];
  await put(value({ body: "<p>New version</p>" }));
  const b = (await state()).body.proposals[0];
  expect(b.hash).not.toBe(a.hash);
  expect((await records()).map((r) => r.status)).toEqual(["superseded", "pending"]);
  await fs.unlink(pendingFile());
  expect((await state()).body.proposals).toEqual([]);
  expect((await records()).map((r) => r.status)).toEqual(["superseded", "withdrawn"]);
  await put();
  expect((await state()).body.proposals).toEqual([]);
  expect(await records()).toHaveLength(2);
  expect(await buildBackup(f.context.store, AT)).toEqual(before);
});
it("refuses a second pid for a pending note and permits it after a first outcome", async () => {
  await put();
  const a = (await state()).body.proposals[0];
  await put(value({ proposal: "p-fixture-0002" }));
  expect((await state()).body.proposals).toHaveLength(1);
  expect((await records())[1]).toMatchObject({ status: "refused", reason: "note-busy" });
  expect((await records())[1]).not.toHaveProperty("body");
  await f.request("POST", "/v1/outcomes", [{ proposal: a.proposal, hash: a.hash, outcome: "dismissed", at: AT }]);
  await put(value({ proposal: "p-fixture-0003" }));
  expect((await state()).body.proposals.map((p) => p.proposal)).toEqual(["p-fixture-0003"]);
});
it("caps pending versions at fifty and returns them in ingestion order", async () => {
  for (let i = 0; i < 51; i++) await put(value({ proposal: `p-fixture-${String(i).padStart(4, "0")}`, note: `note-${i}` }));
  const pending = (await state()).body.proposals;
  expect(pending).toHaveLength(50);
  expect(pending.map((p) => p.sequence)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  expect((await records()).at(-1)).toMatchObject({ status: "refused", reason: "too-many" });
});
it.each([
  ["malformed", "{ invalid", "invalid-json"],
  ["oversized", "x".repeat(1024 * 1024 + 1), "too-large"],
  ["mismatched", JSON.stringify(value({ proposal: "p-someone-else" })), "proposal-mismatch"],
  ["extra field", JSON.stringify(value({ pinned: true })), "invalid-shape"],
  ["body over limit", JSON.stringify(value({ body: "x".repeat(512 * 1024 + 1) })), "invalid-body"],
])("records a body-free refusal for %s input", async (_name, contents, reason) => {
  await fs.writeFile(pendingFile(), contents);
  expect((await state()).body.proposals).toEqual([]);
  const [record] = await records();
  expect(record).toMatchObject({ proposal: "p-fixture-0001", status: "refused", reason });
  expect(record).not.toHaveProperty("body");
  expect(record).not.toHaveProperty("title");
  expect(await fs.readFile(pendingFile(), "utf8")).toBe(contents);
  await state();
  expect(await records()).toHaveLength(1);
});
it.each(["inbox", "inbox/pending"])("skips symlinked %s without reading its target or marking withdrawal", async (relative) => {
  await put();
  await state();
  const before = await fs.readFile(f.context.store.file("meta.json"));
  const target = path.join(f.config.viewDir, relative);
  await fs.rm(target, { recursive: true });
  await fs.symlink(f.context.store.repo, target);
  expect((await state()).body.proposals).toHaveLength(1);
  expect(await fs.readFile(f.context.store.file("meta.json"))).toEqual(before);
  expect((await records())[0].status).toBe("pending");
  expect(f.git.commit).toHaveBeenCalledTimes(1);
  expect(await fs.readFile(path.join(f.config.storeDir, "view-log.jsonl"), "utf8")).toContain("inbox-skipped");
});
it("refuses a pending symlink into the fixture store without reading or changing the target", async () => {
  const sentinel = f.context.store.file("fixture-secret.json");
  await fs.writeFile(sentinel, JSON.stringify(value({ body: "PRIVATE SENTINEL" })));
  const before = await fs.readFile(sentinel);
  await fs.symlink(sentinel, pendingFile());
  expect((await state()).body.proposals).toEqual([]);
  expect((await records())[0]).toMatchObject({ status: "refused", reason: "not-regular" });
  expect(JSON.stringify(await records())).not.toContain("PRIVATE SENTINEL");
  expect(await fs.readFile(sentinel)).toEqual(before);
  expect((await fs.lstat(pendingFile())).isSymbolicLink()).toBe(true);
});
it("ignores nonmatching names and refuses a matching directory", async () => {
  await fs.writeFile(path.join(f.config.viewDir, "inbox/pending/other.json"), "{}");
  await fs.mkdir(pendingFile());
  expect((await state()).body.proposals).toEqual([]);
  expect(await records()).toHaveLength(1);
  expect((await records())[0].reason).toBe("not-regular");
});
it("outcomes are idempotent by full hash and rebuild both status files", async () => {
  await put();
  const a = (await state()).body.proposals[0];
  const item = { proposal: a.proposal, hash: a.hash, outcome: "applied", applied: ["title", "body:1"], at: AT };
  expect((await f.request("POST", "/v1/outcomes", [item])).status).toBe(200);
  await f.request("POST", "/v1/outcomes", [{ ...item, outcome: "dismissed" }]);
  const summary = await readJson(path.join(f.config.viewDir, "notebook/proposals.json"));
  expect(summary[0]).toMatchObject({ status: "applied", outcome: { applied: ["title", "body:1"] } });
  expect(summary[0]).not.toHaveProperty("body");
  const log = await fs.readFile(path.join(f.config.viewDir, "notebook/proposals-log.md"), "utf8");
  expect(log).toContain(`${AT} · Fixture title · applied · applied: title, body:1`);
  expect(log.match(/^- /gm)).toHaveLength(1);
});
it.each(OUTCOME_STEPS)("recovers inbox ingestion interrupted after %s", async (step) => {
  await put();
  f.context.afterStep = (name) => { if (name === step) throw new Error("crash"); };
  expect((await state()).status).toBe(503);
  await f.restart();
  expect((await state()).body.proposals).toHaveLength(1);
  expect(f.git.commit).toHaveBeenCalledTimes(1);
  expect(await f.context.store.readJournal()).toBeNull();
});
it("does not ingest a second version while history is blocked", async () => {
  f.git.commit.mockRejectedValue(new Error("git-failed"));
  await put();
  expect((await state()).body.historyError).toBe(true);
  await put(value({ body: "Changed" }));
  expect((await state()).body.proposals).toEqual([]);
  expect(await records()).toHaveLength(1);
  f.git.commit.mockResolvedValue();
  expect((await state()).body.proposals[0].body).toBe("Changed");
  expect((await records())[0].status).toBe("superseded");
});
it("supports standalone ingestion with explicit temporary paths", async () => {
  // Injected context avoids a real git adapter here; standalone store loading is covered by view tests.
  await put();
  expect(await ingest({ ...f.config, context: f.context })).toHaveLength(1);
});
