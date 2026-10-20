import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { initStore } from "./store.mjs";
import { createContext, createHandler } from "./handler.mjs";
import { mkdir } from "./fsutil.mjs";

export const AT = "2026-10-19T12:00:00.000Z";
export const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
export const note = (extra = {}) => ({ id: "note-1", title: "Fixture title", html: "<p>Fixture</p>",
  text: "Fixture", linkedIds: [], tags: [], folderId: null, pinned: false, rev: 1,
  createdAt: AT, updatedAt: AT, deletedAt: null, ...extra });
export const file = (extra = {}) => ({ id: "image-1", type: "image/png", size: PNG.length,
  width: 12, height: 8, createdAt: AT, ...extra });
export function push(rows = [note()], extra = {}) {
  return { base: { round: 0, generation: null }, generation: "generation-A", schemaVersion: 4,
    appVersion: "0.3.11", ids: rows.map(({ id, rev }) => ({ id, rev })), rows, folders: [],
    tombstones: [], preferences: {}, files: [], notebookMd: "# Fixture\n", ...extra };
}
export async function fixture(extra = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "notes-sync-test-"));
  const config = { origin: "https://fixture.invalid", hosts: ["fixture.invalid:8443"], listen: "127.0.0.1",
    port: 8790, storeDir: path.join(root, "private"), configDir: path.join(root, "config"), viewDir: path.join(root, "view") };
  await mkdir(config.configDir);
  let time = new Date(AT);
  const now = () => time;
  const git = { init: vi.fn(async () => {}), commit: vi.fn(async () => {}), hasRemote: vi.fn(async () => false) };
  const store = await initStore(config.storeDir, { git });
  const logger = vi.fn();
  const context = await createContext(config, { store, git, now, logger, ...extra });
  let handle = createHandler(context), token;
  async function request(method, url, body, headers = {}) {
    const readBody = vi.fn(async () => Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body ?? {})));
    const response = await handle({ method, path: url, headers: {
      origin: config.origin, host: config.hosts[0], authorization: `Bearer ${token}`,
      "content-type": method === "PUT" ? "application/octet-stream" : "application/json", ...headers,
    }, readBody });
    return { ...response, readBody };
  }
  async function pair() {
    const window = await context.pairing.openWindow();
    const response = await request("POST", "/v1/pair", { code: window.code, label: "Fixture phone" });
    if (response.status !== 200) throw new Error("fixture-pair-failed");
    token = response.body.token;
    return token;
  }
  await pair();
  return { root, config, context, git, logger, request, pair,
    setTime(value) { time = new Date(value); },
    get token() { return token; },
    async restart(overrides = {}) {
      const fresh = await createContext(config, { git, now, logger, ...overrides });
      handle = createHandler(fresh);
      return fresh;
    },
    async next(rows, extra = {}) {
      const state = await request("GET", "/v1/state");
      return push(rows, { base: { round: state.body.round, generation: state.body.generation }, ...extra });
    },
    async clean() { await fs.rm(root, { recursive: true, force: true }); },
  };
}
