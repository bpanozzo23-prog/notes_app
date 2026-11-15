// Share → Notes: loaded by the generated service worker (workbox.importScripts in vite.config.js).
// Android's Share menu POSTs the shared title, text and address to ./share-target. They are left
// in Cache Storage for the page to read once and delete (src/lib/shareTarget.js), and the app is
// opened at ./?shared, so shared text is never part of a web address. Nothing else is handled
// here: every other request falls through to the worker's own routes.
self.addEventListener("fetch", (event) => {
  const scope = new URL(self.registration.scope);
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.origin !== scope.origin || url.pathname !== `${scope.pathname}share-target`) return;
  event.respondWith((async () => {
    try {
      const form = await event.request.formData();
      const field = (name) => { const value = form.get(name); return typeof value === "string" ? value.slice(0, 20000) : ""; };
      const cache = await caches.open("notes_app-share-target");
      await cache.put(new URL("__shared", scope).href, new Response(JSON.stringify({ title: field("title"), text: field("text"), url: field("url") }),
        { headers: { "content-type": "application/json" } }));
      return Response.redirect(new URL("?shared", scope).href, 303);
    } catch {
      // The app must still open: an empty Quick add sheet instead of the shared text.
      return Response.redirect(new URL("?quick-add", scope).href, 303);
    }
  })());
});
