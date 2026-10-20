import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import App from "../../App.jsx";
import ClaudeSettings from "./ClaudeSettings.jsx";
import { db, getPref, notebookAccess, setPref } from "../../db/db.js";
import { resetDatabase, backupFixture } from "../../test/fixtures.js";
import { jsonFetch } from "../../test/anthropic.js";
import { countTokens, httpErrors } from "../../claude/fixtures/responses.js";
import { CLAUDE_PREFS, saveClaudeKey, setClaudeEnabled } from "../../claude/prefs.js";
import { testClaudeKey } from "../../claude/client.js";
import { claudeSession } from "../../claude/session.js";
import { buildBackup } from "../../db/backup.js";
import useNotebook from "../../lib/useNotebook.js";
import { downloadJson } from "../../lib/file.js";

vi.mock("../../lib/file.js", async (original) => ({ ...await original(), downloadJson: vi.fn() }));
beforeEach(async () => {
  claudeSession.clearSession(); await resetDatabase();
  window.history.replaceState(null, "");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(async () => {
  cleanup(); claudeSession.clearSession();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const button = (name) => screen.getByRole("button", { name, exact: true });
const idle = () => waitFor(() => expect(document.querySelector("main > div[aria-busy]")?.getAttribute("aria-busy")).toBe("false"));
async function click(name) { await waitFor(() => expect(button(name).disabled).toBe(false)); fireEvent.click(button(name)); await idle(); }
async function start() {
  render(<App />); await idle();
  await click("Settings");
  await screen.findByRole("button", { name: "Claude Off" });
  await click("Claude Off");
  await screen.findByRole("heading", { name: "Claude", exact: true });
}
async function enable(key = "sk-ant-FAKE-UI") {
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("Anthropic API key"), { target: { value: key } });
  await click("Save key and turn on");
  await screen.findByText("On · key saved on this phone");
}
it("is off by default, requires acknowledgement and an uncontrolled key, and supports off/on/removal", async () => {
  await start();
  expect(screen.getByText(/From this app, your notes go to Anthropic only when you tap Send\./)).toBeTruthy();
  const input = screen.getByLabelText("Anthropic API key");
  expect(input.getAttribute("value")).toBeNull();
  expect(input.type).toBe("password");
  expect(input.autocomplete).toBe("off");
  expect(input.getAttribute("autocapitalize")).toBe("off");
  expect(input.getAttribute("spellcheck")).toBe("false");
  expect(button("Save key and turn on").disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(button("Save key and turn on").disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(input, { target: { value: "sk-ant-FAKE-UI" } });
  expect(button("Save key and turn on").disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  await click("Save key and turn on");
  await screen.findByText("On · key saved on this phone");
  expect(input.value).toBe("");
  expect(document.body.innerHTML).not.toContain("sk-ant-FAKE-UI");
  expect(await getPref("claudeApiKey")).toBe("sk-ant-FAKE-UI");
  expect(await getPref("claudeEnabled")).toBe(true);
  expect(screen.getByText("This month on this phone: $0.00 (estimate)")).toBeTruthy();
  await click("Turn off");
  const savedInput = await screen.findByPlaceholderText("Leave blank to keep the saved key");
  expect(savedInput.value).toBe("");
  expect(screen.getByRole("checkbox").checked).toBe(false);
  expect(button("Turn on").disabled).toBe(true);
  expect(await getPref("claudeApiKey")).toBe("sk-ant-FAKE-UI");
  fireEvent.click(screen.getByRole("checkbox"));
  await click("Turn on"); await screen.findByText("On · key saved on this phone");
  await click("Remove key");
  expect(screen.getByRole("dialog").textContent).toContain("Remove the API key from this phone?");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove key" }));
  await screen.findByPlaceholderText("sk-ant-…");
  expect(await db.prefs.get("claudeApiKey")).toBeUndefined();
  expect(await getPref("claudeEnabled")).toBe(false);
});
it.each(["works", "rejected", "unknown"])("tests the saved key: %s", async (result) => {
  const fixture = result === "works" ? jsonFetch(countTokens) : jsonFetch(httpErrors[result === "rejected" ? 0 : 1].body, { status: result === "rejected" ? 401 : 402 });
  vi.stubGlobal("fetch", fixture.fetch);
  await start(); await enable(); await click("Test key");
  await screen.findByText(result === "works" ? "The key works." : result === "rejected" ? "Anthropic rejected this key." : "Couldn't check the key: Anthropic reports a billing problem with your account.");
  expect(claudeSession.isBusy()).toBe(false);
});
it("keeps the app navigable during Test key and drops the result after leaving", async () => {
  const fixture = jsonFetch(countTokens);
  let finish;
  vi.stubGlobal("fetch", (url, options) => new Promise((resolve) => { finish = () => resolve(fixture.fetch(url, options)); }));
  await start(); await enable(); await click("Test key");
  await screen.findByRole("button", { name: "Checking…" });
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(claudeSession.isBusy()).toBe(true);
  expect(button("Back").disabled).toBe(false);
  await click("Back"); await screen.findByRole("heading", { name: "Settings", exact: true });
  expect(claudeSession.isBusy()).toBe(true);
  await act(async () => { finish(); });
  await waitFor(() => expect(claudeSession.isBusy()).toBe(false));
  await click("Claude On");
  await screen.findByText("On · key saved on this phone");
  expect(screen.queryByText("The key works.")).toBeNull();
});
it("drops a result after session invalidation even when the screen stays open", async () => {
  let finish;
  vi.stubGlobal("fetch", () => new Promise((resolve) => { finish = () => resolve(new Response(JSON.stringify(countTokens))); }));
  await start(); await enable(); await click("Test key");
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  act(() => claudeSession.clearSession());
  await act(async () => { finish(); });
  await waitFor(() => expect(button("Test key").disabled).toBe(false));
  expect(screen.queryByText("The key works.")).toBeNull();
});
it.each(["readOnly", "replaced", "versionChange"])("disables settings writes and Test key in %s state", async (kind) => {
  await saveClaudeKey("sk-ant-FAKE"); await setClaudeEnabled(true);
  vi.spyOn(notebookAccess, "getSnapshot").mockReturnValue({ readOnly: kind === "readOnly", replaced: kind === "replaced", versionChange: kind === "versionChange" ? "pending" : null });
  const run = vi.fn();
  render(<ClaudeSettings run={run} refresh={vi.fn()} readOnly={kind === "readOnly"} />);
  await screen.findByText("On · key saved on this phone");
  for (const name of ["Test key", "Turn off", "Remove key"]) expect(button(name).disabled).toBe(true);
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(run).not.toHaveBeenCalled();
});
it("disables off-state fields while busy or read-only", async () => {
  const view = render(<ClaudeSettings busy run={vi.fn()} refresh={vi.fn()} />);
  expect(screen.getByRole("checkbox").disabled).toBe(true);
  expect(screen.getByLabelText("Anthropic API key").disabled).toBe(true);
  view.rerender(<ClaudeSettings readOnly run={vi.fn()} refresh={vi.fn()} />);
  expect(screen.getByRole("checkbox").disabled).toBe(true);
  expect(button("Save key and turn on").disabled).toBe(true);
});
it("keeps a sentinel key out of DOM, console, history, hook prefs, request bodies and both downloads", async () => {
  const sentinel = "sk-ant-SENTINEL-DO-NOT-LEAK-1234567890";
  const logs = Object.keys(console).filter((key) => typeof console[key] === "function").map((key) => vi.spyOn(console, key).mockImplementation(() => {}));
  await saveClaudeKey(sentinel); await setClaudeEnabled(true);
  for (const key of CLAUDE_PREFS.filter((key) => !["claudeApiKey", "claudeEnabled"].includes(key))) await setPref(key, { sentinel });
  const requests = [];
  for (const fixture of httpErrors) {
    const mock = jsonFetch({ ...fixture.body, error: { ...fixture.body.error, message: `${fixture.body.error.message} ${sentinel}` } }, { status: fixture.status, headers: { "retry-after": "0" } });
    const result = await testClaudeKey({ fetch: mock.fetch, maxRetries: 0 });
    expect(JSON.stringify(result)).not.toContain(sentinel);
    requests.push(...mock.requests);
  }
  const mock = jsonFetch({ type: "error", error: { type: "authentication_error", message: sentinel } }, { status: 401 });
  vi.stubGlobal("fetch", mock.fetch);
  render(<App />); await idle(); await click("Settings"); await click("Claude On");
  await screen.findByText("On · key saved on this phone");
  await click("Test key"); await screen.findByText("Anthropic rejected this key.");
  const hook = renderHook(useNotebook);
  await act(async () => { await hook.result.current.refresh(); });
  const backup = await buildBackup();
  expect(JSON.stringify(backup)).not.toContain(sentinel);
  expect(JSON.stringify(hook.result.current.prefs)).not.toContain(sentinel);
  expect(document.body.innerHTML).not.toContain(sentinel);
  expect(JSON.stringify(window.history.state)).not.toContain(sentinel);
  await click("Back"); await screen.findByRole("heading", { name: "Settings", exact: true });
  await click("Export backup");
  fireEvent.change(screen.getByLabelText("Import backup"), { target: { files: [new File([JSON.stringify(backupFixture())], "fixture.json", { type: "application/json" })] } });
  await screen.findByText("fixture.json"); await idle();
  await click("Replace notebook"); await click("Import and replace");
  await screen.findByText(/Backup imported/);
  const downloads = downloadJson.mock.calls;
  expect(downloads.some(([, name]) => name.startsWith("before-import-"))).toBe(true);
  expect(JSON.stringify(downloads)).not.toContain(sentinel);
  expect(await getPref("claudeApiKey")).toBe(sentinel);
  expect(JSON.stringify([...requests, ...mock.requests])).not.toContain(sentinel);
  expect(inspect(logs.flatMap((log) => log.mock.calls), { depth: 8 })).not.toContain(sentinel);
});

it("does not attach an old key's in-flight result to a replacement key", async () => {
  let finish;
  vi.stubGlobal("fetch", () => new Promise((resolve) => { finish = () => resolve(new Response(JSON.stringify(countTokens))); }));
  await start(); await enable(); await click("Test key");
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  await click("Turn off");
  await screen.findByPlaceholderText("Leave blank to keep the saved key");
  await enable("sk-ant-FAKE-REPLACEMENT");
  await act(async () => { finish(); });
  await waitFor(() => expect(claudeSession.isBusy()).toBe(false));
  expect(screen.queryByText("The key works.")).toBeNull();
  expect(await getPref("claudeApiKey")).toBe("sk-ant-FAKE-REPLACEMENT");
});
