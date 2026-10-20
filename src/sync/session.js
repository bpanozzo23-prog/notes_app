const initial = () => ({
  connected: false, connecting: false, running: false, lastResult: null, lastSyncedAt: null, counts: null,
  missingImages: [], error: null, confirm: null, restoreOffer: null, paused: false, proposals: [],
});
export function createSyncSession() {
  let snapshot = initial();
  const listeners = new Set();
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => snapshot,
    update(patch) {
      // Explicit field list: connection credentials can never enter the external store.
      snapshot = { ...snapshot, ...Object.fromEntries(Object.keys(initial()).filter((key) => Object.hasOwn(patch, key)).map((key) => [key, patch[key]])) };
      emit();
    },
    reset() { snapshot = initial(); emit(); },
  };
}
export const syncSession = createSyncSession();
