import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { resetDatabase } from "../test/fixtures.js";
import { jsonFetch, chunkedFetch } from "../test/anthropic.js";
import { saveClaudeKey } from "./prefs.js";
import { createClaudeClient, streamMessage, testClaudeKey, toClaudeError, ERROR_MESSAGES, RESPONSE_ERRORS, loadClaudeSdk } from "./client.js";
import { CLAUDE_MODEL, QUESTION_EFFORT, QUESTION_MAX_TOKENS, REFUSAL_FALLBACK_BETA } from "./config.js";
import { answerEvents, citation, countTokens, httpErrors, streamError } from "./fixtures/responses.js";

beforeEach(async () => { await resetDatabase(); await saveClaudeKey("sk-ant-FAKE-TEST"); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const params = { model: CLAUDE_MODEL, max_tokens: QUESTION_MAX_TOKENS, output_config: { effort: QUESTION_EFFORT }, messages: [{ role: "user", content: "Hi" }] };
const sentence = (fixture) => fixture.kind === "request" ? `Anthropic couldn't accept this request (${fixture.body.error.type}).` : ERROR_MESSAGES[fixture.kind];

it("streams awkward byte chunks through the SDK, including a citation and fallback headers", async () => {
  const fixture = chunkedFetch(answerEvents);
  const onEvent = vi.fn();
  const final = await streamMessage({ ...params, thinking: {}, temperature: 1, top_p: 1, budget_tokens: 10 }, { fetch: fixture.fetch, maxRetries: 0, onEvent });
  expect(final.content).toEqual([{ type: "text", text: "Café opens on Sunday.", citations: [citation] }]);
  expect(final.usage.output_tokens).toBe(9);
  expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual(answerEvents.map((event) => event.type));
  const request = fixture.requests[0];
  expect(request.headers["anthropic-beta"]).toContain(REFUSAL_FALLBACK_BETA);
  expect(request.headers["x-api-key"]).toBe("[REDACTED]");
  expect(request.body).toMatchObject({ ...params, stream: true, fallbacks: "default" });
  for (const key of ["thinking", "temperature", "top_p", "budget_tokens"]) expect(request.body).not.toHaveProperty(key);
});
it("aborts a stepped stream after partial text", async () => {
  const fixture = chunkedFetch(answerEvents, { stepped: true });
  const abort = new AbortController(), events = [];
  const result = streamMessage(params, { fetch: fixture.fetch, signal: abort.signal, maxRetries: 0, onEvent: (event) => events.push(event) }).catch(toClaudeError);
  await vi.waitFor(() => expect(fixture.requests).toHaveLength(1));
  fixture.release(3);
  await vi.waitFor(() => expect(events).toHaveLength(3));
  abort.abort();
  expect(await result).toMatchObject({ kind: "cancelled", message: "Stopped." });
});
it("maps a mid-stream SSE error with no HTTP error status", async () => {
  const fixture = chunkedFetch([...answerEvents.slice(0, 3), streamError]);
  const error = await streamMessage(params, { fetch: fixture.fetch, maxRetries: 0 }).catch(toClaudeError);
  expect(error).toEqual({ kind: "overloaded", message: ERROR_MESSAGES.overloaded, type: "overloaded_error", requestId: "req_fixture_stream" });
});
it.each(httpErrors)("maps HTTP $status ($kind) through the SDK", async (fixture) => {
  const mock = jsonFetch(fixture.body, { status: fixture.status, headers: { "retry-after": "0" } });
  expect(await streamMessage(params, { fetch: mock.fetch, maxRetries: 0 }).catch(toClaudeError)).toMatchObject({ kind: fixture.kind, message: sentence(fixture) });
});
it("counts only Hi to test a key, with no notes or paid message", async () => {
  const fixture = jsonFetch(countTokens);
  expect(await testClaudeKey({ fetch: fixture.fetch, maxRetries: 0 })).toEqual({ result: "works" });
  expect(fixture.requests[0].url).toBe("https://api.anthropic.com/v1/messages/count_tokens");
  expect(fixture.requests[0].body).toEqual({ model: CLAUDE_MODEL, messages: [{ role: "user", content: "Hi" }] });
});
it.each(httpErrors)("key test HTTP $status is conclusive only for auth ($kind)", async (fixture) => {
  const mock = jsonFetch(fixture.body, { status: fixture.status });
  const expected = fixture.kind === "auth" ? { result: "rejected" } : { result: "unknown", message: `Couldn't check the key: ${sentence(fixture)}` };
  expect(await testClaudeKey({ fetch: mock.fetch, maxRetries: 0 })).toEqual(expected);
});
it("maps connection, abort and unknown errors to fixed messages", async () => {
  const module = await loadClaudeSdk();
  for (const error of [new TypeError("secret"), new module.APIConnectionError({ message: "secret" })]) expect(toClaudeError(error)).toEqual({ kind: "network", message: ERROR_MESSAGES.network });
  expect(toClaudeError(new module.APIUserAbortError())).toEqual({ kind: "cancelled", message: "Stopped." });
  expect(toClaudeError(new DOMException("secret", "AbortError")).kind).toBe("cancelled");
  expect(toClaudeError(new Error("secret"))).toEqual({ kind: "unknown", message: ERROR_MESSAGES.unknown });
  expect(await testClaudeKey({ fetch: async () => { throw new TypeError("secret"); }, maxRetries: 0 })).toEqual({ result: "unknown", message: `Couldn't check the key: ${ERROR_MESSAGES.network}` });
  expect(toClaudeError({ status: 400, error: { error: { type: "sk-ant-secret", message: "secret" } } })).toEqual({ kind: "request", message: "Anthropic couldn't accept this request." });
  expect(RESPONSE_ERRORS).toEqual({ refusal: "Claude declined to answer this.", truncated: "The proposal was cut short; nothing was changed.", invalid: "Claude's proposal couldn't be used; nothing was changed." });
});
it("reads keys per client and resolves the default fetch at call time", async () => {
  const first = await createClaudeClient({ maxRetries: 0 });
  expect(first.apiKey).toBe("sk-ant-FAKE-TEST");
  await saveClaudeKey("sk-ant-FAKE-CHANGED");
  expect((await createClaudeClient()).apiKey).toBe("sk-ant-FAKE-CHANGED");
  const fixture = jsonFetch(countTokens);
  vi.stubGlobal("fetch", fixture.fetch);
  await first.messages.countTokens({ model: CLAUDE_MODEL, messages: [{ role: "user", content: "Hi" }] });
  expect(fixture.requests).toHaveLength(1);
});
it("blocks accidental real fetch and XHR to Anthropic", () => {
  expect(() => globalThis.fetch("https://api.anthropic.com/v1/messages")).toThrow("Real Anthropic request in a test");
  expect(() => new XMLHttpRequest().open("POST", "https://api.anthropic.com/v1/messages")).toThrow("Real Anthropic request in a test");
});
