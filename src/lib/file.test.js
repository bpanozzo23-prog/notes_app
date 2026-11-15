import { afterEach, expect, it, vi } from "vitest";
import { downloadJson, readFileAsText, safeFileName, shareTextFile } from "./file.js";

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

it.each([
  ["Vocabulario — comida", "Vocabulario — comida.md"],
  ["a/b\\c:d|e", "a-b-c-d-e.md"],
  ['What? "Quotes" <tags> *stars*', "What Quotes tags stars.md"],
  ["../secret..", "-secret.md"],
  ["Wait.. what", "Wait… what.md"],
  [" .hidden. ", "hidden.md"],
  ["tab\tand\u0000control\u202ebidi", "tab andcontrolbidi.md"],
  ["CON", "CON_.md"], ["nul.txt", "nul_.txt.md"], ["Con artist", "Con artist.md"],
  ["", "Note.md"],
  ["...", "Note.md"],
  ["e\u0301", "\u00e9.md"],
])("makes %j a safe file name", (name, expected) => {
  expect(safeFileName(name, "md")).toBe(expected);
});
it("caps file names at 60 characters without splitting an emoji or ending in a space", () => {
  const name = safeFileName(`${"😀".repeat(59)} tail`, "txt");
  expect(name).toBe(`${"😀".repeat(59)}.txt`);
  expect(Array.from(safeFileName("x".repeat(200), "md"))).toHaveLength(63);
});
it("shares one plain-text file, or returns null when the browser can't", async () => {
  vi.stubGlobal("navigator", { ...navigator, share: undefined, canShare: undefined });
  expect(shareTextFile("# Hi", "Hi.txt")).toBeNull();
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, share, canShare: () => false });
  expect(shareTextFile("# Hi", "Hi.txt")).toBeNull();
  vi.stubGlobal("navigator", { ...navigator, share, canShare: () => { throw new TypeError("bad"); } });
  expect(shareTextFile("# Hi", "Hi.txt")).toBeNull();
  const canShare = vi.fn(() => true);
  vi.stubGlobal("navigator", { ...navigator, share, canShare });
  await shareTextFile("# Hí", "Hí.txt");
  expect(share).toHaveBeenCalledOnce();
  const [data] = share.mock.calls[0];
  expect(Object.keys(data)).toEqual(["files"]);
  expect(data.files).toHaveLength(1);
  expect(data.files[0]).toMatchObject({ name: "Hí.txt", type: "text/plain" });
  expect(await readFileAsText(data.files[0])).toBe("# Hí");
  expect(canShare.mock.calls[0][0].files[0]).toBe(data.files[0]);
});
