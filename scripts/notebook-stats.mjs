#!/usr/bin/env node
// Numbers about the notebook in the sync store: its shape, the formatting in use and the editing
// rhythm recorded by the store's history (one git commit per sync round).
//
// Read-only: it runs git's read commands on the store and writes nothing there.
// It prints counts, sizes and dates, never note text. Titles, folder names and tag names appear
// only with --names; without it notes are N1, N2…, folders F1, F2…
//
//   npm run notebook-stats -- [store-repo-dir] [--names]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_REPO = path.join(os.homedir(), ".local/share/notes_app-sync/store");
const SESSION_GAP_MS = 30 * 60 * 1000; // edits to one note closer than this are one sitting
const DAY = 24 * 60 * 60 * 1000;
const NOTE_FILE = /^notes\/[a-f0-9]{64}\.json$/;
// App vocabulary, safe to print. Any other data-* attribute is counted by name only.
const VALUE_ATTRIBUTES = new Set(["data-callout", "data-style", "data-type", "data-checked", "data-collapsed"]);
const TOKEN = /^[#\w.-]{1,24}$/;

function reader(repo) {
  const base = ["--no-optional-locks", "-C", repo];
  const options = { maxBuffer: 2 ** 30, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } };
  return {
    text: (args) => execFileSync("git", [...base, ...args], { ...options, encoding: "utf8" }),
    // One `git cat-file --batch` call for every historical version.
    blobs(specs) {
      if (!specs.length) return [];
      const out = execFileSync("git", [...base, "cat-file", "--batch"], { ...options, input: `${specs.join("\n")}\n` });
      const blobs = [];
      let offset = 0;
      for (let i = 0; i < specs.length; i += 1) {
        const end = out.indexOf(10, offset);
        const size = Number(out.subarray(offset, end).toString().split(" ")[2]);
        if (end < 0 || !Number.isFinite(size)) throw new Error("unreadable-history-entry");
        blobs.push(out.subarray(end + 1, end + 1 + size).toString("utf8"));
        offset = end + 1 + size + 1;
      }
      return blobs;
    },
  };
}

const hash = (value) => createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 16);
const count = (map, key, by = 1) => { map[key] = (map[key] ?? 0) + by; };
const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
function weekKey(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
  return dayKey(monday);
}
const round = (value, digits = 1) => Number(value.toFixed(digits));
function spread(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return { n: 0 };
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { n: sorted.length, min: sorted[0], q1: at(0.25), median: at(0.5), q3: at(0.75), max: sorted.at(-1),
    total: round(sorted.reduce((sum, v) => sum + v, 0)) };
}
function buckets(values, edges, labels) {
  const out = Object.fromEntries(labels.map((label) => [label, 0]));
  for (const value of values) out[labels[edges.findIndex((edge) => value < edge)] ?? labels.at(-1)] += 1;
  return out;
}

// Counts of tags, attributes and style properties in one note's HTML. No text is kept.
export function scanHtml(html) {
  const tags = {}, attributes = {}, values = {}, styles = {}, distinct = { color: new Set(), "background-color": new Set(), "font-size": new Set(), "font-family": new Set() };
  let depth = 0, maxListDepth = 0, externalLinks = 0, noteLinks = 0;
  for (const match of html.matchAll(/<(\/?)([a-z0-9]+)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const closing = match[1] === "/", tag = match[2].toLowerCase();
    if (tag === "ul" || tag === "ol") {
      depth += closing ? -1 : 1;
      maxListDepth = Math.max(maxListDepth, depth);
    }
    if (closing) continue;
    count(tags, tag);
    for (const attr of match[3].matchAll(/\s([a-z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/gi)) {
      const name = attr[1].toLowerCase(), value = attr[2] ?? attr[3] ?? "";
      count(attributes, name);
      if (VALUE_ATTRIBUTES.has(name) && TOKEN.test(value)) count(values, `${name}=${value}`);
      if (name === "data-color" || name === "color") distinct["background-color"].add(value);
      if (name === "href") { if (/^note:/i.test(value.trim())) noteLinks += 1; else externalLinks += 1; }
      if (name === "style") {
        for (const part of value.split(";")) {
          const [property, ...rest] = part.split(":");
          const key = property.trim().toLowerCase();
          if (!key) continue;
          count(styles, key);
          distinct[key]?.add(rest.join(":").trim().toLowerCase());
        }
      }
    }
  }
  return { tags, attributes, values, styles, maxListDepth, externalLinks, noteLinks,
    distinct: Object.fromEntries(Object.entries(distinct).map(([key, set]) => [key, set.size])) };
}

function features(scan) {
  const { tags, values, styles } = scan;
  const taskLists = values["data-type=taskList"] ?? 0;
  const callouts = Object.entries(values).filter(([key]) => key.startsWith("data-callout=")).reduce((sum, [, n]) => sum + n, 0);
  return {
    heading1: tags.h1 ?? 0, heading2: tags.h2 ?? 0, heading3: tags.h3 ?? 0,
    bulletLists: Math.max(0, (tags.ul ?? 0) - taskLists), numberedLists: tags.ol ?? 0,
    checklists: taskLists, checklistItems: values["data-type=taskItem"] ?? 0, checkedItems: values["data-checked=true"] ?? 0,
    nestedLists: scan.maxListDepth > 1 ? 1 : 0, collapsedListLines: values["data-collapsed=true"] ?? 0,
    callouts, quotes: tags.blockquote ?? 0, dividers: tags.hr ?? 0,
    bold: tags.strong ?? 0, italic: tags.em ?? 0, underline: tags.u ?? 0, strike: tags.s ?? 0, code: (tags.code ?? 0) + (tags.pre ?? 0),
    highlight: tags.mark ?? 0, textColour: styles.color ?? 0, fontSize: styles["font-size"] ?? 0,
    typeface: styles["font-family"] ?? 0, lineSpacing: styles["line-height"] ?? 0,
    images: tags.img ?? 0, noteLinks: scan.noteLinks, externalLinks: scan.externalLinks, tables: tags.table ?? 0,
  };
}

function readHistory(git) {
  const commits = [];
  const log = git.text(["log", "--reverse", "--no-renames", "--name-status", "--format=%x01%H%x09%cI"]);
  for (const chunk of log.split("\x01").slice(1)) {
    const [head, ...lines] = chunk.split("\n");
    const [sha, date] = head.split("\t");
    const changes = lines.filter(Boolean).map((line) => { const [status, file] = line.split("\t"); return { status, file }; });
    commits.push({ sha, at: new Date(date), changes });
  }
  return commits;
}

export function collectStats(repo = DEFAULT_REPO, { names = false, now = new Date() } = {}) {
  const git = reader(repo);
  const commits = readHistory(git);
  if (!commits.length) throw new Error("The store has no history yet.");

  // Every recorded version of every note, the folder list and the preferences.
  const wanted = [];
  for (const commit of commits) {
    for (const change of commit.changes) {
      const tracked = NOTE_FILE.test(change.file) || change.file === "folders.json" || change.file === "preferences.json";
      if (tracked && change.status !== "D") wanted.push({ commit, file: change.file });
    }
  }
  const blobs = git.blobs(wanted.map(({ commit, file }) => `${commit.sha}:${file}`));
  const notes = new Map(); // file → { versions, purgedAt }
  const folderVersions = [], prefVersions = [];
  wanted.forEach(({ commit, file }, index) => {
    const value = JSON.parse(blobs[index]);
    if (file === "folders.json") folderVersions.push({ at: commit.at, folders: value });
    else if (file === "preferences.json") prefVersions.push({ at: commit.at, preferences: value });
    else {
      if (!notes.has(file)) notes.set(file, { versions: [], purgedAt: null });
      const entry = notes.get(file);
      entry.purgedAt = null;
      entry.versions.push({ at: commit.at, row: value });
    }
  });
  for (const commit of commits) {
    for (const change of commit.changes) {
      if (change.status === "D" && notes.has(change.file)) notes.get(change.file).purgedAt = commit.at;
    }
  }

  const folders = folderVersions.at(-1)?.folders ?? [];
  const folderOrder = [...folders].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const folderLabel = new Map(folderOrder.map((folder, index) => [folder.id, names ? folder.name : `F${index + 1}`]));
  const labelFor = (folderId) => (folderId === null || folderId === undefined ? "(no folder)" : folderLabel.get(folderId) ?? "(deleted folder)");

  const events = { moves: 0, renames: 0, titledLater: 0, trashed: 0, restored: 0, purged: 0, tagChanges: 0, pinChanges: 0 };
  const sessionsByHour = Array(24).fill(0), sessionsByWeekday = Array(7).fill(0), createdByHour = Array(24).fill(0);
  const sessionsPerDay = {}, createdPerWeek = {}, sessionsPerWeek = {}, sessionsPerFolder = {};
  const live = [], trashed = [], purged = [];
  const featureNotes = {}, featureTotals = {}, tagTotals = {}, attributeTotals = {}, valueTotals = {}, styleTotals = {};
  const tagUse = {};
  let serial = 0;

  for (const [, entry] of [...notes].sort((a, b) => a[1].versions[0].row.createdAt.localeCompare(b[1].versions[0].row.createdAt))) {
    serial += 1;
    const versions = entry.versions, last = versions.at(-1).row, created = new Date(versions[0].row.createdAt);
    count(createdPerWeek, weekKey(created));
    createdByHour[created.getHours()] += 1;

    const instants = new Set([created.getTime()]);
    const growthDays = new Set();
    let trashedAt = null;
    versions.forEach(({ at, row }, index) => {
      instants.add(new Date(row.updatedAt).getTime());
      if (index === 0) { if (row.deletedAt) trashedAt = new Date(row.deletedAt); return; }
      const before = versions[index - 1].row;
      if ((before.folderId ?? null) !== (row.folderId ?? null)) events.moves += 1;
      if (hash(before.title) !== hash(row.title)) { if (before.title) events.renames += 1; else events.titledLater += 1; }
      if (!before.deletedAt && row.deletedAt) { events.trashed += 1; trashedAt = new Date(row.deletedAt); }
      if (before.deletedAt && !row.deletedAt) { events.restored += 1; trashedAt = null; }
      if (hash(JSON.stringify(before.tags ?? [])) !== hash(JSON.stringify(row.tags ?? []))) events.tagChanges += 1;
      if (Boolean(before.pinned) !== Boolean(row.pinned)) events.pinChanges += 1;
      if ((row.text ?? "").length > (before.text ?? "").length) growthDays.add(dayKey(at));
    });
    if (entry.purgedAt) events.purged += 1;

    const sorted = [...instants].filter(Number.isFinite).sort((a, b) => a - b);
    const sessions = sorted.filter((time, index) => index === 0 || time - sorted[index - 1] > SESSION_GAP_MS);
    const editDays = new Set(sorted.map((time) => dayKey(new Date(time))));
    for (const time of sessions) {
      const date = new Date(time);
      sessionsByHour[date.getHours()] += 1;
      sessionsByWeekday[date.getDay()] += 1;
      count(sessionsPerDay, dayKey(date));
      count(sessionsPerWeek, weekKey(date));
      count(sessionsPerFolder, labelFor(last.folderId));
    }

    const text = last.text ?? "", scan = scanHtml(last.html ?? "");
    const base = {
      note: names ? (last.title || "(untitled)") : `N${serial}`, folder: labelFor(last.folderId),
      characters: text.length, words: text.split(/\s+/).filter(Boolean).length,
      created: dayKey(created), lastEdit: dayKey(new Date(sorted.at(-1))),
      sittings: sessions.length, editDays: editDays.size, growthDays: growthDays.size,
      lifespanDays: round((sorted.at(-1) - created.getTime()) / DAY), daysSinceEdit: round((now.getTime() - sorted.at(-1)) / DAY),
      recordedVersions: versions.length,
    };
    if (entry.purgedAt) { purged.push({ ...base, note: `purged-${purged.length + 1}`, purged: dayKey(entry.purgedAt) }); continue; }
    if (last.deletedAt) {
      trashed.push({ ...base, note: `trashed-${trashed.length + 1}`, folder: undefined,
        hoursToTrash: trashedAt ? round((trashedAt.getTime() - created.getTime()) / 3600000) : null });
      continue;
    }

    const used = features(scan);
    for (const [name, total] of Object.entries(used)) {
      if (!total) continue;
      count(featureNotes, name);
      count(featureTotals, name, total);
    }
    for (const [target, source] of [[tagTotals, scan.tags], [attributeTotals, scan.attributes], [valueTotals, scan.values], [styleTotals, scan.styles]]) {
      for (const [key, total] of Object.entries(source)) count(target, key, total);
    }
    for (const tag of last.tags ?? []) count(tagUse, tag);
    live.push({ ...base, titled: Boolean(last.title), titleLength: (last.title ?? "").length,
      tags: (last.tags ?? []).length, pinned: Boolean(last.pinned), quickAdd: Boolean(last.quickAdd), addDate: Boolean(last.addDate),
      linksOut: (last.linkedIds ?? []).length, images: used.images, maxListDepth: scan.maxListDepth,
      distinctTextColours: scan.distinct.color, distinctHighlights: scan.distinct["background-color"],
      distinctFontSizes: scan.distinct["font-size"],
      uses: Object.keys(used).filter((name) => used[name]) });
  }

  const linkedTo = new Set();
  for (const [, entry] of notes) {
    const row = entry.versions.at(-1).row;
    if (!entry.purgedAt && !row.deletedAt) for (const id of row.linkedIds ?? []) linkedTo.add(id);
  }

  const perFolder = {};
  for (const note of live) {
    const folder = (perFolder[note.folder] ??= { notes: 0, characters: 0, sittings: 0, lastEdit: "", images: 0 });
    folder.notes += 1;
    folder.characters += note.characters;
    folder.sittings += note.sittings;
    folder.images += note.images;
    if (note.lastEdit > folder.lastEdit) folder.lastEdit = note.lastEdit;
  }
  for (const label of folderLabel.values()) perFolder[label] ??= { notes: 0, characters: 0, sittings: 0, lastEdit: "", images: 0 };

  // Folder list changes over the history.
  const folderChanges = { versions: folderVersions.length, created: 0, deleted: 0, renamed: 0, reordered: 0,
    countFirst: folderVersions[0]?.folders.length ?? 0, countNow: folders.length };
  folderVersions.forEach(({ folders: current }, index) => {
    if (index === 0) return;
    const before = new Map(folderVersions[index - 1].folders.map((folder) => [folder.id, folder]));
    const ids = new Set(current.map((folder) => folder.id));
    let moved = false;
    for (const folder of current) {
      const old = before.get(folder.id);
      if (!old) folderChanges.created += 1;
      else {
        if (hash(old.name) !== hash(folder.name)) folderChanges.renamed += 1;
        if (old.position !== folder.position) moved = true;
      }
    }
    for (const id of before.keys()) if (!ids.has(id)) folderChanges.deleted += 1;
    if (moved) folderChanges.reordered += 1;
  });

  // Which formatting preferences changed, and how often (key names are app vocabulary).
  const prefChanges = {};
  prefVersions.forEach(({ preferences }, index) => {
    if (index === 0) return;
    const before = prefVersions[index - 1].preferences;
    for (const key of new Set([...Object.keys(preferences), ...Object.keys(before)])) {
      if (key !== "lastBackupAt" && hash(JSON.stringify(before[key])) !== hash(JSON.stringify(preferences[key]))) count(prefChanges, key);
    }
  });
  const prefs = prefVersions.at(-1)?.preferences ?? {};
  const size = (value) => (Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : value === undefined ? null : 1);
  const toolbarIds = (value) => (Array.isArray(value) ? value.map((item) => (typeof item === "string" ? item : item?.id ?? item?.type ?? "?"))
    .map((id) => (TOKEN.test(String(id)) && !String(id).startsWith("style") ? id : "(custom)")) : null);

  const head = (file, fallback) => { try { return JSON.parse(git.text(["show", `HEAD:${file}`])); } catch { return fallback; } };
  const files = head("files.json", {}), tombstones = head("tombstones.json", []);
  const proposalStatus = {};
  const proposalFiles = git.text(["ls-tree", "-r", "--name-only", "HEAD", "proposals/"]).split("\n").filter(Boolean);
  git.blobs(proposalFiles.map((file) => `HEAD:${file}`)).forEach((blob) => {
    try { const status = JSON.parse(blob)?.status; count(proposalStatus, TOKEN.test(String(status)) ? status : "(other)"); } catch { count(proposalStatus, "(unreadable)"); }
  });

  const firstCommit = commits[0].at, lastCommit = commits.at(-1).at;
  const firstCreated = new Date(Math.min(...[...notes.values()].map((entry) => new Date(entry.versions[0].row.createdAt).getTime())));
  const activeDays = Object.keys(sessionsPerDay).length;
  const spanDays = Math.max(1, Math.round((now.getTime() - firstCreated.getTime()) / DAY));
  const roundsPerDay = {};
  for (const commit of commits) count(roundsPerDay, dayKey(commit.at));
  const sittingsDesc = live.map((note) => note.sittings).sort((a, b) => b - a);
  const totalSittings = sittingsDesc.reduce((sum, n) => sum + n, 0);
  const characters = live.map((note) => note.characters);

  return {
    generated: now.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, namesShown: names,
    explain: {
      sitting: "edits to one note with no gap longer than 30 minutes",
      history: "one snapshot per sync round; edits made before the first round are known only from each note's created and edited dates",
      trash: "counts and dates only",
    },
    totals: { notes: live.length + trashed.length, live: live.length, trashed: trashed.length, purgedInHistory: purged.length,
      tombstones: Array.isArray(tombstones) ? tombstones.length : size(tombstones), folders: folders.length, images: Object.keys(files).length,
      imageBytes: Object.values(files).reduce((sum, file) => sum + (file?.size ?? 0), 0),
      characters: characters.reduce((sum, n) => sum + n, 0), words: live.reduce((sum, note) => sum + note.words, 0) },
    history: { rounds: commits.length, first: firstCommit.toISOString(), last: lastCommit.toISOString(),
      firstNoteCreated: firstCreated.toISOString(), roundsPerDay: spread(Object.values(roundsPerDay)) },
    shape: {
      perFolder,
      charactersPerNote: spread(characters),
      charactersBuckets: buckets(characters, [200, 1000, 5000, 20000], ["under 200", "200–1k", "1k–5k", "5k–20k", "20k+"]),
      untitled: live.filter((note) => !note.titled).length, titleLength: spread(live.filter((note) => note.titled).map((note) => note.titleLength)),
      empty: live.filter((note) => note.characters === 0).length,
      withTags: live.filter((note) => note.tags).length, distinctTags: Object.keys(tagUse).length,
      tagUse: names ? tagUse : Object.values(tagUse).sort((a, b) => b - a),
      pinned: live.filter((note) => note.pinned).length, quickAdd: live.filter((note) => note.quickAdd).length,
      addDate: live.filter((note) => note.addDate).length,
      withLinksOut: live.filter((note) => note.linksOut).length, linksOut: live.reduce((sum, note) => sum + note.linksOut, 0),
      linkedToByOthers: linkedTo.size,
      withImages: live.filter((note) => note.images).length, imagesPerNoteWithImages: spread(live.filter((note) => note.images).map((note) => note.images)),
    },
    formatting: {
      notesUsing: featureNotes, occurrences: featureTotals, ofLiveNotes: live.length,
      tags: tagTotals, attributes: attributeTotals, values: valueTotals, styleProperties: styleTotals,
      maxListDepth: spread(live.map((note) => note.maxListDepth)),
      distinctTextColoursPerNote: spread(live.map((note) => note.distinctTextColours).filter(Boolean)),
      distinctHighlightsPerNote: spread(live.map((note) => note.distinctHighlights).filter(Boolean)),
      preferences: { toolbar: toolbarIds(prefs.toolbar), toolbarLayout: typeof prefs.toolbarLayout === "string" ? prefs.toolbarLayout : size(prefs.toolbarLayout),
        selectionMenu: toolbarIds(prefs.selectionMenu), textColours: size(prefs.textColors), highlightColours: size(prefs.highlightColors),
        namedStyles: size(prefs.namedStyles), changesInHistory: prefChanges },
    },
    rhythm: {
      sittings: Object.values(sessionsPerDay).reduce((sum, n) => sum + n, 0), sittingsOnLiveNotes: totalSittings, activeDays, daysSinceFirstNote: spanDays,
      sittingsByHour: sessionsByHour, sittingsByWeekday: { Sun: sessionsByWeekday[0], Mon: sessionsByWeekday[1], Tue: sessionsByWeekday[2],
        Wed: sessionsByWeekday[3], Thu: sessionsByWeekday[4], Fri: sessionsByWeekday[5], Sat: sessionsByWeekday[6] },
      notesCreatedByHour: createdByHour,
      sittingsPerActiveDay: spread(Object.values(sessionsPerDay)), sittingsPerWeek: sessionsPerWeek, notesCreatedPerWeek: createdPerWeek,
      sittingsPerFolder: sessionsPerFolder,
      editDaysPerNote: buckets(live.map((note) => note.editDays), [2, 3, 6], ["1 day", "2 days", "3–5 days", "6+ days"]),
      sittingsPerNote: spread(live.map((note) => note.sittings)),
      shareOfSittingsInTop5Notes: totalSittings ? round(sittingsDesc.slice(0, 5).reduce((sum, n) => sum + n, 0) / totalSittings, 2) : 0,
      notesGrownOn3PlusDays: live.filter((note) => note.growthDays >= 3).length,
      daysSinceEdit: buckets(live.map((note) => note.daysSinceEdit), [3, 7, 14], ["under 3", "3–7", "7–14", "14+"]),
      lifespanDays: spread(live.map((note) => note.lifespanDays)),
    },
    events,
    folderChanges,
    trash: { notes: trashed.map(({ folder, ...rest }) => rest), purged },
    proposals: { files: proposalFiles.length, status: proposalStatus },
    notes: live,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const repo = args.find((arg) => !arg.startsWith("--")) ?? DEFAULT_REPO;
  try {
    process.stdout.write(`${JSON.stringify(collectStats(repo, { names: args.includes("--names") }), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`notebook-stats: ${error.message}\n`);
    process.exitCode = 1;
  }
}
