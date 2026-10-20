// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AT, PNG, file, fixture, note, push } from "./test-support.js";
import { keyFor, readJson, sha256, writeJson } from "./fsutil.mjs";
import { createConfirmations, pushHash } from "./guard.mjs";
import { ROUND_STEPS, OUTCOME_STEPS } from "./round.mjs";
import { uploadKey } from "./store.mjs";

let f;
beforeEach(async () => { f = await fixture(); });
afterEach(async () => { await f?.clean(); });
const send = (body) => f.request("POST", "/v1/push", body);

it("publishes the first push, returns counts, clears first-push and keeps full rows", async () => {
  const response = await send(push([note(), note({ id: "trash", deletedAt: AT })]));
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ round: 1, counts: { notes: 2, live: 1, trashed: 1, folders: 0, images: 0 },
    missingImages: [], lastRoundAt: AT, historyError: false });
  const state = await f.request("GET", "/v1/state");
  expect(state.body).toMatchObject({ round: 1, generation: "generation-A", notes: { "note-1": 1, trash: 1 }, proposals: [] });
  expect((await f.context.pairing.device()).firstPushPending).toBe(false);
  expect(await readJson(f.context.store.file(`notes/${keyFor("note-1")}.json`))).toEqual(note());
  expect(await f.context.store.readJournal()).toBeNull();
  expect(f.git.commit).toHaveBeenCalledWith("round 1: 2 notes written, 0 removed");
});
it("accepts rows only for differing rev and refuses missing or mismatching omitted rows", async () => {
  await send(push([note(), note({ id: "other" })]));
  const body = await f.next([note({ rev: 2, title: "Changed" })], { ids: [{ id: "note-1", rev: 2 }, { id: "other", rev: 1 }] });
  expect((await send(body)).status).toBe(200);
  const s = await f.request("GET", "/v1/state");
  expect(s.body.notes).toEqual({ "note-1": 2, other: 1 });
  for (const ids of [[{ id: "missing", rev: 1 }], [{ id: "note-1", rev: 99 }]]) {
    expect((await send(await f.next([], { ids }))).body.error).toBe("changed");
  }
});
it.each(["generation", "pairing"])("requires all rows after %s changes", async (kind) => {
  await send(push());
  if (kind === "pairing") await f.pair();
  const body = await f.next([], { ids: [{ id: "note-1", rev: 1 }],
    ...(kind === "generation" ? { generation: "generation-B" } : {}) });
  expect((await send(body)).body.error).toBe("changed");
  body.rows = [note()];
  expect((await send(body)).status).toBe(200); // Identical content passes, even a different rev.
});
it.each([1, 2, 100])("asks before replacing across generations even at rev %i", async (rev) => {
  await send(push());
  const body = await f.next([note({ rev, title: "Imported replacement" })], { generation: "generation-B" });
  const response = await send(body);
  expect(response.status).toBe(409);
  expect(response.body).toMatchObject({ error: "confirm", changed: [{ id: "note-1", title: "Fixture title" }], removed: [] });
  expect((await send({ ...body, confirm: response.body.confirm })).status).toBe(200);
});
it.each(["title", "html", "folderId", "tags", "pinned", "deletedAt", "createdAt", "updatedAt"])("compares %s across a new pairing", async (field) => {
  await send(push());
  await f.pair();
  const values = { title: "Other", html: "<p>Other</p>", folderId: "folder", tags: ["tag"], pinned: true,
    deletedAt: AT, createdAt: "2026-10-18T12:00:00.000Z", updatedAt: "2026-10-20T12:00:00.000Z" };
  const body = await f.next([note({ [field]: values[field] })], {
    folders: field === "folderId" ? [{ id: "folder", name: "Folder", position: 0 }] : [],
  });
  expect((await send(body)).body.changed).toEqual([{ id: "note-1", title: "Fixture title" }]);
});
it("ignores derived text/links and rev when cross-generation content is identical; accepts new rows", async () => {
  await send(push());
  const body = await f.next([note({ rev: 99, text: "New projection", linkedIds: ["new"] }), note({ id: "new" })],
    { generation: "generation-B" });
  expect((await send(body)).status).toBe(200);
});
it("requires confirmation for imported tombstones but accepts same-generation tombstones", async () => {
  await send(push([note(), note({ id: "another" })]));
  const body = await f.next([], { generation: "generation-B", tombstones: [{ id: "note-1", purgedAt: AT }] });
  const response = await send(body);
  expect(response.body.removed).toHaveLength(2);
  const same = await f.next([note({ id: "another" })], { tombstones: [{ id: "note-1", purgedAt: AT }] });
  expect((await send(same)).status).toBe(200);
  expect((await f.request("GET", "/v1/state")).body.notes).toEqual({ another: 1 });
});
it("asks on same-generation unaccounted removals and older revs", async () => {
  await send(push([note({ rev: 2 }), note({ id: "removed" })]));
  const response = await send(await f.next([note()]));
  expect(response.body).toMatchObject({ error: "confirm", removed: [{ id: "removed", title: "Fixture title" }],
    changed: [{ id: "note-1", title: "Fixture title" }] });
});
it("binds confirmations to the entire canonical push including base", async () => {
  await send(push());
  const body = await f.next([], { generation: "generation-B" });
  const first = await send(body);
  const changed = { ...body, notebookMd: "Different", confirm: first.body.confirm };
  const second = await send(changed);
  expect(second.body.error).toBe("confirm");
  expect(second.body.confirm).not.toBe(first.body.confirm);
  expect((await send({ ...changed, confirm: second.body.confirm })).status).toBe(200);
  expect((await send({ ...changed, confirm: second.body.confirm })).body.error).toBe("changed");
  expect(pushHash({ ...body, confirm: "not-hashed" })).toBe(pushHash(body));
  expect(pushHash({ ...body, base: { round: 999, generation: null } })).not.toBe(pushHash(body));
});
it("confirmation is single use, expires and ignores object key order", () => {
  let time = 0;
  const confirmations = createConfirmations(() => time);
  const p = push(), confirm = confirmations.issue(p);
  expect(confirmations.consume({ ...p, confirm })).toBe(true);
  expect(confirmations.consume({ ...p, confirm })).toBe(false);
  const expired = confirmations.issue(p);
  time = 30 * 60 * 1000;
  expect(confirmations.consume({ ...p, confirm: expired })).toBe(false);
  const reordered = Object.fromEntries(Object.entries(p).reverse());
  expect(pushHash(reordered)).toBe(pushHash(p));
});
it("keeps matching image bindings only within a generation, storing different bytes for the same id", async () => {
  const n = note({ html: '<img data-file="image-1">' });
  expect((await f.request("PUT", "/v1/files/image-1?generation=generation-A", PNG)).status).toBe(200);
  await send(push([n], { files: [file()] }));
  const a = f.context.store.published.files["image-1"].sha256;
  expect(a).toBe(sha256(PNG));
  expect(await readJson(f.context.store.uploadsPath)).toEqual({});
  expect((await send(await f.next([], { ids: [{ id: n.id, rev: 1 }], files: [file()] }))).body.missingImages).toEqual([]);
  const changedBytes = Buffer.from(PNG); changedBytes[11] = 99;
  await f.request("PUT", "/v1/files/image-1?generation=generation-B", changedBytes);
  const body = await f.next([n], { generation: "generation-B", files: [file()] });
  const response = await send(body);
  expect(response.body.changed).toHaveLength(1); // Same HTML and rev; image hash changed.
  expect((await send({ ...body, confirm: response.body.confirm })).status).toBe(200);
  expect(f.context.store.published.files["image-1"].sha256).toBe(sha256(changedBytes));
  expect(await f.context.store.readObject(a)).toEqual(PNG); // Old objects never deleted.
  expect((await fs.readdir(f.context.store.objects)).sort()).toEqual([a, sha256(changedBytes)].sort());
});
it("does not reuse an old-generation image without re-upload, and reports missing references", async () => {
  const n = note({ html: '<img data-file="image-1"><img data-file="missing">' });
  await f.request("PUT", "/v1/files/image-1?generation=generation-A", PNG);
  expect((await send(push([n], { files: [file()] }))).body.missingImages).toEqual(["missing"]);
  const body = await f.next([n], { generation: "generation-B", files: [file()] });
  const ask = await send(body);
  expect(ask.body.error).toBe("confirm"); // Losing image bytes is itself a content change.
  const response = await send({ ...body, confirm: ask.body.confirm });
  expect(response.body.missingImages).toEqual(["image-1", "missing"]);
  expect((await f.request("GET", "/v1/state")).body.files).toEqual([]);
});
it("accepts identical bytes re-uploaded for a new generation, with one stored object", async () => {
  const n = note({ html: '<img data-file="image-1">' });
  await f.request("PUT", "/v1/files/image-1?generation=generation-A", PNG);
  await send(push([n], { files: [file()] }));
  await f.request("PUT", "/v1/files/image-1?generation=generation-B", PNG);
  const response = await send(await f.next([n], { generation: "generation-B", files: [file()] }));
  expect(response.status).toBe(200);
  expect(response.body.missingImages).toEqual([]);
  expect(await fs.readdir(f.context.store.objects)).toEqual([sha256(PNG)]);
});
it("does not bind uploads whose size/type differs; ignores unused file metadata", async () => {
  await f.request("PUT", "/v1/files/image-1?generation=generation-A", PNG);
  const n = note({ html: '<img data-file="image-1">' });
  expect((await send(push([n], { files: [file({ type: "image/jpeg" }), file({ id: "unused" })] }))).body.missingImages).toEqual(["image-1"]);
});
it("null and empty-string generations are distinct, and uploads are idempotent and expire", async () => {
  await f.request("PUT", "/v1/files/i", PNG);
  await f.request("PUT", "/v1/files/i", PNG);
  await f.request("PUT", "/v1/files/i?generation=", PNG);
  expect(Object.keys(await readJson(f.context.store.uploadsPath)).sort()).toEqual([uploadKey(null, "i"), uploadKey("", "i")].sort());
  expect(await fs.readdir(f.context.store.objects)).toHaveLength(1);
  f.setTime("2026-11-19T12:00:00.000Z");
  await f.request("PUT", "/v1/files/fresh", PNG);
  expect(Object.keys(await readJson(f.context.store.uploadsPath))).toEqual([uploadKey(null, "fresh")]);
});
it("deletes folders when rows move out and refuses dangling folders on unchanged rows", async () => {
  await send(push([note({ folderId: "f" })], { folders: [{ id: "f", name: "Fixture", position: 0 }] }));
  const invalid = await f.next([], { ids: [{ id: "note-1", rev: 1 }] });
  expect((await send(invalid)).body.error).toBe("invalid-note");
  expect((await send(await f.next([note({ rev: 2 })]))).status).toBe(200);
  expect(await readJson(f.context.store.file("folders.json"))).toEqual([]);
});
it("serialises two pushes on the same base", async () => {
  const responses = await Promise.all([send(push()), send(push())]);
  expect(responses.map((r) => r.status)).toEqual([200, 409]);
  expect(responses[1].body.error).toBe("changed");
});
it("refuses newer and older schemas without changing the store", async () => {
  expect((await send(push([note()], { schemaVersion: 5 }))).body.error).toBe("update-service");
  await send(push());
  expect((await send(await f.next([note()], { schemaVersion: 3 }))).body.error).toBe("update-app");
  expect((await f.request("GET", "/v1/state")).body.round).toBe(1);
});

for (const restart of [false, true]) {
  it.each(ROUND_STEPS)(`recovers after %s (fresh handler: ${restart}) exactly once`, async (step) => {
    let interrupted = false;
    f.context.afterStep = async (name) => {
      if (!interrupted && name === step) { interrupted = true; throw new Error("simulated-crash"); }
    };
    expect((await send(push())).status).toBe(503);
    if (restart) await f.restart();
    const state = await f.request("GET", "/v1/state");
    expect(state.status).toBe(200);
    expect(state.body.round).toBe(1);
    expect(state.body.notes).toEqual({ "note-1": 1 });
    expect((await send(push())).body.error).toBe("changed");
    expect(f.git.commit).toHaveBeenCalledTimes(1);
    expect(await f.context.store.readJournal()).toBeNull();
    expect(await fs.readdir(f.context.store.backups)).toHaveLength(1);
  });
}
it.each(ROUND_STEPS)("recovers after an actual child-process exit at %s, without a socket", async (step) => {
  const program = `
    import { createContext } from ${JSON.stringify(new URL("./handler.mjs", import.meta.url).href)};
    import { pushRound } from ${JSON.stringify(new URL("./round.mjs", import.meta.url).href)};
    const [config, push, step] = process.argv.slice(1);
    const context = await createContext(JSON.parse(config), {
      git: { commit: async () => {} },
      now: () => new Date(${JSON.stringify(AT)}),
      afterStep: (name) => { if (name === step) process.exit(86); },
    });
    await context.enqueue(() => pushRound(context, JSON.parse(push)));
  `;
  await expect(promisify(execFile)(process.execPath, ["--input-type=module", "-e", program,
    JSON.stringify(f.config), JSON.stringify(push()), step])).rejects.toHaveProperty("code", 86);
  await f.restart();
  const state = await f.request("GET", "/v1/state");
  expect(state.body).toMatchObject({ round: 1, notes: { "note-1": 1 }, historyError: false });
  expect(await f.context.store.readJournal()).toBeNull();
  expect((await send(push())).body.error).toBe("changed");
});
it("replays a partially written apply from its full journal snapshot", async () => {
  await send(push([note(), note({ id: "other" })]));
  const apply = f.context.store.apply.bind(f.context.store);
  f.context.store.apply = vi.fn(async () => {
    await writeJson(f.context.store.file(`notes/${keyFor("note-1")}.json`), note({ rev: 2 }));
    throw new Error("disk-full");
  });
  expect((await send(await f.next([note({ rev: 2 })], { tombstones: [{ id: "other", purgedAt: AT }] }))).status).toBe(503);
  const state = await f.request("GET", "/v1/state");
  expect(state.body.round).toBe(1);
  expect(state.body.notes).toEqual({ "note-1": 1, other: 1 });
  const backup = await f.request("GET", "/v1/backup");
  expect(JSON.parse(backup.body).notes.map((n) => n.rev)).toEqual([1, 1]);
  f.context.store.apply = apply;
  await f.restart();
  const recovered = await f.request("GET", "/v1/state");
  expect(recovered.body.round).toBe(2);
  expect(recovered.body.notes).toEqual({ "note-1": 2 });
});
it("does not reapply rows if publication succeeded before the journal checkpoint", async () => {
  const write = f.context.store.writeJournal.bind(f.context.store);
  let failed = false;
  f.context.store.writeJournal = async (j) => {
    if (j.step === "publish" && !failed) { failed = true; throw new Error("crash"); }
    return write(j);
  };
  expect((await send(push())).status).toBe(503);
  const fresh = await f.restart();
  const apply = vi.spyOn(fresh.store, "apply");
  expect((await f.request("GET", "/v1/state")).body.round).toBe(1);
  expect(apply).not.toHaveBeenCalled();
  expect(f.git.commit).toHaveBeenCalledTimes(1);
});
it("keeps reads on a complete round during an in-flight push", async () => {
  let release, reached;
  const ready = new Promise((resolve) => { reached = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  f.context.afterStep = async (step) => { if (step === "apply") { reached(); await gate; } };
  const writing = send(push());
  await ready;
  expect(f.context.store.state().round).toBe(0);
  let readFinished = false;
  const reading = f.request("GET", "/v1/state").then((r) => { readFinished = true; return r; });
  await Promise.resolve();
  expect(readFinished).toBe(false);
  release();
  expect((await writing).status).toBe(200);
  expect((await reading).body.round).toBe(1);
});
it("publishes a failed history commit, blocks round two and outcomes until a successful retry", async () => {
  f.git.commit.mockRejectedValue(new Error("git-failed-sensitive"));
  const first = await send(push());
  expect(first.body).toMatchObject({ round: 1, historyError: true });
  const second = push([note({ rev: 2, title: "Second accepted version" })], { base: { round: 1, generation: "generation-A" } });
  const blocked = await send(second);
  expect(blocked.body.error).toBe("history-blocked");
  // The body is read before the queue (where history is checked); nothing is stored.
  expect(f.context.store.published.meta.round).toBe(1);
  expect((await f.request("POST", "/v1/outcomes", [])).body.error).toBe("history-blocked");
  const state = await f.request("GET", "/v1/state");
  expect(state.body).toMatchObject({ round: 1, historyError: true });
  const backup = await f.request("GET", "/v1/backup");
  expect(JSON.parse(backup.body).notes[0].title).toBe("Fixture title");
  await f.restart();
  expect((await send(second)).body.error).toBe("history-blocked");
  f.git.commit.mockResolvedValue();
  expect((await send(second)).body).toMatchObject({ round: 2, historyError: false });
  expect(f.git.commit.mock.calls.at(-2)[0]).toBe("round 1: history retry");
  expect(f.git.commit.mock.calls.at(-1)[0]).toBe("round 2: 1 notes written, 0 removed");
});
it("outcomes are journalled and idempotent by proposal/hash, with unknown versions acknowledged", async () => {
  const hash = "a".repeat(64), filename = `proposal-1-${hash}.json`;
  await writeJson(f.context.store.file(`proposals/${filename}`), { id: "proposal-1", hash, status: "pending", content: "Fixture proposal" });
  const item = { proposal: "proposal-1", hash, outcome: "applied", applied: ["title"], at: AT };
  const unknown = { ...item, hash: "b".repeat(64) };
  const response = await f.request("POST", "/v1/outcomes", [item, item, unknown]);
  expect(response.body.recorded).toEqual([item, unknown].map(({ proposal, hash }) => ({ proposal, hash })));
  expect((await readJson(f.context.store.file(`proposals/${filename}`))).status).toBe("applied");
  await f.request("POST", "/v1/outcomes", [{ ...item, outcome: "dismissed" }]);
  expect((await readJson(f.context.store.file(`proposals/${filename}`))).outcome).toEqual({ outcome: "applied", applied: ["title"], at: AT });
  expect(f.git.commit).toHaveBeenCalledTimes(1);
  expect(await f.context.store.readJournal()).toBeNull();
});
it.each(OUTCOME_STEPS)("recovers outcomes interrupted after %s", async (step) => {
  const hash = "a".repeat(64), filename = `p-${hash}.json`;
  await writeJson(f.context.store.file(`proposals/${filename}`), { status: "pending" });
  f.context.afterStep = (name) => { if (name === step) throw new Error("crash"); };
  const item = { proposal: "p", hash, outcome: "dismissed", at: AT };
  expect((await f.request("POST", "/v1/outcomes", [item])).status).toBe(503);
  await f.restart();
  expect((await f.request("GET", "/v1/state")).status).toBe(200);
  expect((await f.request("POST", "/v1/outcomes", [item])).body.recorded).toEqual([{ proposal: "p", hash }]);
  expect((await readJson(f.context.store.file(`proposals/${filename}`))).status).toBe("dismissed");
  expect(f.git.commit).toHaveBeenCalledTimes(1);
});

it("checks versions before the guard, so a refused push never uses up a confirmation", async () => {
  await send(push());
  const changed = await f.next([note({ rev: 2, title: "Changed elsewhere" })], { generation: "generation-B" });
  const asked = await send(changed);
  expect(asked.body.error).toBe("confirm");
  const newer = await send({ ...changed, schemaVersion: 5, confirm: asked.body.confirm });
  expect(newer.body.error).toBe("update-service");
  // The confirmation is still unused, but it was bound to the original push, which still works.
  expect((await send({ ...changed, confirm: asked.body.confirm })).status).toBe(200);
});
