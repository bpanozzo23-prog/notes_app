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

## Phase 1b deployment and verification

- 2026-10-16 — The GitHub repository `bpanozzo23-prog/notes_app` was created public and Pages was
  enabled with the Actions source through the GitHub API (`gh api -X POST
  repos/bpanozzo23-prog/notes_app/pages -f build_type=workflow`); the first workflow run published
  `https://bpanozzo23-prog.github.io/notes_app/`. — Public repo, notes never in it, as decided on
  2026-10-14.
- 2026-10-17 — The owner verified 1b on the published app (install, Back, saving across app
  switches and process kill, Trash restore/delete, export, clear site data, import, airplane-mode
  reopen): "Everything works so far". The update prompt gets its first real test when 1c deploys.

## Phase 1c implementation

- 2026-10-17 — The link sheet searches live notes other than the current note, most recently
  edited first. A selection keeps its text and gains a `note:<id>` link; an empty selection gets
  the target's displayed title followed by an unmarked space. The editor receives focus before
  opening the sheet so the dialog restores it on selection or cancellation. — Links use the
  existing HTML/save projection and need no new storage fields.
- 2026-10-17 — Link text is a snapshot when inserted; renaming the target does not rewrite it.
  — The owner may deliberately label a link differently, and title edits should not modify other
  notes. The destination still resolves by id; picker and backlink rows use its current title.
- 2026-10-17 — One selection bubble also appears for a cursor inside a link, with Open note or
  Open link and Remove link before the formatting actions. Remove link covers the whole link
  mark; web/mail links open only from that explicit button, in a separate browsing context with
  `noopener`. Bubble taps do not trigger the blank-body focus-at-end handler. — Editing a web
  link must remain possible, and a second bubble would compete for the same selection.
- 2026-10-17 — Tapping an internal link uses the existing save-protected navigation. A trashed
  target says "That note is in the Trash. Restore it from the Trash to open it."; an absent target
  says "That note no longer exists." Both leave the current note open. — This refines the plan's
  generic deleted message so recoverable targets are distinguishable from missing imports or
  purged notes. Linked from uses the live notes already in memory, pinned first then recent.
- 2026-10-17 — Search requires every normalised word somewhere in title or body, combines with
  folder/tag chips, and excludes Trash. A trimmed, control-free query of at most 200 characters
  lives in the list's history entry; invalid queries are dropped. Query changes replace that
  entry without scrolling, and Back restores it. The input keeps unfinished trailing spaces
  locally while typing. — No search index or extra history visit per keystroke is needed.
- 2026-10-17 — Step 1c passes 201 fixture-based tests and the production build (Vite reports its
  large-chunk warning). No requested implementation is deferred; no commit, installation or
  deployment was performed. — Automated checks exercise the real editor and save queue, with
  browser geometry substituted in jsdom. The agent has not seen the phone: picker focus, bubble
  placement, keyboard composition, long-note scrolling and Android Back still need owner review.

## Phase 1d closeout

- 2026-10-17 — Codex reviewed `git diff phase-1-base...HEAD` (read-only `codex exec`, xhigh)
  against the plan. It found one P1 and three smaller issues; all are addressed below. —
  Independent review before declaring Phase 1 done, as the plan required.
- 2026-10-17 — The save queue runs "before flush" hooks, and the Note screen registers one that
  forces ProseMirror's DOM observer to hand over input it is still holding
  (`forceFlush()` then `flush()`). — Codex reproduced a lost deletion: on Android, ProseMirror
  delays some deletions by 20 ms inside its observer, and an update reload (or any flush) inside
  that window saved the old text. Every flush now drains the editor first; a test drives the
  delayed path.
- 2026-10-17 — `storagePersisted` is no longer exported; backups that contain it are accepted
  with a warning and the value is dropped on import. Import requests persistence afterwards,
  through the same helper as the first note. — The flag is this device's answer, not the
  notebook's: restoring it suppressed the persistence request on a fresh browser.
- 2026-10-17 — Backup validation uses the same id rule as navigation (`SAFE_STRING` in
  `src/lib/ids.js`: nonblank, no control characters, at most 512 characters) for note, folder and
  tombstone ids, folder names and tags. — A backup could previously import notes that history
  state then refused to open.
- 2026-10-17 — Deleting a folder bumps affected notes' `rev` but not `updatedAt`; the test
  asserts this on purpose. — Codex flagged it as a plan deviation ("folder edits bump
  `updatedAt`"). Decision: that rule is for the owner changing one note's folder; a folder
  deletion is housekeeping that should not push every affected note to the top of the list.
  `rev` still records the write for sync.
- 2026-10-17 — Tag field and its Add button wrap as one unit; folder rows put name and actions
  on one line. — Found in the headless phone-size screenshots (`npm run shots`).
- 2026-10-17 — The owner starts the notebook fresh rather than migrating Samsung Notes. — Decided
  after Phase 1 closed; no import tooling for Samsung's format is needed, and the Phase 2 image
  work only has to cover new images, not screenshots carried over from old notes.


## Phase 2 (planned, Codex-reviewed and approved 2026-10-17)

- 2026-10-17 — Owner answers before planning: toolbar layout chosen in Settings (one swiping
  row, two rows, or one row + More); starter text/highlight palettes the owner reorders and
  hides, plus custom colours; named styles also set typeface, line spacing and optionally a
  heading level, and style the whole line when nothing is selected; the painter applies once;
  four fixed callout types; "page-break line" means divider styles; images are shrunk. — The
  formatting layer is the owner's own design; these were the choices the repo could not answer.
- 2026-10-17 — The schema version covers the HTML vocabulary: v2 in 2a (preferences), v3 in 2c
  (highlight colours, line spacing, callouts, divider styles), v4 in 2e (images). — Codex
  reproduced an editor without a node dropping that content on its next save; one version for
  the whole phase would have let intermediate builds erase later content.
- 2026-10-17 — A build that opens a newer database goes read-only (no edits, import or export);
  a synchronous `versionchange` handler flushes before closing; a device-local
  `notebookGeneration` changed by import makes every other window's writes fail and lock. —
  Codex showed Dexie silently reopens a newer database for old code, and that an import does
  not stop another window's queued save from overwriting the restored notebook. Web Locks need
  HTTPS, which the phone's dev URL lacks.
- 2026-10-17 — Unused image files are marked at app start and deleted after 30 days unused, not
  one day after creation. — Codex: creation age does not protect Undo or cut-and-paste across
  windows; the unused clock does, and matches Trash's 30 days.
- 2026-10-17 — Image insertion is a pending operation the save queue waits for, inserted
  through a mapped placeholder. — Codex reproduced `flush()` returning before an asynchronous
  hook's edit; Back, reload or export could otherwise finish before the image is in the note.
- 2026-10-17 — File references are derived from HTML wherever needed and never stored. — One
  source of truth; Codex flagged stale stored references causing valid images to be skipped.
- 2026-10-17 — Images: a `files` table of `ArrayBuffer` rows referenced by `<img data-file>` with
  no `src`; shrunk to ≤ 2,560 px WebP (JPEG if WebP encoding is unavailable); backups carry
  referenced files as base64 in the same JSON file, assembled from Blob parts; the practical
  size ceiling is measured on the phone in 2e. — Keeps autosave small and the one-file backup
  flow; BRIEF §9 rules out `blob:` URLs in notes.
- 2026-10-17 — Callouts live only at the top level (`Document` content `(block | callout)+`);
  line spacing is a block attribute with its own commands; highlight colours use multicolour
  `<mark data-color>` with plain `<mark>` still meaning yellow; divider styles are
  `<hr data-style>` with plain `<hr>` meaning thin. — Schema-enforced, no nesting to manage, and
  Phase 1 notes need no conversion.
- 2026-10-17 — Named styles and the painter replace the formatting in their range (links kept,
  code skipped); styles are snapshots. — The result always looks like the style; BRIEF §9.
- 2026-10-17 — Cosmetic preferences in a backup never block a restore: invalid values and
  unknown keys in v2+ are warnings. The v1 validator is unchanged. — Notes matter more than
  toolbar settings.
- 2026-10-17 — Reordering uses ↑/↓ plus Move to top/bottom; no drag library. — Drag competes
  with scrolling on a phone and the maintained library is pre-1.0; Codex suggested dropping the
  drafted pick-and-place "Move…" to keep scope down.

## Phase 2a implementation

- 2026-10-17 — Compare `db.backendDB().version / 10` with the app schema, at boot and inside
  the shared write guard. — Installed Dexie 4.4.6 retries a `VersionError` without a requested
  version, but keeps `db.verno` at the declared version for an explicit schema (2 while the
  native database is 30). A higher-version fixture reproduces this; using `verno` alone would
  leave the newer notebook writable.
- 2026-10-17 — The database's `versionchange` subscriber synchronously returns `false`; the
  app locks, drains the existing save queue, and closes only after a successful flush. — Dexie's
  `reverseStoppableEventChain` compares the immediate return value with `false`; an async handler
  returns a Promise and allows the default handler to close. Failed flushes retain the connection
  and Retry; dialog portals also close so they cannot leave an editing surface outside the lock.
- 2026-10-17 — Every writer shares a transaction wrapper that includes `prefs` and checks the
  window's remembered generation before touching rows; exports check in their read transaction
  too. — The generation check and mutation must be indivisible with respect to an import. Import
  adopts and broadcasts its new generation only after commit, and a stale window stops its save
  timers without discarding its in-memory text. Guard notifications leave Dexie's transaction
  context so React's subsequent work does not inherit a transaction that is being aborted.
- 2026-10-17 — Explicitly empty formatting lists are kept; nonempty lists with no valid entries
  use the defaults. Invalid palette/style entries are dropped whole, while valid neighbours,
  safe unknown action ids and duplicate toolbar buttons survive. — Empty toolbars, hidden-all
  palettes and deleting all styles are valid customisations; incomplete style definitions cannot
  promise the requested formatting. Names also reject the C1 control-character range.
- 2026-10-17 — The eight extra text colours are Black, Grey, Brown, Orange, Teal, Cyan, Indigo
  and Pink; highlights are Yellow, Orange, Red, Pink, Purple, Blue, Green and Grey. — These give
  a useful spread without changing the four existing text buttons; computed contrast tests
  enforce 4.5:1 against white for text and against near-black for highlights.
- 2026-10-17 — Keep v1's original preference allow-list separate from the expanded export
  allow-list, and reuse its table validation for v2. — Growing the shared list would silently
  change which v1 files validate; v2 alone sanitises cosmetic settings and ignores unknown keys.
