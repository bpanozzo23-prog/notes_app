import { getPref, setPref } from "../db/db.js";

/** Ask the browser once per device to keep this site's storage out of eviction, and remember
 * the answer. The answer is device-local: it is never exported, so a restored backup asks again. */
export async function requestPersistence() {
  if (await getPref("storagePersisted") !== undefined) return;
  let granted = false;
  try { granted = await navigator.storage?.persist?.() ?? false; }
  catch { /* The saved note is usable even if persistence is denied. */ }
  await setPref("storagePersisted", granted);
}
