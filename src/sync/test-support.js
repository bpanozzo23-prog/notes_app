import { createHandler } from "../../server/handler.mjs";
import { fixture } from "../../server/test-support.js";
import { createSyncClient } from "./client.js";

// No socket or global fetch: exercise exactly the deployed handler's request boundary.
export async function syncFixture(overrides) {
  const server = await fixture(overrides);
  const handle = createHandler(server.context);
  const requests = [];
  let before = async () => {}, after = async () => {};
  const fetch = async (input, options) => {
    const request = new Request(input, options), url = new URL(request.url);
    request.signal.throwIfAborted();
    const bytes = Buffer.from(await request.arrayBuffer());
    const captured = { method: request.method, path: url.pathname + url.search,
      headers: Object.fromEntries(request.headers), body: request.method === "PUT" ? bytes : bytes.length ? JSON.parse(bytes.toString()) : undefined,
      signal: options.signal };
    requests.push(captured);
    const replacement = await before(captured);
    const response = replacement ?? await handle({
      method: request.method, path: captured.path,
      headers: { ...captured.headers, host: server.config.hosts[0], origin: server.config.origin },
      readBody: async (limit) => { if (bytes.length > limit) throw new Error("fixture-too-large"); return bytes; },
    });
    await after(captured, response);
    request.signal.throwIfAborted();
    return new Response(Buffer.isBuffer(response.body) ? response.body : JSON.stringify(response.body), { status: response.status, headers: response.headers });
  };
  return {
    ...server, requests, fetch, address: `https://${server.config.hosts[0]}`,
    clientFactory: (config) => createSyncClient({ ...config, fetch }),
    before(fn) { before = fn; },
    after(fn) { after = fn; },
  };
}
export const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
