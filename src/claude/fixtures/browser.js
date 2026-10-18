// Serializable init script for Playwright. Only made-up SSE frames enter this closure.
// Release one event at a time with window.__claudeStreams.at(-1).release().
export function installSteppedClaudeFetch(fixtures) {
  const originalFetch = window.fetch.bind(window);
  window.__claudeStreams = [];
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, window.location.href);
    const method = options.method ?? input?.method ?? "GET";
    if (url.origin !== "https://api.anthropic.com" || url.pathname !== "/v1/messages" || method.toUpperCase() !== "POST") return originalFetch(input, options);
    // Matching rules are supplied by the shots script; production knows no marker strings.
    let frames = Array.isArray(fixtures) ? fixtures : null;
    if (!frames) {
      let body;
      try { body = typeof options.body === "string" ? JSON.parse(options.body) : await input.clone().json(); }
      catch { return originalFetch(input, options); }
      const last = body.messages?.filter((message) => message.role === "user").at(-1);
      const text = typeof last?.content === "string" ? last.content : last?.content?.filter((block) => block.type === "text").at(-1)?.text;
      frames = text ? fixtures.cases.find((fixture) => text.includes(fixture.match))?.frames : !body.messages && body.stream === true ? fixtures.smoke : null;
      if (!frames) return originalFetch(input, options); // The route guard fails closed.
    }
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
