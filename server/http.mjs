import http from "node:http";
import { HttpError } from "./validate.mjs";

export async function readLimitedBody(request, limit) {
  const chunks = [];
  let size = 0;
  // destroyOnReturn:false lets the adapter send a 413 before closing the connection.
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      const error = new HttpError(413, "too-large");
      error.bytesIn = size;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}
export function createServer(handle, { listen = "127.0.0.1", port = 8790 } = {}) {
  if (listen !== "127.0.0.1") throw new Error("invalid-listen");
  const server = http.createServer(async (request, response) => {
    let consumed = false;
    try {
      const result = await handle({
        method: request.method, path: request.url, headers: request.headers,
        readBody: async (limit) => {
          if (consumed) throw new Error("body-already-read");
          consumed = true;
          return readLimitedBody(request, limit);
        },
      });
      const stream = result.body && typeof result.body.pipe === "function";
      const body = result.body == null ? null : Buffer.isBuffer(result.body) || stream ? result.body : Buffer.from(JSON.stringify(result.body));
      response.statusCode = result.status;
      for (const [key, value] of Object.entries(result.headers)) response.setHeader(key, value);
      if (body && !response.hasHeader("Content-Type")) response.setHeader("Content-Type", "application/json");
      if (body && !stream) response.setHeader("Content-Length", body.length);
      // Do not drain an unauthorised or oversized body; close once the rejection is sent.
      if (!request.complete || result.status === 413) response.setHeader("Connection", "close");
      if (stream) {
        body.on("error", () => response.destroy());
        body.pipe(response);
      } else response.end(body);
    } catch {
      if (response.headersSent) response.destroy();
      else {
        response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store", Connection: "close" });
        response.end('{"error":"storage-problem"}');
      }
    }
  });
  // Creation is inert for tests. serve() is the only production caller that opens a socket.
  server.start = () => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, listen, () => { server.off("error", reject); resolve(server); });
  });
  return server;
}
