// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { AT, fixture, note, push } from "./test-support.js";
import { readJson, sha256, stableStringify } from "./fsutil.mjs";
import { buildBackup } from "./backup.mjs";
import { HALF_PAIR_TIMEOUT_MS, scanInbox } from "./inbox.mjs";
import { readProposals, proposalFilename, proposalHash } from "./proposals.mjs";
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
const state = () => f.request("GET", "/v1/state?proposals=2");
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

const newDetails = (extra = {}) => ({ generation: "generation-A", title: "New suggestion", folderId: null,
  tags: [], why: "New fixture", ...extra });
const trashDetails = (extra = {}) => ({ note: "note-1", basedOnRev: 1, generation: "generation-A", trash: true, why: "Trash fixture", ...extra });
async function submit(details, body, pid = PID) {
  if (body !== undefined) await fs.writeFile(filename("html", pid), body);
  await fs.writeFile(filename("json", pid), JSON.stringify(details));
}

it("takes a lone Trash JSON only after two stable scans and stores no body", async () => {
  const details = trashDetails();
  await submit(details);
  expect((await state()).body.proposals).toEqual([]);
  expect(await fs.readdir(inbox())).toEqual([`${PID}.json`]);
  await fs.appendFile(filename(), " ");
  expect((await state()).body.proposals).toEqual([]);
  expect(await records()).toEqual([]);
  const [record] = (await state()).body.proposals;
  expect(record).toEqual({ ...details, proposal: PID, hash: proposalHash(details), status: "pending", ingestedAt: AT, sequence: 1 });
  expect(record.hash).not.toBe(proposalHash({ ...details, body: "" }));
  expect(await records()).toEqual([record]);
  expect(await fs.readdir(inbox())).toEqual([]);
  expect((await summary())[0]).toMatchObject({ kind: "trash", title: "Fixture title" });
});
it("accepts an edit with a new folder, and a new note with live links and pictures in a new folder", async () => {
  await put({ newFolder: "Recipes" });
  expect((await ingest())[0].newFolder).toBe("Recipes");
  const details = newDetails({ newFolder: "Recipes" });
  const body = '<p>New</p><img data-file="image-1"><a href="note:other">Other</a>';
  await submit(details, body, "p-new-note");
  expect((await ingest()).at(-1)).toEqual({ ...details, body, proposal: "p-new-note", hash: proposalHash({ ...details, body }),
    status: "pending", ingestedAt: AT, sequence: 2 });
  expect((await summary()).map((p) => p.kind)).toEqual(["edit", "new"]);
});
it.each([
  [trashDetails({ title: "Not allowed" }), undefined, "invalid-shape"],
  [trashDetails({ trash: false }), undefined, "invalid-shape"],
  [trashDetails({ basedOnRev: 0 }), undefined, "invalid-shape"],
  [trashDetails({ newFolder: "Recipes" }), undefined, "invalid-shape"],
  [trashDetails({ folderId: null }), undefined, "invalid-shape"],
  [trashDetails(), "", "trash-with-body"],
  [trashDetails({ extra: true }), "Unexpected body", "trash-with-body"],
  [trashDetails({ note: "missing" }), undefined, "unknown-note"],
  [trashDetails({ note: "trash" }), undefined, "note-in-trash"],
  [trashDetails({ basedOnRev: 2 }), undefined, "changed-since-read"],
  [trashDetails({ generation: "old" }), undefined, "changed-since-read"],
  [newDetails({ basedOnRev: 1 }), "New body", "invalid-shape"],
  [newDetails({ newFolder: " Recipes" }), "New body", "invalid-folder"],
  [newDetails({ folderId: "folder", newFolder: "Recipes" }), "New body", "invalid-folder"],
  [newDetails({ newFolder: "fOlDeR" }), "New body", "folder-exists"],
  [newDetails({ generation: "old" }), "New body", "changed-since-read"],
  [newDetails({ folderId: "missing" }), "New body", "unknown-folder"],
  [newDetails(), '<a href="note:trash">Trash</a>', "unknown-note-link"],
  [newDetails(), '<img data-file="new-image">', "new-image"],
])("refuses new/Trash submission %j (%s, %s) without a body", async (details, body, reason) => {
  await submit(details, body);
  expect(await ingest()).toEqual([]);
  expect(await records()).toEqual([expect.objectContaining({ proposal: PID, status: "refused", reason })]);
  expect((await records())[0]).not.toHaveProperty("body");
  expect(await fs.readdir(inbox())).toEqual([]);
});
it("refuses an edit's existing new-folder name without superseding its pending version", async () => {
  await put(); await ingest();
  await put({ newFolder: "fOlDeR" }); await ingest();
  expect((await records()).map((r) => [r.status, r.reason])).toEqual([["pending", undefined], ["refused", "folder-exists"]]);
});
it("reformatted identical Trash replay only cleans up, including after the owner handled it", async () => {
  const details = trashDetails();
  await submit(details); const [record] = await ingest();
  await f.request("POST", "/v1/outcomes", [{ proposal: PID, hash: record.hash, outcome: "dismissed", at: AT }]);
  const commits = f.git.commit.mock.calls.length;
  await fs.writeFile(filename(), JSON.stringify(Object.fromEntries(Object.entries(details).reverse()), null, 2));
  expect(await ingest()).toEqual([]);
  expect(await records()).toHaveLength(1);
  expect((await records())[0]).toMatchObject({ hash: record.hash, status: "dismissed" });
  expect(f.git.commit).toHaveBeenCalledTimes(commits);
  expect(await fs.readdir(inbox())).toEqual([]);
});
it.each(OUTCOME_STEPS)("recovers lone Trash interrupted after %s without a second version", async (step) => {
  await submit(trashDetails()); await state();
  f.context.afterStep = (name) => { if (name === step) throw new Error("crash"); };
  expect((await state()).status).toBe(503);
  expect(await fs.readdir(inbox())).toEqual([`${PID}.json`]);
  const fresh = await f.restart();
  expect(await ingest()).toHaveLength(1);
  expect(await records()).toHaveLength(1);
  expect((await records())[0]).not.toHaveProperty("body");
  expect(f.git.commit).toHaveBeenCalledTimes(1);
  expect(await fresh.store.readJournal()).toBeNull();
  expect(await fs.readdir(inbox())).toEqual([]);
});
it("leaves a Trash JSON edited during view rebuild for later ingestion", async () => {
  await submit(trashDetails()); await state();
  const original = f.context.rebuildView;
  f.context.rebuildView = async () => { await original(); await submit(trashDetails({ why: "Reconsidered reason" })); };
  expect((await state()).body.proposals).toHaveLength(1);
  expect(JSON.parse(await fs.readFile(filename(), "utf8")).why).toBe("Reconsidered reason");
  f.context.rebuildView = original;
  expect((await ingest())[0].why).toBe("Reconsidered reason");
  expect((await records()).map((r) => r.status)).toEqual(["superseded", "pending"]);
});
it("leaves a Trash JSON changed at the final unlink check", async () => {
  await submit(trashDetails()); await state();
  const original = fs.lstat;
  let cleanup = false, checks = 0;
  f.context.afterStep = (step) => { if (step === "response") cleanup = true; };
  vi.spyOn(fs, "lstat").mockImplementation(async (name, ...args) => {
    if (cleanup && String(name).endsWith(`${PID}.json`) && ++checks === 2) {
      await fs.appendFile(filename(), "  ");
    }
    return original(name, ...args);
  });
  expect((await state()).status).toBe(200);
  expect(await fs.readdir(inbox())).toEqual([`${PID}.json`]);
  expect(await records()).toHaveLength(1);
});
it.each(["between scans", "during read"])("waits again when a Trash HTML companion appears %s", async (when) => {
  await submit(trashDetails()); await state();
  if (when === "between scans") await fs.writeFile(filename("html"), "Unexpected");
  else {
    const original = fs.open;
    let changed = false;
    vi.spyOn(fs, "open").mockImplementation(async (name, ...args) => {
      const handle = await original(name, ...args);
      if (!changed && String(name).endsWith(`${PID}.json`)) {
        changed = true; await fs.writeFile(filename("html"), "Unexpected");
      }
      return handle;
    });
  }
  await state();
  expect(await records()).toEqual([]);
  await ingest();
  expect(await records()).toEqual([expect.objectContaining({ status: "refused", reason: "trash-with-body" })]);
});
it.each(["edit", "new", "invalid-json", "unreadable", "too-large"])("keeps lone %s JSON waiting through stable reads until missing-body timeout", async (kind) => {
  if (kind === "edit") { await put(); await fs.unlink(filename("html")); }
  else await submit(newDetails());
  if (kind === "invalid-json") await fs.writeFile(filename(), "{broken");
  if (kind === "too-large") await fs.writeFile(filename(), " ".repeat(16 * 1024 + 1));
  if (kind === "unreadable") {
    const original = fs.open;
    vi.spyOn(fs, "open").mockImplementation(async (name, ...args) => {
      if (String(name).endsWith(`${PID}.json`)) throw Object.assign(new Error("Fixture"), { code: "EACCES" });
      return original(name, ...args);
    });
  }
  await ingest();
  expect(await records()).toEqual([]);
  expect(await fs.readdir(inbox())).toEqual([`${PID}.json`]);
  expect(f.context.inboxObservations.get(PID).firstSeen).toBe(Date.parse(AT));
  f.setTime(Date.parse(AT) + HALF_PAIR_TIMEOUT_MS); await state();
  expect(await records()).toEqual([]);
  f.setTime(Date.parse(AT) + HALF_PAIR_TIMEOUT_MS + 1); await state();
  expect((await records())[0]).toMatchObject({ status: "refused", reason: "missing-body" });
  expect(await fs.readdir(inbox())).toEqual([]);
});
it("a lone new JSON probe does not consume it before its body arrives", async () => {
  await submit(newDetails()); await ingest();
  await fs.writeFile(filename("html"), "New body");
  expect((await state()).body.proposals).toEqual([]);
  expect((await state()).body.proposals).toHaveLength(1);
  expect((await records())[0].body).toBe("New body");
});
it("supersedes edit to Trash to edit by note across different pids", async () => {
  await put(); await ingest();
  await submit(trashDetails(), undefined, "p-trash-note");
  expect((await ingest())[0].trash).toBe(true);
  await put({ title: "Edited instead" }, "p-edit-again");
  expect((await ingest())[0].title).toBe("Edited instead");
  expect((await records()).map((r) => [r.status, r.handledAt])).toEqual([
    ["superseded", AT], ["superseded", AT], ["pending", undefined],
  ]);
});
it("supersedes new notes only by pid, with no collision against an edit whose note id is that pid", async () => {
  expect((await f.request("POST", "/v1/push", await f.next([...f.context.store.published.notes, note({ id: PID })]))).status).toBe(200);
  await put({ note: PID }, "p-edit-collision"); await ingest();
  await submit(newDetails(), "First"); await ingest();
  await submit(newDetails({ title: "Revision" }), "Second");
  expect(await ingest()).toHaveLength(2);
  await put({ note: PID, title: "Edited" }, "p-edit-next");
  expect(await ingest()).toHaveLength(2);
  await submit(newDetails(), "Separate", "p-other-new");
  expect(await ingest()).toHaveLength(3);
  expect((await records()).map((r) => r.status)).toEqual(["superseded", "superseded", "pending", "pending", "pending"]);
});
it.each(["applied", "kept", "dismissed", "stale"])("refuses pid-used after a new note's %s outcome", async (outcome) => {
  await submit(newDetails(), "First"); const [record] = await ingest();
  expect((await f.request("POST", "/v1/outcomes", [{ proposal: PID, hash: record.hash, outcome, applied: [], at: AT }])).status).toBe(200);
  await submit(newDetails({ title: "Another version" }), "Second");
  expect(await ingest()).toEqual([]);
  expect((await records()).map((r) => [r.status, r.reason])).toEqual([[outcome, undefined], ["refused", "pid-used"]]);
});
it.each(["refused", "superseded", "handled-edit", "handled-trash"])("allows a new-note pid after %s", async (status) => {
  if (status === "handled-edit" || status === "handled-trash") {
    if (status === "handled-edit") await put();
    else await submit(trashDetails());
    const [record] = await ingest();
    await f.request("POST", "/v1/outcomes", [{ proposal: PID, hash: record.hash, outcome: "applied", at: AT }]);
  } else {
    await submit(newDetails(status === "refused" ? { generation: "old" } : {}), "First"); await ingest();
    if (status === "superseded") { await submit(newDetails({ title: "Second" }), "Second"); await ingest(); }
  }
  await submit(newDetails({ title: "Final revision" }), "Final");
  expect((await ingest())[0].title).toBe("Final revision");
  expect((await records()).at(-1).status).toBe("pending");
});
it("counts all three kinds at the pending limit and subtracts replacements of either identity", async () => {
  await put(); await ingest();
  await submit(trashDetails({ note: "other" }), undefined, "p-trash-other"); await ingest();
  for (let i = 0; i < 49; i++) await submit(newDetails(), "Fixture", `p-new-${String(i).padStart(3, "0")}`);
  expect(await ingest()).toHaveLength(50);
  expect((await records()).at(-1)).toMatchObject({ status: "refused", reason: "too-many" });
  await submit(newDetails({ title: "Replacement" }), "Replacement", "p-new-000");
  expect(await ingest()).toHaveLength(50);
  await submit(trashDetails(), undefined, "p-trash-replacement");
  expect(await ingest()).toHaveLength(50);
  expect((await records()).at(-1).status).toBe("pending");
});
