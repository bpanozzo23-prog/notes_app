// Share → Notes. Android's Share menu POSTs to ./share-target; the offline worker's add-on
// (public/share-target.js) keeps the text out of every web address by leaving it in Cache Storage
// and redirecting to ./?shared. The app reads it once here and deletes it.
export const SHARE_CACHE = "notes_app-share-target";
export const QUICK_ADD_MAX = 2000;

const part = (value) => (typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "");

// Android usually sends the page title as `title` and puts the address inside `text`; `url` is
// rarely filled. Each part goes on its own line unless another part already holds it.
export function composeShared({ title, text, url } = {}) {
  const [heading, body, address] = [part(title), part(text), part(url)];
  const lines = [];
  if (heading && !body.includes(heading) && heading !== address) lines.push(heading);
  if (body) lines.push(body);
  if (address && !body.includes(address)) lines.push(address);
  const whole = lines.join("\n");
  if (whole.length <= QUICK_ADD_MAX) return { text: whole, cut: false };
  // Never end on half of a two-unit character (an emoji, say).
  const end = /[\ud800-\udbff]/.test(whole[QUICK_ADD_MAX - 1]) ? QUICK_ADD_MAX - 1 : QUICK_ADD_MAX;
  return { text: whole.slice(0, end).trimEnd(), cut: true };
}

// Reads the waiting share (when `use`) and empties the box, so shared text does not stay in
// storage: the whole box is deleted, or its entries one by one if that fails; a failure of both
// is retried at the next start. Returns { text, cut } or null. Plain-HTTP pages (the phone's dev
// server) have no Cache Storage: nothing to read there.
export async function takeShared(use = true) {
  if (typeof caches === "undefined") return null;
  let shared = null;
  try {
    if (use && await caches.has(SHARE_CACHE)) {
      const [response] = await (await caches.open(SHARE_CACHE)).matchAll();
      if (response) shared = composeShared(await response.json());
    }
  } catch { shared = null; }
  try { await caches.delete(SHARE_CACHE); }
  catch {
    try {
      const cache = await caches.open(SHARE_CACHE);
      for (const key of await cache.keys()) await cache.delete(key);
    } catch { /* the next start tries again */ }
  }
  return shared?.text ? shared : null;
}
