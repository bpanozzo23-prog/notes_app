// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { AT, fixture, note, push } from "./test-support.js";
import { readJson, sha256, stableStringify } from "./fsutil.mjs";
import { buildBackup } from "./backup.mjs";
import { HALF_PAIR_TIMEOUT_MS, scanInbox } from "./inbox.mjs";
import { readProposals, proposalFilename } from "./proposals.mjs";
import { OUTCOME_STEPS } from "./round.mjs";

let f;
beforeEach(async () => {
  f = await fixture();
  expect((await f.request("POST", "/v1/push", push([
    note({ html: '<p>Fixture</p><img data-file="image-1">' }), note({ id: "other" }), note({ id: "trash", deletedAt: AT }),
  ], { folders: [{ id: "folder", name: "Folder", position: 0 }] }))).status).toBe(200);
  f.git.commit.mockClear();
});
afterEach(async () => { vi.restoreAllMocks(); await f?.clean(); });
const PID = "p-fixture-0001";
const value = (extra = {}) => ({ note: "note-1", basedOnRev: 1,
  generation: "generation-A", title: "Suggested", folderId: null, tags: [], why: "", body: "<p>Suggestion</p>", ...extra });
const inbox = (name = "") => path.join(f.config.viewDir, "inbox", name);
const filename = (ext = "json", pid = PID) => inbox(`${pid}.${ext}`);
async function put(extra = {}, pid = PID) {
  const { body, ...details } = value(extra);
  await fs.writeFile(filename("html", pid), body);
  await fs.writeFile(filename("json", pid), JSON.stringify(details));
}
const state = () => f.request("GET", "/v1/state");
async function ingest() {
  expect((await state()).status).toBe(200);
  const response = await state();
  expect(response.status).toBe(200);
  return response.body.proposals;
}
const records = async () => (await readProposals(f.config.storeDir)).map((e) => e.record);
const summary = () => readJson(path.join(f.config.viewDir, "notebook/proposals.json"));

it("requires two unchanged scans, commits canonical fields/body, publishes metadata, then removes the pair", async () => {
  await put();
  const before = await buildBackup(f.context.store, AT);
  expect((await state()).body.proposals).toEqual([]);
  expect(await records()).toEqual([]);
  expect(f.context.inboxObservations.get(PID)).toEqual({
    json: expect.objectContaining({ size: expect.any(Number), mtimeMs: expect.any(Number), ino: expect.any(Number) }),
    html: expect.objectContaining({ size: expect.any(Number), mtimeMs: expect.any(Number), ino: expect.any(Number) }), firstSeen: Date.parse(AT),
  });
  const original = f.context.rebuildView;
  f.context.rebuildView = async () => {
    expect(f.git.commit).toHaveBeenCalledExactlyOnceWith("inbox: 1 new versions");
    expect(await fs.readdir(inbox())).toHaveLength(2);
    await original();
  };
  const hash = sha256(stableStringify(value()));
  expect((await state()).body.proposals).toEqual([{ ...value(), proposal: PID, hash, status: "pending", ingestedAt: AT, sequence: 1 }]);
  expect(await fs.readdir(f.context.store.file("proposals"))).toEqual([proposalFilename(PID, hash)]);
  expect(await fs.readdir(inbox())).toEqual([]);
  expect((await summary())[0]).toMatchObject({ status: "pending" });
  expect((await summary())[0]).not.toHaveProperty("body");
  expect(await buildBackup(f.context.store, AT)).toEqual(before);
});
it.each(["json", "html"])("defers a pair changing %s between scans until stable", async (ext) => {
  await put(); await state();
  if (ext === "html") await fs.appendFile(filename(ext), "<p>More</p>");
  else await fs.appendFile(filename(ext), "  ");
  expect((await state()).body.proposals).toEqual([]);
  expect(await records()).toEqual([]);
  expect((await state()).body.proposals).toHaveLength(1);
});
it("detects mtime and inode changes even when size stays the same", async () => {
  await put(); await state();
  const bytes = await fs.readFile(filename("html"));
  await fs.utimes(filename("html"), new Date(AT), new Date(AT));
  expect((await state()).body.proposals).toEqual([]);
  const stat = await fs.stat(filename("html"));
  await fs.writeFile(inbox("replacement"), bytes);
  await fs.utimes(inbox("replacement"), stat.atime, stat.mtime);
  await fs.rename(inbox("replacement"), filename("html"));
  expect((await state()).body.proposals).toEqual([]);
  expect((await state()).body.proposals).toHaveLength(1);
});
it.each([["json", "missing-body"], ["html", "missing-details"]])("times out a lone %s only after ten minutes", async (ext, reason) => {
  await put(); await fs.unlink(filename(ext === "json" ? "html" : "json"));
  await state();
  f.setTime(Date.parse(AT) + HALF_PAIR_TIMEOUT_MS);
  await state(); expect(await records()).toEqual([]);
  f.setTime(Date.parse(AT) + HALF_PAIR_TIMEOUT_MS + 1);
  await state();
  expect(await records()).toEqual([expect.objectContaining({ proposal: PID, status: "refused", reason })]);
  expect((await records())[0]).not.toHaveProperty("body");
  expect((await summary())[0].reason).toBe(reason);
  expect(await fs.readdir(inbox())).toEqual([]);
});
it("a half pair that becomes complete needs a second observation of both files", async () => {
  await put(); const details = await fs.readFile(filename()); await fs.unlink(filename());
  await state(); f.setTime(Date.parse(AT) + HALF_PAIR_TIMEOUT_MS + 1);
  await fs.writeFile(filename(), details);
  expect((await state()).body.proposals).toEqual([]);
  expect((await state()).body.proposals).toHaveLength(1);
});
it.each([false, true])("supersedes a valid pending version for the same note (reuse pid: %s), never withdraws", async (reuse) => {
  await put(); const [a] = await ingest();
  await put({ body: "<p>New version</p>" }, reuse ? PID : "p-fixture-0002");
  const [b] = await ingest();
  expect(b.hash).not.toBe(a.hash);
  expect((await records()).map((r) => r.status)).toEqual(["superseded", "pending"]);
  await state();
  expect((await records()).map((r) => r.status)).toEqual(["superseded", "pending"]);
  await put(); await ingest();
  expect(await records()).toHaveLength(2);
  expect(await fs.readdir(inbox())).toEqual([]);
});
it("does not supersede a pending proposal with a refused replacement", async () => {
  await put(); await ingest();
  await put({ basedOnRev: 2 }); await ingest();
  expect((await records()).map((r) => r.status)).toEqual(["pending", "refused"]);
});
it("repeated pid+hash with different JSON whitespace/order is only removed, including after an outcome", async () => {
  await put(); const [a] = await ingest();
  await f.request("POST", "/v1/outcomes", [{ proposal: PID, hash: a.hash, outcome: "dismissed", at: AT }]);
  const commits = f.git.commit.mock.calls.length;
  await put();
  const { body: _body, ...details } = value();
  await fs.writeFile(filename(), JSON.stringify(Object.fromEntries(Object.entries(details).reverse()), null, 2));
  expect(await ingest()).toEqual([]);
  expect(await records()).toHaveLength(1);
  expect((await records())[0].status).toBe("dismissed");
  expect(f.git.commit).toHaveBeenCalledTimes(commits);
  expect(await fs.readdir(inbox())).toEqual([]);
});
it("caps pending at fifty but permits replacement when full", async () => {
  const rows = Array.from({ length: 51 }, (_, i) => note({ id: `note-${i}` }));
  expect((await f.request("POST", "/v1/push", push(rows, { base: { round: 1, generation: "generation-A" },
    tombstones: [{ id: "other", purgedAt: AT }, { id: "trash", purgedAt: AT }] }))).status).toBe(200);
  for (let i = 0; i < 51; i++) await put({ note: `note-${i}` }, `p-fixture-${String(i).padStart(4, "0")}`);
  const pending = await ingest();
  expect(pending).toHaveLength(50);
  expect(pending.map((p) => p.sequence)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  expect((await records()).at(-1)).toMatchObject({ status: "refused", reason: "too-many" });
  await put({ note: "note-0", title: "Replacement" }, "p-replacement");
  expect(await ingest()).toHaveLength(50);
  expect((await records())[0].status).toBe("superseded");
  expect((await records()).at(-1).status).toBe("pending");
});
it.each([
  [{ extra: true }, "invalid-shape"], [{ body: "<p>x</p>", proposal: PID }, "invalid-shape"],
  [{ title: undefined }, "invalid-shape"], [{ note: "" }, "invalid-note"], [{ note: 4 }, "invalid-note"],
  [{ basedOnRev: 0 }, "invalid-rev"], [{ basedOnRev: 1.5 }, "invalid-rev"], [{ basedOnRev: "1" }, "invalid-rev"],
  [{ generation: 7 }, "invalid-generation"], [{ title: "x".repeat(201) }, "invalid-title"],
  [{ title: "\u0085" }, "invalid-title"], [{ title: null }, "invalid-title"],
  [{ folderId: "" }, "invalid-folder"], [{ folderId: 1 }, "invalid-folder"],
  [{ tags: ["x", "x"] }, "invalid-tags"], [{ tags: [" x"] }, "invalid-tags"],
  [{ tags: Array.from({ length: 51 }, (_, i) => `tag-${i}`) }, "invalid-tags"],
  [{ tags: ["\u0000"] }, "invalid-tags"], [{ tags: ["x".repeat(513)] }, "invalid-tags"], [{ tags: null }, "invalid-tags"],
  [{ why: "x".repeat(301) }, "invalid-why"], [{ why: false }, "invalid-why"],
  [{ note: "absent" }, "unknown-note"], [{ note: "trash" }, "note-in-trash"],
  [{ basedOnRev: 2 }, "changed-since-read"], [{ generation: "old" }, "changed-since-read"],
  [{ generation: null }, "changed-since-read"], [{ folderId: "absent" }, "unknown-folder"],
  [{ body: '<a href="note:absent">Link</a>' }, "unknown-note-link"],
  [{ body: '<a href="note:trash">Link</a>' }, "unknown-note-link"],
  [{ body: '<img data-file="new">' }, "new-image"],
])("records a body-free refusal for %j (%s)", async (extra, reason) => {
  await put(extra); expect(await ingest()).toEqual([]);
  const [r] = await records();
  expect(r).toMatchObject({ proposal: PID, status: "refused", reason });
  expect(r).not.toHaveProperty("body");
  expect((await summary())[0].reason).toBe(reason);
  expect(await fs.readdir(inbox())).toEqual([]);
});
it.each([
  ["json", "{ invalid", "invalid-json"], ["json", Buffer.from([0xff]), "invalid-json"],
  ["json", "null", "invalid-shape"], ["json", "[]", "invalid-shape"],
  ["json", "[".repeat(7000) + "]".repeat(7000), "invalid-shape"],
  ["json", '{"extra":' + "[".repeat(7000) + "]".repeat(7000) + "}", "invalid-shape"],
  ["json", "x".repeat(16 * 1024 + 1), "too-large"],
  ["html", "x".repeat(512 * 1024 + 1), "too-large"], ["html", Buffer.from([0xc3, 0x28]), "invalid-body"],
])("refuses invalid/oversized %s bytes (%s)", async (ext, bytes, reason) => {
  await put(); await fs.writeFile(filename(ext), bytes);
  expect(await ingest()).toEqual([]);
  expect((await records())[0]).toMatchObject({ status: "refused", reason });
  expect((await records())[0]).not.toHaveProperty("body");
  await put(); await fs.writeFile(filename(ext), bytes); await ingest();
  expect(await records()).toHaveLength(1);
  expect(await fs.readdir(inbox())).toEqual([]);
});
it("allows exact byte limits, empty HTML, and valid folder/link/image references", async () => {
  await put({ folderId: "folder", body: '<a href="note:other">Other</a><img data-file="image&#45;1">' });
  expect(await ingest()).toHaveLength(1);
  await put({ body: "é".repeat(256 * 1024) });
  const bytes = await fs.readFile(filename());
  await fs.appendFile(filename(), " ".repeat(16 * 1024 - bytes.length));
  expect((await ingest())[0].body).toHaveLength(256 * 1024);
  await put({ body: "" }); expect((await ingest())[0].body).toBe("");
});
it("checks references/rev/generation against the private store even if view metadata lies", async () => {
  const indexFile = path.join(f.config.viewDir, "notebook/index.json");
  await fs.chmod(indexFile, 0o600);
  await fs.writeFile(indexFile, JSON.stringify({ generation: "fake", notes: [{ id: "fake", rev: 10 }] }));
  await put({ generation: "fake" }); await ingest();
  expect((await records())[0].reason).toBe("changed-since-read");
  await put({ body: '<img data-file="image-1">' }, "p-private-check");
  expect(await ingest()).toHaveLength(1);
});
it("ignores a symlinked inbox without touching its store target or withdrawing existing versions", async () => {
  await put(); await ingest();
  const before = await fs.readFile(f.context.store.file("meta.json"));
  await fs.rm(inbox(), { recursive: true }); await fs.symlink(f.context.store.repo, inbox());
  expect((await state()).body.proposals).toHaveLength(1);
  expect(await fs.readFile(f.context.store.file("meta.json"))).toEqual(before);
  expect(await records()).toHaveLength(1);
  expect(f.git.commit).toHaveBeenCalledTimes(1);
  expect((await fs.lstat(inbox())).isSymbolicLink()).toBe(true);
  expect(await fs.readFile(path.join(f.config.storeDir, "view-log.jsonl"), "utf8")).toContain("inbox-skipped");
});
it.each(["json", "html"])("ignores a linked %s entry without reading, deleting or writing its target", async (ext) => {
  await put(); await fs.unlink(filename(ext));
  const sentinel = f.context.store.file("fixture-secret.json");
  await fs.writeFile(sentinel, "PRIVATE SENTINEL");
  await fs.symlink(sentinel, filename(ext));
  await ingest(); f.setTime(Date.parse(AT) + HALF_PAIR_TIMEOUT_MS + 1); await state();
  expect(await records()).toEqual([]);
  expect(f.git.commit).not.toHaveBeenCalled();
  expect(await fs.readFile(sentinel, "utf8")).toBe("PRIVATE SENTINEL");
  expect((await fs.lstat(filename(ext))).isSymbolicLink()).toBe(true);
});
it("ignores unrelated names, matching directories and legacy inbox subdirectories without deleting them", async () => {
  const names = ["other.json", "p-ab.json", "p-UPPER.json", `p-${"x".repeat(81)}.json`, "p-valid.json.tmp"];
  for (const name of names) await fs.writeFile(inbox(name), "{}");
  for (const name of [`${PID}.json`, "drafts", "pending"]) await fs.mkdir(inbox(name));
  const before = await fs.readdir(inbox());
  await ingest(); f.setTime(Date.parse(AT) + HALF_PAIR_TIMEOUT_MS + 1); await state();
  expect(await records()).toEqual([]);
  expect(await fs.readdir(inbox())).toEqual(before);
});
it("accepts shortest and longest legal pids", async () => {
  for (const pid of ["p-abc", `p-${"a".repeat(80)}`]) {
    await put({}, pid); expect((await ingest())[0].proposal).toBe(pid);
  }
});
it("outcomes remain idempotent by full hash and rebuild both status files", async () => {
  await put(); const [a] = await ingest();
  const item = { proposal: a.proposal, hash: a.hash, outcome: "applied", applied: ["title", "body:1"], at: AT };
  expect((await f.request("POST", "/v1/outcomes", [item])).status).toBe(200);
  await f.request("POST", "/v1/outcomes", [{ ...item, outcome: "dismissed" }]);
  expect((await summary())[0]).toMatchObject({ status: "applied", outcome: { applied: ["title", "body:1"] } });
  expect((await summary())[0]).not.toHaveProperty("body");
  const log = await fs.readFile(path.join(f.config.viewDir, "notebook/proposals-log.md"), "utf8");
  expect(log).toContain(`${AT} · Fixture title · applied · applied: title, body:1`);
  expect(log.match(/^- /gm)).toHaveLength(1);
});
it.each(OUTCOME_STEPS)("recovers ingestion interrupted after %s, removes files without a second record", async (step) => {
  await put(); await state();
  f.context.afterStep = (name) => { if (name === step) throw new Error("crash"); };
  expect((await state()).status).toBe(503);
  expect(await fs.readdir(inbox())).toHaveLength(2);
  await f.restart();
  expect(await ingest()).toHaveLength(1);
  expect(await records()).toHaveLength(1);
  expect(f.git.commit).toHaveBeenCalledTimes(1);
  expect(await f.context.store.readJournal()).toBeNull();
  expect(await fs.readdir(inbox())).toEqual([]);
});
it("leaves inbox files until a failed history commit is repaired and blocks subsequent versions", async () => {
  f.git.commit.mockRejectedValue(new Error("git-failed"));
  await put(); await ingest();
  expect((await state()).body).toMatchObject({ historyError: true, proposals: [] });
  expect(await fs.readdir(inbox())).toHaveLength(2);
  await put({ body: "Changed" }, "p-second-version"); await ingest();
  expect(await records()).toHaveLength(1);
  f.git.commit.mockResolvedValue();
  expect((await ingest())[0].body).toBe("Changed");
  expect((await records())[0].status).toBe("superseded");
  expect(await fs.readdir(inbox())).toEqual([]);
});
it("preserves files changed during commit/view rebuild", async () => {
  await put(); await state();
  const original = f.context.rebuildView;
  f.context.rebuildView = async () => { await original(); await put({ body: "New work while committing" }); };
  expect((await state()).body.proposals).toHaveLength(1);
  expect(await fs.readFile(filename("html"), "utf8")).toBe("New work while committing");
  f.context.rebuildView = original;
  expect((await ingest())[0].body).toBe("New work while committing");
  expect(await records()).toHaveLength(2);
});
it("refuses to overwrite an unresolved journal when called directly", async () => {
  await put(); await state();
  f.context.afterStep = (name) => { if (name === "journal") throw new Error("crash"); };
  await state();
  await expect(f.context.enqueue(() => scanInbox(f.context))).rejects.toThrow("journal-pending");
});
it("records unreadable regular files without leaking arbitrary errors", async () => {
  await put(); await state();
  const original = fs.open;
  vi.spyOn(fs, "open").mockImplementation(async (name, ...args) => {
    if (String(name).endsWith(`${PID}.html`)) throw Object.assign(new Error("SENTINEL"), { code: "EACCES" });
    return original(name, ...args);
  });
  await state();
  expect((await records())[0]).toMatchObject({ reason: "unreadable", status: "refused" });
  expect(JSON.stringify(await records())).not.toContain("SENTINEL");
});
it("bounds a growing read and defers it instead of recording partial content", async () => {
  await put(); await state();
  const original = fs.open;
  let grew = false;
  vi.spyOn(fs, "open").mockImplementation(async (name, ...args) => {
    const handle = await original(name, ...args);
    if (!grew && String(name).endsWith(`${PID}.html`)) {
      const read = handle.read.bind(handle);
      handle.read = async (...readArgs) => {
        const result = await read(...readArgs);
        if (!grew) {
          grew = true;
          await fs.appendFile(filename("html"), "x".repeat(512 * 1024));
        }
        return result;
      };
    }
    return handle;
  });
  expect((await state()).body.proposals).toEqual([]);
  expect(await records()).toEqual([]);
  expect(await ingest()).toEqual([]);
  expect((await records())[0].reason).toBe("too-large");
});
it("restarts half-pair timers and forgets files that vanished before ingestion", async () => {
  await put(); await fs.unlink(filename("html")); await state();
  f.setTime(Date.parse(AT) + HALF_PAIR_TIMEOUT_MS);
  await f.restart(); await state();
  f.setTime(Date.parse(AT) + HALF_PAIR_TIMEOUT_MS + 1); await state();
  expect(await records()).toEqual([]);
  await fs.unlink(filename()); await state();
  await put(); await fs.unlink(filename("html")); await state();
  expect(await records()).toEqual([]);
  f.setTime(Date.parse(AT) + HALF_PAIR_TIMEOUT_MS * 2 + 2); await state();
  expect((await records())[0].reason).toBe("missing-body");
});
it("defers a file changed between observation and open", async () => {
  await put(); await state();
  const original = fs.open;
  let changed = false;
  vi.spyOn(fs, "open").mockImplementation(async (name, ...args) => {
    if (!changed && String(name).endsWith(`${PID}.html`)) {
      changed = true; await fs.appendFile(filename("html"), " changed at open");
    }
    return original(name, ...args);
  });
  expect((await state()).body.proposals).toEqual([]);
  expect(await records()).toEqual([]);
  expect((await ingest())[0].body).toContain("changed at open");
});
it("never follows an inbox replaced during scanning", async () => {
  await put(); await state();
  const original = fs.open;
  let changed = false;
  vi.spyOn(fs, "open").mockImplementation(async (name, ...args) => {
    if (!changed && String(name).endsWith(`${PID}.html`)) {
      changed = true;
      await fs.rename(inbox(), path.join(f.config.viewDir, "old-inbox"));
      await fs.symlink(f.context.store.repo, inbox());
    }
    return original(name, ...args);
  });
  await state(); expect(await records()).toEqual([]);
  expect(f.git.commit).not.toHaveBeenCalled();
  expect((await fs.lstat(inbox())).isSymbolicLink()).toBe(true);
  expect(await fs.readdir(f.context.store.repo)).not.toContain(`${PID}.html`);
});
