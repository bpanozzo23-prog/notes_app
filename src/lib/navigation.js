import { newId, SAFE_STRING } from "./ids.js";

export const NAVIGATION_KEY = "notesNavigation";
const SCREENS = ["list", "note", "folders", "trash", "settings", "settings-toolbar", "settings-selection", "settings-colours"];
const safeString = (value) => typeof value === "string" && SAFE_STRING.test(value);
const safeScroll = (value) => Number.isFinite(value) && value >= 0 ? value : 0;
export const activeEntry = (navigation) => navigation.stack.at(-1);
export const initialNavigation = () => ({ version: 1, stack: [{ screen: "list", key: "root", filter: { type: "all" }, scrollY: 0 }] });

export function sanitizeFilter(filter) {
  return ["folder", "tag"].includes(filter?.type) && safeString(filter.value)
    ? { type: filter.type, value: filter.value } : { type: "all" };
}

export function sanitizeQuery(query) {
  if (typeof query !== "string" || /[\u0000-\u001f\u007f-\u009f]/.test(query)) return undefined;
  const trimmed = query.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : undefined;
}

/** Read only our versioned, allowlisted shape; never restore note content from history. */
export function sanitizeNavigation(raw) {
  if (raw?.version !== 1 || !Array.isArray(raw.stack) || !raw.stack.length || raw.stack.length > 1000) return initialNavigation();
  const keys = new Set();
  const stack = raw.stack.map((entry, index) => {
    let key = safeString(entry?.key) ? entry.key : `restored-${index}`;
    let suffix = 0;
    while (keys.has(key)) key = `restored-${index}-${++suffix}`;
    keys.add(key);
    const base = { key, scrollY: safeScroll(entry?.scrollY) };
    if (index > 0 && typeof entry?.screen === "string" && entry.screen.startsWith("settings-") && !SCREENS.includes(entry.screen)) {
      return { ...base, screen: "settings" };
    }
    if (!SCREENS.includes(entry?.screen) || (index === 0 && entry.screen !== "list") ||
        (entry.screen === "note" && !safeString(entry.noteId))) {
      return { ...base, screen: "list", filter: { type: "all" } };
    }
    const query = sanitizeQuery(entry.query);
    return { ...base, screen: entry.screen,
      ...(entry.screen === "note" ? { noteId: entry.noteId } : {}),
      ...(entry.screen === "list" ? { filter: sanitizeFilter(entry.filter),
        ...(query ? { query } : {}),
      } : {}),
    };
  });
  return { version: 1, stack };
}

export function navigationReducer(navigation, action) {
  const stack = navigation.stack;
  switch (action.type) {
    case "push": return sanitizeNavigation({ version: 1, stack: [...stack, { ...action.entry, key: action.key, scrollY: 0 }] });
    case "replace": return sanitizeNavigation({ version: 1, stack: [...stack.slice(0, -1), { ...action.entry, key: activeEntry(navigation).key, scrollY: action.entry.scrollY ?? 0 }] });
    case "filter": return navigationReducer(navigation, { type: "replace", entry: {
      screen: "list", filter: action.filter,
      query: Object.hasOwn(action, "query") ? action.query : activeEntry(navigation).query,
      scrollY: action.scrollY ?? 0,
    } });
    case "scroll": return { ...navigation, stack: stack.map((entry, i) => i === stack.length - 1 ? { ...entry, scrollY: safeScroll(action.y) } : entry) };
    default: return navigation;
  }
}

export function resolveDestination(navigation, { notes, folders }) {
  const route = activeEntry(navigation);
  if (route.screen === "note" && !notes.some((note) => note.id === route.noteId && note.deletedAt === null)) {
    const list = navigation.stack.findLast((entry) => entry.screen === "list");
    return resolveDestination(navigationReducer(navigation, { type: "replace", entry: { ...list, screen: "list" } }), { notes, folders });
  }
  if (route.screen === "list" && route.filter.type === "folder" && !folders.some((folder) => folder.id === route.filter.value)) {
    return navigationReducer(navigation, { type: "filter", filter: { type: "all" } });
  }
  return navigation;
}

const withNavigation = (state, navigation) => ({ ...(state && typeof state === "object" ? state : {}), [NAVIGATION_KEY]: navigation });

/** Browser adapter. Callers share run() so a mutation and a leave cannot race a flush.
 * A pop keeps the old screen mounted until prepare() succeeds. Repeated Back presses
 * during that wait coalesce to the latest browser destination, including on failure.
 */
export function createNavigationController({ win = window, prepare, onChange, onBusy, onError }) {
  let navigation = sanitizeNavigation(win.history.state?.[NAVIGATION_KEY]);
  let busy = false;
  let stopped = false;
  let pendingPop = null;
  let recovering = false;
  const overlays = new Set();
  const scrollByKey = new Map();
  const emit = () => { if (!stopped) onChange(navigation); };
  const setBusy = (value) => { busy = value; if (!stopped) onBusy(value); };
  const write = (method, next) => win.history[method](withNavigation(win.history.state, next), "");

  function captureScroll() {
    if (busy || stopped) return;
    navigation = navigationReducer(navigation, { type: "scroll", y: win.scrollY });
    scrollByKey.set(activeEntry(navigation).key, win.scrollY);
    write("replaceState", navigation);
  }
  function commit(next, method = "replaceState") {
    if (stopped || pendingPop) return;
    navigation = next;
    write(method, navigation);
    emit();
  }
  function recoverPop(error) {
    if (error) onError(error);
    const delta = navigation.stack.length - pendingPop.stack.length;
    pendingPop = null;
    if (delta) {
      recovering = true;
      win.history.go(delta); // Ordinary Back failure: go(1); failed Forward: go(-1).
    } else {
      commit(navigation);
      setBusy(false);
    }
  }
  async function settlePop() {
    setBusy(true);
    try {
      const data = await prepare();
      if (stopped) return;
      // prepare may have awaited a disk write while several popstate events arrived.
      const target = pendingPop;
      pendingPop = null;
      const route = activeEntry(target);
      const remembered = scrollByKey.get(route.key);
      const next = remembered === undefined ? target : navigationReducer(target, { type: "scroll", y: remembered });
      commit(resolveDestination(next, data));
    } catch (error) {
      if (stopped) return;
      recoverPop(error);
    } finally {
      if (!recovering) setBusy(false);
    }
  }
  function onPop(event) {
    if (stopped) return;
    const target = sanitizeNavigation(event.state?.[NAVIGATION_KEY]);
    if (recovering && activeEntry(target).key === activeEntry(navigation).key) {
      recovering = false;
      pendingPop = null;
      write("replaceState", navigation);
      setBusy(false);
      return;
    }
    pendingPop = target;
    if (recovering) {
      win.history.go(navigation.stack.length - target.stack.length);
    } else if (!busy) {
      // The browser has already moved: do not overwrite its destination with captureScroll().
      scrollByKey.set(activeEntry(navigation).key, win.scrollY);
      if ([...overlays].reverse().some((close) => close())) {
        setBusy(true);
        recoverPop();
        return;
      }
      void settlePop();
    }
  }

  async function run(task, { captureScroll: capture = true } = {}) {
    if (busy || stopped) return false;
    if (capture) captureScroll();
    setBusy(true);
    let success = false;
    let failure;
    try { await task(); success = true; }
    catch (error) { failure = error; if (!stopped) onError(error); }
    finally {
      if (pendingPop && !stopped) {
        // A Back that arrived during a failing mutation must not silently retry its save.
        if (failure) recoverPop(failure);
        else await settlePop();
      }
      else setBusy(false);
    }
    return success;
  }
  return {
    get current() { return navigation; },
    start() {
      stopped = false;
      const previous = win.history.scrollRestoration;
      win.history.scrollRestoration = "manual";
      write("replaceState", navigation);
      win.addEventListener("popstate", onPop);
      win.addEventListener("scroll", captureScroll, { passive: true });
      emit();
      return () => {
        stopped = true;
        win.removeEventListener("popstate", onPop);
        win.removeEventListener("scroll", captureScroll);
        win.history.scrollRestoration = previous;
      };
    },
    run,
    registerOverlay(close) { overlays.add(close); return () => overlays.delete(close); },
    restore(data) { commit(resolveDestination(navigation, data)); },
    open(entry) {
      return run(async () => {
        const data = await prepare();
        commit(resolveDestination(navigationReducer(navigation, { type: "push", entry, key: newId() }), data), "pushState");
      });
    },
    openCreated(noteId) {
      // Reserve one browser visit, then replace it with the persisted note. No draft/missing
      // note destination remains, and the previous list (including filter/scroll) stays behind it.
      commit(navigationReducer(navigation, { type: "push", entry: { screen: "list" }, key: newId() }), "pushState");
      commit(navigationReducer(navigation, { type: "replace", entry: { screen: "note", noteId } }));
    },
    setFilter(filter) {
      if (busy) return;
      commit(navigationReducer(navigation, { type: "filter", filter }));
      win.scrollTo(0, 0);
    },
    setQuery(query) {
      if (busy || stopped || activeEntry(navigation).screen !== "list") return;
      captureScroll();
      const route = activeEntry(navigation);
      commit(navigationReducer(navigation, { type: "filter", filter: route.filter, query, scrollY: route.scrollY }));
    },
    back() {
      if (busy) return;
      if (navigation.stack.length > 1) win.history.back();
      else void run(async () => { await prepare(); commit(initialNavigation()); });
    },
  };
}
