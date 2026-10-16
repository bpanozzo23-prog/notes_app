import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { NAVIGATION_KEY, activeEntry, createNavigationController, initialNavigation, navigationReducer, resolveDestination, sanitizeNavigation } from "./navigation.js";
import { SaveQueue } from "./saveQueue.js";
import { noteFixture } from "../test/fixtures.js";

const push = (nav, screen, key, extras = {}) => navigationReducer(nav, { type: "push", entry: { screen, ...extras }, key });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

it("reduces a single stack without mutating previous snapshots", () => {
  const root = initialNavigation();
  const filtered = navigationReducer(root, { type: "filter", filter: { type: "folder", value: "f" } });
  const scrolled = navigationReducer(filtered, { type: "scroll", y: 280 });
  const next = push(scrolled, "note", "visit", { noteId: "a" });
  expect(next.stack).toHaveLength(2);
  expect(next.stack[0]).toMatchObject({ filter: { type: "folder", value: "f" }, scrollY: 280 });
  expect(activeEntry(next)).toMatchObject({ screen: "note", noteId: "a", key: "visit", scrollY: 0 });
  const replaced = navigationReducer(next, { type: "replace", entry: { screen: "settings" } });
  expect(replaced.stack).toHaveLength(2);
  expect(activeEntry(replaced)).toEqual({ screen: "settings", key: "visit", scrollY: 0 });
  expect(root).toEqual(initialNavigation());
});

it.each([null, {}, { version: 99, stack: [] }, { version: 1, stack: "bad" }, { version: 1, stack: [] }])("sanitises unusable snapshots: %j", (raw) => {
  expect(sanitizeNavigation(raw)).toEqual(initialNavigation());
});

it("strips unknown data, repairs invalid destinations/scroll/filters and retains valid routes", () => {
  const clean = sanitizeNavigation({ version: 1, secret: "discard", stack: [
    { key: "root", screen: "list", scrollY: -1, filter: { type: "tag", value: "Spanish", extra: 2 }, html: "discard" },
    { key: "note", screen: "note", noteId: "fixture", scrollY: 12 },
    { key: "missing", screen: "note", noteId: null, scrollY: Infinity },
    { key: "wrong", screen: "__proto__", filter: { type: "folder", value: 5 } },
  ] });
  expect(clean).toEqual({ version: 1, stack: [
    { key: "root", screen: "list", scrollY: 0, filter: { type: "tag", value: "Spanish" } },
    { key: "note", screen: "note", noteId: "fixture", scrollY: 12 },
    { key: "missing", screen: "list", scrollY: 0, filter: { type: "all" } },
    { key: "wrong", screen: "list", scrollY: 0, filter: { type: "all" } },
  ] });
});

it("repairs duplicate visit keys even when a key resembles the repair name", () => {
  const clean = sanitizeNavigation({ version: 1, stack: [
    { screen: "list", key: "restored-1" },
    { screen: "settings", key: "restored-1" },
    { screen: "trash", key: "restored-1-1" },
  ] });
  expect(new Set(clean.stack.map((entry) => entry.key)).size).toBe(3);
});

it("falls back to the last list for missing or trashed notes, and clears a deleted folder filter", () => {
  let nav = navigationReducer(initialNavigation(), { type: "filter", filter: { type: "folder", value: "gone" } });
  nav = push(nav, "note", "visit", { noteId: "gone" });
  const resolved = resolveDestination(nav, { notes: [noteFixture({ id: "gone", deletedAt: "2026-10-16" })], folders: [] });
  expect(activeEntry(resolved)).toMatchObject({ key: "visit", screen: "list", filter: { type: "all" } });
  expect(resolved.stack).toHaveLength(2); // Keep the browser chronology for failed-pop recovery.
});

describe("browser history and popstate", () => {
  let nav, stop, queue, save, data, change, error, busy;
  const scroll = (y) => { Object.defineProperty(window, "scrollY", { configurable: true, value: y }); window.dispatchEvent(new Event("scroll")); };
  beforeEach(() => {
    window.history.replaceState({ otherOwner: "kept" }, "");
    scroll(0);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    data = { notes: [noteFixture()], folders: [{ id: "folder", name: "Folder" }] };
    save = vi.fn().mockResolvedValue(undefined);
    queue = new SaveQueue({ save });
    change = vi.fn(); error = vi.fn(); busy = vi.fn();
    nav = createNavigationController({ prepare: async () => { await queue.flush(); return data; }, onChange: change, onError: error, onBusy: busy });
    stop = nav.start();
  });
  afterEach(async () => {
    stop();
    save.mockResolvedValue(undefined);
    await queue.flush();
    scroll(0);
    vi.restoreAllMocks();
  });
  const openNote = () => nav.open({ screen: "note", noteId: noteFixture().id });

  it("keeps the URL and foreign state, restores filter/scroll, and flushes before applying Back", async () => {
    const url = window.location.href;
    expect(window.history.scrollRestoration).toBe("manual");
    nav.setFilter({ type: "folder", value: "folder" });
    scroll(342);
    await openNote();
    scroll(90);
    const pending = deferred(); save.mockReturnValueOnce(pending.promise);
    queue.schedule(noteFixture().id, { title: "Mid-word" });
    window.history.back();
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(activeEntry(nav.current).screen).toBe("note");
    pending.resolve();
    await waitFor(() => expect(activeEntry(nav.current).screen).toBe("list"));
    expect(activeEntry(nav.current)).toMatchObject({ filter: { type: "folder", value: "folder" }, scrollY: 342 });
    expect(window.location.href).toBe(url);
    expect(window.history.state.otherOwner).toBe("kept");
    window.history.forward();
    await waitFor(() => expect(activeEntry(nav.current).screen).toBe("note"));
    expect(activeEntry(nav.current).scrollY).toBe(90);
  });

  it("blocks a failed Back with go(1), retains edits, and does not retry on the recovery pop", async () => {
    await openNote();
    const go = vi.spyOn(window.history, "go");
    save.mockRejectedValue(new Error("Disk full"));
    queue.schedule(noteFixture().id, { title: "Keep this" });
    window.history.back();
    await waitFor(() => expect(go).toHaveBeenCalledWith(1));
    await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false));
    expect(activeEntry(nav.current).screen).toBe("note");
    expect(activeEntry(window.history.state[NAVIGATION_KEY]).screen).toBe("note");
    expect(queue.status).toBe("error");
    expect(save).toHaveBeenCalledTimes(1);
    save.mockResolvedValue(undefined);
    window.history.back();
    await waitFor(() => expect(activeEntry(nav.current).screen).toBe("list"));
    expect(save).toHaveBeenLastCalledWith(noteFixture().id, { title: "Keep this" });
  });

  it("does not retry a failed save when Back arrives during another guarded operation", async () => {
    await openNote();
    const pending = deferred(); save.mockReturnValueOnce(pending.promise);
    queue.schedule(noteFixture().id, { title: "Keep" });
    const operation = nav.run(() => queue.flush());
    await waitFor(() => expect(save).toHaveBeenCalled());
    window.history.back();
    await waitFor(() => expect(window.history.state[NAVIGATION_KEY].stack).toHaveLength(1));
    pending.reject(new Error("Disk full"));
    await operation;
    await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false));
    expect(activeEntry(nav.current).screen).toBe("note");
    expect(save).toHaveBeenCalledTimes(1);
    expect(queue.status).toBe("error");
  });

  it("resolves a deleted destination on Forward instead of opening an empty editor", async () => {
    await openNote();
    window.history.back();
    await waitFor(() => expect(activeEntry(nav.current).screen).toBe("list"));
    data.notes = [];
    window.history.forward();
    await waitFor(() => expect(nav.current.stack).toHaveLength(2));
    expect(activeEntry(nav.current).screen).toBe("list");
    expect(activeEntry(window.history.state[NAVIGATION_KEY]).screen).toBe("list");
  });

  it("replaces the reserved creation visit so one Back returns to the filtered list", async () => {
    nav.setFilter({ type: "tag", value: "tag" });
    const replace = vi.spyOn(window.history, "replaceState");
    await nav.run(async () => nav.openCreated(noteFixture().id));
    expect(replace.mock.calls.at(-1)[0][NAVIGATION_KEY].stack.at(-1).noteId).toBe(noteFixture().id);
    window.history.back();
    await waitFor(() => expect(activeEntry(nav.current).screen).toBe("list"));
    expect(nav.current.stack).toHaveLength(1);
    expect(activeEntry(nav.current).filter).toEqual({ type: "tag", value: "tag" });
  });

  it.each([false, true])("coalesces repeated Back during a slow save (failure: %s)", async (fail) => {
    await nav.open({ screen: "folders" });
    await openNote();
    const pending = deferred(); save.mockReturnValueOnce(pending.promise);
    queue.schedule(noteFixture().id, { title: "Keep" });
    window.history.back();
    await waitFor(() => expect(save).toHaveBeenCalled());
    window.history.back();
    await waitFor(() => expect(window.history.state[NAVIGATION_KEY].stack).toHaveLength(1));
    if (fail) pending.reject(new Error("Disk full")); else pending.resolve();
    await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false));
    expect(nav.current.stack).toHaveLength(fail ? 3 : 1);
    expect(window.history.state[NAVIGATION_KEY].stack).toHaveLength(fail ? 3 : 1);
  });
});
