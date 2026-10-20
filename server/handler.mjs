import { MAX_IMAGE_BYTES, MAX_JSON_BYTES, isSafeId } from "./constants.mjs";
import { openStore } from "./store.mjs";
import { createQueue } from "./queue.mjs";
import { createConfirmations } from "./guard.mjs";
import { createPairing } from "./pairing.mjs";
import { buildBackup } from "./backup.mjs";
import { pushRound, recordOutcomes, resolveJournal, retryHistory } from "./round.mjs";
import { HttpError, detectImage, fail } from "./validate.mjs";
import { rebuildView } from "./view.mjs";
import { scanInbox, enqueueInboxScan } from "./inbox.mjs";
import { loadViewTemplates } from "./templates.mjs";
import { proposalKind } from "./proposals.mjs";

const METHODS = ["GET", "POST", "PUT", "DELETE"];
const ALLOWED_HEADERS = ["authorization", "content-type"];
export async function createContext(config, overrides = {}) {
  const now = overrides.now ?? (() => new Date());
  return {
    config, now, store: overrides.store ?? await openStore(config.storeDir, { git: overrides.git }),
    pairing: createPairing(config.configDir, now), enqueue: createQueue(), confirmations: createConfirmations(now),
    rebuildView: async () => rebuildView({ ...config, templates: await loadViewTemplates(config), now: now() }),
    scanInbox,
    logger: () => {}, ...overrides,
  };
}
function routeFor(method, pathname) {
  return ({
    "POST /v1/pair": "pair", "DELETE /v1/pair": "unpair", "GET /v1/state": "state",
    "POST /v1/push": "push", "POST /v1/outcomes": "outcomes", "GET /v1/backup": "backup",
  })[`${method} ${pathname}`] ?? (method === "PUT" && pathname.startsWith("/v1/files/") ? "upload" : null);
}
export function createHandler(context) {
  return async function handle({ method, path: requestPath, headers = {}, readBody }) {
    const started = performance.now();
    const pathname = typeof requestPath === "string" ? requestPath.split("?")[0] : "";
    const h = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    let bytesIn = 0, response;
    const responseHeaders = { "Cache-Control": "no-store" };
    const reply = (body, status = 200, extra = {}) => ({ status, headers: { ...responseHeaders, ...extra }, body });
    try {
      if (h.origin !== context.config.origin) fail(403, "origin");
      responseHeaders["Access-Control-Allow-Origin"] = context.config.origin;
      responseHeaders.Vary = "Origin";
      if (!context.config.hosts.includes(h.host)) fail(403, "host");
      if (method === "OPTIONS") {
        const requested = h["access-control-request-headers"];
        const names = requested === undefined || requested === "" ? [] :
          typeof requested === "string" ? requested.split(",").map((name) => name.trim().toLowerCase()) : [null];
        if (!METHODS.includes(h["access-control-request-method"]) || names.some((name) => !ALLOWED_HEADERS.includes(name))) fail(403, "preflight");
        // A preflight reads nothing and changes nothing, so it never waits for the queue.
        response = reply(null, 204, {
          "Access-Control-Allow-Methods": METHODS.join(", "),
          "Access-Control-Allow-Headers": ALLOWED_HEADERS.join(", "),
          "Access-Control-Max-Age": "600",
          ...(h["access-control-request-private-network"] === "true" ? { "Access-Control-Allow-Private-Network": "true" } : {}),
        });
      } else {
        const route = routeFor(method, pathname);
        if (route !== "pair" && !await context.pairing.checkToken(h.authorization)) fail(401, "unauthorized");
        if (!route) fail(404, "not-found");
        const hasBody = ["pair", "push", "outcomes", "upload"].includes(route);
        if (hasBody || (h["content-length"] !== undefined && h["content-length"] !== "0") || h["transfer-encoding"]) {
          const contentType = typeof h["content-type"] === "string" ? h["content-type"].split(";")[0].trim().toLowerCase() : "";
          if (contentType !== (route === "upload" ? "application/octet-stream" : "application/json")) fail(415, "content-type");
        }
        let id, generation;
        if (route === "upload") {
          try { id = decodeURIComponent(pathname.slice("/v1/files/".length)); }
          catch { fail(400, "invalid-id"); }
          if (!isSafeId(id)) fail(400, "invalid-id");
          const query = new URLSearchParams(requestPath.includes("?") ? requestPath.slice(requestPath.indexOf("?") + 1) : "");
          if (query.getAll("generation").length > 1) fail(400, "invalid-generation");
          generation = query.get("generation");
        }
        // The body is read after every check that needs no body and before the queue, so a slow
        // or stalled upload from a phone that froze mid-request never holds up other requests.
        let body;
        if (hasBody) {
          const limit = route === "upload" ? MAX_IMAGE_BYTES : MAX_JSON_BYTES;
          const length = h["content-length"];
          if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > limit)) fail(413, "too-large");
          const raw = await readBody(limit);
          const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          bytesIn = bytes.length;
          if (bytes.length > limit) fail(413, "too-large");
          if (route === "upload") body = bytes;
          else {
            try {
              body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes), (_key, value) => {
                if (typeof value === "number" && !Number.isFinite(value)) throw new Error("non-finite-json");
                return value;
              });
            }
            catch { fail(400, "invalid-json"); }
          }
        }
        const enqueue = route === "state" ? (task) => enqueueInboxScan(context, task) : context.enqueue;
        response = await enqueue(async () => {
          // Pairing may have changed while the body arrived; the queue is where it's decided.
          if (route !== "pair" && !await context.pairing.checkToken(h.authorization)) fail(401, "unauthorized");
          try { await resolveJournal(context); }
          catch {
            if (!["state", "backup"].includes(route)) fail(503, "storage-problem");
            // Cached reads remain valid even if an unrelated view/backup step cannot finish.
            return route === "state" ? reply(await stateBody([])) : reply(await backupBody(), 200, backupHeaders);
          }
          await retryHistory(context);
          if (context.store.published.meta.historyError && ["push", "outcomes"].includes(route)) fail(503, "history-blocked");
          switch (route) {
            case "pair": return reply(await context.pairing.pair(body));
            case "unpair": await context.pairing.unpair(); return reply({ disconnected: true });
            case "state": {
              const proposals = context.store.published.meta.historyError ? [] : await context.scanInbox(context);
              return reply(await stateBody(proposals));
            }
            case "backup": return reply(await backupBody(), 200, backupHeaders);
            case "upload": {
              const type = detectImage(body);
              if (!type || !body.length) fail(400, "invalid-image");
              return reply(await context.store.recordUpload(generation, id, body, type, context.now()));
            }
            case "push": return reply(await pushRound(context, body));
            case "outcomes": return reply(await recordOutcomes(context, body));
          }
        });
      }
    } catch (error) {
      if (Number.isSafeInteger(error?.bytesIn)) bytesIn = error.bytesIn;
      if (!(error instanceof HttpError)) {
        // Unexpected failures are logged by kind only: messages can quote paths or data.
        const internal = typeof error?.message === "string" && /^[a-z0-9-]{1,40}$/.test(error.message) ? error.message : null;
        try { context.logger(JSON.stringify({ event: "error", method, path: pathname, name: typeof error?.name === "string" ? error.name : null,
          code: typeof error?.code === "string" ? error.code : null, internal })); } catch { /* Logging is best effort. */ }
      }
      response = error instanceof HttpError ? reply(error.body, error.status) : reply({ error: "storage-problem" }, 503);
    }
    const bytesOut = response.body == null ? 0 : Buffer.isBuffer(response.body) ? response.body.length : Buffer.byteLength(JSON.stringify(response.body));
    try { context.logger(JSON.stringify({ method, path: pathname, status: response.status,
      ms: Math.max(0, Math.round(performance.now() - started)), bytesIn, bytesOut })); } catch { /* Logging cannot undo a round. */ }
    return response;

    async function backupBody() { return Buffer.from(JSON.stringify(await buildBackup(context.store, context.now()))); }
    // fullPush tells a newly paired phone to send every row (the XPS compares content then).
    async function stateBody(proposals) {
      const device = await context.pairing.device();
      const query = new URLSearchParams(typeof requestPath === "string" && requestPath.includes("?") ?
        requestPath.slice(requestPath.indexOf("?") + 1) : "");
      if (query.get("proposals") !== "2") proposals = proposals.filter((p) => proposalKind(p) === "edit" && !Object.hasOwn(p, "newFolder"));
      return { ...context.store.state(), fullPush: Boolean(device?.firstPushPending), proposals };
    }
  };
}
const backupHeaders = { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="notes-backup.json"' };
