import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SaveQueue } from "./saveQueue.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => vi.advanceTimersByTimeAsync(0);

it("coalesces patches after 400 ms of quiet and reports statuses", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const queue = new SaveQueue({ save });
  const states = [];
  const unsubscribe = queue.subscribe((state) => states.push(state));
  expect(queue.status).toBe("idle");
  queue.schedule("a", { title: "Old", html: "Body" });
  await vi.advanceTimersByTimeAsync(300);
  queue.schedule("a", { title: "New" });
  await vi.advanceTimersByTimeAsync(399);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(save).toHaveBeenCalledExactlyOnceWith("a", { title: "New", html: "Body" });
  expect(queue.status).toBe("idle");
  expect(states).toEqual(["pending", "pending", "saving", "idle"]);
  unsubscribe();
  queue.schedule("a", {});
  expect(states).toHaveLength(4);
  await queue.flush();
});
it("saves at 2000 ms even with uninterrupted typing", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const queue = new SaveQueue({ save });
  queue.schedule("a", { title: "0" });
  for (let i = 1; i <= 6; i++) {
    await vi.advanceTimersByTimeAsync(300);
    queue.schedule("a", { title: String(i) });
  }
  await vi.advanceTimersByTimeAsync(199);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(save).toHaveBeenCalledExactlyOnceWith("a", { title: "6" });
});
it("never overlaps writes for one id, and starts another id independently", async () => {
  const first = deferred();
  const save = vi.fn((id) => id === "a" && save.mock.calls.filter(([key]) => key === "a").length === 1 ? first.promise : Promise.resolve());
  const queue = new SaveQueue({ save });
  queue.schedule("a", { html: "First" });
  await vi.advanceTimersByTimeAsync(400);
  queue.schedule("a", { html: "Second" });
  queue.schedule("b", { html: "Other note" });
  await vi.advanceTimersByTimeAsync(2000);
  expect(save.mock.calls).toEqual([["a", { html: "First" }], ["b", { html: "Other note" }]]);
  first.resolve();
  await tick();
  expect(save.mock.calls[2]).toEqual(["a", { html: "Second" }]);
  expect(queue.status).toBe("idle");
});
it("flush drains in-flight and subsequently scheduled work, and concurrent flushes share a promise", async () => {
  const first = deferred();
  const save = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined);
  const queue = new SaveQueue({ save });
  queue.schedule("a", { title: "A" });
  const flush = queue.flush();
  expect(queue.flush()).toBe(flush);
  await tick();
  queue.schedule("a", { title: "B" });
  queue.schedule("b", { html: "Body" });
  first.resolve();
  await flush;
  expect(save.mock.calls).toEqual([["a", { title: "A" }], ["a", { title: "B" }], ["b", { html: "Body" }]]);
  expect(queue.status).toBe("idle");
  await vi.advanceTimersByTimeAsync(3000);
  expect(save).toHaveBeenCalledTimes(3);
});
it("retains failed patches and a persistent error until a successful flush retry", async () => {
  const error = new Error("Quota exceeded");
  const save = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
  const queue = new SaveQueue({ save });
  queue.schedule("a", { title: "Keep me" });
  await vi.advanceTimersByTimeAsync(400);
  expect(queue.status).toBe("error");
  expect(queue.error).toBe(error);
  await vi.advanceTimersByTimeAsync(10000);
  expect(save).toHaveBeenCalledTimes(1);
  await queue.flush();
  expect(save.mock.calls[1]).toEqual(["a", { title: "Keep me" }]);
  expect(queue.status).toBe("idle");
});
it("flush rejects on failure, preserves newer fields and retries on the next schedule", async () => {
  const first = deferred();
  const retry = deferred();
  const save = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => retry.promise);
  const queue = new SaveQueue({ save });
  queue.schedule("a", { title: "Old", html: "Keep body" });
  const flush = queue.flush();
  const rejected = expect(flush).rejects.toThrow("Disk full");
  await tick();
  queue.schedule("a", { title: "New" });
  first.reject(new Error("Disk full"));
  await rejected;
  expect(queue.status).toBe("error");
  queue.schedule("a", { tags: ["tag"] });
  await vi.advanceTimersByTimeAsync(400);
  expect(save.mock.calls[1]).toEqual(["a", { title: "New", html: "Keep body", tags: ["tag"] }]);
  expect(queue.status).toBe("error"); // Even while the retry is in flight.
  retry.resolve();
  await queue.flush();
  expect(queue.status).toBe("idle");
});
it("handles synchronous failures and does not poison other notes", async () => {
  const save = vi.fn((id) => { if (id === "bad") throw new Error("Failed"); });
  const queue = new SaveQueue({ save });
  queue.schedule("bad", { title: "Bad" });
  queue.schedule("good", { title: "Good" });
  await expect(queue.flush()).rejects.toThrow("Failed");
  expect(save).toHaveBeenCalledWith("good", { title: "Good" });
  expect(queue.status).toBe("error");
  save.mockImplementation(() => {});
  await queue.flush();
  expect(queue.status).toBe("idle");
});
it("snapshots caller patches and accepts injectable timers", async () => {
  const timers = { now: vi.fn(() => Date.now()), setTimeout: vi.fn((fn, ms) => setTimeout(fn, ms)), clearTimeout: vi.fn(clearTimeout) };
  const save = vi.fn();
  const queue = new SaveQueue({ save, timers });
  const patch = { tags: ["original"] };
  queue.schedule("a", patch);
  patch.tags.push("mutation");
  await queue.flush();
  expect(save).toHaveBeenCalledExactlyOnceWith("a", { tags: ["original"] });
  expect(timers.setTimeout).toHaveBeenCalled();
  expect(timers.clearTimeout).toHaveBeenCalled();
  expect(timers.now).toHaveBeenCalled();
});

it("keeps saving a healthy note's newer edits after another note makes flush reject", async () => {
  const goodWrite = deferred();
  const save = vi.fn((id, patch) => {
    if (id === "bad") throw new Error("Cannot save bad");
    if (patch.title === "First") return goodWrite.promise;
  });
  const queue = new SaveQueue({ save });
  queue.schedule("good", { title: "First" });
  queue.schedule("bad", { title: "Bad" });
  const flush = queue.flush();
  const failed = expect(flush).rejects.toThrow("Cannot save bad");
  await tick();
  queue.schedule("good", { title: "Second" });
  goodWrite.resolve();
  await failed;
  await vi.advanceTimersByTimeAsync(400);
  expect(save).toHaveBeenCalledWith("good", { title: "Second" });
  expect(queue.status).toBe("error");
});

it("runs beforeFlush hooks before any save, and a hook's schedule is saved in the same flush", async () => {
  const saved = [];
  const queue = new SaveQueue({ save: async (id, patch) => { saved.push([id, patch]); } });
  const order = [];
  const off = queue.onBeforeFlush(() => { order.push("hook"); queue.schedule("n", { html: "<p>late</p>" }); });
  queue.schedule("n", { title: "T" });
  await queue.flush();
  expect(order).toEqual(["hook"]);
  expect(saved).toEqual([["n", { title: "T", html: "<p>late</p>" }]]);
  off();
  queue.schedule("n", { title: "U" });
  await queue.flush();
  expect(order).toEqual(["hook"]);
});

