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
- 2026-10-17 — The owner verified 2a on the published app: update applied, notes intact,
  schema 2 shown, export/import round trip, the pre-update v1 backup previews as "will be
  upgraded", selection pop-up unchanged: "Everything checks out."

## Phase 2b implementation

- 2026-10-17 — The selection pop-up puts overflow behind ⋯ More in its last slot, opening
  the same tray as the toolbar; it no longer scrolls its second row sideways. — The step 2b
  task explicitly changes the direction file so both surfaces behave the same way.
- 2026-10-17 — Toolbar buttons stay 40 px wide with 2 px gaps; the measured content width
  determines capacity, and the Settings preview supplies that same capacity to the list's
  More divider. Unknown ids consume no slots. — The preview and the note must agree at phone
  width and after a resize, including with imported unavailable or duplicate buttons.
- 2026-10-17 — A cursor inside a link keeps Open and Remove link on the first pop-up row;
  formatting uses the second row with More as needed. — Keeps the existing readable link
  commands and still honours the two-row limit.
- 2026-10-17 — The row's ⋮ opens the shared sheet for Move to top, Move to bottom and Remove.
  — Reuses the existing phone-sized targets, focus handling, Escape and Android Back behaviour
  instead of adding another kind of menu.
- 2026-10-17 — Mounted dialogs and trays register dismissal callbacks with navigation; the
  most recently opened overlay closes first, and history recovers without a flush or a new
  visit. Busy operations retain their existing Back handling. — One shared path covers old
  confirmations, pickers and import as well as the new sheets and trays.
- 2026-10-17 — Reset removes the toolbar and layout preferences in one guarded transaction;
  the pop-up reset removes only its own preference. — A failed reset cannot leave half a
  toolbar reset behind, and absent preferences keep following future defaults.
- 2026-10-17 — Finger and pen share the 500 ms label gesture; movement over 10 px cancels
  both the label and that tap. Pen hover optionally labels after 300 ms. — A swipe must not
  accidentally format text; hover is an extra and no action depends on detecting a pen.
- 2026-10-17 — The pop-up's Floating UI boundary reserves the positioning gap as well as
  an 8 px edge. — The 375 × 450 screenshots caught Tiptap applying its gap after the boundary
  shift, clipping 4 px off the top.
- 2026-10-17 — The Add sheet initially focuses its first group heading. — At reduced height,
  automatic focus on the first enabled Add button scrolled past the sheet's title.
- 2026-10-17 — Done stays in a separate footer outside the Add sheet's scrolling rows. —
  Keeps it reachable without rows peeking below or being covered by a sticky button.

## Phase 2c implementation

- 2026-10-17 — Empty-line Enter inside a callout lifts that line directly to the document.
  — The installed ProseMirror default only splits the wrapper on a middle line, leaving the
  empty paragraph inside the second callout. A narrow shortcut supplies the promised plain
  line between callouts; first-line Backspace keeps the tested default behavior.
- 2026-10-17 — StarterKit's automatic trailing paragraph excludes callouts, while keeping its
  existing behavior for every Phase 1 block. — A callout already has editable content and an
  explicit Enter exit; automatically adding another paragraph produced two empty exit lines.
- 2026-10-17 — Callout commands lift whole touched wrappers before wrapping the top-level range,
  using ProseMirror's position mapping to retain the selection. — This merges complete contents
  without nesting, replacing text, or splitting one tap across undo steps.
- 2026-10-17 — Divider attributes use `dividerStyle`, not `style`. — The step's explicit task
  corrects the direction file: Tiptap merges a property named `style` into inline CSS.
- 2026-10-17 — Backup upgrades accumulate and deduplicate warnings across versions. — The
  second upgrade otherwise erased v2's warnings after sanitisation, silently hiding dropped
  preferences from an owner importing a v1 file.
- 2026-10-17 — Size previews stop growing at 20 pt; the actual choices still apply 24 and 28 pt.
  — Keeps all size options usable in a tray above an open keyboard.
- 2026-10-17 — Colours and toolbar lists share the arrow/menu controls and reorder helper; the
  colour form uses a separate fixed footer for Cancel/Add. — Reuses the existing focus and
  overlay behavior and leaves the form actions reachable at reduced phone height.

## Phase 2d implementation

- 2026-10-17 — Named styles use Paintbrush and the format painter uses PaintRoller; style
  buttons share an “Aa” preview, with size omitted on the toolbar and capped at 20 pt in rows,
  trays and the form. — Reuses the installed icons and 2c's preview cap at phone width.
- 2026-10-17 — The style form uses native selects for size, typeface, spacing and line type,
  with text toggles and palette swatches; its full-height Dialog keeps errors and actions in a
  separate fixed footer. — Long choices remain readable and Save stays reachable at 375 × 450.
- 2026-10-17 — An explicit null spacing means the style's Default: clear block and legacy
  inline spacing. Omitted spacing leaves the line alone for the painter. — The shared helper
  must distinguish resetting a style's spacing from copying only its text look.
- 2026-10-17 — Style saves and deletion read current preferences inside the guarded transaction;
  a toolbar switch left unchanged does not store a toolbar, and deletion writes only lists that
  contained that style. — Defaults keep following future improvements, and a failed write rolls
  back the definition and all affected button lists together.
- 2026-10-17 — Applying a look starts a separate undo event and, when needed, adds StarterKit's
  trailing paragraph in that same transaction before setting empty-line stored marks. — The
  editor's later automatic paragraph transaction otherwise discards the next-typing look when an
  empty final paragraph becomes a heading.
- 2026-10-17 — The selection pop-up reserves the measured height of the toolbar, painter hint
  and open tray when positioning itself. — The first screenshot run caught Apply format behind
  the hint bar; a viewport-only boundary left the button visible but untappable.
- 2026-10-17 — The owner verified 2b on the published app (layouts, ⋯ More with the keyboard
  open, Back closing overlays, long-press labels, pop-up settings, export/import of the
  toolbar): "2b checks out on my end."

## Phase 2e implementation

- 2026-10-17 — Cleanup reads and writes one file row at a time inside its guarded transaction,
  changing only `unusedSince`; it does not use Dexie's collection `modify`. — A fixture test
  reproduced `modify` deep-cloning an ArrayBuffer into an empty object across realms. The
  regression test compares the bytes as well as the mark, so cleanup cannot silently erase them.
- 2026-10-17 — Each mounted note has one serial image-processing lane; each picker, paste or
  drop batch has its own mapped position marker, advanced after each successful image. The
  picker reserves its position when opened and removes it on cancellation. — Typing can continue
  during processing, multiple batches retain their destinations, and navigation waits for their
  edits without cancelling them just because the screen becomes busy.
- 2026-10-17 — JPEG headers also supply EXIF orientation when available, so bitmap resize
  requests use the displayed axes for rotated camera photos. The bitmap's actual dimensions
  still determine the final canvas size. — A quarter-turn photo must stay upright and preserve
  its proportions whether or not the browser honours bitmap resizing.
- 2026-10-17 — Image failures appear beside the toolbar with Dismiss and are also passed to
  the screen message, so a failure while Back waits remains visible after navigation. Unexpected
  decoder/storage details become the safe image error; quota failures get the specific storage
  message. — Each failed file remains independent of the rest of a batch and of text saves.
- 2026-10-17 — The image viewer uses the existing full-screen Dialog with an optional full-width
  body; its controls stay outside the scrolling image area. The URL cache shares pending reads
  and refuses to create a URL for a released or cleared read. — Keeps Back/Escape/focus behaviour
  shared with existing overlays and avoids leaking late object URLs.
- 2026-10-17 — Backup validation checks canonical base64 padding and trailing bits without
  decoding; file objects remain shared during upgrades. Downloads serialize the envelope and
  each image separately; restore decodes and writes one image at a time in the transaction.
  — Limits peak extra memory while retaining the one-file safety backup and atomic replacement.
- 2026-10-17 — The task's explicit backup dimension limit is 10,000 per axis; new insertions
  still shrink to 2,560 on the long edge. Sizes shown in MB use 1,024 × 1,024 bytes and the
  provisional comfortable-backup threshold is 150 MB. — The task is more specific than the
  direction file's shared-limits wording; the threshold awaits the owner's phone measurement.
- 2026-10-17 — A shared Node PNG generator supplies the public sample landscape, temporary
  screenshot input and 320 × 320 noise images for measurement (about 300 KB each). — Generated
  pixels only, with measurement backups kept under the ignored `private-data/image-backups/`.
- 2026-10-17 — The viewer body fills the space above its fixed footer and Actual size has a
  visible pressed state. Screenshot steps scroll the image and import preview into view at
  reduced height. — Inspection at 412 × 839, 375 × 667 and 375 × 450 caught unused space below
  the first viewer footer and off-screen preview counts; all three 69-screen runs then passed.
- 2026-10-17 — Unreleased schema 4 splits image metadata into `files` (indexed by
  `unusedSince`) and bytes into `fileData`, refining the direction file's single file-row shape
  and the earlier cleanup choice above. — Boot cleanup and Settings must never read image
  bytes; index keys identify marks and expiry, and only changing metadata rows are read/written.
  Creation, cleanup deletion and import keep both tables together in guarded transactions;
  display/export read both in one transaction and treat either missing half as a missing image.
  The v4 backup envelope stays unchanged.
- 2026-10-17 — Settings and the import preview show sizes under 1 MB in KB and quotas over
  1 GB in GB, and say "1 image". — Review fix: the screenshots showed "Images: 2, 0.0 MB".
- 2026-10-18 — The owner verified 2c and 2d on the published app: "Everything checks out."
- 2026-10-18 — A single `heading` picker (Normal text, Heading 1–3, each drawn at its size, the
  current one marked) replaces `h1` and `h2` in the default toolbar; the separate heading
  buttons stay in the Add sheet. — The owner asked to combine the heading options into one
  button. A stored (customised) toolbar is not changed: the owner swaps the buttons in
  Settings → Formatting → Toolbar.

## Phase 2f closeout

- 2026-10-18 — Codex reviewed `git diff phase-2-base...HEAD` read-only (xhigh) against the
  direction file. It reproduced two P1s (an image abandoned when another window upgrades the
  database mid-insertion; a re-used image keeping an old unused mark), three P2 defects
  (nested dialogs leaving the app inert, the heading tray lifting lines out of callouts and
  lists, line spacing dropping typing formatting) and a missing Named styles Reset; all are
  fixed below with a reproducing test each. Its remaining P2, the phone backup-size
  measurement, is the owner's and stays open; `COMFORTABLE_BACKUP_BYTES` stays provisional at
  150 MB until then. — Independent review before calling Phase 2 done, as the plan required.
- 2026-10-18 — Tracked image insertions may finish while a database upgrade is pending; new insertions are refused immediately. — Review finding 1: the upgrade drain must save the image reference before closing, even while DialogLock blocks new input.
- 2026-10-18 — Creating, saving HTML and restoring notes clear referenced images' unused marks in the same guarded transaction, reading only metadata and writing only marked rows. — Review finding 2: reuse must restart the 30-day grace period after a later removal, without loading image bytes.
- 2026-10-18 — Dialogs share a module-level background lock whose open layers count its references; only the last close restores the original inert and overflow values, while focus restoration stays per dialog. — Review finding 3: deleting a style closes both dialogs in one commit and must leave the app usable.
- 2026-10-18 — The heading tray and named-style application share a block-type helper that preserves attributes, skips matching or disallowed types, and never lifts or unwraps lines. — Review finding 4: choosing the current heading or Normal text must preserve callouts, quotes and lists.
- 2026-10-18 — Line spacing captures stored typing marks before changing blocks and restores them with only inline spacing removed. — Review finding 5: changing spacing, including Default, must retain bold, colour and size prepared for typing.
- 2026-10-18 — Named styles gains a confirmed Reset that deletes its preference and removes nondefault style references from toolbar and selection pop-up in one guarded transaction. — Review's Named styles Reset finding (7 in the report, task item 6): restore defaults without leaving dangling buttons or partially saved preferences.
- 2026-10-18 — The owner verified 0.2.5 on the published app (version shown, the heading panel inside a callout, deleting a style from its edit screen): "The phone checklist checks out."

## Phase 3 (planned, Codex-reviewed and approved 2026-10-18)

- 2026-10-18 — Owner answers before planning: tidy covers all four kinds (one note; titles, tags
  and folders; links; merge or split), built in that order; answers are kept in memory until the
  app closes; every live note is sent with a whole-notebook question (no private folders), Trash
  never. — The choices the repo could not answer; contract in `docs/PHASE-3-DIRECTION.md`.
- 2026-10-18 — Model `claude-opus-5-5` (Opus 5.5, $4/$20 per million tokens), effort `medium` for
  questions and `high` for proposals, streaming, no `thinking`/`temperature`/`top_p`. — Current
  Opus, cheaper than mi-cuaderno's `claude-opus-5`, and noted by Anthropic as better at citing the
  right source. About 17¢ for a first question over 40 notes, 5¢ a follow-up. One constant.
- 2026-10-18 — Questions send one citations-enabled document per live note (a structured plain-
  text projection, `[image]` markers), cached at the last document; proposals use structured
  output without citations. — Anthropic rejects citations combined with `output_config.format`;
  citations make "names the notes it drew from" verifiable rather than a guess at titles.
- 2026-10-18 — Nothing, not even a token count, is sent before the owner taps Send; the disclosure
  is built from an immutable payload captured in one read transaction after a protected flush,
  and exactly that payload is sent. — Anthropic's free counter would itself transmit the notes;
  Codex showed a later save could otherwise make the sent data differ from the disclosed data.
- 2026-10-18 — A conversation freezes its snapshot (cache hits, consistent answers); only
  completed turns are sent back, unchanged; a follow-up is refused if a snapshot note was trashed
  or deleted, or the generation changed. — Codex: a frozen snapshot otherwise resends notes the
  owner has since moved to Trash.
- 2026-10-18 — `@anthropic-ai/sdk` (0.135.0) with `dangerouslyAllowBrowser`, an injected `fetch`,
  loaded on demand; refusal fallback `fallbacks: "default"`. — Streaming, citations, typed errors
  and `retry-after` handling; mi-cuaderno's raw `fetch` covered one non-streaming call.
- 2026-10-18 — The key is a device-local preference entered through an uncontrolled field; React
  state holds only its presence; errors shown are the app's own sentences; `validateBackup` refuses
  `claudeApiKey` before version upgrades. — Codex: v2+ sanitising would otherwise discard the
  evidence, and mi-cuaderno's card kept the typed key in React state.
- 2026-10-18 — Claude's HTML is parsed through the editor schema, validated against handles the
  app issued (`I1`, `N12`; raw ids and unknown handles removed, link attributes replaced), then
  serialised; the block diff and review show that result. — Codex: the schema alone accepts any
  syntactic id and preserves link `class`/`target`/`rel`.
- 2026-10-18 — Approval is per top-level block (effects on images and links inside a block share
  its tick, counted per occurrence), ticked by default; merges and splits are all-or-nothing. —
  Codex: independent ticks for nested images or links contradict whole-block replacement.
- 2026-10-18 — One approval is one guarded transaction inside `nav.run`, checking the generation,
  every recorded `rev` (including notes whose links a merge rewrites) and folder ids and names. —
  Codex: writing beneath a mounted editor lets its next save overwrite the result.
- 2026-10-18 — Undo stores complete before-copies of every affected note, keeps their images from
  cleanup while it exists, moves split-created notes to Trash, restores through tombstone link
  cleanup, never moves `rev` backwards, and offers copies when a note changed since. Import
  deletes it. — Codex: changed fields alone cannot restore after an edit or purge, and an
  unbounded undo would outlive its images' 30-day clock.
- 2026-10-18 — One request at a time; conversations, proposals and requests carry an identity
  token and generation, invalidated by New question, Cancel and imports (a local post-commit
  notification plus the existing broadcast). — Codex: late stream callbacks could otherwise
  repopulate a cleared session.
- 2026-10-18 — With a conversation or proposal in memory an update never reloads automatically
  (including activation from another tab); Reload is disabled during a request and says it clears
  the conversation. New requests are disabled in read-only, upgrade and replaced states. — Codex:
  waiting for the request alone still discards the answer on reload.
- 2026-10-18 — Test key uses the free token-counting endpoint: success means verified, 401/403
  rejected, anything else inconclusive. — Costs nothing and sends no notes; Codex: a 403 or an
  outage is not a working key.
- 2026-10-18 — No schema change: no new tables or note vocabulary; new state is device-local
  preferences (`claudeEnabled`, `claudeApiKey`, `claudeSpend`, `claudeLastChange`). — The schema
  version tracks stored data and note vocabulary (Phase 2 rule 1); neither changes.
- 2026-10-18 — Tests feed chunked `ReadableStream` fixtures through the injected `fetch`; shots
  block service workers, route Anthropic's address fail-closed before navigation, and wrap `fetch`
  in an init script to release fixture chunks step by step. — Codex: a fulfilled route body cannot
  show a mid-stream state or test Cancel.

## Phase 3a implementation

- 2026-10-18 — Saving a key and turning Claude on share one guarded transaction; removing the key and turning it off do too. — A storage failure must not leave half of a settings action applied.
- 2026-10-18 — Session tokens are opaque identity objects carrying the notebook generation, and remain current after a request ends until the next request or invalidation. — Completed answers and proposal review can keep using the same identity; late callbacks from earlier requests cannot write into a later one.
- 2026-10-18 — Cancel aborts and invalidates the token but keeps content already received; New question, replacement and versionchange clear content as well. — Step 3b needs partial answers for its Stopped display, while a replaced notebook makes the whole answer obsolete. The step 3a task explicitly requires versionchange invalidation, which takes precedence over the direction file's more general running-request failure row.
- 2026-10-18 — SDK logging is explicitly off; status-less SSE `overloaded_error` and `api_error` become the fixed busy sentence, and a failed SDK preload can be retried. — Streaming errors arrive after HTTP 200, and neither SDK diagnostics nor a transient chunk-load failure should leak credentials or permanently disable the feature.
- 2026-10-18 — An explicit Reload remembers the owner's choice through the worker activation callback; automatic activation still waits for an empty, idle Claude session. — Otherwise the conversation-preservation guard also prevents the reload the owner deliberately requested; a failed final save still retains the answer.
- 2026-10-18 — Screenshot streams use a serializable fixture-only fetch installer with one-event release controls; shots 62–68 run before the existing destructive database-guard shots. — Later Claude screenshots need reproducible partial streams, and the guard shots deliberately leave the notebook read-only.
- 2026-10-18 — Test-key results also carry the screen's settings revision; changing the saved key or on/off state drops the old result without cancelling the request. — A result for an earlier key must never verify a replacement key, while navigation and settings remain usable during the request.
- 2026-10-18 — Review fixes: the key field has a visible label (its placeholder disappears once
  typing starts); a malformed `claudeSpend` record restarts the month's total instead of throwing;
  `enforced_spend_limit_reached` is recognised at either level of the error body. — Found reading
  the diff and the 375–412 px screenshots (62–68).

## Phase 3b implementation

- 2026-10-18 — Ask captures live notes, folder labels, image metadata and the generation in one read transaction, reading only the generation preference. Read-only capture itself is allowed; the UI and session refuse requests in guard states. — The capture must not bring the device key into a payload or React state, and must remain consistent across an import.
- 2026-10-18 — The first user message is retained in memory as plain data, including its first-question date; retries replace the latest attempt and only completed assistant turns re-enter the protocol. After an unsuccessful first answer, the owner can retry or start a new question before following up. — This preserves the exact signed-thinking prefix, even across midnight, and avoids a follow-up with an unanswered first question.
- 2026-10-18 — SDK 0.135.0's complete `BetaContentBlockParam` type list is explicitly allowed for non-text history blocks, including thinking, redacted thinking and fallback blocks, which are copied without altering fields or order. Unknown block types are dropped. Text citations use the five citation-param field lists; document citations omit response-only `file_id`. — The installed SDK types define what can be echoed; fallback boundaries and thinking signatures must survive unchanged.
- 2026-10-18 — The estimate includes the instructions and document titles/context/text, the question, sent image dimensions and the last completed request's full usage; it never sums cumulative usage across all previous requests. Cache warmth uses that attempt's start time. — This follows the task's conservative estimate definition without repeatedly counting every earlier cumulative total. The displayed estimate is not a bill.
- 2026-10-18 — Image preparation reads only the first 20 referenced files, checks the captured note revision and generation in that read transaction, then encodes outside the transaction. A missing image or still-oversize copy is omitted and listed; 5 MB is conservatively 5,000,000 base64 bytes. — Long image processing should not keep a database transaction open, and stored originals must never change. A stale revision requires a fresh disclosure with images unticked.
- 2026-10-18 — Cancel changes the running display turn to Stopped before aborting and invalidating the request token. Message-start input counts provide a lower bound; incomplete/missing final counts never enter monthly spend. SDK-wrapped TypeError causes map to the fixed network sentence. — A late callback cannot overwrite Stopped, and a connection loss during an HTTP-200 stream needs the same treatment as a failed connection.
- 2026-10-18 — Sources resolve current titles, folders and content-edit timestamps on render; snapshot titles remain available after deletion. The answer renderer understands only plain paragraphs, line breaks and `- ` lists. — No generated HTML or URL becomes an active element, and pin-only revisions do not falsely claim an edit.
- 2026-10-18 — Shots 69–87 use last-user-text matching supplied only by the screenshot script, retaining the fail-closed Anthropic route guard and stepped stream controls. Before those shots the script reimports the public sample to restore citation order after earlier destructive shots. — Screenshot fixtures must be reproducible and cannot fall through to a real API call. The agent wrote but did not run these shots, as requested.
- 2026-10-18 — Review fixes: a follow-up's estimate uses the previous request's reported token
  counts in place of the character estimate (they already include the instructions, notes and
  images, which were being counted twice); numbered lists reach Claude numbered from their start
  ("3. 4. 5.", not "1. 1. 1."); an estimate under a cent reads "under 1¢" rather than "about
  under 1¢"; the image line says "1 image prepared · 7 KB to send" without "base64". The
  screenshot script taps the images checkbox instead of Playwright's `check()`, which fails
  because the box is ticked only once the images are prepared. — Found reading the diff and
  shots 69–87.
- 2026-10-18 — The owner verified 3a on the published app with their own key, through the
  checklist: Test key works, a wrong key is rejected, Turn off/on asks for the acknowledgement
  again and keeps the key, a backup round trip keeps Claude on (airplane mode was optional). This was
  the project's first real request to Anthropic: the browser call with the direct-access header
  works from GitHub Pages. "Checks passed."
