import { afterEach, expect, it, vi } from "vitest";
import { downloadJson, readFileAsText } from "./file.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("downloads JSON and keeps its blob URL alive for ten seconds", async () => {
  vi.useFakeTimers();
  const create = vi.fn(() => "blob:fixture");
  const revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  let download;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    download = { name: this.download, href: this.href, attached: this.isConnected };
  });
  downloadJson({ hello: "fixture" }, "fixture.json");
  expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
  expect(download).toEqual({ name: "fixture.json", href: "blob:fixture", attached: true });
  expect(document.querySelector("a")).toBeNull();
  await vi.advanceTimersByTimeAsync(9999);
  expect(revoke).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:fixture");
});
it("reads files as text", async () => {
  expect(await readFileAsText(new File(['{"fixture":true}'], "fixture.json"))).toBe('{"fixture":true}');
});
