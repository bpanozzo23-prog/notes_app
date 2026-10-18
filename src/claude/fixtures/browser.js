// Serializable init script for Playwright. Only made-up SSE frames enter this closure.
// Release one event at a time with window.__claudeStreams.at(-1).release().
export function installSteppedClaudeFetch(frames) {
  const originalFetch = window.fetch.bind(window);
  window.__claudeStreams = [];
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, window.location.href);
    const method = options.method ?? input?.method ?? "GET";
    if (url.origin !== "https://api.anthropic.com" || url.pathname !== "/v1/messages" || method.toUpperCase() !== "POST") return originalFetch(input, options);
    const signal = options.signal ?? input?.signal;
    let index = 0, done = false, abort;
    const stream = new ReadableStream({
      start(controller) {
        const clean = () => { done = true; signal?.removeEventListener("abort", abort); };
        abort = () => { if (!done) { clean(); controller.error(new DOMException("Fixture stopped", "AbortError")); } };
        window.__claudeStreams.push({
          release() {
            if (done) return false;
            const bytes = new TextEncoder().encode(frames[index++]);
            for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7));
            if (index === frames.length) { clean(); controller.close(); }
            return true;
          },
        });
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      },
      cancel() { done = true; signal?.removeEventListener("abort", abort); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "request-id": "req_screenshot_fixture" } });
  };
}
