import { expect, it } from "vitest";
import { DEFAULT_SYNC_ADDRESS, normalizeAddress } from "./config.js";
import { guardTailnet } from "../../scripts/tailnet-guard.mjs";

it.each(["http://127.0.0.1:8790", "http://localhost:8790", DEFAULT_SYNC_ADDRESS])("accepts local checks or HTTPS: %s", (address) => {
  expect(normalizeAddress(`${address}/`)).toBe(address);
});
it.each(["http://127.0.0.1.evil.test", "http://localhost.evil.test", "http://10.0.0.1:8443",
  "http://localhost@evil.test:8790", "http://127.0.0.2:8790", "http://localhost:8790/?token=secret"])("refuses %s", (address) => {
  expect(() => normalizeAddress(address)).toThrow();
});
it("the browser guard aborts and records tailnet requests, including ports, without recording secrets", async () => {
  let pattern, handler, aborted = 0;
  const check = await guardTailnet({ route: async (match, callback) => { pattern = match; handler = callback; } });
  expect(check).not.toThrow();
  for (const url of [DEFAULT_SYNC_ADDRESS + "/v1/state", "https://fixture.ts.net/v1/pair", "https://fixture.ts.net.:8443/v1/backup?secret=SENTINEL"]) {
    expect(pattern.test(url)).toBe(true);
    await handler({ request: () => ({ method: () => "GET", url: () => url }), abort: async () => { aborted++; } });
  }
  expect(aborted).toBe(3);
  expect(() => check()).toThrow("Unexpected request to Tailscale");
  try { check(); } catch (error) { expect(error.message).not.toContain("SENTINEL"); }
  for (const url of ["https://fixture.ts.net.evil.test/v1/state", "http://localhost:8790/v1/state"]) expect(pattern.test(url)).toBe(false);
});
