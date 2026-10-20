export const DEFAULT_SYNC_ADDRESS = "https://brent-dell-system-xps-l502x.tail1ce757.ts.net:8443";
export const TIMEOUTS = Object.freeze({ state: 20_000, push: 20_000, outcomes: 20_000, pair: 20_000, unpair: 20_000, upload: 60_000, backup: 180_000 });
export const QUIET_MS = 10_000;
export const MAX_WAIT_MS = 60_000;
export const BACKOFF_MS = Object.freeze([30_000, 120_000, 600_000]);
export const NETWORK_PERMISSION = "local-network-access";

export function normalizeAddress(address = DEFAULT_SYNC_ADDRESS) {
  try {
    const url = new URL(address);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw null;
    return url.href.replace(/\/+$/, "");
  } catch { throw new Error("Enter a valid HTTPS sync address."); }
}
