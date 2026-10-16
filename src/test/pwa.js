// No service worker in jsdom. App tests mock this module to drive update events.
import { useState } from "react";
export function useRegisterSW() {
  return { needRefresh: useState(false), offlineReady: useState(false), updateServiceWorker: async () => {} };
}
