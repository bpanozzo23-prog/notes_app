const sentences = Object.freeze({
  unreachable: "Couldn't reach the XPS. Check that Tailscale is on. Trying again shortly.",
  blocked: "Chrome is blocking this site from reaching the XPS. Allow Local network access for this site in Chrome's site settings.",
  unauthorized: "The XPS no longer recognises this phone. Connect again with a new code.",
  pairing: "That code didn't work. Run notes-sync pair on the XPS for a new one.",
  "update-service": "Update the XPS service.",
  "update-app": "Update this app.",
  "history-blocked": "The XPS couldn't record history, so syncing is paused. Your notes are safe on this phone.",
  server: "The XPS had a problem. Trying again shortly.",
});
export const syncStatusMessage = (kind) => !kind || kind === "cancelled" ? "" : sentences[kind] ?? sentences.server;

export function lastSyncedLabel(iso, now = Date.now()) {
  const elapsed = now - Date.parse(iso);
  if (!iso || !Number.isFinite(elapsed)) return "Connected · not synced yet";
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes === 0) return "Connected · last synced just now";
  const amount = minutes < 60 ? minutes : minutes < 1440 ? Math.floor(minutes / 60) : Math.floor(minutes / 1440);
  const unit = minutes < 60 ? "minute" : minutes < 1440 ? "hour" : "day";
  return `Connected · last synced ${amount} ${unit}${amount === 1 ? "" : "s"} ago`;
}
