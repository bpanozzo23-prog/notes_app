import "fake-indexeddb/auto";

const isAnthropic = (input) => {
  try { return new URL(typeof input === "string" || input instanceof URL ? input : input.url, "http://localhost").hostname === "api.anthropic.com"; }
  catch { return false; }
};
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, ...rest) {
  if (isAnthropic(input)) throw new Error("Real Anthropic request in a test");
  return originalFetch.call(this, input, ...rest);
};
if (globalThis.XMLHttpRequest) {
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (isAnthropic(url)) throw new Error("Real Anthropic request in a test");
    return originalOpen.call(this, method, url, ...rest);
  };
}
