import { NETWORK_PERMISSION, TIMEOUTS, normalizeAddress } from "./config.js";

const failure = (kind, status, details) => ({
  ok: false, kind, ...(status === undefined ? {} : { status }), ...(details === undefined ? {} : { details }),
});
function httpFailure(status, body) {
  if (status === 401) return failure("unauthorized", status);
  if (status === 403 && ["no-pairing", "wrong-code"].includes(body?.error)) return failure("pairing", status, { reason: body.error });
  if (status === 409) {
    if (["changed", "update-service", "update-app"].includes(body?.error)) return failure(body.error, status);
    if (body?.error === "confirm" && typeof body.confirm === "string" && Array.isArray(body.removed) && Array.isArray(body.changed)) {
      const rows = (items) => items.filter((item) => typeof item?.id === "string" && typeof item.title === "string").map(({ id, title }) => ({ id, title }));
      return failure("confirm", status, { removed: rows(body.removed), changed: rows(body.changed), confirm: body.confirm });
    }
  }
  if (status === 503 && body?.error === "history-blocked") return failure("history-blocked", status);
  return failure(status >= 500 ? "server" : "invalid", status);
}

export function createSyncClient({ address, token, fetch = (...args) => globalThis.fetch(...args) }) {
  async function request(kind, method, path, body, roundSignal = new AbortController().signal) {
    let base;
    try { base = normalizeAddress(address); } catch { return failure("invalid"); }
    const signal = AbortSignal.any([roundSignal, AbortSignal.timeout(TIMEOUTS[kind])]);
    try {
      if (roundSignal.aborted) return failure("cancelled");
      const response = await fetch(`${base}${path}`, {
        method, signal, credentials: "omit", redirect: "error", cache: "no-store",
        headers: {
          ...(kind === "pair" ? {} : { Authorization: `Bearer ${token}` }),
          ...(body === undefined ? {} : { "Content-Type": kind === "upload" ? "application/octet-stream" : "application/json" }),
        },
        ...(body === undefined ? {} : { body: kind === "upload" ? body : JSON.stringify(body) }),
      });
      let value;
      try { value = await response.json(); }
      catch {
        if (signal.aborted) throw null;
        return response.ok ? failure("invalid", response.status) : httpFailure(response.status);
      }
      if (roundSignal.aborted) return failure("cancelled");
      if (signal.aborted) throw null;
      return response.ok ? { ok: true, body: value } : httpFailure(response.status, value);
    } catch {
      if (roundSignal.aborted) return failure("cancelled");
      let denied = false;
      try { denied = (await globalThis.navigator?.permissions?.query({ name: NETWORK_PERMISSION }))?.state === "denied"; } catch { /* Unknown permission is an ordinary reachability failure. */ }
      if (roundSignal.aborted) return failure("cancelled");
      return failure(denied ? "blocked" : "unreachable");
    }
  }
  return {
    pair: ({ code, label = "Notes phone" }, signal) => request("pair", "POST", "/v1/pair", { code, label }, signal),
    state: (signal) => request("state", "GET", "/v1/state", undefined, signal),
    upload: (id, bytes, generation, signal) => request("upload", "PUT", `/v1/files/${encodeURIComponent(id)}${generation == null ? "" : `?generation=${encodeURIComponent(generation)}`}`, bytes, signal),
    push: (body, signal) => request("push", "POST", "/v1/push", body, signal),
    outcomes: (body, signal) => request("outcomes", "POST", "/v1/outcomes", body, signal),
    backup: (signal) => request("backup", "GET", "/v1/backup", undefined, signal),
    unpair: (signal) => request("unpair", "DELETE", "/v1/pair", undefined, signal),
  };
}
