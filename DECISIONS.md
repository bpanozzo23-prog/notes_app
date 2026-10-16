# Decisions

Append-only. One dated line per decision: what was decided, then why, after the dash.

## Project

- 2026-10-14 — A separate repo, `notes_app`, not a feature of mi-cuaderno. — mi-cuaderno is a
  Spanish notebook built around a dictionary; a general notes app has different data, a different
  editor and different users of its output (an LLM). Patterns are copied, code is not shared.
- 2026-10-14 — Web app (PWA), not native Android. — It runs on all four of the owner's devices,
  can be built and deployed from the headless XPS, and the owner already has the toolchain. The
  native-only gains (widgets, a quick-settings tile) were judged not worth it.
- 2026-10-14 — Typed notes only; no ink. — The owner rarely writes with the S Pen. Matching
  Samsung's ink and handwriting recognition would dominate the project for a feature not used.

## Editor

- 2026-10-14 — Tiptap, pending the spike. — A ready-made ProseMirror editor with a plugin model
  that covers the owner's wishes (custom marks for colour and size, input rules, bubble menu,
  custom nodes for callouts). Known risk: ProseMirror's history with Android keyboards (stray
  newlines, duplicated characters with predictive text, marks invisible until a composition ends).
  Forum reports are old and inconclusive, so the spike tests it directly rather than reading more.
- 2026-10-14 — Notes are stored as HTML. — Colour, font size and underline are on the owner's
  list and have no Markdown form; HTML round-trips through Tiptap ~~exactly~~ within the supported
  vocabulary (corrected 2026-10-16 after Codex review: Tiptap keeps only what its configured
  extensions define, so the vocabulary is versioned and tested, and unknown pasted HTML is
  dropped, which doubles as sanitising), and Claude reads it.
- 2026-10-14 — Spike packages: StarterKit (already bundles underline, link, lists, undo), TextStyleKit
  (colour, font size), Highlight, TaskList/TaskItem. The separate underline, color and bubble-menu
  packages were installed then removed as redundant with v3's bundles.
- 2026-10-14 — `interactive-widget=resizes-content` in the viewport meta. — Chrome on Android
  otherwise keeps the layout viewport full height under the keyboard, so a bottom-fixed toolbar is
  hidden exactly when it is needed.

## Claude

- 2026-10-14 — Whole-notebook-in-context for questions, no embeddings. — At 20–40 notes, even a
  few hundred, every note fits in one request. An index would be work with no benefit at this
  scale; revisit only if the notebook grows past what a request holds.
- 2026-10-14 — Reuse mi-cuaderno's Phase 6 policy: owner's own key on-device, spend cap, off by
  default, propose-then-approve for any change. — Already thought through and lived with.

## Repo

- 2026-10-14 — `AGENTS.md` is the one instructions file; `CLAUDE.md` is only `@AGENTS.md`. — Claude
  Code follows the `@` import, so one file serves both tools (the pattern from `research-workflow`).
  mi-cuaderno's three-file layout predates that and is not copied.

## Spike result

- 2026-10-14 — **Tiptap passes on the Galaxy S25 Ultra with Samsung Keyboard; it is the editor.**
  Owner-verified in Chrome: predictive text, swipe typing, Enter/Backspace, mid-word bold, the
  selection pop-up, highlight across paragraphs, `## ` / `- ` / `[] ` / `---` typing shortcuts,
  paste from Samsung Notes and Chrome, and a bottom-fixed toolbar that stays above the keyboard.
  None of the forum-reported Android failures (stray newlines, duplicated characters) appeared.
- 2026-10-14 — Build the editor command chain per tap, never during render. — The first spike
  cached `editor.chain().focus()` at render; a chain carries a snapshot of the document, so later
  taps were rejected (dead toolbar) or, once, applied over newer text (cursor jumped to an old
  position typing bold). Toolbar state comes from `useEditorState`, since Tiptap v3 does not
  re-render on every transaction.
- 2026-10-14 — Editor DOM carries `autocorrect="on"`, `autocapitalize="sentences"`,
  `spellcheck="true"`. — Without them Samsung Keyboard only underlined misspellings; with them it
  corrects on space, as in native apps.
- 2026-10-14 — Buttons use `onPointerDown` `preventDefault` to keep focus in the editor. — Keeps
  the keyboard open across a toolbar tap; the earlier touchstart/touchend handling was replaced
  with this simpler form at the same time as the chain fix.

## Phase 1 (planned 2026-10-14, Codex-reviewed and approved 2026-10-16)

- 2026-10-16 — Codex implements; Claude directs, reviews and commits; the owner verifies on the
  phone. — The owner has ample Codex usage; keeping Claude as reviewer puts a second pair of eyes
  on every step. Codex runs non-interactively (`codex exec --sandbox workspace-write`) from a
  self-contained task per step and cannot commit, push or leave the repo.
- 2026-10-16 — Trash with 30-day purge and tombstones, not hard delete. — Codex: confirmation
  cannot recover a mistaken delete, and Phase 4 sync needs a record that a note was deleted or the
  other device resurrects it. Purge leaves a `tombstones` row; links to a purged note lose their
  href and keep their text.
- 2026-10-16 — Every write bumps an integer `rev`; `updatedAt` moves only on content edits. —
  Recency for the list and change detection for Phase 3 (apply Claude's edit only if `rev` still
  matches) and Phase 4 (conflicts) are different needs; one field cannot serve both.
- 2026-10-16 — UUIDs from `crypto.getRandomValues`, not `crypto.randomUUID`. — `randomUUID` exists
  only on secure (HTTPS or localhost) pages; the phone's dev URL is plain HTTP over Tailscale.
- 2026-10-16 — `pinned` and `folderId` are not indexed; filters run in memory. — IndexedDB cannot
  index booleans or null, and the whole notebook is loaded anyway at this scale.
- 2026-10-16 — Autosave: 400 ms debounce, 2 s maximum wait, flush on blur, leave, hidden and
  pagehide; per-note serialised writes; visible "Not saved" on failure. — Codex: a plain trailing
  debounce never fires under continuous typing and silent failure loses notes.
- 2026-10-16 — Service worker `registerType: "prompt"`, banner suppressed while a save is pending.
  — vite-plugin-pwa's autoUpdate reloads the page and can discard unsaved input.
- 2026-10-16 — Backup import previews counts and confirms; Delete and Import are the two confirmed
  actions. — Import replaces the whole notebook, which is as destructive as delete.
- 2026-10-16 — Backup preferences come from an explicit allow-list. — So the Phase 3 API key can
  never be exported by omission.
- 2026-10-16 — Internal links are `note:<uuid>` hrefs with `Link` configured to accept that
  protocol and refuse all but `https:`, `mailto:` and `note:`; clicks route through app
  navigation. — Tiptap's default validator rejects unknown protocols, and the browser must never
  try to open a `note:` URL.
- 2026-10-16 — Deploy to GitHub Pages in step 1b, before search and links. — The dev server and
  the published app have separate browser storage; trial notes should accumulate in the real one.

## Phase 1a implementation

- 2026-10-16 — Live notes use a filtered scan; Trash uses the `deletedAt` index. — IndexedDB
  omits null values from indexes, so the direction's suggested indexed lookup for live notes is
  not possible. The small notebook makes a scan appropriate.
- 2026-10-16 — New notes start at `rev: 1`; identical content patches still increment `rev` but
  do not advance `updatedAt`. — A write and an actual content change are different events.
- 2026-10-16 — Folders contain `{ id, name, position }`, with zero-based integer positions;
  reorder accepts a complete permutation. — No folder timestamps or partial-reorder rules are
  needed for this step, and an incomplete reorder must not silently drop a folder.
- 2026-10-16 — Restoring a note also neutralises links to existing tombstones without changing
  recency. — A source note can be in Trash when its target is purged, so live-only purge cleanup
  would otherwise leave a permanently broken link after restore.
- 2026-10-16 — The save queue injects its clock, timer functions and writer; failed patches stay
  in memory and merge underneath newer fields. Retry waits for the next schedule or flush, and
  flush rejects on failure. — Avoids a retry loop against full storage, preserves the latest edit,
  and stops navigation or backup replacement from proceeding with an unsuccessful save.
- 2026-10-16 — NoteEditor keys its inner editor by note id, creating a new editor on a switch.
  — This resets document and undo history together through React's lifecycle; same-id updates
  never reload saved HTML into the active editor. The screen is inert during awaited navigation
  and destructive actions so new typing cannot race a completed flush.
- 2026-10-16 — Backup validation reports `warnings` separately from blocking `errors`, requires
  canonical UTC timestamps and positive revisions, and rejects duplicate ids across tables.
  — Dates must sort correctly in string indexes; a live note and its tombstone cannot coexist.
  Missing note links remain importable and are shown in the preview.
- 2026-10-16 — Schema 1 is the first backup format; no schema-0 format is invented. Pure upgrade
  functions and validators run one version at a time, with synthetic future versions testing the
  runner until a real v2 exists. — Keeps the upgrade path explicit without pretending to support
  files that were never produced by this app.
- 2026-10-16 — Vitest uses jsdom and fake-indexeddb, with a fresh database before every database
  test; text helpers also run in Node without a DOM. Component tests exercise the real Tiptap
  editor and seeded data. — Covers storage, failure recovery and editor lifecycle without access
  to the owner's notes; physical keyboard and download behavior remain phone checks.
- 2026-10-16 — Importing a backup replaces only the exportable preferences; device-local ones
  survive. — Review fix: clearing the whole `prefs` table on import would have wiped a Phase 3
  API key, which is never in a backup, every time the owner restored one.

## Phase 1b implementation

- 2026-10-16 — One versioned stack lives under `history.state.notesNavigation`; each visit has
  a screen, optional note id or list filter, a visit key and vertical scroll position. — No router,
  per-tab stacks or note URLs are needed. Restored state is allowlisted and sanitised. Missing or
  trashed destinations become the previous list; missing folder filters become All. Other owners'
  history-state fields are retained. Scroll restoration is manual, with a per-visit memory copy
  for a just-popped entry that the browser no longer lets us rewrite.
- 2026-10-16 — New-note creation reserves one history visit and immediately replaces it with
  the persisted note. — Back returns directly to the filtered list; there is no draft/missing-note
  entry. Ordinary moves push a visit. Filter changes replace the current list visit.
- 2026-10-16 — Back leaves the editor mounted and inert (temporarily unable to accept input)
  while the save queue flushes. A failed Back returns the browser with `history.go(1)` and keeps
  Not saved visible. Repeated Back presses coalesce; recovery uses the full traversed distance,
  and a failed Forward reverses direction. — A slow write must neither discard the current editor
  nor retry in a loop during recovery. UI actions and history changes share one operation guard.
- 2026-10-16 — `useNotebook()` owns live notes, Trash, ordered folders and preferences, refreshed
  on boot, navigation and mutations. — Explicit refreshes are enough for this one-owner app and
  avoid a new state library. Current editor content stays local and never receives save echoes.
  Tags are derived from live notes, ordered by frequency then name; pinning sorts before recency.
- 2026-10-16 — Confirmations and the folder sheet share a focus-trapped dialog with an inert
  background, Escape dismissal and focus restoration. Cancel receives initial confirmation focus;
  failures are also shown inside the dialog. — Destructive actions remain deliberate and usable
  with a keyboard or screen reader. Folder deletion counts notes in Trash as well as live notes.
- 2026-10-16 — Delete now is restricted to Trash and shares the existing purge transaction:
  remove the note, write a tombstone, neutralise live links without changing their recency. —
  Immediate deletion must obey the same durability and future-sync rules as expiration.
- 2026-10-16 — The update banner stays visible with Reload disabled and a reason during pending,
  saving or failed saves. This supersedes the earlier “banner suppressed” wording, as requested
  for step 1b. Reload flushes again and locks editing while activation is requested; the final
  service-worker activation callback also flushes, including activation initiated by another tab.
  A failed flush keeps the app open for explicit retry. The initial offline-ready message lasts
  four seconds. Registration failures appear in Settings.
- 2026-10-16 — The Vite base is `/notes_app/`; HTML icon paths use `%BASE_URL%` and manifest
  icons are relative. Service-worker registration uses the plugin's generated base-aware code.
  The workflow matches the requested Node 24 and Pages action versions. — No runtime path assumes
  mi-cuaderno's deployment. Creating the GitHub repo, enabling Pages and pushing are left to the
  reviewer under this task's explicit instructions; no commit, package install or deploy was done.
- 2026-10-16 — Tests use jsdom, fake-indexeddb and seeded fixtures, with the PWA virtual module
  replaced only in the test configuration. — Actual Android keyboard/Back gestures, the 375 px
  layout, download completion, installed offline startup and two-build update behavior still need
  owner verification. Search and internal-link navigation remain deferred to 1c.
