import { randomBytes } from "node:crypto";
import { CONFIRM_WINDOW_MS, extractFileIds } from "./constants.mjs";
import { sha256, stableStringify } from "./fsutil.mjs";

const CONTENT_FIELDS = ["title", "html", "folderId", "tags", "pinned", "deletedAt", "createdAt", "updatedAt"];
export function guard(previous, push, nextFiles, firstPushPending = false) {
  const removed = [], changed = [];
  const ids = new Map(push.ids.map((n) => [n.id, n.rev]));
  const rows = new Map(push.rows.map((n) => [n.id, n]));
  const tombstones = new Set(push.tombstones.map((n) => n.id));
  const across = firstPushPending || previous.meta.generation !== push.generation;
  for (const old of previous.notes) {
    const summary = { id: old.id, title: old.title };
    if (!ids.has(old.id)) {
      if (across || !tombstones.has(old.id)) removed.push(summary);
      continue;
    }
    if (!across) {
      if (ids.get(old.id) < old.rev) changed.push(summary);
    } else {
      const next = rows.get(old.id);
      if (!next || CONTENT_FIELDS.some((key) => stableStringify(old[key]) !== stableStringify(next[key])) ||
          extractFileIds(old.html).some((id) => (previous.files[id]?.sha256 ?? null) !== (nextFiles[id]?.sha256 ?? null))) {
        changed.push(summary);
      }
    }
  }
  return { removed, changed };
}
export function pushHash(push) {
  const { confirm: _confirm, ...body } = push;
  return sha256(stableStringify(body));
}
export function createConfirmations(now = () => new Date()) {
  const tokens = new Map();
  const prune = () => {
    for (const [token, entry] of tokens) if (entry.expires <= new Date(now()).getTime()) tokens.delete(token);
  };
  return {
    issue(push) {
      prune();
      const hash = pushHash(push);
      // Repeated questions for one capture do not grow the token store.
      for (const [token, entry] of tokens) if (entry.hash === hash) tokens.delete(token);
      const token = randomBytes(32).toString("base64url");
      tokens.set(token, { hash, expires: new Date(now()).getTime() + CONFIRM_WINDOW_MS });
      return token;
    },
    consume(push) {
      prune();
      const entry = tokens.get(push.confirm);
      if (!entry || entry.hash !== pushHash(push)) return false;
      tokens.delete(push.confirm);
      return true;
    },
  };
}
