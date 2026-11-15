// A small stand-in for the browser's Cache Storage (jsdom has none). `boxes` shows what is stored.
export function fakeCaches() {
  const boxes = new Map();
  return {
    boxes,
    async has(name) { return boxes.has(name); },
    async open(name) {
      if (!boxes.has(name)) boxes.set(name, new Map());
      const box = boxes.get(name);
      return {
        async put(key, response) { box.set(String(key), response); },
        async matchAll() { return [...box.values()].map((response) => response.clone()); },
        async keys() { return [...box.keys()]; },
        async delete(key) { return box.delete(String(key)); },
      };
    },
    // `failDelete` stands for a browser that refuses to drop the whole box.
    failDelete: false,
    async delete(name) { if (this.failDelete) throw new Error("Cannot delete the box"); return boxes.delete(name); },
  };
}
export async function storeShare(caches, name, value) {
  await (await caches.open(name)).put("https://example.test/notes_app/__shared", new Response(typeof value === "string" ? value : JSON.stringify(value)));
}
