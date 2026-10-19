export class SaveQueue {
  constructor({ save, resolveConflict, quietMs = 400, maxWaitMs = 2000, timers = {} }) {
    this.save = save;
    this.resolveConflict = resolveConflict;
    this.knownRevs = new Map();
    this.redirects = new Map();
    this.conflictListeners = new Set();
    this.quietMs = quietMs;
    this.maxWaitMs = maxWaitMs;
    this.timers = {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      now: () => Date.now(),
      ...timers,
    };
    this.entries = new Map();
    this.listeners = new Set();
    this.beforeFlushHooks = new Set();
    this.operations = new Set();
    this.flushing = null;
  }

  /** Run fn at the start of every flush, before any save starts. The editor uses this to hand
   * over input it is still holding (Android deletions wait 20 ms inside ProseMirror). */
  onBeforeFlush(fn) {
    this.beforeFlushHooks.add(fn);
    return () => this.beforeFlushHooks.delete(fn);
  }

  setKnownRev(noteId, rev) {
    this.knownRevs.set(noteId, rev);
    this.redirects.delete(noteId);
  }

  onConflict(listener) {
    this.conflictListeners.add(listener);
    return () => this.conflictListeners.delete(listener);
  }

  async saveEntry(noteId, patch) {
    if (this.blocked) throw this.blocked;
    const targetId = this.redirects.get(noteId) ?? noteId, expectedRev = this.knownRevs.get(targetId);
    let saved;
    try {
      saved = await (expectedRev === undefined ? this.save(targetId, patch) : this.save(targetId, patch, { expectedRev }));
    } catch (error) {
      if (this.blocked) throw this.blocked;
      if (!this.resolveConflict) throw error;
      saved = await this.resolveConflict(error, targetId, patch);
      // Keep the entry under the editor's original id, including input queued during recovery.
      this.redirects.set(noteId, saved.id);
      this.knownRevs.set(saved.id, saved.rev);
      for (const listener of this.conflictListeners) listener({ noteId, copyId: saved.id, copyTitle: saved.title });
      return;
    }
    if (saved) this.knownRevs.set(targetId, saved.rev);
  }

  track(promise) {
    // The caller reports the operation's failure. It must not strand unrelated note saves.
    const settled = Promise.resolve(promise).catch(() => {}).finally(() => {
      this.operations.delete(settled);
      this.emit();
    });
    this.operations.add(settled);
    this.emit();
    return settled;
  }

  get status() {
    if (this.operations.size) return "pending";
    if (this.blocked && this.entries.size) return "error";
    if ([...this.entries.values()].some((entry) => entry.error)) return "error";
    if ([...this.entries.values()].some((entry) => entry.running)) return "saving";
    return this.entries.size ? "pending" : "idle";
  }

  get error() {
    if (this.blocked && this.entries.size) return this.blocked;
    return [...this.entries.values()].find((entry) => entry.error)?.error ?? null;
  }

  getSnapshot = () => this.status;
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  emit() {
    for (const listener of this.listeners) listener(this.status);
  }

  schedule(noteId, patch) {
    if (this.blocked) return;
    if (!noteId) throw new Error("A save needs a note id");
    let entry = this.entries.get(noteId);
    if (!entry) {
      entry = { noteId, pending: null, running: null, timer: null, error: null, ready: false };
      this.entries.set(noteId, entry);
    }
    const at = this.timers.now();
    if (!entry.pending) entry.firstAt = at;
    entry.lastAt = at;
    entry.pending = { ...entry.pending, ...structuredClone(patch) };
    this.arm(entry);
    this.emit();
  }

  clearTimer(entry) {
    if (entry.timer !== null) this.timers.clearTimeout(entry.timer);
    entry.timer = null;
  }

  block(error) {
    this.blocked = error;
    for (const entry of this.entries.values()) this.clearTimer(entry);
    this.emit();
  }

  arm(entry) {
    this.clearTimer(entry);
    if (this.flushing || this.blocked) return;
    const deadline = Math.min(entry.lastAt + this.quietMs, entry.firstAt + this.maxWaitMs);
    entry.timer = this.timers.setTimeout(() => {
      entry.timer = null;
      entry.ready = true;
      this.start(entry);
    }, Math.max(0, deadline - this.timers.now()));
  }

  start(entry) {
    if (entry.running) return entry.running;
    if (this.blocked) return Promise.resolve();
    if (!entry.pending) return Promise.resolve();
    this.clearTimer(entry);
    const patch = entry.pending;
    const firstAt = entry.firstAt;
    entry.pending = null;
    entry.ready = false;
    // Start through a promise so synchronous exceptions follow the same retry path.
    entry.running = Promise.resolve()
      .then(() => this.saveEntry(entry.noteId, patch))
      .then(() => { entry.error = null; }, (error) => {
        // Newer fields win, but failed fields must never disappear.
        entry.pending = { ...patch, ...entry.pending };
        entry.firstAt = firstAt;
        entry.error = error instanceof Error ? error : new Error(String(error));
        entry.ready = false;
        this.clearTimer(entry);
      })
      .finally(() => {
        entry.running = null;
        if (!entry.pending) this.entries.delete(entry.noteId);
        else if (!entry.error && !this.flushing) {
          if (entry.ready) this.start(entry);
          else this.arm(entry);
        }
        this.emit();
      });
    this.emit();
    return entry.running;
  }

  flush() {
    if (this.flushing) return this.flushing;
    this.flushing = Promise.resolve().then(async () => {
      if (this.blocked) throw this.blocked;
      for (const hook of this.beforeFlushHooks) await hook();
      while (this.operations.size || this.entries.size) {
        if (this.blocked) throw this.blocked;
        while (this.operations.size) await Promise.all([...this.operations]);
        if (this.blocked) throw this.blocked;
        await Promise.all([...this.entries.values()].map((entry) => this.start(entry)));
        // Reject so navigation/export/import cannot claim success with unsaved data.
        // Keep the failed patch and error; only a later schedule/flush retries it.
        if (this.error) throw this.error;
      }
    }).finally(() => {
      this.flushing = null;
      // A failed note must not strand another note's newer pending changes.
      for (const entry of this.entries.values()) {
        if (entry.pending && !entry.running && !entry.error) this.arm(entry);
      }
    });
    return this.flushing;
  }
}
