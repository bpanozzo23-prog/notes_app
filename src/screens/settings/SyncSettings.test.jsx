import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../../App.jsx";
import SyncSettings from "./SyncSettings.jsx";
import SyncBar from "../../components/SyncBar.jsx";
import Settings from "../Settings.jsx";
import { db, notebookAccess } from "../../db/db.js";
import { buildBackup, importBackup } from "../../db/backup.js";
import { resetDatabase, backupFixture } from "../../test/fixtures.js";
import { AT, note } from "../../../server/test-support.js";
import { syncSession } from "../../sync/session.js";
import { syncNow } from "../../sync/trigger.js";
import { syncFixture, deferred } from "../../sync/test-support.js";
import { saveConnection, readSyncConfig } from "../../sync/prefs.js";
import { DEFAULT_SYNC_ADDRESS } from "../../sync/config.js";
import { NAVIGATION_KEY } from "../../lib/navigation.js";
import { downloadJson } from "../../lib/file.js";
import * as persistence from "../../lib/persistence.js";

vi.mock("../../lib/file.js", async (original) => ({ ...await original(), downloadJson: vi.fn() }));
let server;
const button = (name) => screen.getByRole("button", { name, exact: true });
const idle = () => waitFor(() => expect(document.querySelector("main > div[aria-busy]")?.getAttribute("aria-busy")).toBe("false"));
async function click(name) { await waitFor(() => expect(button(name).disabled).toBe(false)); fireEvent.click(button(name)); }
const props = () => ({
  notebook: { notes: [], trash: [], folders: [], prefs: {}, refresh: vi.fn(async () => {}) },
  queue: { flush: vi.fn(async () => {}), status: "idle" }, run: (task) => task(), setMessage: vi.fn(), onBack: vi.fn(),
});
beforeEach(async () => {
  await resetDatabase(); syncSession.reset(); downloadJson.mockReset();
  window.history.replaceState(null, "");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(async () => {
  cleanup();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (server) { await server.clean(); server = null; }
});
async function fixtureApp({ connected = false, phone = [], remote } = {}) {
  server = await syncFixture();
  if (remote) expect((await server.request("POST", "/v1/push", await server.next(remote))).status).toBe(200);
  if (connected) await saveConnection({ address: server.address, token: server.token });
  await db.notes.bulkPut(phone);
  vi.stubGlobal("fetch", server.fetch);
  render(<App />); await idle();
  await click("Settings"); await idle();
  await click(`Sync · ${connected ? "Connected" : "Off"}`);
  await screen.findByRole("heading", { name: "Sync with the XPS" }); await idle();
}
async function pair() {
  const pairing = await server.context.pairing.openWindow();
  fireEvent.change(screen.getByLabelText("Address"), { target: { value: server.address } });
  fireEvent.change(screen.getByLabelText("Code"), { target: { value: pairing.code } });
  await click("Connect");
  await waitFor(() => expect(syncSession.getSnapshot().connected).toBe(true));
  return pairing.code;
}
// Inspect component hook values, without traversing React's graph or event closures.
// Input refs are allowed and checked separately for clearing after submit.
function hookValues(element) {
  const key = Object.keys(element).find((key) => key.startsWith("__reactFiber$"));
  let fiber = element[key];
  while (fiber && fiber.type !== SyncSettings) fiber = fiber.return;
  const values = [];
  for (let hook = fiber?.memoizedState; hook; hook = hook.next) values.push(hook.memoizedState);
  const seen = new WeakSet();
  return JSON.stringify(values, (_key, value) => {
    if (value instanceof Element) return "element";
    if (typeof value === "object" && value !== null) { if (seen.has(value)) return "seen"; seen.add(value); }
    return value;
  });
}

it("renders the connection form and enables Connect only for six digits, keeping code and token out of hooks and the submitted DOM", async () => {
  await fixtureApp({ phone: [note()] });
  const input = screen.getByLabelText("Code"), address = screen.getByLabelText("Address");
  expect(address.value).toBe(DEFAULT_SYNC_ADDRESS);
  expect(address.inputMode).toBe("url");
  expect(input.getAttribute("value")).toBeNull();
  expect(input.inputMode).toBe("numeric"); expect(input.autocomplete).toBe("one-time-code");
  expect(screen.getByText('run "notes-sync pair" on the XPS')).toBeTruthy();
  expect(screen.getByText("Chrome will ask to let this site reach devices on your local network: tap Allow.")).toBeTruthy();
  for (const value of ["", "12345", "1234567", "12345a", "123 45"]) {
    fireEvent.change(input, { target: { value } }); expect(button("Connect").disabled).toBe(true);
  }
  const pairing = await server.context.pairing.openWindow();
  const gate = deferred(), started = deferred();
  server.after(async (request) => { if (request.path === "/v1/pair") { started.resolve(); await gate.promise; } });
  fireEvent.change(address, { target: { value: server.address } });
  fireEvent.change(input, { target: { value: pairing.code } });
  expect(button("Connect").disabled).toBe(false);
  expect(hookValues(input.closest("section"))).not.toContain(pairing.code);
  const logs = ["log", "warn", "error", "info", "debug"].map((name) => vi.spyOn(console, name));
  await click("Connect"); await started.promise;
  expect(input.value).toBe(""); expect(button("Connecting…").disabled).toBe(true);
  expect(button("Back").disabled).toBe(false);
  await act(async () => { gate.resolve(); });
  await screen.findByText("On the XPS: 1 notes, 0 pictures");
  const token = (await readSyncConfig()).token;
  expect(token).toBeTruthy();
  const section = screen.getByRole("heading", { name: "Sync with the XPS" }).closest("section");
  for (const value of [token, pairing.code, server.address]) {
    expect(document.body.innerHTML).not.toContain(value);
    expect(hookValues(section)).not.toContain(value);
    expect(JSON.stringify(syncSession.getSnapshot())).not.toContain(value);
    expect(JSON.stringify(window.history.state)).not.toContain(value);
    expect(JSON.stringify(await buildBackup())).not.toContain(value);
    expect(JSON.stringify(logs.flatMap((log) => log.mock.calls))).not.toContain(value);
  }
  expect(server.requests.some(({ path }) => path === "/v1/push")).toBe(true);
});

it("clears a wrong/expired code immediately and shows only the fixed pairing sentence", async () => {
  await fixtureApp();
  fireEvent.change(screen.getByLabelText("Address"), { target: { value: server.address } });
  const input = screen.getByLabelText("Code");
  fireEvent.change(input, { target: { value: "123456" } });
  await click("Connect"); expect(input.value).toBe("");
  await screen.findByText("That code didn't work. Run notes-sync pair on the XPS for a new one.");
  expect(button("Connect").disabled).toBe(true);
  expect(await db.prefs.get("syncToken")).toBeUndefined();
});

it.each([
  ["unreachable", "Couldn't reach the XPS. Check that Tailscale is on. Trying again shortly."],
  ["blocked", "Chrome is blocking this site from reaching the XPS. Allow Local network access for this site in Chrome's site settings."],
  ["unauthorized", "The XPS no longer recognises this phone. Connect again with a new code."],
  ["update-service", "Update the XPS service."], ["update-app", "Update this app."],
  ["history-blocked", "The XPS couldn't record history, so syncing is paused. Your notes are safe on this phone."],
  ["server", "The XPS had a problem. Trying again shortly."],
  ["invalid", "The XPS had a problem. Trying again shortly."],
])("renders the fixed status for %s without raw errors", (kind, sentence) => {
  syncSession.update({ connected: true, error: { kind, message: "SECRET-SERVER-TEXT" } });
  render(<SyncSettings {...props()} />);
  expect(screen.getByText(sentence)).toBeTruthy();
  expect(screen.getByText("Connected · not synced yet")).toBeTruthy();
  expect(document.body.textContent).not.toContain("SECRET-SERVER-TEXT");
  if (kind === "unauthorized") expect(screen.getByLabelText("Code")).toBeTruthy();
});

it("shows session last-sync time, XPS counts and missing pictures", () => {
  syncSession.update({ connected: true, lastSyncedAt: new Date(Date.now() - 120_000).toISOString(), counts: { notes: 43, images: 12 }, missingImages: ["a", "b", "c"] });
  render(<SyncSettings {...props()} />);
  expect(screen.getByText("Connected · last synced 2 minutes ago")).toBeTruthy();
  expect(screen.getByText("On the XPS: 43 notes, 12 pictures")).toBeTruthy();
  expect(screen.getByText("3 pictures referenced by notes are missing on this phone, so the XPS can't back them up.")).toBeTruthy();
});

it("renders confirmation counts with five initial titles and disclosures, safely as text", () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: `n-${i}`, title: i ? `Title ${i}` : "<img src=x onerror=alert(1)>" }));
  syncSession.update({ connected: true, confirm: { removed: rows, changed: rows.slice(0, 2) } });
  render(<SyncSettings {...props()} />);
  expect(screen.getByText("The XPS copy has notes this phone doesn't")).toBeTruthy();
  expect(screen.getByText("7 notes would be removed from the XPS copy and 2 would be replaced with this phone's versions. The XPS keeps every earlier version in its history.")).toBeTruthy();
  const details = screen.getByText("Show all").closest("details");
  expect(details.open).toBe(false); expect(within(details).getByText("Title 6")).toBeTruthy();
  expect(document.querySelector("img")).toBeNull();
  expect(button("Replace the XPS copy").classList.contains("danger")).toBe(true);
});

it.each(["readOnly", "replaced", "versionChange"])("guards all Sync actions and fields for %s", (kind) => {
  vi.spyOn(notebookAccess, "getSnapshot").mockReturnValue({ readOnly: kind === "readOnly", replaced: kind === "replaced", versionChange: kind === "versionChange" ? "pending" : null });
  const view = render(<SyncSettings {...props()} />);
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.getByLabelText("Address").disabled).toBe(true);
  expect(screen.getByLabelText("Code").disabled).toBe(true);
  expect(button("Connect").disabled).toBe(true);
  act(() => syncSession.update({ connected: true }));
  view.rerender(<SyncSettings {...props()} />);
  for (const name of ["Sync now", "Restore from the XPS…", "Disconnect"]) expect(button(name).disabled).toBe(true);
});

it("offers Restore after Connect, does not push, and imports only through the shared preview and approval", async () => {
  await fixtureApp({ remote: [note()] });
  await pair(); await screen.findByText("The XPS has 1 notes. Restore them?");
  expect(server.requests.filter(({ path }) => path === "/v1/push")).toHaveLength(0);
  await click("Restore from the XPS instead"); await screen.findByText("Backup from the XPS");
  expect(await db.notes.count()).toBe(0); expect(downloadJson).not.toHaveBeenCalled();
  await click("Replace notebook");
  expect(await db.notes.count()).toBe(0); expect(downloadJson).not.toHaveBeenCalled();
  const persist = vi.spyOn(persistence, "requestPersistence");
  const order = [];
  downloadJson.mockImplementationOnce((backup, filename) => {
    order.push("download"); expect(backup.notes).toEqual([]); expect(filename).toMatch(/^before-import-/);
  });
  const original = db.notes.bulkAdd.bind(db.notes);
  vi.spyOn(db.notes, "bulkAdd").mockImplementation((notes) => { order.push("import"); return original(notes); });
  await click("Import and replace"); await screen.findByText(/Backup imported/); await idle();
  expect(order).toEqual(["download", "import"]); expect(persist).toHaveBeenCalledTimes(1);
  expect((await db.notes.toArray()).map(({ title }) => title)).toEqual(["Fixture title"]);
  await waitFor(() => expect(syncSession.getSnapshot().lastSyncedAt).toBe(AT));
  expect(syncSession.getSnapshot().confirm).toBeNull();
  const pushed = server.requests.find(({ path }) => path === "/v1/push").body;
  expect(pushed.rows).toHaveLength(1); expect(pushed).not.toHaveProperty("confirm");
  await click("Back"); await screen.findByRole("button", { name: "Sync · Connected" });
  await click("Sync · Connected"); await screen.findByText(/Connected · last synced/);
});

it("a failed safety download prevents Restore import", async () => {
  await fixtureApp({ connected: true, phone: [note()] });
  await waitFor(() => expect(syncSession.getSnapshot().lastSyncedAt).toBe(AT));
  await click("Restore from the XPS…"); await screen.findByText("Backup from the XPS");
  await click("Replace notebook");
  downloadJson.mockImplementationOnce(() => { throw new Error("Fixture download failed"); });
  await click("Import and replace");
  await screen.findAllByText("Fixture download failed");
  expect(await db.notes.toArray()).toEqual([note()]);
  expect(notebookAccess.getGeneration()).toBeNull();
});

it("Disconnect requires the danger confirmation, cancels safely and forgets the token only after approval", async () => {
  await fixtureApp({ connected: true, phone: [note()] });
  await click("Disconnect");
  expect(screen.getByRole("dialog").textContent).toContain("Disconnect from the XPS?The XPS keeps its copy and history.");
  const action = within(screen.getByRole("dialog")).getByRole("button", { name: "Disconnect" });
  expect(action.classList.contains("danger")).toBe(true);
  await click("Cancel"); expect((await readSyncConfig()).token).toBe(server.token);
  await click("Disconnect"); fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Disconnect" }));
  await screen.findByRole("button", { name: "Connect" });
  await waitFor(async () => expect((await readSyncConfig()).token).toBe(""));
  expect(screen.queryByText(/Connected ·/)).toBeNull();
});

async function backWithoutLeaving(expectedGone) {
  const stack = window.history.state[NAVIGATION_KEY];
  act(() => window.history.back());
  await waitFor(expectedGone); await idle();
  expect(window.history.state[NAVIGATION_KEY]).toEqual(stack);
  expect(screen.getByRole("heading", { name: "Sync with the XPS" })).toBeTruthy();
}
it("Android Back closes the import confirmation, then its preview, before leaving Sync", async () => {
  await fixtureApp({ connected: true, phone: [note()] });
  await waitFor(() => expect(syncSession.getSnapshot().lastSyncedAt).toBe(AT));
  await click("Restore from the XPS…"); await screen.findByText("Backup from the XPS");
  await click("Replace notebook");
  await backWithoutLeaving(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByText("Backup from the XPS")).toBeTruthy();
  await backWithoutLeaving(() => expect(screen.queryByText("Backup from the XPS")).toBeNull());
  expect(downloadJson).not.toHaveBeenCalled();
  await click("Back"); await screen.findByRole("heading", { name: "Settings", exact: true });
});
it("Android Back closes the Disconnect confirmation first", async () => {
  await fixtureApp({ connected: true, phone: [note()] });
  await click("Disconnect"); await backWithoutLeaving(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect((await readSyncConfig()).token).toBe(server.token);
});
it("Android Back dismisses the XPS copy decision and keeps syncing paused", async () => {
  await fixtureApp({ connected: true, phone: [note({ title: "Phone version" })], remote: [note()] });
  await screen.findByText("The XPS copy has notes this phone doesn't");
  await backWithoutLeaving(() => expect(screen.queryByText("The XPS copy has notes this phone doesn't")).toBeNull());
  expect(await syncNow()).toMatchObject({ status: "paused" });
});

it("the real copy decision retries the approved push and Not now pauses later decisions", async () => {
  await fixtureApp({ connected: true, phone: [note({ title: "Phone version" })], remote: [note()] });
  await screen.findByText("The XPS copy has notes this phone doesn't");
  await click("Replace the XPS copy");
  await waitFor(() => expect(syncSession.getSnapshot().lastSyncedAt).toBe(AT));
  expect(server.requests.filter(({ path }) => path === "/v1/push").at(-1).body.confirm).toBeTruthy();
  await act(async () => { await importBackup(backupFixture({ notes: [note({ title: "Imported version" })] })); });
  await screen.findByText("The XPS copy has notes this phone doesn't");
  await click("Not now"); expect(await syncNow()).toMatchObject({ status: "paused" });
});

it("the list bar appears only for a copy decision, opens Sync, and failures stay in Settings", async () => {
  await fixtureApp({ connected: true, phone: [note({ title: "Phone version" })], remote: [note()] });
  await screen.findByText("The XPS copy has notes this phone doesn't");
  // Opening a sibling screen leaves the engine's decision pending.
  cleanup();
  window.history.replaceState(null, "");
  render(<App />); await idle();
  await screen.findByRole("button", { name: "The XPS copy needs your decision · Review" });
  await click("The XPS copy needs your decision · Review");
  await screen.findByRole("heading", { name: "Sync with the XPS" });
  expect(screen.queryByRole("button", { name: "The XPS copy needs your decision · Review" })).toBeNull();
  await click("Not now"); await click("Back"); await screen.findByRole("heading", { name: "Notes", exact: true }); await idle();
  act(() => syncSession.update({ error: { kind: "unreachable" } }));
  expect(screen.queryByText(/Couldn't reach the XPS/)).toBeNull();
  expect(screen.queryByRole("button", { name: "The XPS copy needs your decision · Review" })).toBeNull();
});
it.each([false, true])("Settings entry reads the connection state: %s", async (connected) => {
  syncSession.update({ connected });
  const onOpen = vi.fn(); render(<Settings {...props()} onOpen={onOpen} />);
  await screen.findByText("Images: 0 (1 KB)");
  await click(`Sync · ${connected ? "Connected" : "Off"}`);
  expect(onOpen).toHaveBeenCalledWith({ screen: "settings-sync" });
});
it("SyncBar ignores errors and proposals until Phase 4c", () => {
  syncSession.update({ error: { kind: "blocked" }, proposals: [{ id: "fixture" }] });
  const { container } = render(<SyncBar onOpen={vi.fn()} />);
  expect(container.textContent).toBe("");
});
