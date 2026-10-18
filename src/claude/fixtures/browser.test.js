import { afterEach, expect, it, vi } from "vitest";
import { installSteppedClaudeFetch } from "./browser.js";
import { sseFrames, answerEvents } from "./responses.js";
import { followupAnswer } from "./ask.js";
afterEach(() => { vi.unstubAllGlobals(); delete window.__claudeStreams; });
it("selects by the last user text block, releases chunks step by step and sends unknowns to the guard", async () => {
  const guard = vi.fn(async () => { throw new Error("Fixture route guard"); });
  vi.stubGlobal("fetch", guard);
  installSteppedClaudeFetch({ smoke: sseFrames(), cases: [{ match: "first", frames: sseFrames() }, { match: "follow", frames: sseFrames(followupAnswer) }] });
  const response = await window.fetch("https://api.anthropic.com/v1/messages", { method: "POST", body: JSON.stringify({ messages: [
    { role: "user", content: [{ type: "text", text: "first" }] }, { role: "assistant", content: [] },
    { role: "user", content: [{ type: "text", text: "irrelevant" }, { type: "text", text: "follow" }] },
  ] }) });
  expect(guard).not.toHaveBeenCalled(); expect(window.__claudeStreams).toHaveLength(1);
  let text = "", done = false;
  const reading = (async () => { const reader = response.body.getReader(); const decoder = new TextDecoder(); while (true) { const chunk = await reader.read(); if (chunk.done) break; text += decoder.decode(chunk.value, { stream: true }); } done = true; })();
  await Promise.resolve(); expect(text).toBe("");
  window.__claudeStreams[0].release();
  await vi.waitFor(() => expect(text).toContain("msg_followup_fixture")); expect(done).toBe(false);
  while (window.__claudeStreams[0].release()) { /* drain */ }
  await reading; expect(done).toBe(true);
  await expect(window.fetch("https://api.anthropic.com/v1/messages", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "unknown" }] }) })).rejects.toThrow("Fixture route guard");
  expect(guard).toHaveBeenCalledTimes(1);
});
it("aborts an already-open fixture stream without releasing further events", async () => {
  vi.stubGlobal("fetch", vi.fn()); installSteppedClaudeFetch(sseFrames(answerEvents));
  const abort = new AbortController();
  const response = await window.fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: abort.signal });
  const reader = response.body.getReader(); abort.abort();
  await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
  expect(window.__claudeStreams[0].release()).toBe(false);
});
