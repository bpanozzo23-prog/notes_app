import { useEffect, useState } from "react";
import { db, getPref, setPref, delPref, writeTransaction } from "../db/db.js";
import { loadClaudeSdk } from "./client.js";

export const claudeEnabled = "claudeEnabled";
export const claudeApiKey = "claudeApiKey";
export const claudeSpend = "claudeSpend";
export const claudeLastChange = "claudeLastChange";
export const CLAUDE_PREFS = Object.freeze([claudeEnabled, claudeApiKey, claudeSpend, claudeLastChange]);

export async function getClaudeStatus() {
  const [on, key] = await Promise.all([getPref(claudeEnabled), getPref(claudeApiKey)]);
  const enabled = on === true, hasKey = typeof key === "string" && key.trim() !== "";
  return { enabled, hasKey, ready: enabled && hasKey };
}
export async function readClaudeKey() {
  const key = await getPref(claudeApiKey);
  return typeof key === "string" ? key.trim() : "";
}
export const saveClaudeKey = (key) => setPref(claudeApiKey, key.trim());
export async function setClaudeEnabled(enabled) {
  await setPref(claudeEnabled, enabled === true);
  if (enabled) void loadClaudeSdk().catch(() => {});
}
export function removeClaudeKey() {
  return writeTransaction([db.prefs], async () => {
    await delPref(claudeApiKey);
    await setPref(claudeEnabled, false);
  });
}
const monthAt = (now) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
export async function readClaudeSpend(now = new Date()) {
  const spend = await getPref(claudeSpend);
  return spend?.month === monthAt(now) && Number.isFinite(spend.dollars) ? spend.dollars : 0;
}
export function addClaudeSpend(requestId, dollars, now = new Date()) {
  if (typeof requestId !== "string" || !requestId || !Number.isFinite(dollars) || dollars < 0) throw new Error("Invalid Claude usage total.");
  return writeTransaction([db.prefs], async () => {
    const month = monthAt(now);
    const saved = await getPref(claudeSpend);
    // A damaged record restarts this month's total rather than blocking the answer's bookkeeping.
    const spend = saved?.month === month && Number.isFinite(saved.dollars) && Array.isArray(saved.counted) ? saved : { month, dollars: 0, counted: [] };
    if (spend.counted.includes(requestId)) return;
    await setPref(claudeSpend, { month, dollars: spend.dollars + dollars, counted: [...spend.counted, requestId].slice(-100) });
  });
}
export function useClaudeStatus(refreshKey) {
  const [status, setStatus] = useState({ enabled: false, hasKey: false, ready: false });
  useEffect(() => {
    let alive = true;
    getClaudeStatus().then((next) => { if (alive) setStatus(next); }).catch(() => {});
    return () => { alive = false; };
  }, [refreshKey]);
  return status;
}
