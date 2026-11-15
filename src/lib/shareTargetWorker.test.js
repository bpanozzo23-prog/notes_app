// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { SHARE_CACHE, takeShared } from "./shareTarget.js";
import { fakeCaches } from "../test/cacheStorage.js";

// public/share-target.js is a plain worker script: run it against a stand-in worker scope.
const source = readFileSync(new URL("../../public/share-target.js", import.meta.url), "utf8");
const scope = "https://example.test/notes_app/";
function worker(caches = fakeCaches()) {
  let listener;
  const self = { registration: { scope }, addEventListener: (type, handler) => { if (type === "fetch") listener = handler; } };
  new Function("self", "caches", source)(self, caches);
  const send = (request) => { let answer; listener({ request, respondWith: (response) => { answer = response; } }); return answer; };
  return { caches, send };
}
const post = (path, body, headers = { "content-type": "application/x-www-form-urlencoded" }) => new Request(new URL(path, scope), { method: "POST", body, headers });

it("keeps a shared title, text and address for the page and opens the app at ?shared", async () => {
  const { caches, send } = worker();
  const response = await send(post("share-target", new URLSearchParams({ title: "An article", text: "Worth reading: https://example.com/a?b=1&c=2", url: "" }).toString()));
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(`${scope}?shared`);
  expect([...caches.boxes.keys()]).toEqual([SHARE_CACHE]);
  expect([...caches.boxes.get(SHARE_CACHE).keys()]).toEqual([`${scope}__shared`]);
  globalThis.caches = caches;
  try { expect(await takeShared()).toEqual({ text: "An article\nWorth reading: https://example.com/a?b=1&c=2", cut: false }); }
  finally { delete globalThis.caches; }
});
it("a second share replaces the first", async () => {
  const { caches, send } = worker();
  await send(post("share-target", "text=First")); await send(post("share-target", "text=Second"));
  const [stored] = await (await caches.open(SHARE_CACHE)).matchAll();
  expect(await stored.json()).toEqual({ title: "", text: "Second", url: "" });
});
it("accepts a multipart share and ignores fields that are not text", async () => {
  const form = new FormData(); form.set("text", "From a form"); form.set("title", new Blob(["x"]), "file.txt");
  const { caches, send } = worker();
  expect((await send(new Request(new URL("share-target", scope), { method: "POST", body: form }))).headers.get("location")).toBe(`${scope}?shared`);
  const [stored] = await (await caches.open(SHARE_CACHE)).matchAll();
  expect(await stored.json()).toEqual({ title: "", text: "From a form", url: "" });
});
it("leaves every other request to the worker's own routes", () => {
  const { caches, send } = worker();
  expect(send(new Request(new URL("share-target", scope)))).toBeUndefined();
  expect(send(new Request(scope))).toBeUndefined();
  expect(send(post("__fake-anthropic/v1/messages", "text=x"))).toBeUndefined();
  expect(send(post("share-target/extra", "text=x"))).toBeUndefined();
  expect(send(new Request("https://elsewhere.test/notes_app/share-target", { method: "POST", body: "text=x" }))).toBeUndefined();
  expect(send(new Request("https://example.test/mi-cuaderno/share-target", { method: "POST", body: "text=x" }))).toBeUndefined();
  expect(caches.boxes.size).toBe(0);
});
it.each([
  ["storage fails", () => worker({ open: () => Promise.reject(new Error("quota")) }), () => post("share-target", "text=x")],
  ["the form cannot be read", () => worker(), () => post("share-target", "not a form", { "content-type": "application/json" })],
])("still opens the app, with an empty Quick add sheet, when %s", async (_, make, request) => {
  const response = await make().send(request());
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(`${scope}?quick-add`);
});
