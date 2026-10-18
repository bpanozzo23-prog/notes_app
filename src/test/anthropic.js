// Inject these fetch functions into the real SDK. Recording never retains the key.
function record(requests, url, options = {}) {
  const headers = Object.fromEntries(new Headers(options.headers));
  if (headers["x-api-key"]) headers["x-api-key"] = "[REDACTED]";
  if (headers.authorization) headers.authorization = "[REDACTED]";
  requests.push({ url: String(url), headers, body: options.body ? JSON.parse(options.body) : null });
}
export function jsonFetch(body, { status = 200, headers = {} } = {}) {
  const requests = [];
  return { requests, fetch: async (url, options) => {
    record(requests, url, options);
    if (options?.signal?.aborted) throw new DOMException("Fixture aborted", "AbortError");
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_fixture", ...headers } });
  } };
}
// Each release sends one SSE event, split into small, uneven byte chunks. A multibyte
// character is deliberately split too; the SDK must decode it across reads.
export function chunkedFetch(events, { stepped = false, headers = {} } = {}) {
  const requests = [];
  let release = () => false;
  return {
    requests,
    release: (count = 1) => { for (let i = 0; i < count; i++) if (!release()) return false; return true; },
    fetch: async (url, options = {}) => {
      record(requests, url, options);
      let index = 0, done = false;
      const signal = options.signal;
      let abort;
      const stream = new ReadableStream({
        start(controller) {
          const clean = () => { done = true; signal?.removeEventListener("abort", abort); };
          abort = () => { if (!done) { clean(); controller.error(new DOMException("Fixture aborted", "AbortError")); } };
          release = () => {
            if (done) return false;
            const event = events[index++];
            const bytes = new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            for (let offset = 0; offset < bytes.length;) {
              const size = [1, 7, 2, 11, 3][offset % 5];
              controller.enqueue(bytes.slice(offset, offset + size)); offset += size;
            }
            if (index === events.length) { clean(); controller.close(); }
            return true;
          };
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) abort();
        },
        pull() { if (!stepped) release(); },
        cancel() { done = true; signal?.removeEventListener("abort", abort); },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "request-id": "req_fixture_stream", ...headers } });
    },
  };
}
