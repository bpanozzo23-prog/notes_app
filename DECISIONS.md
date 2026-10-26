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
- 2026-10-18 — Backup size measured on the owner's phone (dev address, generated image backups):
  the 100-image file (about 40 MB) and the 300-image file (about 118 MB) each imported and
  exported in about 1–2 seconds. `COMFORTABLE_BACKUP_BYTES` stays at 150 MB, now as a measured
  value rather than a guess: just above the largest size proven comfortable; beyond it the phone
  is untested, which is what the warning says. The first 300-image downloads were cut off because
  the phone's browser tried to display the 118 MB file; the temporary server was restarted to send
  it as a download. — Closes the Phase 2 closeout's open P2; the temporary server is stopped.

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
- 2026-10-18 — The owner verified 3b on the published app with their own key, through the
  checklist (first question and its disclosure, sources and Back, the console's cost against the
  app's, a cheaper follow-up, the edited-source label, Cancel, airplane mode, switching apps, a
  one-note question with a picture): "the phone check passes".

## Note dates (0.3.2, the owner's request, 2026-10-18)

- 2026-10-18 — Show the dates the app already stores: the end of every note says "Created 3 Oct
  2026 · Edited today, 14:02" (only "Created …" for a note never edited), and each notes-list row
  adds the last edit beside the folder ("Español · 16 Oct": a time today, day and month this
  year, the year before that). "Edited" is `updatedAt`, which moves only on content changes. —
  The owner asked where creation and edit dates would show. The note's end keeps the top of the
  screen free under the keyboard; the list is already ordered by last edit, so its date explains
  the order. No stored data changes.
- 2026-10-18 — The note screen moves its displayed edit time on each content edit at once
  (display only; the save still writes the stored `updatedAt`); dates use en-GB on every device.
  — Otherwise the line would show the time before the edit until the note was reopened. The
  app's wording is English.
- 2026-10-18 — This ships as 0.3.2, before 3c, so the remaining Phase 3 steps are each one
  version later than `docs/PHASE-3-DIRECTION.md` lists: 3c 0.3.3, 3d 0.3.4, 3e 0.3.5, 3f 0.3.6,
  3g 0.3.7. — The owner wanted it before the tidy steps; the direction file is left as approved.

## Phase 3c implementation

- 2026-10-18 — Tidy captures only the generation and the two colour preferences, alongside notes, folders and image metadata in one read transaction. Handle maps are stored as frozen entry arrays and reconstructed as Maps at the HTML boundary. — `Object.freeze(Map)` does not prevent `set`; neither the key nor image bytes should enter a proposal payload. Missing and trashed link targets receive handles but their titles and bodies are never sent.
- 2026-10-18 — An unsent proposal has an internal `disclosure` state in the session store; each proposal also has an identity independent of the current network request. New question clears only Ask, while Discard clears only the proposal. — The disclosure must survive navigation without sending, and later Ask requests must not prevent review or Apply of an existing proposal.
- 2026-10-18 — Link defaults come from the schema built from the actual editor extensions; unissued references are removed before review, and an invalid resulting document is refused. Preview links prevent ordinary, auxiliary and context-menu activation. — Editor defaults should not be duplicated, and generated links must never open anything from the review.
- 2026-10-18 — Adjacent changed blocks remain one change, except standalone images, which have separate ticks. The sample's two consecutive class paragraphs therefore share one body-change card (spelling fixes and a new list), with a separate tags tick. — This follows the approved `diffArrays` grouping rule; splitting adjacent replacements into paragraph pairs would guess at correspondence and conflict with structural changes.
- 2026-10-18 — The source folder and any suggested existing destination are checked by id and exact name on review and inside Apply. Ambiguous case-insensitive folder matches are refused; a newly occupied create-name is stale. New-folder patches use a local `{ create: name }` reference resolved to a fresh id inside the transaction, and unused creation requests are refused. — No folder is created before approval, and no concurrent rename or creation silently changes what was reviewed.
- 2026-10-18 — Apply returns the number of notes written; the review separately reports the number of approved ticks. Undo uses the shared writer in housekeeping mode, then restores the prior `updatedAt` inside the same transaction; copies receive fresh ids and dates. Old-body image marks are cleared when the undo record is written, as well as during cleanup. — Revision numbers always advance, and an already-running unused-image clock cannot expire an image that Undo now needs.
- 2026-10-18 — Tidy estimates price input without caching and use twice the note HTML's estimated tokens plus 3,000 for output. Completed unusable and cut-short replies still record their known cost; interrupted replies retain a lower bound from message-start usage. — Proposal requests do not set a cache point, and a paid but unusable response must not disappear from the spending estimate.
- 2026-10-18 — Added textareas to the shared dialog focus loop, and ignored malformed Undo records in the Settings row. — The new instruction box must be keyboard reachable; an invalid device-local preference must not crash Settings or expose arbitrary preference contents.
- 2026-10-18 — Shots 88–105 exercise tidy disclosure, working, partial review, Apply, both Undo paths, stale detection, image effects, the ready bar, failures and Settings Undo, using only fixture markers in the screenshot script. The existing public sample was regenerated unchanged and fixture assumptions are tested against it. — No new content vocabulary is needed. The agent did not run screenshots, start a server, install packages or make real requests; the owner's task reserves screenshots and phone checks for the owner. Version 0.3.3; schema remains 4.
- 2026-10-18 — A final generation-only read before Send refuses an undisclosed notebook replacement even if its broadcast was missed, without rejecting ordinary edits to the frozen snapshot. Undo confirmations and conflict offers retain the specific change id they describe. — These close two races: sending a replaced notebook, and restoring copies from a newer Undo record while an older offer is open. Android Back closes the disclosure overlay first; its Cancel button returns to the note without racing the shared overlay recovery.
- 2026-10-18 — Starting another tidy confirms replacement of any in-memory proposal, including one for the same note. — A new capture creates a different proposal even when the note id is unchanged; the previous review must not disappear silently.
- 2026-10-18 — Review fixes. (1) Whole note bodies are normalised exactly as the editor stores
  them: the editor appends an empty paragraph on its first transaction when a note ends with a
  block other than a paragraph or callout (StarterKit's TrailingNode with `notAfter:
  ["callout"]`), and our serialiser did not, so merely opening a note whose tidied body ended in a
  list saved it again: `updatedAt` moved ("Edited") and a clean Undo became the copies-only
  conflict. Found by the screenshot run (Apply → Back → Forward → Undo). `normalizeBody`,
  `fromClaudeHtml` and `assembleBody` now add it; a test compares `normalizeBody` with a real
  editor's HTML after one transaction for every supported sample and sample note. (2) Neighbouring
  blocks each edited in place pair one-to-one, so each has its own tick (the contract's per-block
  approval); uneven groups stay one change, and trailing empty paragraphs travel with the last
  pair. (3) A change whose shape changed ("now a bulleted list") hides the word-by-word line,
  which was unreadable there; the editor's end-of-note empty line is left out of previews (still
  saved). (4) "Apply 1 change" / "Applied 1 change." wording, without a duplicate "· Undo" text.
  (5) The ready bar is sticky, so it is visible on a scrolled list. — Found reading the diff and
  shots 88–105.
- 2026-10-18 — Noted, not changed: a note whose stored HTML ends in a list or heading without
  the trailing paragraph (only HTML not written by this editor: the public sample notebook, or a
  hand-made backup) is saved once when first opened, which moves its edit date. Notes typed in the
  app always already have it.
- 2026-10-18 — The owner verified 3c on the published app with their own key, through the
  checklist (tidy with partial ticks, Apply, Undo, an instruction, stale refusal, Undo after an
  edit, the ready bar, cost): "Phone check passes and it seemed to handle Spanish ok and keep my
  wording."

## Text export (0.3.4)

- 2026-10-18 — Export notes as text downloads Markdown; Copy as text copies one note, with a
  textarea fallback for plain HTTP or denied clipboard access. Both flush saves and read fresh
  notes and folders, including in read-only mode; neither reads preferences or changes
  `lastBackupAt`. — A small readable file for other apps and AI tools is not a backup.
- 2026-10-18 — Reuse the Claude text projection with an optional heading offset (capped at six),
  keeping its default output unchanged. Export live notes in folder/pinned/recent order, with
  absolute en-GB dates, image markers and resolved note links; omit empty folder sections and
  put missing-folder references under No folder. — Keep structure and every live note without
  pictures, settings, a schema change or changes to Ask's cached prompt.
- 2026-10-18 — Shots 106–108 cover Settings, the copy row and its success message; the script
  saves the pristine sample's real download as `106-sample-export.md`. — The owner runs and
  checks screenshots and phone clipboard/download behavior; these were not run by the agent.
- 2026-10-18 — Review fix: the tag field stays inside a read-only `fieldset` (moving the row's
  fieldset to keep Copy as text usable in read-only mode had left tags looking editable; nothing
  would have saved). A test checks every control in the row. The remaining Phase 3 steps are each
  one more version later: 3d 0.3.5, 3e 0.3.6, 3f 0.3.7, 3g 0.3.8. — Found reading the diff.
- 2026-10-18 — The owner verified the text export on the published app (Export notes as text,
  Copy as text): "The phone check passes."

## Agent testing with real requests (2026-10-18)

- 2026-10-18 — The agent gets its own test key (`~/.config/notes_app/test-key`, mode 600, in a
  separate Anthropic workspace `notes_app-tests` with its own spend limit), used only against the
  made-up sample notebook, never the owner's notes, and never handed to Codex. Standing allowance:
  up to $1 per step without asking, each run's cost reported; more needs the owner's go-ahead with
  a reason. Recorded in `AGENTS.md`. — The owner asked what the agent could test with the right
  access; real requests let it check Claude's actual answers, citations, caching, costs and
  proposals before they reach the phone. The workspace limit is the hard cap.
- 2026-10-18 — Also planned without any new access: service-worker update and offline tests on
  a production build, page freeze/resume during a request (Android app switching) and dropped
  connections mid-stream, in headless Chromium. — Covers several phone-checklist items.
- 2026-10-18 — First real-request check (`npm run claude-check -- --real`, the sample notebook,
  the agent's test key): question across 18 notes 9,685 input tokens (cache write) + 689 out =
  6.2¢; follow-up read the cache (9,685 read, 715 written) + 606 out = 1.8¢; tidy of "Notas de
  clase" 2,301 in + 643 out = 2.2¢; total 10¢. Answers cited four notes, flagged general
  knowledge, and the tidy fixed accents but deliberately kept "recivir" (the sentence is about
  its spelling); Apply and a clean Undo worked; the app's shown costs matched Anthropic's
  counts. — The made-up fixtures could not show real behaviour.
- 2026-10-18 — Estimates use measured tokens per character: 0.85 for citation-enabled questions
  (Anthropic adds instructions and splits documents into citable sentences; characters ÷ 3 had
  undercounted by 2.5×) and 0.65 for proposal requests; the question output allowance falls to
  1,000 tokens and a tidy's to 1.5 × the note plus 800. Quoted sources no longer show the
  projection's `[x]`/`[ ]` and `[→ title]` markers. 0.3.5; 3d becomes 0.3.6 (each later step one
  more). — From the run above; `claude-check` re-measures them.

## Phase 3d implementation

- 2026-10-18 — Ask → Tidy the notebook → Titles, tags and folders captures every live note,
  folder names and tag counts in one read transaction after flushing saves. The frozen request
  carries creation-time/id-ordered N handles, displayed and stored titles, and the existing
  Claude text projection; ids, stored HTML, image bytes and preferences stay local. Nothing is
  sent until the disclosure's Send. — This extends the 3c capture and disclosure contract to
  the notebook without exposing the key or changing note bodies.
- 2026-10-18 — Share 3c's schema-shape, title and folder validation and its streaming runner,
  fallback, effort, cost and spend handling. Notebook proposals reject unknown/repeated handles,
  more than 40 changes, invalid titles/tags/folders and extra fields; no-ops disappear. New-folder
  names are grouped case-insensitively using the first proposed spelling. — One reviewed name
  must mean one folder, even if Claude varies its capitalisation between cards.
- 2026-10-18 — Each note card shows its title, first text line and reason, with independent
  title/folder/tags ticks and an editable title. Apply checks every affected note, even an
  unticked card, and every source/destination folder; proposed new names must remain unused
  even if their rows are unticked. Only approved folder rows create folders. All patches and
  the complete Undo record use the existing guarded transaction. — Unticking cannot bypass a
  stale proposal; an unapproved row cannot create an empty folder. There are no body patches.
- 2026-10-18 — Owner-requested deviation from the direction file's Undo rule: when the actual
  applied fields are only title, tags or folder, a later edit offers “Undo the N unchanged notes”
  instead of copies. The transaction rechecks the change id, generation and each written rev,
  restores only still-live unchanged notes, reports the current titles of skipped notes (the
  old title if missing), then clears the record. Revisions advance; restored edit dates return
  to their before values. A zero-unchanged offer can clear the record without changing notes.
  Created folders are removed only if no note, including Trash, still uses them. Changes with
  any body edit keep the existing all-notes copies path. — Duplicating unchanged bodies merely
  to undo metadata would clutter the notebook and would not preserve any additional writing.
- 2026-10-18 — Notebook proposal estimates use request plus system characters at the existing
  plain-text token ratio, priced without caching, plus 6,000 output tokens. This allowance is
  provisional until the owner runs the extended real-request check. — No counting request is
  made before disclosure. No schema or backup-format change; release version is 0.3.6.
- 2026-10-18 — Added streamed public-sample fixtures and shots 109–121 for entry, disclosure,
  per-row review, a shared new folder, Apply, clean/partial Undo and stale refusal. The real
  check now records the notebook proposal's disclosure, outcome, row count, Apply and Undo in
  summary.json and takes full-page screenshots, retaining the existing key-reading code.
  The public sample was regenerated unchanged. — The owner runs both browser scripts; this
  implementation makes no network requests and does not access private-data or the test key.
- 2026-10-18 — Local verification passed: `npm test` (52 files, 1,018 tests), the final targeted
  reorganise checks (42 tests, including the distinct 40/41-note boundary and rollback),
  `npm run build`, both browser scripts' syntax checks and `git diff --check`. The build retains
  Vite's large-chunk warning. Screenshots, real Claude responses/costs and phone typing/layout
  were not run or seen; those remain owner verification. No packages installed, server started,
  commit or push made, or private-data accessed.
- 2026-10-18 — Review fixes: redundant tag suggestions (adding a tag a note has, removing one it
  lacks, repeats) are dropped instead of discarding the whole proposal; only a tag both added and
  removed, or a malformed tag, makes it unusable. Cards don't repeat an untitled note's first line
  and strip the projection's markers from the preview; Undo names notes as the list does
  (`noteTitle`). The notebook-wide estimate uses its own measured ratio (0.5 tokens per character;
  2,000-token reply allowance). The intermittent App folder test waited for "Move up" to be
  disabled, which is also true while the screen is busy saving, then tapped Rename into a disabled
  screen under load; it now waits for the buttons to be enabled again (not an app bug). — From the
  diff, the shots and the real-request run.
- 2026-10-18 — Real-request run with 3d (sample notebook, test key): question 6.6¢, follow-up
  2.0¢ (cache read), tidy 2.0¢, titles/tags/folders 5.5¢ (6,621 in, 1,430 out); 16¢ in total.
  Claude's notebook proposal (10 rows) passed validation: titled the untitled note, renamed a vague
  reminder, reused existing tags, added one shared tag, and left well-organised notes alone; Apply
  and Undo were clean.
- 2026-10-18 — Asked at the start of 3e: the owner's 3d phone check has not been done yet. It
  stays pending; 3e proceeds (no schema change, and 3d's Undo covers its changes).
- 2026-10-18 — The owner verified 3d on the published app with their own key, in the same
  sitting as 3e (the 3d checklist was item 7 of the 3e one): "Phone checks pass".

## Free browser checks (2026-10-18)

- 2026-10-18 — `npm run browser-checks` (`scripts/browser-checks.mjs`) builds the app twice (two
  releases differing by one marker), serves them itself and drives headless Chromium at phone
  size, with the made-up sample notebook and made-up answers streamed by its own stand-in for
  Anthropic: nothing reaches Anthropic and it costs nothing. First run, on 0.3.6: 15 of 15 checks
  pass. The service worker installs and serves the app; the app reopens offline with the notes,
  every app file from the cache, and Ask says it is offline; a connection dropped mid-answer keeps
  what arrived, labelled "Connection lost", and Try again finishes it without repeating the
  question; an answer streamed while the page was frozen (Chrome's page-lifecycle freeze, what
  Android does on an app switch) completes on resume, and one whose connection died while frozen
  shows "Connection lost"; an update arriving mid-answer keeps Reload disabled ("Waiting for
  Claude's answer."), then offers "Reload (clears Claude's conversation)" and never reloads by
  itself, also when another tab applies the update; Reload brings the new release with the notes.
  — The owner asked for the free checks offered on 2026-10-18 to be fitted in before 3g. Not
  covered: how Android itself freezes or kills a page or its connection, the installed app's update
  on the phone, and Samsung Internet.
- 2026-10-18 — Chromium's offline emulation does not stop the browser's own background check for
  a new service worker (`sw.js` and the workbox file it imports), so the offline check ignores
  those two and requires every other file to come from the cache. — Seen in the second run; it is
  not page traffic.

## Phase 3e implementation

- 2026-10-18 — Links between notes captures every live note in one generation-checked read,
  ordered by creation time then id. Only the task and each note's N handle, displayed title,
  Claude text and existing links to live N handles go in the request. HTML, ids, dates, folders,
  tags, preferences, images and Trash stay local. The disclosure and Send use the same frozen
  snapshot. — Claude suggests relationships; the app places links without accepting note HTML.
- 2026-10-18 — Placement is computed once against captured HTML, before ticking. A phrase must
  occur exactly once, case-sensitively and on whole-word boundaries, outside code and links.
  Hard breaks and excluded inline content retain their document positions. An overlapping later
  link goes to See also, even if the earlier link is unticked. Review snippets are inert React
  text. — Approval must write the placement shown and must never move when another row changes.
- 2026-10-18 — Fallback links use the captured displayed target titles, joined with ` · ` in a
  `See also:` paragraph. Append to a final See also paragraph or insert immediately after the
  last non-empty block, before trailing empty paragraphs; an entirely empty note keeps its empty
  paragraphs after the new line. Inline links retain the owner's other text formatting. — This
  keeps one predictable end-of-note line and handles lists, callouts, dividers and empty notes.
- 2026-10-18 — Drop self-links, existing links and repeated source/target pairs (keep the first).
  Invalid or unusable phrases fall back to See also. Invalid shape, unknown handles or more than
  30 links refuse the proposal. — Harmless redundancies should not waste the whole paid reply.
- 2026-10-18 — Apply checks every referenced source and target, even for unticked links, once
  per note: sources first, then targets, deduplicated. A changed revision, trashed target or
  different notebook generation refuses the entire transaction. Only selected sources receive
  body patches; projections and backlinks use the shared writer. — Unticking cannot bypass
  freshness, and a note that is both source and target must not make its own plan stale.
- 2026-10-18 — Owner-approved link-only Undo uses “Undo the N unchanged notes” after later
  edits, like metadata Undo. Edited notes retain their links and See-also line and are named in
  the result. Records carry `kind: "links"`; only HTML-only changes with no created/trashed notes
  or created folders qualify. Records without the kind keep the copies path for body edits.
  — Adding links never changes the owner's words, so a “(before Claude)” copy of an edited note
  holds nothing the owner has not kept or deliberately deleted; copies would only add clutter.
- 2026-10-18 — Apply serialises a note's whole body in the editor's form, including its required
  trailing paragraph. For notes typed in the app this changes nothing else; for the sample or a
  hand-made backup it only rewrites representation the editor already shows (attribute order,
  colour notation and the end-of-note empty line). — Merely opening an applied note must not
  save again, move its edit date or turn clean Undo into a conflict. Tests compare every full
  fixture source with a real Tiptap editor after its first transaction.
- 2026-10-18 — Added fixture-based links review, disclosure, Apply/Undo and stale coverage;
  screenshot steps 122–134 and a links result in the real-request script. That script opens a
  source in a second tab of the same throwaway profile, flushes and closes it, then returns to
  the retained review for Undo: opening from the list in the review tab would replace forward
  history. Links provisionally share 3d's named estimate constants pending real measurement.
  Version 0.3.7; schema remains 4, with no new dependency or backup-format change. The public
  sample and its generator are unchanged. Existing decision-log edits were preserved.
- 2026-10-18 — Verification passed: `npm test` (54 files, 1,098 tests, including 79 new links
  tests), `npm run build`, syntax checks for both edited browser scripts and `git diff --check`.
  The build retains Vite's large-chunk warning. Screenshots, real Claude requests/costs and phone
  layout/typing were not run or seen, as reserved for Claude Code and the owner. No network
  requests, key/private-data access, package installation, server start, commit or push. The
  unrelated `scripts/browser-checks.mjs` that appeared during work was left untouched.
- 2026-10-18 — Review (Claude Code), before Codex started: a planning pass checked the design
  against the real schema and found that a paragraph's `textContent` drops hard breaks (every link
  after a line break would have landed on the wrong characters), that a note both source and
  target would have made the review permanently stale, and the five places that knew only two
  proposal kinds (Discard would have left a links request running and spending). All went into
  the task and have tests. After it: shots 125 and 130 now scroll to what they show, and 130
  waits for the new backlink under "Linked from".
- 2026-10-18 — Real-request runs with 3e (sample notebook, test key), two full runs: 21.3¢ and
  16.2¢ (the second read the first run's cache), 37.5¢ in total for the step. Links: 5,715 and
  5,755 tokens in, 1,488 and 1,459 out, 5.3¢ and 5.2¢ against an estimate of "about 6¢" (5,821
  tokens), so links keep the notebook ratio and reply allowance. Both proposals validated; Apply,
  opening a linked note in another tab, and a clean Undo worked both times. — Real behaviour the
  fixtures can't show.
- 2026-10-18 — Prompt tightened after the first run: a phrase must name the target note or its
  subject (its title, the book, person or topic), and notes related only by theme get null (See
  also). The first run linked sentence fragments that merely illustrated a topic ("el examen es"
  → the grammar note, "diez minutos antes del café" → the habits podcast): 7 in the text, 3 See
  also. The second linked only words that name the target ("ser y estar", "Frases útiles",
  "repasar los verbos"): 3 in the text, 8 See also. — In-text links on loose words read as
  references that aren't there; thematic links belong in See also.
- 2026-10-18 — Noted, not changed: a See-also link to an untitled note shows its whole first line
  (the link picker does the same, through `noteTitle`).
- 2026-10-18 — The owner verified 3e on the published app with their own key, through the
  checklist (Links between notes on their own notebook, unticking a link, Apply, an in-text link,
  the See-also line and "Linked from", Undo), together with the pending 3d check: "Phone checks
  pass".

## Phase 3f implementation

- 2026-10-18 — Find duplicates sends all live notes in creation-time/id order with N handles,
  displayed titles, folders, tags and Claude text. Selecting 2–5 notes prepares a separate merge
  disclosure: only their full handle HTML and metadata, plus folder names, tags in use and other
  live titles. Split sends the same snapshot as tidy with its own task and optional instruction.
  Captures are generation-checked reads; nothing is sent before Send. Backlinks, raw ids, Trash,
  image bytes and preferences stay local. — Two separate disclosures make the scope checkable.
- 2026-10-18 — Merge keeps the oldest selected note, breaking equal creation dates by id, and
  pins it if any selected note was pinned. Images share one handle map across the group. Links
  into the group lose their marks inside the HTML walk, preserving their words and the editor's
  serialised form. Backlinks are rewritten at the string level, changing only matching href
  attributes; writes advance rev without moving updatedAt. Apply rechecks the complete live
  backlink set and every captured revision in its transaction. — Opening a result must not
  silently save again, and a newly added or removed backlink must make the proposal stale.
- 2026-10-18 — Split creates fresh ids only in its plan, inserts new notes after writing the
  original, and uses the shared See-also insertion helper with the label “Split into:”. Folder
  creation includes new-note destinations and groups case variants using the first spelling.
  Each approval and its complete role-labelled Undo record commit together or roll back together.
  — No half-merge, half-split or unused folder is left behind on failure.
- 2026-10-18 — Owner-approved deviation from the direction file: if every note is exactly as
  Claude left it, Undo restores the original content, brings merge sources out of Trash, restores
  backlinks, or moves split-created notes to Trash, and removes unused created folders. After any
  later change, Undo never overwrites or removes anything: it copies the content note's before
  version, brings surviving sources out of Trash with their current text, copies purged sources,
  and leaves already-restored sources, relinked notes and split-created notes alone. The offer is
  a dry run; confirmation recomputes its decision list in the transaction and requires another
  review if the list changed. Created folders stay on this path; revisions only advance.
  — Restoring some notes in place could lose text the owner moved between them. Copies of notes
  safe in Trash or only relinked would add clutter without protecting more writing.
- 2026-10-18 — Merge and split are approved as a whole, without ticks. Review shows every result,
  Trash and backlink consequences, image/link effects and word-for-word missing/added lines.
  Line comparison uses sets, NFC and collapsed whitespace, splits hard breaks, and includes task
  state; only app-shaped link lines are ignored. Split also counts characters carrying each mark
  to disclose formatting changes. — Moving a line is not losing it, but rewording or changing a
  checked task must remain visible. The first eight lines appear immediately; more are expandable.
- 2026-10-18 — Duplicate replies allow at most ten groups. Unknown handles or malformed shape
  void the proposal; repeated handles and overlaps are dropped, then groups smaller than two.
  Groups larger than five remain reviewable with only the first five ticked. Split allows one to
  ten new notes (zero means no split). Existing title/tag/folder rules apply; empty merged or new
  split bodies are refused after HTML cleanup. — Harmless redundancy should not waste a paid
  answer. The in-memory suggestions slot preserves group ticks across merge cancellation and
  Ask again, and clears on imports or a new non-merge proposal.
- 2026-10-18 — Version 0.3.8; schema stays 4, with no new table, dependency or backup-format
  change. The public sample adds only the requested reading-list backlink in Recordatorio
  suelto; projection/export snapshots reflect that sentence. Added streamed fixtures, screenshot
  steps 135–160 before the destructive guard checks, and duplicates/merge/split reporting in
  claude-check. The key-reading code is unchanged. — Browser scripts and phone checks remain for
  Claude Code and the owner; this implementation does not run them or access private-data/key
  files, make network requests, install packages, start servers, commit or push.
- 2026-10-18 — Final local verification passed: `npm test` (62 files, 1,229 tests),
  `npm run build`, syntax checks for both edited browser scripts and `git diff --check`.
  Tests include atomic rollback, backlink-set freshness, every Undo decision-table state,
  damaged/legacy records, image retention, real-editor no-update-on-open parity, disclosure,
  guards and retained suggestions. The build retains Vite's large-chunk warning. Screenshots,
  real Claude responses/costs, phone layout and Samsung Keyboard/Gboard were not run or seen.
  — No network requests, private-data/key access, package installation, server start, commit
  or push; phone verification remains at http://brent-dell-system-xps-l502x:5174/notes_app/.
- 2026-10-18 — Review (Claude Code), before Codex started: a read-only planning pass checked the
  first design against the code and found that a partial Undo after later edits could lose text the
  owner had moved between notes (a merged note restored in place while a source had been restored
  and trimmed), that a source still in Trash with a moved rev (folder deletion bumps it) was
  uncovered, that the old copies path would have handled merge records, that links into the group
  removed with `neutralizeNoteLinks` would make the editor re-save on open, that `anyOf` on
  `linkedIds` returns a note once per matching source, and that folder creation ignored new notes
  (every split into a new folder would have been refused as stale). The approved plan and Codex task
  closed each of these.
- 2026-10-18 — Review fix: an exact-duplicate merge, whose kept note would not change at all, was
  refused ("An approved note change is empty"). It now applies: the kept note gets no write and no
  Undo entry, the sources go to Trash and backlinks are redirected; a merge record may have no
  content entry (a split still needs exactly one). Trashed and relinked entries that change nothing
  still refuse the whole Apply. — The most natural duplicate (one note a subset of the other) must
  merge.
- 2026-10-18 — Review fixes: a duplicates group dropped for having one note no longer claims that
  note from later groups; "1 new note" in the split review, result and Undo text; an empty
  duplicates reply says "Claude found no duplicates to merge." rather than "No suggested merges
  left."; screenshot steps: an exact heading selector, waiting for the backlink to open the kept
  note (it read the previous note's title first), and the guard shot's first matching status.
- 2026-10-18 — Real-request run with 3f (sample notebook, test key), one full run, 27.3¢ in total:
  question 6.2¢, follow-up 1.9¢, tidy 2.1¢, titles/tags/folders 4.9¢, links 5.1¢, find
  duplicates 2.8¢ (5,722 in, 237 out; estimate "about 6¢"), merge 1.6¢ (1,511 in, 500 out;
  "about 3¢"), split 2.6¢ (2,359 in, 845 out; "about 4¢"). Claude grouped only the two reading
  lists ("the rest are merely related"); the merge kept every line word for word; the split moved
  the restaurant section into "Vocabulario — en el restaurante" and retitled the original. Apply,
  opening the results, and both full Undos were clean. Find duplicates now has its own 800-token
  reply allowance (estimate about 4¢ on the sample); merge and split keep tidy's formula, which
  overestimates safely. — Real behaviour the fixtures can't show.
- 2026-10-18 — Noted, not changed: Claude's reasons and summaries are shown as plain text, so a
  stray mark in them appears literally (the real merge reason ended "Ficciones.](#)"). Residual
  risks for the owner's checklist: a second tab holding the merged note open can overwrite it on
  its next keystroke (the save queue has no rev check; the sources stay in Trash), and a merge
  ends any Ask conversation that included a merged-away note (its liveness check sees Trash).
- 2026-10-18 — Verification: `npm test` (62 files, 1,231 tests; one earlier run had a single
  failure that two reruns did not reproduce), `npm run build`, `npm run shots` (171 PNGs read,
  135–160 new), `npm run browser-checks` on 0.3.8 (15 of 15).

## Phase 3 closeout (3g)

- 2026-10-18 — Ordinary editor saves check the revision last opened or written by this window. A conflict creates an unpinned copy in one guarded transaction, cleaning purged links and missing folders; pending and later input follows that copy, including another conflict. The original editor locks with a persistent notice and an Open the copy button; reopening resets its revision and redirect. The mounted editor survives a refresh after Trash/purge, and Open the copy reads fresh notes if the conflict refresh has not reached the list yet. — A second window's edit, Claude Apply/Undo, Trash or purge must never be overwritten, and preserving the draft must let navigation finish. Notebook replacement and version guards retain precedence.
- 2026-10-18 — Every Send checks the stored generation and all disclosed note ids in one read transaction, including title-only otherNotes. Trash, purge or a missed import notification refuses the first question or proposal with a fresh-review message; the first question returns to its input box without starting a conversation. Follow-ups retain their conversation-ended message. — Trash must never be transmitted, while ordinary edits still send exactly the snapshot the owner approved.
- 2026-10-18 — Link effects first cancel identical words/destination pairs, then pair remaining links by words to report changed destinations, then cancel word-only changes by destination before listing additions/removals. Image handling is unchanged. — Swapping two destinations must produce two visible ChangeCard warnings even when Before and After have the same words.
- 2026-10-18 — Review freshness and Apply check that every newly introduced note-link destination still exists (live or Trash); every link in a newly created note is checked, excluding ids the same plan creates. Existing missing links on stored notes remain allowed. — Purging an unlinked target does not change the source revision, so revision checks alone could write a new dangling link. The check runs before any write or Undo replacement.
- 2026-10-18 — Sources compares edit timestamps for inequality, including a timestamp restored backwards by Undo; pin-only revisions remain silent. — A citation captured after tidy is outdated when Undo restores the earlier content and timestamp.
- 2026-10-18 — Test-first verification: before each fix, the new regressions failed: 14 save/database/Note conflict tests (then 3 app tests for opening a copy before refresh), 25 Send/disclosure tests, 2 swapped-link diff/review tests, 4 purged-target Apply tests, and 1 post-Undo source-label test. Preservation controls cover ordinary edits after disclosure, word-only link changes, existing missing links, split-created ids and pin-only source changes. One existing Apply fixture now creates its link target; Send assertions use the newly required sentence, and Note queue doubles expose its new methods. — Regressions must demonstrate the fault before implementation; controls protect existing behavior.
- 2026-10-18 — Final verification passed: `npm test` (66 files, 1,294 tests; 63 added), `npm run build`, `node --check scripts/screenshot.mjs` and `git diff --check`. The first full run's seven failures were corrected (normal Delete/navigation interactions, the copy-opening race, and two old Send-message assertions). The build retains its existing large-chunk warning. Version 0.3.9; schema 4, dependencies, backup format and sample notebook unchanged. Shots 161–162 use a second page in the same fixture browser context, close it, and retain the fail-closed Anthropic route guard. Screenshots, browser/real-Claude checks and phone layout/keyboard behavior were not run or seen, as requested; phone verification remains at http://brent-dell-system-xps-l502x:5174/notes_app/. No network requests, key/private-data access, package installation, server start, commit or push. README and DECISIONS-EXPLAINED remain for Claude Code.
- 2026-10-18 — Closeout review (Codex, read-only, xhigh, `git diff phase-3-base...HEAD`): five
  findings, all fixed above (two P0, two P1, one P2); no key-leak path; merge/split Undo,
  transactions, image retention, late-reply protection, kind handling and the BRIEF amendments
  found sound. The second-window overwrite (P0) predates Phase 3: two windows editing the same
  note could always overwrite each other; the owner approved fixing it for every save, not just
  Claude's, with a conflict copy rather than a refusal. — Independent review before calling
  Phase 3 done, as the plan required.
- 2026-10-18 — Review fix: a conflict copy of a note that was deleted for good, with only a title
  or tag edit pending, starts from the editor's empty body (`<p></p>`) rather than an empty
  string, so opening the copy doesn't re-save it.
- 2026-10-18 — Verification (Claude Code): `npm test` (66 files, 1,294 tests), `npm run build`,
  `npm run shots` (173 PNGs; 161–162 show the conflict notice and the copy beside the other
  window's version), `npm run browser-checks` (15 of 15), and one real-request run on the sample
  (27.3¢): question, follow-up (cache read), tidy, titles/tags/folders, links, find duplicates,
  merge and split all sent, applied and undid cleanly after the new pre-send check.
- 2026-10-18 — The owner verified 0.3.9 on the published app through the closeout checklist (a
  note edited in the installed app and a browser tab gave a conflict copy with nothing lost; Ask
  and Tidy this note still work): "Checks pass". Asked, the owner said the 3f merge/split
  checklist has not been tried on the phone yet; it stays pending.

## Visual quick wins (0.3.10)

- 2026-10-18 — Note and Settings share `saveStatusLabel`: Saved, Saving… and Not saved; Settings
  retains the error detail, and failed saves stay red and bold. — Plain words describe the result
  without exposing save-queue states; internal values, comparisons and save behavior stay intact.
- 2026-10-18 — The notes list ends with `6rem + env(safe-area-inset-bottom)` of padding; the +
  button keeps its size and position. Screenshot `04b-list-end` scrolls to the bottom after 04,
  then restores the top for the existing shots. — The last note and Trash link need clearance
  above the button even on phones with a gesture bar.
- 2026-10-18 — Settings offers “Choose a backup file…” through the existing labelled input,
  now visually hidden, with the same busy/read-only guard. Images show count (size); persistence
  reads “Protected from automatic clearing” with the same four states. — Familiar controls and
  plain wording explain backup and storage without changing the import preview or data flow.
- 2026-10-18 — Buttons use one dark primary action per screen, dialog, sheet or card; destructive
  actions have red outlines and their confirmations are filled red. Confirm defaults to primary,
  so Undo is no longer red. Send, Apply, Merge, Export backup, Save key/Turn on, Save style, Add
  colour and Save name receive the primary style. Remove and Reset use danger for button lists,
  palettes and styles. Equal choices,
  Cancel and proposal Discard stay plain; icon buttons stay as they are. The link picker inserts
  on a note tap and has no separate confirming button. — The main action should be easy to find,
  and red should consistently signal loss. Version is 0.3.10; schema stays 4, with no dependency
  change. Screenshot edits are written for Claude Code to run; phone layout remains owner-checked.
- 2026-10-18 — Verification passed: `npm test` (67 files, 1,318 tests; 24 added), `npm run build`,
  `node --check scripts/screenshot.mjs` and `git diff --check`. The build retains its large-chunk
  warning; generated CSS includes the safe-area padding and all button variants. — These checks
  cover wording, picker guards and confirmation tones; screenshots and phone layout were not
  run or seen. No network requests, private-data/key access, installs, server start, commit or push.
- 2026-10-18 — Review fix (Claude Code): New question stays a plain button; only its
  confirmation, Clear conversation, is red. — Starting a new question is an everyday action; red
  there would read as a warning every time.
- 2026-10-18 — The owner approved the look from before/after screenshots (note header, Settings,
  a red confirmation, the Send button, the list's end): "Looks good". Verification: `npm test`
  (67 files, 1,318 tests), `npm run build`, `npm run shots` (174 PNGs, new `04b-list-end`).

## Note screen: more room to write (0.3.11)

- 2026-10-19 — The header shows save status, Pin, Claude when available, and Note options in
  that order. Pin stays one tap with its pressed state visible at a glance. — Keeping frequent
  actions in the header frees writing space without hiding whether a note is pinned.
- 2026-10-19 — Note options holds Copy as text and Move to Trash…, followed by Cancel. Copy
  still works read-only and closes the sheet after the existing guarded operation; Trash opens
  the unchanged confirmation. — Less frequent actions need no permanent row above the editor,
  and the shared Dialog retains focus return, background locking and Android Back behavior.
- 2026-10-19 — Folder and plain #tags share one compact line above the divider; + Tags marks an
  untagged note. Edit tags opens a Tags sheet with Done, and edits still enter the save queue at
  once. Its fieldset disables editing if a conflict locks the note while it is open. — Moving
  tag entry into a sheet leaves more room for writing while preserving saving and read-only rules.
- 2026-10-19 — TagInput accepts optional suggestionsOpen and initialFocus, both false by default.
  The Tags sheet enables both: Used before starts open and remains open after adding, suggestions
  still scroll sideways, and Dialog focuses Add tag when enabled. — Tags are ready to choose or
  type with a short sheet, while callers without the options keep the existing behavior.
- 2026-10-19 — Verification passed: `npm test -- --reporter=verbose` (68 files, 1,327 tests;
  nine more), `npm run build`, `node --check scripts/screenshot.mjs` and `git diff --check`.
  The build retains its large-chunk warning. — Tests cover both sheets, queued metadata saves,
  focus return, read-only conflicts and Android Back; the 360 px header fit and approximately
  165 px top were checked from CSS dimensions only. Screenshots and phone layout/keyboard
  behavior were not run or seen. No network requests, key/private-data access, installs, server
  start, commit or push. Version is 0.3.11; schema stays 4, with no dependency change.
- 2026-10-19 — Claude Code's review checks: `npm test` (68 files, 1,327 tests), `npm run build`,
  `npm run shots` (175 PNGs; new `07b-note-tags-sheet`; `107` now shows the Note options sheet;
  read-only and conflict-notice shots checked), `npm run browser-checks` (15/15). No real Claude
  request: no Claude code changed. The owner approved the look from before/after screenshots
  (note top, a short window imitating the open keyboard, both sheets): "Looks good".

## Phase 4 — sync to the XPS (discussed 2026-10-19)

- 2026-10-19 — Owner answers before planning: Claude Code on the XPS should both read the notes
  and change them; the same notebook on the Surface is wanted but tabled if it needs full two-way
  sync; the notes may sit readable on the XPS (plain ext4, no disk encryption, readable by every
  program running as `brent`) since that is what lets Claude read and write them; Codex may be
  given access later, not now. — The choices the repo could not answer. They rule out a
  read-only mirror and point to the middle level discussed (a mirror on the XPS plus an inbox of
  proposed changes the owner approves on the phone), planned next.
- 2026-10-19 — Claude Code's changes wait for the owner's tap on the phone (review, Apply, Undo),
  not applied automatically with Undo; the owner's choice. — Keeps Phase 3's "nothing changes
  without approval": a mistake is never in the notes before it has been seen.
- 2026-10-19 — Plan approved: one-way sync from the phone (the one true copy) to the XPS, plus an
  inbox of proposals. The XPS keeps a private exact copy outside `~/notes` (history in a local git
  repository with no remote, daily backups; Backups and Restore come only from it) and rebuilds
  `~/notes` as a read-only view where Claude Code reads and proposes, in sessions locked down by a
  settings file (no web, no connectors, sandboxed shell, writes only to `inbox/`). Rounds carry the
  notebook generation and apply atomically; a note may vanish from the XPS copy only with a
  tombstone, otherwise the app asks first. Inbox edits to existing notes come first (4c); new notes
  and Trash are optional (4d). A user service with linger, deployed from a committed copy. Steps:
  spike, contract (`docs/PHASE-4-DIRECTION.md`, Codex-reviewed), 4a–4e. — A planning review of
  the first draft found that mirror files Claude Code can edit would reach the phone through a
  backup or Restore without approval, that a note's `rev` alone does not identify a version after
  an import, and that a session with web tools could send notes elsewhere; the design closes each.
- 2026-10-19 — No Obsidian (or other Markdown viewer) for now. — The XPS has no screen, so a
  viewer needs another way to move files to the Surface; Markdown cannot hold the notes'
  formatting; and a second place to edit would bypass approval. `~/notes` is rebuilt from the
  private copy, so an Obsidian-style layout later costs nothing.
- 2026-10-19 — Spike before the contract: a throwaway page `public/sync-spike.html` on the
  published site and a throwaway endpoint (`tailscale serve --https=8443` →
  `127.0.0.1:8790`, tmux session `notes-spike`, log in `private-data/sync-spike/`). The page
  sends only test bytes and timings; it names the XPS's tailnet address, which is already public
  through the certificate logs Tailscale's HTTPS certificates are published in and reachable only
  from the owner's devices. — Whether the published HTTPS app can reach the XPS decides the
  architecture. Both are removed after the test.
- 2026-10-19 — Headless Chromium 156 (Playwright 1.64) treats the Tailscale address as Chrome's
  `local` address space: a fetch from `https://bpanozzo23-prog.github.io` fails ("Permission was
  denied for this request to access the `local` address space", seen by the page only as "Failed
  to fetch") until `local-network-access` is granted. Granted, simple and preflighted requests and
  1 MB and 8 MB uploads succeed (8 MB in about 1.6 s on the XPS itself), and Tailscale Serve
  passes the caller's tailnet identity. `navigator.permissions.query` reports the state under
  `local-network-access`, `local-network` and `loopback-network`. — On the phone, Chrome should
  ask once; the app must read the permission state to explain a refusal, which otherwise looks
  like a network failure. Phone results follow.
- 2026-10-19 — Spike passed on the owner's phone (Chrome 155, browser tab, published site): the
  local-network permission is granted; on Wi-Fi and on mobile data a simple request, a JSON
  request with a token (CORS preflight) and 1 MB and 8 MB uploads all succeeded (8 MB in 1.1 s on
  Wi-Fi and 0.9 s on mobile data; a run's first request 1.3–2.5 s, later ones under 0.1 s); with
  Tailscale off every request failed in 0.25–0.5 s as "Failed to fetch". Chrome sent no
  `Access-Control-Request-Private-Network` header (it uses the permission, not the older
  preflight). Not run: the installed app (the permission belongs to the site, so the app shares
  it) and the frozen-device timing (the client uses timeouts regardless). — The published app can
  reach the XPS, so the fallback of serving the app from the XPS is not needed. The test page, the
  endpoint and the :8443 Serve entry are removed; step 4a adds the real service.
- 2026-10-19 — Contract drafted (`docs/PHASE-4-DIRECTION.md`) and reviewed read-only by Codex
  (xhigh): 15 findings (2 P0, 8 P1, 4 P2, 1 P3), all folded in, marked *(Codex)*. Note files are
  named by the SHA-256 of their id (a literal id could equal another id's encoded name). Image
  bytes are content-addressed and bound to ids per generation, re-uploaded after an import (an
  import keeps image ids whose bytes may differ). A failed history commit blocks further rounds
  (otherwise a later round could overwrite an unrecorded version). Across generations and on a
  new pairing the guard compares content, not `rev` or tombstones from another branch. The inbox
  is read-only for the service, symlink-safe, and proposals are ingested as immutable versions
  bound by hash. One mutation queue and an idempotent journal on the XPS. In the app: round
  identity, recapture after 409, a dirty flag; exported preferences and the outbox trigger sync;
  only acknowledged outbox entries are removed. A lazy body reader keeps rejected requests from
  reading bodies. A pre-parse audit lists what the editor drops (`fromClaudeHtml` reports only
  unknown handles), and kind `"xps"` refuses new links to notes in Trash. Missing images are
  synced as a reported, degraded state. The Markdown projection is kept in the store so the view
  can be rebuilt without the phone. Release order: verify, commit, deploy, smoke-check, push. —
  Each closes a loss, leak or approval hole Codex showed against the code or with fixtures.
- 2026-10-19 — Codex's scope suggestions: the XPS helper's checks are narrowed to shape,
  references and size (taken; the phone's editor pipeline judges formatting). Sending every note
  row on every round is not taken: rows go only for a differing `rev` within a generation, all
  rows after a generation change or a new pairing. — Saves mobile data as the notebook grows; the
  guard needs full rows only across generations.
- 2026-10-19 — Sessions on the notes start through a launcher (`claude-notes`) that loads one
  policy file and leaves out the owner's user and local Claude Code settings, because settings
  lists merge across sources and a project file alone can't stop a user-level grant, hook or
  plugin from loosening it. Claude Code's docs (read for 2.1.304) offer `--restricted` (only
  managed settings and `--settings`) and `--setting-sources project` with `--settings`; neither
  is fully specified, so 4a picks by test (CLAUDE.md loads, sandbox on, `/status` sources,
  deliberately permissive local settings change nothing, no plugins), and Phase 4 stops at 4b if
  neither passes. `sandbox.network.strictAllowlist`, `syncClaudeAiPlugins` and
  `syncClaudeAiSkills` are honoured from `--settings`, not project settings. No managed settings
  exist on the XPS; `bubblewrap` 0.11.1 and `socat` are installed, and Ubuntu's
  `bwrap-userns-restrict` profile lets bubblewrap build a network-less sandbox without sudo. —
  Rule 5 must hold whatever else is configured on the machine.
- 2026-10-19 — The owner approved the Phase 4 contract. — Next is 4a, the XPS service; the app
  doesn't change until 4b.

- 2026-10-19 — Phase 4a, run A implements the service core only, with no app change, installation,
  live-service access or dependency. Runtime code is confined to `server/`; a compatibility test
  compares its copied constants and image-reference extraction with the app and passes generated
  backups through the app's validator. View rebuild and inbox ingestion are explicitly injected
  hooks for run B. — The deployed service contains only `server/`, and the approved run boundary
  keeps the core independently testable without sockets or the owner's data.
- 2026-10-19 — A round journal carries full previous and target snapshots plus resolved image
  bindings; stage checkpoints follow durable operations. Reads use the published snapshot and
  share the mutation queue. Recovery can replay partially written files, while a failed recovery
  still allows reads of the last published copy. A failed history commit publishes its round
  with `historyError` and blocks later pushes/outcomes until the retry succeeds. — Recomputing
  from partly overwritten rows or from uploads that expired during downtime could lose data.
  The extra temporary disk space is preferable to that ambiguity at this notebook's scale.
- 2026-10-19 — Ordinary files use fsynced temporary files and rename; immutable image objects and
  the once-per-day backup use an atomic no-replace hard link from a fsynced temporary file,
  followed by directory fsync. — A repeated upload or recovery cannot overwrite the existing
  immutable target. New private files are 0600 and service-created directories are 0700.
- 2026-10-19 — Note ids retain the app's exact validation and SHA-256-of-UTF-8 filenames, with an
  additional batch check for equal file keys. — Distinct JavaScript strings containing lone
  UTF-16 surrogates can encode to the same UTF-8 bytes. Refusing such a batch before journalling
  prevents one accepted row from overwriting another without changing the app's id vocabulary.
- 2026-10-19 — The startup Funnel check follows enabled public listeners to their loopback proxy
  targets; it refuses an enabled listener whose mapping cannot be determined. The test bypass
  requires both `NOTES_SYNC_TEST=1` and `NOTES_SYNC_SKIP_TAILSCALE=1`. — Testing only port 8790
  in `AllowFunnel` would miss public exposure through the intended HTTPS listener on 8443.
  Live Host forwarding and Tailscale output remain for run B's temporary-service verification.
- 2026-10-19 — Run A verification passed: `npm test` (74 files, 1,604 tests; 277 server tests),
  `node --check` for all 13 new `.mjs` files, and whitespace checks. Recovery tests include an
  actual child-process exit at every round stage, without sockets; real git is exercised only
  in a temporary fixture repository. No owner's notes, private-data, configuration or keys were
  accessed; no network, live service, app change, dependency, commit in this checkout or deploy.
  Real HTTP/Tailscale and phone behavior were not seen and remain outside this run.
- 2026-10-19 — Phase 4a, run B connects the real view and ingestion defaults to run A's hooks.
  Inbox changes use the existing journal stages and their own `inbox: N new versions` history
  commit; a sequence number preserves ingestion order when timestamps tie. — Capturing each
  version before exposing it to the phone also covers a freeze during ingestion and keeps
  history failures from skipping a proposal version.
- 2026-10-19 — Proposal filenames use the first 16 hash characters as specified for run B,
  while records and outcomes retain the full SHA-256; full-hash run A filenames remain readable.
  A prefix collision is refused. The view's proposal index excludes bodies and uses only live
  note titles. — Outcomes must identify exact versions, and the view must not expose a trashed
  note's old proposed text.
- 2026-10-19 — View and helper filesystem operations pin checked directories with Linux
  directory descriptors through `/proc/self/fd`, recheck ancestry before mutations, and use
  no-follow exclusive temporary files. Ingestion reads bounded regular files only and skips an
  unreadable inbox without marking pending versions withdrawn. — Checking a path only once
  would leave a symlink replacement race; an unavailable inbox is not evidence of withdrawal.
- 2026-10-19 — The helper checks generation as well as revision, checks un-ingested local
  submissions for duplicates, and cleans handled pending files only when the current content
  hash matches the handled version. — Imports can reuse revisions, and `list` must not erase
  an edited proposal the service has not captured yet.
- 2026-10-19 — Deployment and rollback render the policy, launcher and unit from the selected
  committed release; retention protects current and previous among three kept releases. —
  Policy fixes must deploy with the code, and rollback must remain possible after a failed check.
  `--restricted` and the complete absolute-path strict policy implement the approved request;
  their real-session isolation and Host forwarding remain for Claude's empty-view checks.
- 2026-10-19 — Run B's `sync-check` is server-only, temporary and loopback-only, with a
  deterministic fixture projection; it is written but not run by Codex. The production app's
  deterministic Markdown view option remains in 4b. — This run has no network, browser, app
  edits, installation, new dependency or commit.
- 2026-10-19 — Run B verification passed on the final sources: `npm test` (78 files, 1,772
  tests, including 445 server tests), `node --check` for all 21 server/check `.mjs` files,
  and whitespace checks. The helper's actual CLI exit codes and messages were tested with
  temporary-file stdio; this sandbox suppresses Node child-process pipe output. Deployment
  tests use injected plans/executors; no installer, live status, `sync-check`, network, socket,
  protected owner path or app source change was used. — Claude still runs the real service,
  Tailscale and empty-view isolation checks before installation is considered verified.
- 2026-10-19 — Claude Code's review of run A: request bodies are read after the pre-body checks
  and before the mutation queue, and the token is checked again inside it (a stalled upload from
  a frozen phone could otherwise hold every request for minutes); preflights don't wait for the
  queue; unexpected errors are logged by name and code only; `GET /v1/state` carries `fullPush`
  (a newly paired phone would otherwise loop on 409 `changed`); version checks run before the
  guard (a refused push no longer uses up a confirmation); outcomes are limited to `applied`,
  `dismissed`, `stale` with a bounded tick list. Each has a test. — Found by reading the code.
- 2026-10-19 — Claude Code's review of run B: the view writer skips a file that is intact and
  already holds the new content. — Rewriting every picture on every round would cost seconds per
  sync for a picture-heavy notebook; intact unchanged files are already exactly right.
- 2026-10-19 — Tailscale Serve forwards `Host: brent-dell-system-xps-l502x.tail1ce757.ts.net:8443`
  (with the port), plus `X-Forwarded-Host`, `X-Forwarded-Proto: https` and the caller's tailnet
  identity; measured with a throwaway listener behind a temporary Serve entry, since removed. —
  The live config accepts exactly that `Host`.
- 2026-10-19 — The launcher uses `claude --restricted --strict-mcp-config --tools
  "Bash,Read,Edit,Write,Glob,Grep" --settings <claude-strict.json>`. Claude Code 2.1.304's help
  says `--restricted` ignores user, project and local settings files (managed settings and
  `--settings` still apply), removes code-running tools and WebFetch unless `--tools` names them,
  confines file tools to the working directories and refuses bypassPermissions. Permission
  rules in a `--settings` file anchor a single leading `/` at that file's own folder, so every
  path rule in the strict policy is `//absolute` or `~/`; sandbox paths are plain absolute. —
  The most isolating documented combination; the real-session test decides it.
- 2026-10-19 — 4a verification before installation: `npm test` (78 files, 1,772 tests; 445
  server), `npm run sync-check` (8/8: pairing, sample push with store/view hashes, incremental
  edit, helper submission and outcome, import confirmation, backup with image hashes, journal
  recovery after apply and after publish), and a real-socket smoke test (pairing, push, git
  commit, daily backup, 403 for another origin, 401 for a wrong token, counts-only status and
  log). All on temporary data; no owner's notes involved.
- 2026-10-19 — The service's first install failed its health check: the `current` symlink made
  every entry-point check false, so `main.mjs` exited without doing anything. Fixed with a
  real-path comparison and a test (`b6e91eb`); then installed (linger on, user unit enabled,
  Serve `:8443` → `127.0.0.1:8790`, Funnel off, empty store, view built), restarted by systemd
  within seconds of `SIGKILL`, and passed a 10-step live check through the real Tailscale address
  on a temporary store with the made-up sample notebook (pairing, other origin 403, wrong token
  401, picture upload, 19-note push, backup with matching picture bytes, disconnect). The real
  store stayed empty and unpaired.
- 2026-10-19 — Lock-down test in real `claude-notes` sessions (Haiku, stream-json evidence): the
  session had exactly Bash, Edit, Glob, Grep, Read and Write, no MCP servers, `dontAsk`; Write
  and Edit were refused in `notebook/`, on `CLAUDE.md` and in the store; Read was refused for a
  sentinel file in `~/.config/notes_app-sync/` (never read); Read of the notebook and Write into
  `inbox/` worked. Two failures: `CLAUDE.md` does not load under `--restricted` (passing it with
  `--append-system-prompt-file` works), and every Bash command failed with "apply-seccomp: write
  /proc/self/setgroups (nested userns is capability-restricted …)": Ubuntu's
  `bwrap-userns-restrict` profile moves everything bubblewrap starts into `unpriv_bwrap`, which
  denies all capabilities. The documented fix (a `bwrap` AppArmor profile) clashes with Ubuntu's
  own and would loosen a system-wide protection, with sudo. — The sandbox fails closed, but the
  helper and any shell command can't run.
- 2026-10-19 — Owner's choice: **no shell commands in note sessions.** `claude-notes` gives
  Claude Code only Read, Edit, Write, Glob and Grep (Bash also denied in the policy). The
  `./propose` helper is replaced by a file protocol: Claude Code writes `inbox/<id>.html` (the
  proposed body) then `inbox/<id>.json` (its details); the service polls the inbox every few
  seconds, ingests a pair once both files have stopped changing, checks it against the private
  store (shape, sizes, the note's current `rev` and the generation, folder, links, pictures),
  records the version as pending or refused with a reason in `notebook/proposals.json`, and
  removes the two files through the symlink-safe pinned-directory helpers. A new proposal for a
  note with one pending replaces it (superseded). — The tightest lock-down: no command runs, so
  nothing needs sandboxing and nothing on the machine is loosened. Lost: Claude Code running
  scripts on the notes; reading, searching and proposing remain.
- 2026-10-19 — Run C replaces the command helper with an HTML/details file pair. The service
  observes each pair twice, checks revisions, generation and references against the private
  published store, and journals versions before rebuilding status files and removing inbox
  files. A valid replacement supersedes the pending version for its note, including at the
  50-pending limit; a refusal never supersedes it. — The owner chose a note session with no
  shell after the real sandbox failure; proposal safety must therefore live in the service.
- 2026-10-19 — Inbox observations and ten-minute half-pair timers are process-local and restart
  after a service restart. Reads recheck size/time/inode, and cleanup rechecks them after commit
  so intervening edits survive. Repeated pid/hash pairs only repeat cleanup. Nonregular entries
  and legacy inbox subdirectories remain untouched, while rebuild retires the old root helper
  file. — The protocol permits only regular pairs and explicitly forbids deleting unrelated
  inbox contents; a changed or unavailable inbox is never evidence of withdrawal.
- 2026-10-19 — The 3-second timer shares the mutation queue with state requests and skips ticks
  while any scan is queued or running; it is unreferenced and stops on server close. It resolves
  the journal and retries history before scanning. Both policies deny Bash, and the launcher
  exposes exactly Read, Edit, Write, Glob and Grep and passes CLAUDE.md explicitly. — Polling
  must work without the phone, must not pile up behind a slow commit, and must not keep tests
  alive or depend on the unavailable Bash sandbox.
- 2026-10-19 — Run C verification passed: `npm test` (77 files, 1,794 tests), `node --check`
  on all nine changed `.mjs` files, and whitespace checks. The existing symlink-entry CLI test
  now captures stderr in a temporary file because this sandbox suppresses child-process pipes;
  it still checks the actual exit code and JSON error. The socket-based `sync-check` was updated
  for timer ingestion, refusal and superseding but was not run. No owner paths, app sources,
  network, sockets, deployment or repository commit were used. Real Claude Code enforcement
  and the live service remain untested in this run.
- 2026-10-20 — The installer adds a `notes-sync` command (`~/.local/bin/notes-sync`, bound to the
  live config) for `pair` and `status`, removed by `--uninstall` and protected in both policies
  like `claude-notes`. — The contract and AGENTS.md name `notes-sync pair` and `notes-sync
  status`; the first installer didn't create them.
- 2026-10-20 — Run C reviewed by Claude Code; verification before redeploying: `npm test` (77
  files, 1,795 tests), `npm run sync-check` (10/10, including timer ingestion of a file pair, a
  `changed-since-read` refusal and superseding), all on temporary data.
- 2026-10-20 — Deployed `6fc3006`; then the final lock-down test in real sessions, with a
  deliberately permissive `~/notes/.claude/settings.local.json` in place (allow
  `Edit(/notebook/**)`, `Bash`, `WebFetch`; `acceptEdits`; sandbox off; a SessionStart hook):
  `claude-notes` sessions had exactly Edit, Glob, Grep, Read and Write, `dontAsk`, no MCP
  servers; `CLAUDE.md` loaded; the hook never ran; Read was refused for a sentinel in
  `~/.config/notes_app-sync/` and for `~/.ssh/`; Read of the notebook and Write into `inbox/`
  worked. With `CLAUDE.md` loaded, Claude Code declined even to attempt the forbidden writes; the
  same launcher flags and policy without the appended instructions refused, at the permission
  layer, writes to `notebook/`, `CLAUDE.md`, `AGENTS.md`, the private store and
  `~/.local/bin/notes-sync`, and allowed `inbox/`. The permissive file, test files and sentinel
  were removed; the real store has no commits. — Rule 5 holds against the owner's own settings
  sources as well as against note text. Built-in skills and subagents are listed in these
  sessions but unusable without the Skill and Agent tools.
- 2026-10-20 — **4a is complete.** The service runs on the XPS (user unit `notes-sync`, linger,
  `127.0.0.1:8790`, Tailscale Serve `:8443`, Funnel off), empty and unpaired, with the view at
  `~/notes` and the launcher `claude-notes`. — Next is 4b, the app side (0.4.0).
- 2026-10-20 — Phase 4b, run D adds only the app's sync engine and tests. App boot starts the
  scheduler; pairing, confirmation, Disconnect and Restore are callable operations for run E's
  UI. There are no new screens, navigation routes, tables, dependencies or version bump, and
  `server/` is unchanged. — This is the approved engine-only boundary; phone setup comes next.
- 2026-10-20 — Sync captures all stored notes (Trash included), folders, tombstones, exported
  preferences, referenced image metadata and generation in one read transaction. Image bytes
  are read separately with a generation check in the same transaction; requests check both
  generation and connection before and after awaiting a reply. A 409 recaptures at most three
  times; confirmation retries reuse the captured push only while it remains unchanged. —
  A save during a round belongs to the next round, and an import must never mix two notebooks.
- 2026-10-20 — A module-level sync lifecycle cancels requests and retained confirmations on
  import (start and local post-commit), replacement broadcasts, Disconnect and database updates.
  Connection changes also broadcast a credential-free notification. Pairing writes and outbox
  acknowledgements remain cancellable through transaction commit. — Late replies must not
  reconnect a disconnected phone or clear outcomes belonging to invalidated work.
- 2026-10-20 — The scheduler checks Dexie's database/table paths and primary-key ranges for
  exported preferences and `syncOutbox`; it ignores token, spend and other device preference
  writes. It uses the approved debounce, maximum wait, visibility rules and back-off, one
  in-window flight and a nonwaiting Web Lock when available. Its status store contains no
  address, connection token or retry closure. — Saving and navigation remain independent of
  network delays, and sync's bookkeeping cannot create an endless loop.
- 2026-10-20 — Missing images retain the server's list-of-ids shape, unioned with locally
  skipped references; outcomes use the server's exact `(proposal, hash)` acknowledgements.
  Restore returns `validateBackup`'s preview result without importing. Sync tokens are refused
  before backup upgrades and all sync preferences stay out of React's notebook state. The
  Markdown view uses UTC and the latest live edit, while ordinary text exports stay unchanged.
  — These reuse 4a's wire format and the existing import safety boundary.
- 2026-10-20 — Run D verification passed: `npm test` (83 files, 1,904 tests, including
  107 sync tests), `npm run build` and whitespace checks. The build retains Vite's
  large-chunk warning. Client/round integration uses the real handler with temporary stores
  and Request/Response adapters, never sockets; cancellation, capture races, confirmation,
  full pushes, missing images, exact outcomes, scheduler guards/timing and sentinel-token
  privacy are covered. No network, protected owner data, live service, commit or deployment.
  Phone typing, real Tailscale/permission behavior and run E's controls were not tested.
- 2026-10-20 — Claude Code reviewed run D (the app's sync engine): one read-transaction capture
  per round, generation and connection re-checked around every request and before each picture
  read, recapture after 409 `changed`, the confirmation bound to the exact capture, no writes to
  notes (only exact outbox acknowledgements), token never in the status store, requests with
  `credentials: "omit"` and `redirect: "error"`, a storage-change filter limited to this
  database's notebook tables, exported preferences and the outbox. Verification: `npm test`
  (83 files, 1,904 tests), `npm run build`. Not released: the engine starts with the app but
  stays idle without a saved connection.

- 2026-10-20 — Phase 4b, run E wires Settings → Sync, the connection entry and the notes-list
  decision bar at app version 0.4.0 (schema remains 4). Connection codes stay in an uncontrolled
  input, cleared before pairing awaits; saved addresses populate only the address input. The
  UI uses fixed status sentences and never receives the connection token. Network operations
  stay outside navigation's busy lock, so Back and local editing remain available.
- 2026-10-20 — An empty phone (including Trash) checks the XPS before its first push after
  pairing, also on reopen if the pairing or notebook generation still needs a full push.
  If the XPS has notes, the engine pauses for Restore or Continue without
  restoring; continuing still runs the normal removal/replacement confirmation. Failed state
  reads retain this check. An ordinary same-generation purge of the last note still syncs its
  tombstone. — Pairing must not push an empty notebook before the owner has seen the restore
  offer, including when the first state read fails; intentional deletions must still reach the XPS.
- 2026-10-20 — File import and XPS restore share BackupImport: the same preview, destructive
  confirmation, before-import safety download, guarded import and persistence request. A restore
  download holds background pushes through the preview; cancellation releases that hold but
  preserves an unanswered empty-phone offer. A successful restore resumes a full push under the
  imported generation. Android Back closes the import confirmation, then the preview, before
  leaving the screen; Back on a copy decision has the same paused-until-reopen effect as Not now.
- 2026-10-20 — Local checks may use HTTP only for localhost or 127.0.0.1; other HTTP hosts remain
  refused. Screenshot, browser-check and Claude-check contexts install one fail-closed Tailscale
  guard before navigation, covering service ports and trailing DNS dots. It aborts and records
  requests without query strings or headers and fails the run if any were attempted. — These
  checks must never reach the owner's service after the app gains connection controls.
- 2026-10-20 — Run E final verification passed: `npm test` (85 files, 1,947 tests),
  `npm run build`, `node --check scripts/*.mjs` plus an individual syntax check of every script,
  and `git diff --check`. The build retains the existing large-chunk warning. Fixture checks
  cover pairing and credential privacy, fixed status sentences, restore offers and pausing,
  shared import approval and safety downloads, identical restores with images, ordinary last-note
  deletion, copy decisions, Disconnect, entry/bar navigation and Android Back. No network,
  sockets in the added tests, paid requests, protected owner data, live service, commit or
  deployment; `server/`, README, dependencies and schema 4 are unchanged. Browser screenshots,
  phone layout/keyboard and live Tailscale/permission behavior remain for run F and the owner.
- 2026-10-20 — Claude Code reviewed run E: the screen follows the contract (fixed sentences, code
  cleared before awaiting, address only in its input, the confirmation with up to five titles per
  count, the empty-phone restore offer, Disconnect confirmed), Settings' file import and the XPS
  restore share one preview and import path (now with Cancel and Back), loopback `http:`
  addresses are accepted only for 127.0.0.1 and localhost, and the three Playwright scripts fail
  closed on any `*.ts.net` request. `package-lock.json` changed only its version. Verification:
  `npm test` (85 files, 1,947 tests), `npm run build`, `node --check scripts/*.mjs`.

- 2026-10-20 — Phase 4b, run F adds Sync shots 163–177 and the browser half of `sync-check`.
  Screenshots route only the exact default sync address to the real handler on a temporary
  store, with local-network permission granted; every other HTTP(S) Tailscale request aborts
  and fails the run. The browser check builds/serves a temporary app and service on loopback,
  imports only sample-derived notebooks through the UI, and checks pairing, typed autosave,
  one-change/one-removal confirmation, full-push restore, Disconnect with a response held,
  import during a held image upload, and recovery after a commit crash. Store/view/image
  assertions distinguish a published notebook from an upload that never reached a round.
  `status` runs with a temporary child-only Tailscale stub because its CLI probes Serve even
  in test mode; no real machine configuration is needed. Shared script helpers keep the import
  approval/safety download and fixture edits consistent. `--server-only` retains the original
  checks for diagnosis. No app or server runtime logic, dependencies, schema or version change;
  no owner data, live service, commit or deployment. Browser/socket checks and PNG/phone
  inspection remain for Claude and the owner; Codex cannot run them in this sandbox.
  Verification passed: `npm test -- --pool=threads --reporter=verbose` (85 files, 1,947 tests),
  `npm run build`, syntax checks of all four changed/new scripts and `git diff --check`.
  The full suite took about five minutes; earlier interrupted/time-limited attempts had no
  result. The build retains its existing large-chunk warning.
- 2026-10-20 — Claude Code ran run F's checks and looked at the shots: `npm run sync-check` 17/17
  (10 server, 7 browser), `npm run shots` (190 PNGs; sync shots 163–177 read at phone width and
  375 px), `npm run browser-checks` 15/15, `npm test` (85 files, 1,948 tests), `npm run build`.
  Fixed from the shots: plurals ("1 note", "1 picture", "1 picture used in your notes is
  missing … back it up") and the code hint ("Get a code by running notes-sync pair on the
  XPS."), with a test; the browser fixture now expects the same wording. The dev server was
  restarted in its tmux restart loop (it hadn't come back after the 2026-10-19 freeze).
- 2026-10-20 — **4b released as 0.4.0** (schema 4). Nothing syncs until the owner connects in
  Settings → Sync; the live XPS service is unchanged (no server code changed in 4b). Owner's
  phone check pending; before connecting, the owner exports a backup on the published app.
- 2026-10-20 — Owner's first real sync: the published app (0.4.0) paired with the XPS on the first
  code and synced three rounds; `notes-sync status` showed 14 notes (11 live, 3 in Trash), 6
  folders, 2 pictures, none missing, history recording, no journal left; the request log showed
  only 200/204 answers. The owner confirmed the counts match the phone. — The XPS is now an
  automatic backup of the real notebook.
- 2026-10-20 — The owner keeps both Claudes: the in-app one (API key) for quick work on the note
  in hand, questions with tappable sources, merge and split, and whenever the XPS is down; Claude
  Code on the XPS (subscription) for longer, conversational work across many notes. — They
  differ in cost, reach and availability; the in-app one costs nothing when unused.
- 2026-10-20 — Correction: a locked-down note session sees only `~/notes`, so Claude Code can't
  "connect notes to other projects" there, as the discussion on 2026-10-19 suggested. Read access
  to a named folder would be a deliberate policy change. — `--restricted` confines the file
  tools to the working directory.
- 2026-10-20 — 4c starts with a redesign of the shared review parts, used by both the Tidy review
  and the new XPS review, so they share one look and one phone check. Mockups at phone size (in
  `private-data/mockups/`): inline word changes (struck red, added green) instead of repeated
  Before/After blocks, with "Show before and after" on demand; one compact row per change with a
  tick, a small label ("Text · 4 words", "now a bulleted list") and Claude's reason; tags as
  added/removed chips; the new title first with "was: …" and Edit; a sticky bottom bar with
  Apply (and Discard); per-note cards with Dismiss for the XPS; a clear amber banner and greyed,
  disabled rows for a changed-since-read note. — The owner asked for a better review screen; the
  current one repeats each paragraph twice and puts the actual changes in small print.

- 2026-10-20 — Phase 4c, run G implements the approved review look in shared React components
  under `src/components/review/`, using the mockup colours as `src/index.css` tokens.
  `ChangeCard` keeps its existing export and accessible article name, wrapping `ChangeRow`;
  `ReadOnlyBody` moves unchanged and is re-exported for its existing callers. Inline text uses
  the existing word parts, with literal whitespace and spoken added/removed prefixes. The word
  label counts each replacement once (the larger of the removed/added word counts for that
  edit), summing separate edits. Shape changes show the formatted result and a plain Before
  line; other replacements offer formatted Before/After on demand. — Presentation must not
  alter the diff, tick ids, proposal plans, Apply, Undo or freshness checks.
- 2026-10-20 — Review title editing is revealed by Edit; per-note selection moves into the card
  header. Untick all keeps clearing any partial selection; when nothing is ticked it becomes
  Tick all, using the same existing ids and proposal update path. The existing stale result
  disables and fades metadata/text rows as well as disabling Apply. The fixed action bar has
  safe-area padding and the review page reserves 120 px plus the safe area below its content.
  Duplicates keeps its per-group Merge actions and has only Discard in that bar. — The approved
  controls change where the owner reviews and selects, not what can be applied.
- 2026-10-20 — Run G retains every screenshot name and adds `91a-tidy-before-after`; tidy shots
  explicitly position their content above the fixed bar. Existing review test interactions
  now open Edit/the formatted toggle and use the per-note header's new selection label; the
  saved-After assertion still compares the displayed result to the exact normalised saved body.
  New fixture tests cover shared rows, diff kinds, whitespace, keyboard ticks, metadata,
  action buttons and disabled stale rows. Browser screenshots and the phone/keyboard check
  remain for Claude and the owner; Codex has not run or seen them.
- 2026-10-20 — Run G verification passed: `npm test` (86 files, 1,967 tests), `npm run build`,
  `node --check scripts/screenshot.mjs` and `git diff --check`. The build retains the existing
  large-chunk warning. No dependencies, proposal/diff/session logic, storage code, `server/` or
  `src/sync/` changed; no paid requests, live-service changes, commit or deployment.
- 2026-10-20 — Claude Code reviewed run G against the approved mockups with fresh shots (191
  PNGs: tidy review, its stale state, titles/tags/folders): the build matches. Fixed: the stale
  banner no longer repeats "Ask again." before its Ask again button (tests and shot waits follow
  the shortened text). Test edits in run G only add checks (Tick all, disabled rows when stale).
  Verification: `npm test` (86 files, 1,968 tests), `npm run build`.

- 2026-10-20 — Phase 4c, run H adds the phone inbox at 0.4.1, using run G's shared review
  cards, rows, amber warning and action bar. The HTML audit walks an inert DOM before cleaning;
  its vocabulary comes from the editor schema and supported HTML samples, including the
  editor's own serialized markup. It counts authored CSS declarations once and combines its
  removals with the cleaner's report without counting the same reference twice. Images can
  refer only to images already in that note, and note links only to live notes.
- 2026-10-20 — Each reviewed proposal version keeps its exact diff and tick ids while the
  screen is open. Later saves only mark that card stale; they never silently give an existing
  tick different text. Apply captures the selected current cards before flushing the save queue,
  then checks all revisions and the generation in one transaction. Its `kind: "xps"` record
  uses the existing Undo slot, and its proposal outcomes are appended in that same transaction.
  A target moved to Trash also refuses any newly added note link. A failed batch refreshes the
  review and applies nothing.
- 2026-10-20 — Handled proposal versions are hidden for the rest of the in-memory sync session
  as well as while their outcomes wait in the durable outbox. A late GET result or an outcome
  acknowledgement cannot resurrect a card. Dismiss records `dismissed`, or `stale` when its
  note changed, and keeps the proposal on the XPS. The next sync reports outcomes through the
  existing engine. Reload starts with an empty review until sync supplies pending proposals.
- 2026-10-20 — Shared title-edit and formatted Before/After panels register with the existing
  overlay stack so Android Back closes the last opened panel before leaving either review.
  Settings → Sync exposes the same durable Undo as Settings → Claude, with the source-specific
  "Undo Claude Code's last change" label. Browser scripts now write proposal HTML/JSON pairs
  only into their temporary view, exercising ingestion, partial Apply, stale review, Dismiss
  and Undo. No server runtime, schema, dependencies or owner data are changed.
- 2026-10-20 — Run H final verification passed: `npm test` (89 files, 2,050 tests),
  `npm run build`, `node --check` for every script and `git diff --check`. The production build
  retains the existing large-chunk warning. Tests cover every supported HTML sample and its
  serialized form, identity-reference cleaning, all stale cases, partial multi-note Apply,
  transactional outcome writes and rollback, Undo, Dismiss, exact server acknowledgements,
  review/bar states and Android Back. Round tests use the real request handler with temporary
  stores and no sockets. Screenshots and `npm run sync-check` were extended but not run under
  this run's no-network rule; the implementation's phone layout and keyboard behavior have
  not been seen. The approved mockup PNGs were inspected (the referenced `xps.html` was absent).
  No paid requests, protected owner data, live-service changes, commit or deployment.
- 2026-10-20 — Claude Code reviewed run H (the suggestions screen, the proposal models, the plan
  builder, the apply-path change: kind `"xps"`, the live-target rule, the outbox written in the
  Apply transaction) and ran what Codex couldn't. Fixed: the stale-banner change from run G
  crashed when a review had no message of its own (a one-frame state when leaving a stale merge
  for the duplicates list); the review now falls back to the general stale sentence and the
  banner accepts any message. The suggestions screen hides its Apply bar when only stale or
  unusable suggestions are left and shows "Nothing ticked" when nothing is selected (it said
  "Apply 0 changes to 0 notes"); a `sync-check` assertion assumed one checkbox per stale card.
  Verification: `npm test` (89 files, 2,052 tests), `npm run build`, `npm run sync-check` 19/19
  (10 server, 9 browser, including a proposal pair through review, partial Apply, Undo, a stale
  card and Dismiss), `npm run shots` (198), `npm run browser-checks` 15/15. The dev server was
  restarted once (it had stopped settling after many file changes).
- 2026-10-20 — **4c released as 0.4.1** (schema 4): the new review look for every Claude review,
  and Claude Code's suggestions on the phone. No server change; the XPS service stays at its
  4a deploy. Owner's phone check pending.
- 2026-10-20 — Owner's 4c phone check (published app 0.4.1, real `claude-notes` session):
  suggestions for two notes arrived; review, unticking one change, Apply and Undo behaved; asked
  again, a note edited on the phone before Apply showed the amber card and couldn't be applied
  while the other applied; Dismiss worked. The new review look reads right on the phone in Tidy
  and in Claude Code's suggestions. Not tried: Apply in one window with another open, then Undo
  there (left for 4e's full phone check). — 4c is owner-verified apart from the two-window case;
  the owner asked for 4d next.

## Phase 4d — new notes, Trash moves, new folders and Keep both (2026-10-20)

- 2026-10-20 — Owner's choices for 4d, all the recommended options: Claude Code sets a new note's
  title, text, tags, reason and folder (an existing one, No folder, or a new folder by name) and
  may reuse pictures already in live notes, never add one; new notes are never pinned. One tick
  for a whole new note (its title keeps Edit) and one for a Trash move; a Trash proposal can't
  also edit the note. Undo works as split's: a new note goes to Trash, trashed notes come back,
  and nothing changed since is overwritten ("(before Claude)" copies instead). Keep both adds
  Claude Code's version as a new note "… (from Claude Code)" in the folder the owner's note is in
  now, with its own Undo and the outcome `kept`; not offered after an import. — One tick per new
  note because there is no "before" to keep part of; Trash rather than deletion on Undo because
  it can itself be undone; the copy beside the original because that is where the owner looks.
- 2026-10-20 — Shapes: a new note is a file pair without `note`/`basedOnRev`; a Trash move is the
  JSON file alone with `trash: true`; any edit or new note may carry `newFolder` (a name, with
  `folderId: null`). A new-note pid stands for one proposed note: Claude Code revises it under the
  same pid while it waits; once the owner handled it, `pid-used`. — Without a shell, Claude Code
  can only write files; a body file for a Trash move would be meaningless, and a pid is the only
  identity a not-yet-existing note has.
- 2026-10-20 — Added by Claude Code, not asked for: the XPS lists new-note and Trash proposals
  only to an app that asks for them (`GET /v1/state?proposals=2`). — A 0.4.1 window would show
  them as broken cards that Dismiss would throw away. Codex's review moved this from "the last
  push's app version" to a per-request parameter.
- 2026-10-20 — Codex reviewed the 4d draft read-only (xhigh): 13 findings (1 P0, 5 P1, 7 P2), all
  taken. P0: Keep both re-cleaned Claude Code's text with a wider picture rule than its card,
  so it could save a picture or link shown as removed; now Keep both opens a sheet with the exact
  copy and Apply writes exactly that, refusing if anything it depends on changed. P1s: a durable
  record of handled versions (`syncHandled`) so two windows can't add the same note twice; the
  per-request compatibility parameter; mixed Undo spelled out (roleless edits decided as split's
  content note); folder reuse built from the resolved review (only real new folders are
  "expected new"); new-note titles in `proposals.json` only while pending. P2s: a canonical hash
  for body-less Trash versions; the complete `kept` outcome entry; typed pending keys; a renamed
  created folder never deleted by Undo; `db.files` in every checking transaction and picture
  retention tests; link destinations shown for new notes; the amended contract rules. A focused
  second pass found 11 resolved and 2 partly, plus 6 more, all taken: no cap on the handled
  record within a notebook generation (a sleeping window could act on an evicted entry); an
  owner outcome retires pending sibling versions under its pid and titles show only for the
  current generation; Keep both rechecks the source note's `rev`; `folderId` resolves by id and
  only `newFolder` by name; Undo records written before 0.4.2 (without folder names) keep their
  created folders; every Dismiss, stale included, is recorded as handled. — Each closes a
  duplicate, a silent difference between review and write, or a leak of a trashed note's title.
- 2026-10-20 — The owner approved the 4d contract (`docs/PHASE-4-DIRECTION.md` "4d"). BRIEF
  Tier 4 now mentions Keep both and the new proposal kinds. — Next: run I (server), run J (app).
- 2026-10-20 — Phase 4d, run I keeps edit checks in their 4c order and inserts the new-folder
  collision check after folder-id lookup. New notes check generation, folder id, folder name,
  live links, live-note pictures, then prior owner outcomes for the pid; Trash checks existence,
  Trash state, then revision/generation. — Establish the current notebook and valid references
  before reporting pid reuse; an edit's existing first refusal stays the same.
- 2026-10-20 — Phase 4d, run I probes stable lone JSON through the existing bounded read and
  reinspection, keeping the observation and original half-pair timer when it is not Trash.
  Malformed Trash objects are refused immediately as `invalid-shape`; a companion body takes
  `trash-with-body` precedence. Valid lone Trash hashes only canonical details. — Two unchanged
  observations still protect a Trash file, and reading an unfinished edit/new pair must neither
  consume it nor reset its timeout. Cleanup retains the captured stamps and file set.
- 2026-10-20 — Phase 4d, run I uses separate replacement identities for existing notes and
  new-note pids. Outcome updates accumulate by filename, including pending new-note siblings,
  before one journal batch; sibling `handledAt` uses the service clock, as ingestion does.
  — A delayed outcome for an earlier revision retires its replacement without losing another
  explicit outcome in the same request, and a note id equal to a pid cannot collide.
- 2026-10-20 — Phase 4d, run I parses the state query with `URLSearchParams` after the first
  question mark; its first `proposals` value must be exactly `2`. Other parameters are ignored,
  malformed escapes do not throw, and the route and logs keep the query-free path. — The
  compatibility filter belongs only to the reply, independent of ingestion and app versions.
- 2026-10-20 — Phase 4d, run I verification passed: `npx vitest run server/ --reporter=dot`
  (10 files, 606 tests), then one full `npm test -- --pool=threads` (90 files, 2,190 tests;
  138 added over the 2,052-test baseline). `node --check` passed on all seven changed `.mjs`
  files, and `git diff --check` passed. Tests use temporary stores and generated rows without
  sockets, including recovery at every ingestion/outcome checkpoint, canonical Trash replay,
  raced reads/cleanup, new-note sibling retirement, title privacy and old-app reply filtering.
  The server half of `sync-check` gains five checks; its browser half and the supported-HTML
  list are unchanged. `sync-check`, shots, browser checks and deployment were not run; no phone,
  browser layout, real service or live Claude Code session was seen. No network, protected owner
  data, keys, app source changes, new dependencies or repository commit were used. — Claude
  Code runs the socket/browser checks and reviews this server step before run J.
- 2026-10-20 — Claude Code reviewed run I (the shapes per kind, the lone Trash JSON read only
  after two stable observations, the body-less Trash hash, superseding by note or by pid,
  `pid-used` from owner outcomes, sibling retirement in the outcome batch, `kept`, the
  pending-and-current-generation title rule, the `?proposals=2` filter, the rewritten
  `CLAUDE.md`). Fixed: a version refused for its shape is stored without details, so it was
  classed as a new note and shown as "New note" in `proposals.json`; `recordKind` now gives it no
  kind (with a test). Verification: server tests (607), `npm run sync-check` 24/24 (15 server,
  9 browser) with the unchanged 0.4.1 app against the new service, which is the order the
  release uses.
- 2026-10-20 — Phase 4d, run J keeps the exact reviewed edit diff and ticks while a card is
  open; handled-version and handled-pid checks remain live and disable old cards immediately.
  The durable handled list is read inside database callbacks, with only filtered proposals or
  plain display messages entering React state. Dismiss reads freshness again inside the same
  transaction as its outbox and handled entries. — A late reply, sleeping window or delayed
  acknowledgement cannot repeat an approval or turn a stale dismissal into a current one.
- 2026-10-20 — Phase 4d, run J uses the shared body-cleaning path for new notes and Keep both.
  Keep both captures source and link revisions plus picture metadata when its sheet opens;
  picture cleanup's unused clock is excluded from that comparison because it changes no picture.
  The saved copy is never cleaned again after confirmation. New titles use the same validation
  and edit control as edit titles. — Refusal requires another look at the exact copy, without
  making routine picture housekeeping invalidate an otherwise unchanged sheet.
- 2026-10-20 — Phase 4d, run J checks new note-link occurrences through the shared effects
  comparison, including a retargeted link or a second link to an already-linked note. The review
  and xps Apply use the same comparison; links already present may stay when their target moves
  to Trash. Other Claude plan kinds retain their previous target checks. — Matching plain words
  or a set of target ids alone would miss a newly added link into a ticked Trash move.
- 2026-10-20 — Phase 4d, run J gives moved-note xps Undo a confirmation even directly after
  Apply, using the same description and decision list as Settings. Folder names are captured
  for every new Undo record; legacy records keep their created folders. The shared three 4c
  browser fixtures remain, with new-note and Trash fixtures added; the screenshot script alone
  revises the metadata fixture to demonstrate a new folder on an edit. — The owner can inspect
  the moves before Undo, and older records cannot accidentally remove a renamed folder.
- 2026-10-20 — Phase 4d, run J verification passed: one full `npm test -- --pool=threads`
  (92 files, 2,272 tests; 81 added over the reviewed run I's 2,191), after targeted fixture
  checks (206 tests across six files, then 46 review/preference tests covering the final
  compatibility check). `npm run build`, `node --check` on all nine changed `.mjs` files and
  `git diff --check` passed; the build retains its existing large-chunk warning. Tests cover
  concurrent approvals, handled identities and pids, backup/React-state exclusions, folder
  races, atomic mixed Apply, record validation, Undo, pictures, fresh Keep both confirmation,
  the real handler's `kept` acknowledgement, links into Trash, row controls and Android Back.
  Existing expectations changed for the agreed bar/intro/stale wording, `?proposals=2`, valid
  created-note xps records and positive server sequence fixtures. The pending bar also keeps
  hiding a legacy outbox-only version after acknowledgement. The browser scripts were extended
  but not run: shots, `sync-check`, browser checks and the owner's phone remain for Claude Code
  and the owner; no browser layout or phone keyboard was seen. Run J changed no `server/` files
  and used no network, sockets, protected owner data, keys, paid requests, new dependencies,
  deployment or repository commit. — Version 0.4.2 is ready for Claude Code's review and the
  socket/browser/phone checks.
- 2026-10-20 — Claude Code reviewed run J (the suggestion models per kind, `syncHandled`, folder
  resolution, the mixed plan, `checkPlan`'s new rules, created-only xps records, Undo through
  `undoMovedNotes` with folder names, Keep both's fresh sheet and its dependency checks, the
  new rows and sheet) and ran what Codex couldn't. Fixed: `sync-check`'s mixed Apply/Undo step
  read `~/notes`'s index as soon as the store had published, but the XPS rebuilds the view a
  moment after publishing; the check now waits for the view as it does for the store (an
  opt-in `SYNC_CHECK_DEBUG` prints assertion messages only, never Playwright errors). From the
  shots: the new-note and Keep both previews label their folder ("Folder: …"). Kept as built:
  Undo of a change with new or trashed notes asks for confirmation even right after Apply,
  showing what it will do. Verification: `npm test` (92 files, 2,273 tests), `npm run build`,
  `npm run sync-check` 26/26 (15 server, 11 browser, including a mixed Apply, its Undo and Keep
  both through real files), `npm run shots` (207; shots 185–193 read), `npm run browser-checks`
  15/15. `server/README.md` describes the three kinds.
- 2026-10-22 — Owner's 4d phone check (published app, the checklist at the end of
  `docs/PHASE-4-DIRECTION.md` "4d"): "Checks pass." Then 4c's remaining item, Apply in one
  window with another open and Undo from the other window's Settings → Sync: "The remaining 4c
  checks passed." — 4c and 4d are owner-verified; the owner asked for 4e.

## Indent and outdent buttons (2026-10-22)

- 2026-10-22 — Two toolbar buttons, Indent and Outdent, on the default toolbar right after the
  list buttons. — The owner asked for a "tab" button to make nested bullets; the phone keyboard
  has no Tab key. Outdent was added with it (owner approved) so an indent can be undone without
  Undo.
- 2026-10-22 — Lists only: they move the innermost bullet, numbered or checklist line under the
  cursor (Tiptap's `sinkListItem` / `liftListItem`), including lists inside callouts. Outside a
  list both buttons show as unavailable. — Nested lists were already in the note vocabulary, so
  no schema change. Indenting plain paragraphs would add new note content and is left out.
  Outdent on a top-level line turns it into a plain line, as Shift+Tab does on a keyboard.
- 2026-10-22 — "Unavailable" is `aria-disabled` plus greying, not the `disabled` attribute. — A
  disabled button cannot keep the note focused, so a tap would close the phone keyboard. The tap
  is swallowed and does nothing.
- 2026-10-22 — Owners who already saved their own toolbar do not get the new buttons
  automatically; they add them in Settings → Toolbar. — Changing a saved list silently would
  override the owner's choices.
- Collapsible nested lists (OneNote-style +/−) were discussed the same day: feasible, medium-sized,
  and would add a new attribute to the note vocabulary. Not planned yet.
- 2026-10-22 — Indenting plain lines stays out for now (owner). — A typed tab character shows while
  editing but is dropped when the note is reopened (HTML whitespace is collapsed on load), so it
  would silently lose the indent. Doing it properly means an indent level on paragraphs and
  headings: a schema version bump, plus Claude, Copy as text and the XPS Markdown copy. Worth it
  only once the owner needs it.
- Verification: `npm test` (92 files, 2,280 tests), `npm run build`, `npm run shots` (209; shots
  07c and 07d read). Owner checked Indent on the phone, 2026-10-22.

## Phase 4e — closeout (2026-10-22)

- 2026-10-22 — Codex reviewed `git diff phase-4-base...HEAD` read-only (xhigh) against the
  contract, as three parallel runs: the XPS service and Claude Code's lock-down; the app's sync
  engine and Settings → Sync; Claude Code's suggestions on the phone. The indent/outdent commits
  were out of scope. — One run across 128 changed files would have spread too thin.
- 2026-10-22 — Claude Code checked every finding against the code; all 11 distinct findings hold:
  (1) an edit with more than 500 ticked changes makes the XPS refuse every later outcome report
  (the server caps a tick list at 500, the phone doesn't), found by all three runs; (2) a stale
  edit naming a folder the owner has since deleted is shown as unreadable, so Keep both isn't
  offered; (3) a malformed proposal identity from the XPS reaches the outbox on Dismiss and blocks
  outcome reports the same way; (4) an import or Restore can lose a note another window saves
  between the safety download and the replacement (older than Phase 4); (5) a window opened while
  Sync was off doesn't notice another window connecting; (6) an app update from another window
  doesn't pause or invalidate sync, as the contract says it should; (7) a crash in the middle of
  writing a view file leaves a temporary file with note text in `~/notes`, never cleaned;
  (8) view directories are 0755, the contract says 0700; (9) `notes-sync status` counts any
  Tailscale Serve mapping (the health tracker's) as the notes mapping; (10) a view file whose
  mode changed but whose bytes didn't is never repaired; (11) inbox cleanup can delete a file
  Claude Code replaced in the instant between the last check and the delete. Fix plan for the
  owner's approval next.
- 2026-10-22 — The owner approved the 4e fix plan: fixes for findings 1–10 (the XPS: no count
  cap on an outcome's tick list, the readable log showing at most 50 ticks; temporary files
  cleaned from the view; 0700 view directories; the exact Serve mapping in `notes-sync status`;
  mode-only damage repaired. The phone: the import/Restore replacement refused if the notebook
  changed after the safety download; identities checked before anything is queued for the XPS,
  an unreportable Dismiss kept on the phone; Keep both on a stale edit whose folder is gone;
  windows adopting another window's connection; sync paused once an app update is activated),
  a round-trip test of the phone's real results through the XPS's checker, version 0.4.4, a
  Codex second pass over the fixes, and the final phone check. Finding 11 is accepted: Linux has
  no delete-if-unchanged, every fix only narrows the instant, never deleting captured files would
  change rule 4 and fill the inbox, the worst case is a lost revision of a suggestion (never a
  note), and `CLAUDE.md` already tells Claude Code not to touch submitted files.
- 2026-10-22 — Phase 4e, run K uses the shared temporary-file prefix for view writes and
  rebuild cleanup. Cleanup checks only immediate regular files and symlinks in the five
  managed directories outside inbox, through pinned directories, before new files are written.
  Temporary-named directories and their contents remain untouched. — Recover interrupted
  writes without following links, recursing into unexpected entries or changing inbox cleanup.
- 2026-10-22 — Phase 4e, run K checks a view file's 0444 mode on its opened no-follow file
  descriptor, alongside the existing regular-file and identity checks. A mode mismatch takes
  the same tampered-log and replacement path as changed bytes; managed directories are
  tightened to 0700 on every rebuild. — Permission-only damage must not pass the manifest's
  content check, while intact pictures still avoid unnecessary rewrites.
- 2026-10-22 — Phase 4e, run K retains every validated outcome tick in the store and JSON
  index, shortening only the readable log to 50 ticks plus the omitted count. The phone's real
  inbox and Keep both plan builders supply compatibility-test outcomes; Dismiss entries use
  its exact shape without a database write. — The request-size limit bounds long lists, and
  a readable summary must not discard the durable record of what the owner applied.
- 2026-10-22 — Phase 4e, run K resolves explicit public ports from `config.hosts`, falling
  back to the origin's port for hosts without one and also checking the origin's host. This
  corrects the task's origin-only port wording: the existing config's origin is GitHub Pages,
  while its service Host names :8443. — An origin-only check would falsely reject the deployed
  notes mapping. Readiness requires that listener's HTTPS flag and exact root proxy to the
  configured loopback port (one trailing slash allowed); other mappings report missing. Empty
  or absent configuration is off, distinct from a failed read, which is unreadable.
- 2026-10-22 — Phase 4e, run K verification: `npx vitest run server/ --reporter=dot` passed
  (10 files, 647 tests, including deployment tests; 40 net additional tests). New regressions
  reproduced the view and outcome defects before the fixes. The real 501-paragraph app diff
  exceeds both the default five-second test limit and 30 seconds under jsdom here; that one
  compatibility test has a 90-second limit and passed without replacing the app's code.
  One full `npm test -- --pool=threads` completed (92 files: 91 passed, 1 failed; 2,320 tests:
  2,319 passed, 1 failed). The unchanged `src/screens/SyncReview.test.jsx` navigation test
  could not find the suggestions Review button at line 168, before its Android Back checks.
  A separate `npx vitest run src/screens/SyncReview.test.jsx --pool=threads --reporter=dot`
  passed all 24 tests in that file. — The full run is not green; this intermittent app-test
  failure remains for Claude's review/run L, and the full suite was not repeated.
  `node --check` passed on all four changed `.mjs` files; `git diff --check` passed. No build,
  `sync-check`, shots, browser checks, live-service check or deployment was run; no phone,
  browser layout or live Claude Code session was seen. Checks used generated fixtures and
  temporary folders, with no network, listening sockets, Tailscale command, protected owner
  data, keys, paid requests, new dependencies or repository commit. No `src/`, `docs/` or
  scripts changed; the pre-existing root README and decision-log edits were preserved.
- 2026-10-22 — Phase 4e, run L captures the safety backup and its fingerprint in the same
  read transaction. The fingerprint is synchronously sorted-key JSON of every note field,
  all folder and tombstone rows, only `EXPORTED_PREFS`, and referenced picture ids, exported
  metadata and byte lengths (including missing halves). Picture bytes are immutable under
  their ids; unused-picture clocks, unreferenced pictures and device-local preferences are
  excluded. Pictures are encoded one at a time, without retaining all their byte buffers.
  Import compares the same capture inside its write transaction before any clear; every UI
  path supplies the fingerprint, while fixture/script imports may omit it. — A committed
  save or housekeeping change in another window must survive, with a fresh safety download
  before the owner retries; no asynchronous digest can end the checking transaction early.
- 2026-10-22 — Phase 4e, run L shares the service's reportable proposal/hash rules in sync
  preferences, with explicit string checks and a compatibility assertion against the service.
  The inbox retains its narrower proposal-name rule; note ids already use the typed `isSafeId`
  helper. An unreadable, unreportable Dismiss writes only `syncHandled`, never an outbox entry;
  xps Apply checks reportability again. A stale edit may ignore only a folder-resolution
  failure, keeping its other reviewed changes and audit; Keep both still uses the source's
  current folder. — A bad suggestion must neither block later reports nor hide a valid copy.
- 2026-10-22 — Phase 4e, run L distinguishes received `connection-changed` from ordinary
  `invalidated` lifecycle events. The scheduler pauses immediately, rereads the saved connection,
  resets its Restore check as on startup, and waits for an aborted round to leave before
  resuming. Adoption is ignored during local Connect/Disconnect and after stop; overlapping
  reads cannot adopt an older connection. Connection notifications now follow the credential
  commit (including Disconnect), while starting a local operation invalidates locally.
  — Other windows must read the committed state, not the credentials about to be removed.
- 2026-10-22 — Phase 4e, run L calls `beginUpdate` from the activated-worker `onNeedReload`
  callback and immediately before an explicit `updateServiceWorker(true)`. The lifecycle aborts
  outstanding work and keeps both direct rounds and the scheduler paused until reload;
  `needRefresh` alone does not pause. A failed explicit activation calls `endUpdate`, emitting
  `update-ended` to resume, unless a worker has already activated meanwhile. — Loaded code may
  sync while an update merely waits, but activation invalidates even a schema-4-to-schema-4
  round. The navigation regression now waits for sync startup before supplying its suggestions;
  startup's session reset could otherwise erase the fixture state (run K's intermittent failure).
- 2026-10-22 — Phase 4e, run L verification passed: targeted runs of four files / 231 tests,
  five files / 273 tests, then the final backup/App/scheduler checks (three files / 226 tests)
  and review/picture-backup checks (two files / 88 tests). One full
  `npm test -- --pool=threads` passed all 92 files and 2,380 tests in 397.44 seconds
  (60 added over run K's 2,320-test baseline). `npm run build` passed with the existing
  large-chunk warning; `git diff --check` passed. Regressions cover a second Dexie connection's
  save, all note fields and exported preferences, referenced picture changes, unchanged/local-only
  changes, the usable Import retry dialog and its new safety download, malformed identities and
  local Dismiss, the Apply guard, stale missing/ambiguous folders with rendered Keep both and
  saved copies, received connection changes, notification-after-commit, stopped/local-operation
  schedulers, and update invalidation, pause and failure recovery. Version is 0.4.4 in all three
  package entries; no schema or dependency change. Existing run K and README edits were preserved;
  the only server edit in run L adds the requested identity-rule compatibility assertions.
  No network, sockets, protected owner data or keys, paid calls, deployment or commit were used.
  `sync-check`, shots and browser checks were not run; no browser layout, phone keyboard,
  real service or live Claude Code session was seen. — Claude Code reviews this step and runs
  those checks; the owner still needs the phone check at
  `http://brent-dell-system-xps-l502x:5174/`.
- 2026-10-22 — Claude Code reviewed runs K and L (each fix against its finding, the tests, the
  contract around it) and ran what Codex couldn't. Checked the new Serve test against the live
  `tailscale serve status --json` with the deployed host list: "configured", and "missing" with
  only the health tracker's mapping. Timed the review diff for a big suggestion in headless
  Chromium on the XPS: 0.45 s for 50 changed paragraphs, 1.5 s for 200, 3.3 s for 501, growing
  in step with the size. — Shared with Tidy since Phase 3; acceptable, and nothing realistic comes
  near 500; noted, not changed.
- 2026-10-22 — Codex's second pass (read-only, xhigh) over the fixes: findings 1, 3, 4 and 6–10
  (the numbering of the findings entry above) fixed; two partly fixed, both now completed by
  Claude Code with a test each that fails without the fix: (a) a connection change from another
  window arriving during this window's own Connect or Disconnect was dropped, so this window
  could stay disconnected with valid saved credentials; it is now read once that operation
  finishes (`adoptDeferred` in `src/sync/trigger.js`). (b) The review kept an unreadable card as
  first built, so a card going stale while the review was open still hid Keep both; unreadable
  cards, which have nothing tickable to keep, are now rebuilt on every snapshot
  (`src/screens/SyncReview.jsx`). — Both need two windows or a change while the review is open;
  the rest of the second pass found nothing new.
- 2026-10-22 — 4e verification before release: `npm test` (92 files, 2,381 tests), `npm run
  build`, `npm run sync-check` 26/26 (15 server, 11 browser, including import, Restore, Keep both
  and the mixed Apply/Undo through real files), `npm run shots` (208 PNGs; Restore, the stale
  Keep both card and Sync connected read; a first run timed out at the wrong-code shot while
  the dev server was reloading for a test edit, and the rerun passed), `npm run browser-checks`
  15/15 (including an update activated from another tab). The phone, Samsung Keyboard and a
  real Claude Code session were not seen. Contract, BRIEF §7, README and
  `DECISIONS-EXPLAINED.md` §80 updated.
- 2026-10-22 — **4e released as 0.4.4**: commit 77e4f9d; `npm run sync-deploy` switched the
  service from 431d79d to 77e4f9d; `notes-sync status` afterwards: active, same counts (16 live,
  3 in Trash, 8 folders, 2 images), no missing images, history fine, paired, `serve:
  "configured"` under the stricter check, Funnel off. Pushed; the Pages deploy succeeded and the
  live bundle is 0.4.4. Owner's final phone check pending.
- 2026-10-22 — **Owner's final 4e phone check passed** ("Checks pass"): on 0.4.4, Settings
  showed the version and Sync connected; a stale Claude Code edit whose folder had been deleted
  offered Keep both and saved the copy in No folder; an Apply; `notebook/proposals.json`
  showed `kept` and `applied`; a phone edit reached Claude Code's view. **Phase 4 is
  complete.** The local tag `phase-4-base` (efdc681) is no longer needed.

## Collapsible list lines (0.4.5, note format 5, 2026-10-22)

- 2026-10-22 — Owner's choices (asked in Plan Mode): the collapsed state is **saved in the note**
  (`<li data-collapsed="true">`); a grey − in front of every list line that has lines under it,
  + when collapsed; **bullets, numbered lists and checklists**; collapsing or expanding **doesn't
  move "Edited"**. — Like OneNote, it stays tidy after closing, in backups and on the XPS.
- 2026-10-22 — Note format 4 → 5 (`src/version.js`, `server/constants.mjs`, `db.version(5)` with no
  store change, a 4→5 backup upgrade). — The schema covers the HTML vocabulary. An older app
  refuses a 0.4.5 backup and an older window goes read-only through the existing guards; the XPS
  must be deployed before the app is pushed, or pushes wait with "Update the XPS service".
- 2026-10-22 — `data-collapsed` is written only when true. — Every note without a collapsed line
  saves byte-for-byte as before, so opening old notes never looks like an edit.
- 2026-10-22 — Hiding is CSS, only while the editor is editable
  (`.ProseMirror[contenteditable="true"]`). — Read-only notes and Claude's review previews (which
  use the same editor, read-only) always show every line, so a suggested change can't hide.
- 2026-10-22 — The −/+ is a ProseMirror widget with no text (the glyph is CSS), and bullet lines
  get a small node view that updates the `<li>` in place. — The keyboard's predictions never see
  the toggle, and tapping it never replaces the line being typed in; TaskItem's own node view
  already updates in place. Taps call preventDefault and never focus, so the keyboard stays as
  it was.
- 2026-10-22 — Toggling is not an Undo step (as in OneNote). One `appendTransaction` rule keeps the
  promises: the cursor never stays in hidden lines (it opens the line), a change to hidden lines
  opens them (Indent into a collapsed line, Outdent taking the lines below, Backspace joining in),
  and a line left with nothing under it loses the mark. Undo/Redo get only the cursor rule. Enter
  at the end of a collapsed line adds the new line after the hidden group; elsewhere Enter is
  unchanged. Deleting a selection across a collapsed line deletes its hidden lines (Undo restores).
- 2026-10-22 — "Edited" ignores collapse-only changes through one shared `isContentEdit` in
  `src/db/notes.js`, used by saving and the note screen. `rev` still goes up, so it syncs; as with
  pinning, a pending Claude suggestion for that note then counts as stale (Keep both is offered).
- 2026-10-22 — No "+3" count on the toggle. — A count would mean redrawing the toggle as lines are
  added, next to text being typed; the plan allowed a plain + if it didn't fit.
- 2026-10-22 — Claude: `NOTE_HTML_RULE` and the XPS `CLAUDE.md` say to keep `data-collapsed` as
  given; the sync audit accepts only the value `true`. Search, Copy as text, Ask and the XPS
  `notebook.md` list hidden lines normally.
- 2026-10-22 — The sample's collapsed lists went into "Muestra de formato", not a new note. — A new
  note shifts the creation-order N handles that 34 Claude fixtures pin (and makes the
  "unknown N19" test valid).
- Verification: `npm test` (93 files, 2,426 tests), `npm run build`, `npm run shots` (213; 12b–12e
  read: collapsed of each kind, tap to open without focusing, Enter after a hidden group,
  read-only shows every line), `npm run browser-checks` 15/15, `npm run sync-check` 26/26 (15
  server, 11 browser), `npm run claude-check -- --real` on the sample notebook ($0.27, test key).
  Not seen: the phone, Samsung Keyboard next to a toggle, a real Claude Code session.
- 2026-10-22 — **Owner's phone check: the toggle was hard to tap** ("If I try enough times I can
  eventually trigger it"). Cause: the toggle cancelled `touchstart`, which on Android also cancels
  the tap's click; the shots used mouse clicks, so they passed. Fix: cancel only
  `pointerdown`/`mousedown`, as the toolbar buttons do, and make the button itself the tap zone
  (2.2 × 1.9 em, about 37 × 32 px, from the gutter edge up to the bullet). The shots now tap with
  touch events, check the keyboard stays open when the note is focused, and outline the zones
  (12f); a unit test fails if `touchstart` is cancelled again.
- 2026-10-22 — Owner re-checked on the phone (dev server) after the tap fix: "That works."
- 2026-10-22 — **Released 0.4.5**: commit 215a1c9; `npm run sync-deploy` switched the service from
  77e4f9d to 215a1c9 (deployed `SCHEMA_VERSION = 5`, `CLAUDE.md` documents `data-collapsed`);
  `notes-sync status` afterwards: active, same counts (16 live, 3 in Trash, 8 folders, 2 images),
  no missing images, history fine, paired. Pushed; the Pages deploy succeeded and the live bundle
  is 0.4.5. The installed app's update and its first format-5 round are the owner's to check.
- 2026-10-22 — **After the 0.4.5 update the installed app opened to a blank screen**; the same app in
  a Chrome tab worked. Diagnosis (owner's OK to use their notes, made-up output only): the XPS's
  last push was still from 0.4.4, so 0.4.5 had never finished starting in the installed app; the
  owner's XPS backup updated from a real 0.4.4 build to 0.4.5 in headless Chromium and all 13 notes
  opened without error; every published file was present. A stalled format upgrade reproduces
  the blank page exactly: the app draws nothing until the notebook opens, and an open copy still
  holding the format-4 database makes the upgrade wait. Swiping the installed app away and
  reopening fixed it (Android had been bringing back the stuck window). The XPS then recorded
  0.4.5, format 5 (round 47, counts unchanged). The exact copy holding the old version was not
  identified; the likeliest is the Chrome tab with 0.4.4, paused in the background.
- 2026-10-22 — 0.4.6: the boot is never silently blank. `index.html` holds a plain-HTML status
  box, shown if the app isn't ready after 6 s, with the current step, the version and any error
  (no note text); App names each boot step; Dexie's `blocked` event says another open copy is
  holding the old version; a top-level error boundary records a crash while drawing. Checked in
  headless Chromium with a held format-4 connection: the message appears, and the app opens and
  the box hides once the connection closes. — The owner had nothing to go on but a blank page.
- 2026-10-26 — Search results show an extract of the line with the most distinct search words, with matching words bold; opened results mark every word and offer Previous, Next and Close in the formatting dock. — Long notes need search to show the place, not just the note.
- 2026-10-26 — Search uses one per-character, accent-insensitive matcher with original-text offsets and a ς→σ fold; the existing text.js normalize stays unchanged for other callers. — List results, snippets and editor marks must agree, including decomposed accents, Greek final sigma, Korean and emoji.
- 2026-10-26 — Search decorations live outside editor transactions and redraw with view.setProps({}); history stores find and findShown with the visit key and scroll. — Searching must not trigger a trailing paragraph or a save, and returning through a link must not jump again.
- 2026-10-26 — Showing a hidden match unfolds only the collapsed ancestors hiding it, using the existing toggle and only when editing is allowed. — The owner chose saved and synced unfolding, with the existing revision/conflict rules and no Undo step; read-only notes already show all lines.
- 2026-10-26 — Search scrolls the window within the visible space above the dock, without moving focus or selection, and allows one correction for an earlier picture loading unless the owner interacts. — The keyboard and the owner's chosen scroll position must stay under their control.
- 2026-10-26 — Fold toggles use Tiptap's skipTrailingNode flag on their existing transaction. — Without it, unfolding an imported note ending in a list or heading appended an empty paragraph and moved Edited; the fold must change only its saved attribute.
- 2026-10-26 — The plan came from a conversation about keeping one living note per topic:
  search must lead inside a long note. Claude Code drafted it, Codex reviewed it read-only
  against the code (its eight findings are folded in, the serious one being that any editor
  transaction can append StarterKit's trailing paragraph and save), the owner chose unfolding
  over a temporary peek, and Codex implemented it.
- 2026-10-26 — Search marks have no dark-mode colours. — The app has no dark theme; a dark
  current-match fill on the light page would have looked broken on a phone set to dark mode.
- 2026-10-26 — Screenshot step 12d now taps "Paso plegado" and waits for the editor to take the
  cursor before End/Enter. — It had failed since the 0.4.5 tap fix (on that commit too, not
  just this change): after the touch taps, a mouse click didn't move the cursor and keys raced the
  selection, so the new line went under "Lista abierta" and every later shot was skipped.
- 2026-10-26 — Accepted, not changed: with the find bar open, each keystroke rescans the whole
  note. Codex's final read-only review measured (jsdom on the XPS) 8–17 ms per keystroke for a
  12,000-character note with 1,600 matches, and 120–240 ms only for 119,000 characters searching
  one letter; 2–3 ms without search. — Notes here are far shorter; re-scanning only the edited
  block is the fix if typing ever stalls with the bar open. Codex found no unintended save.
- Verification: `npm test` (95 files, 2,471 tests), `npm run build`, `npm run shots` (221, all
  steps; 06b–06i read: snippet, deep match centred, ▼, keyboard space, unfold, ticked line,
  callout); `npm run browser-checks` 15/15. One walk run alongside Codex's review timed out in
  the XPS-suggestions steps (no search involved) and passed when rerun alone. Not seen: the
  phone, Samsung Keyboard with the bar open, real scrolling feel.
- 2026-10-26 — Owner checked 0.4.7 on the phone (dev server): "Looks good. Push". **Released
  0.4.7** by pushing `main` (GitHub Pages deploys it). App-only: the XPS service is unchanged, so
  no `npm run sync-deploy`.

## Heading folds (0.4.8, note format 6, 2026-10-26)

- 2026-10-26 — Owner's choices: a grey − at the **right end** of each heading with a section,
  blue + when folded; a section ends at the next **same-or-bigger heading**, or the end of its
  parent (note, callout or list line); a faint **…** under the folded heading; **Fold all sections /
  Unfold all sections** in Note options. — Long topic notes can become an outline, with a clear
  sign that words are tucked away. The tap zone is 44 × 44 px; long titles leave room for it.
- 2026-10-26 — Save `data-collapsed="true"` on H1–H3 only when true; hide following sibling
  blocks with editable-only decorations. Inner heading folds keep their state. — Opening notes
  changes nothing, unfolded HTML stays byte-identical to the previous renderer, and read-only
  notes and Claude previews show every line. Search, text export, Ask and the XPS text view see
  all the words. A heading with no section has no button.
- 2026-10-26 — **Enter opens a folded heading first**, except a cursor at the very start of a
  non-empty heading, where normal Enter inserts above. — Unlike a list line, a heading has no
  place "after its hidden group" that isn't still part of its section. Opening first keeps the
  new line visible directly under the heading. Selection or edits inside hidden blocks open the
  folds; Undo/Redo use only the selection rule. Deleting across folds deletes their text too,
  and Undo restores it. Converting the heading to normal text shows the section.
- 2026-10-26 — A heading node view keeps its `<hN>` and an inner text `<span>` in place while
  folding and typing. Its text-free button and CSS-drawn marker live outside that span. — The
  keyboard's composing text never contains the controls. The view keeps decoration classes,
  so an inner heading and its button disappear together under an outer fold. Only pointerdown
  and mousedown are cancelled, never touchstart; toggles never focus the editor.
- 2026-10-26 — List folds, heading folds, Fold all and both normalisers share `fold` metadata
  and changed-range calculation in `src/editor/nodes/fold.js`. Every fold transaction disables
  history and the trailing paragraph. — A heading toggle must not open a list line, or vice
  versa, and folding must never append text. Fold all moves a selection it would hide to the
  outer heading's end, in the same transaction; it leaves list folds alone.
- 2026-10-26 — `withoutCollapse` also ignores H1–H3 fold attributes when deciding whether content
  changed. `rev` still advances and syncs; "Edited" and list order stay put. — The real save queue
  tests compare exact HTML, revision and timestamps, including notes ending in a list or heading.
  Search opens only the heading/list folds hiding a match, under the existing editing guard.
- 2026-10-26 — Note format **5 → 6**, without a store change: both version constants, database
  version, backup upgrade/validator and sample envelope advance. The HTML vocabulary and XPS
  audit accept folded H1, H2 and H3, including in callouts. Claude's instructions say to keep
  folds; if tidy, merge, split or a Claude Code proposal drops one, all its words remain visible.
  — Older apps refuse format-6 backups and older windows become read-only.
- 2026-10-26 — Release order: Claude reviews and commits; **owner exports a backup** from the
  published app; deploy the XPS service to accept format 6; owner checks the dev server only if
  Settings → Sync says it isn't connected; push on the owner's OK. If dev is connected, check
  the published app after release instead. — One format-6 push makes the published 0.4.7's
  format-5 pushes fail until it updates. Codex does not commit, push or deploy this change.
- 2026-10-26 — **Review fix (Claude): the heading keeps its text directly in the `<hN>`**; the
  button and "…" sit beside it in a thin wrapper `<div class="heading-fold-wrap">` that the node
  view owns (decoration classes land on the wrapper). — The screenshot run (Pixel 7 emulation)
  found that Codex's inner text `<span>` broke **Enter at the end of every heading** on Android
  Chrome: there ProseMirror ignores the Enter key and recognises the browser's own edit as Enter
  only for a plain block, so Chrome's clone of the heading (fold mark included) became a second
  heading instead of a new line. The same probe on 0.4.7 gave a paragraph; with the wrapper it
  does again, folded or not. jsdom tests take the desktop Enter path and could not see it.
- 2026-10-26 — Review fix (Claude): Enter on a folded heading opens it and splits in **one**
  transaction and reports itself handled. — Dispatching the opening first and returning false
  also misbehaved on that Android path. A test pins one dispatch and the paragraph result.
- 2026-10-26 — Review fixes (Claude, from Codex's final read-only review): deletes that join a
  heading with its neighbour, cross a heading in a selection, or reach into hidden lines run the
  editor's own Backspace/Delete from `beforeinput`, only when the browser lets the edit be
  cancelled. — Pixel 7 emulation, keyboard composing: Backspace at the start of a heading left an
  empty heading behind (0.4.7 did not), and after a folded section it added an empty line. Now
  every case gives the joined line (`BodyNext`), folded or not, composing or not — cleaner than
  0.4.7, whose composing merge carried the heading's size into the paragraph.
- 2026-10-26 — Review fixes: the button copies the heading's own line spacing, so it stays centred;
  Claude's review previews reset the margins of a heading inside its wrapper, as they did for a
  bare heading. Text sizes set on part of a heading can still shift it slightly.
- Verification (Codex, 2026-10-26): `npm test -- --reporter=verbose` passes all **2,558 tests in
  96 files**, including 41 heading-fold tests and the unchanged list-fold tests; `npm run build`
  passes. The real save queue preserves exact HTML and Edited while advancing revisions;
  the stock heading renderer comparison, composition-shaped DOM input, heading tray, named
  styles, nested search, Claude Apply/Undo and format-6 server tests pass. `git diff --check`
  and the screenshot script's syntax check pass. `npm run sync-check` and `npm run browser-checks`
  were attempted but temporary localhost listeners are blocked by the sandbox (`listen EPERM`);
  screenshots 12g–12n were added, but Chromium launch is also blocked (`Operation not permitted`).
  No screenshots or phone keyboard were seen. Claude must run and read the shots and browser/sync
  checks outside this sandbox; owner phone check remains pending. No real API calls, commits,
  pushes or deployments were made.
- Verification (Claude, 2026-10-26, after the review fixes): `npm test` (96 files, 2,562 tests),
  `npm run build`, `npm run sync-check`, `npm run browser-checks` 15/15, `npm run shots` (229, all
  steps; 12g–12n read: buttons, folded with "…", unfolded, Enter, read-only, search opening a
  heading, Note options, the long note as an outline). Pixel 7 probes against 0.4.7 for Enter and
  Backspace at headings, folded and not, composing and not. Screenshot fixes: the wrapper
  locator, clearing the search before the long note, and the simulated newer database (Dexie
  stores version 6 as 60, so 70). Not seen: the phone, Samsung Keyboard, the tap zone by finger.
- 2026-10-26 — Owner's phone check (dev server) passed, after exporting a backup: "Checks pass and
  backup was exported. Ok to push". **Released 0.4.8**: `npm run sync-deploy` switched the XPS
  service from 215a1c9 to 1271e78 (format 6); `notes-sync status` afterwards: active, round 177,
  23 live notes, 8 in Trash, 10 folders, 2 images, none missing, history fine, paired. Then
  pushed `main` (GitHub Pages deploys the app).

## Quick add (0.4.9, 2026-10-26)

- 2026-10-26 — The organisation system, after reading the owner's notebook with permission: **one
  living note per topic with an "Inbox" line at the top; capture always goes to that Inbox; sorting,
  splitting by subject and hub notes happen at review time, never at capture; logs (dated
  entries) are the one case for a cutoff by period.** — After one week the notebook already had
  one-line notes that should have been Inbox items and three notes on one subject, because a new
  note is one tap and adding to the right note was five steps. Nothing from the notes went into
  the repo beyond this summary.
- 2026-10-26 — Owner's choices: **long-press +** on the notes list opens the Quick add sheet (a tap
  still makes a new note); the sheet lists the notes with the **Quick add switch** on (Note
  options ⋯), last-used one preselected; the line goes **under the note's Inbox, newest first**,
  and an Inbox is **created at the top** when the note has none; **Add the date** is a per-note
  switch, off by default; **folded** list lines and headings show a **count of hidden lines**; a
  **home-screen shortcut** opens the sheet; the share-sheet target, an unsorted count in the list
  and a Claude "file my Inbox items" pass are deferred to Tier 4 (`docs/BRIEF.md`). — Capture into
  the right note must be as fast as starting a new one, and the decision "new note or existing"
  belongs to review time, when the pile shows the answer.
- 2026-10-26 — The two switches are **note fields** (`quickAdd`, `addDate`), booleans like `pinned`:
  backed up, synced as part of the row, not content edits (`rev` up, Edited unchanged), absent on
  older rows and read as false. — They survive a restore or a new phone with no setting to redo.
  The XPS validator checks only the fields it lists, the store writes whole rows and the view
  picks named fields, so no service change and no format bump; the switches reach the XPS
  history like any revision, and a flip never asks for the cross-generation confirmation
  (`CONTENT_FIELDS` in `server/guard.mjs`). Conflict copies and merges don't carry them.
- 2026-10-26 — Quick add is a **headless ProseMirror insertion** on the stored HTML (the links
  step's `documentFor`/`serializeBody` path, `documentFor` now shared from `src/claude/html.js`),
  written in one guarded read-modify-write transaction through `writeNoteInTransaction`, after
  flushing the save queue. Not the Claude Apply path. — One transaction leaves no gap for a
  revision race, so no retry and no conflict copy; the note is never open in an editor while the
  list shows. Only an insertion happens: every other node, attribute and fold is untouched
  (tested against a note with every supported format). Added text is stored in its parse-stable
  form (runs of spaces collapsed, lines trimmed), so a later add never rewrites an earlier line
  *(final Codex review)*.
- 2026-10-26 — Placement rule: the first list line or heading whose text is exactly "Inbox"
  (case-insensitive). A bullet list right after it takes the new item first; otherwise a new
  bullet list goes right after the Inbox line, leaving numbered or task sublists and paragraphs
  where they are. No Inbox: one is created at position 0. The added line is one bullet; newlines
  become line breaks. — One rule the owner can predict; numbered and task lists cannot take a
  plain bullet item *(Codex plan review)*.
- 2026-10-26 — The open sheet is a **pushed history entry** (`list` entry with `quickAdd: true`,
  allowed only above the root), not an overlay; `Dialog` gains `routed` to skip overlay
  registration. A shortcut launch (`?quick-add`) strips the parameter at once and passes a flag
  into `restore`, since the boot task holds the navigation lock *(Codex plan review:
  `openQuickAdd` would have returned false there)*. A reload or Forward shows the empty sheet
  again. After an Add, the sheet closes only if its own entry is still active *(Codex: `run`
  already settles a Back that arrived during the write; a second Back would reset the root's
  filter)*. Repairing a deleted-folder filter keeps the sheet. — On the root list there is no
  entry to pop, so Android Back would have closed the installed app instead of the sheet.
- 2026-10-26 — A non-blank draft in the sheet **blocks the automatic update reload** and the lock
  that comes with it, like an open Claude conversation; the explicit Reload stays available
  *(Codex plan review)*. — The draft is not in the save queue, so the existing flush-then-reload
  would have dropped it.
- 2026-10-26 — Fold counts appear **only on folded lines**: `data-count` on the list toggle widget
  (its decoration key includes the count) and on the heading's "…" marker via the node
  decoration's attributes, never in the document; shared `leafLines` in `src/editor/nodes/fold.js`
  counts textblocks and images. — This keeps the 2026-10-22 reason intact: nothing can be typed
  under a folded line, so the toggle never redraws beside typing. Checklist toggles sit under
  `li > div` and are covered too *(Codex)*.
- 2026-10-26 — A `useLongPress` hook for the + button copies ActionButton's timing (500 ms, 10 px,
  swallowed click) without its focus-keeping `preventDefault`; ActionButton itself is unchanged.
  — The toolbar's long-press is heavily tested; folding the two together is a later tidy.
- 2026-10-26 — The sample notebook gets no new note; "Libros por leer" and "Recordatorio suelto"
  carry the switches. — The links tests and handle order depend on exactly 18 live notes *(Codex
  plan review)*.
- 2026-10-26 — Provenance: Claude Code drafted the plan after a fresh-model brainstorm and the
  owner's notebook review; Codex reviewed it read-only (xhigh; two blockers, eight findings, all
  folded in); Codex implemented; Claude reviewed, ran the checks and wrote the docs; final
  read-only Codex review (one P2, two P3, all addressed); fixes by Claude.
- 2026-10-26 — **Review fix (Claude): `pointerleave` only ends the hold.** Codex's hook treated
  it as a suppressing cancel; on touch the browser fires `pointerleave` between `pointerup` and
  `click`, so every tap on + would have been swallowed on the phone. Mouse-driven shots could
  not show it; a test now replays the touch order. Also: the checklist shot locator keyed off
  the parent `ul[data-type="taskList"]` (the editor's checklist `li` carries no `data-type`), and
  the quick-add shots moved to 194–194e (40 was taken).
- 2026-10-26 — Verification: 100 test files / 2,637 tests, build; `npm run shots` 236 PNGs (read
  194–194e, 12o–12q, 04-list); `npm run browser-checks` 18/18, including the manifest shortcut
  and the `?quick-add` launch online and offline. Not seen: the phone (long-press under Samsung
  Keyboard, the sheet above the keyboard, Back, the home-screen shortcut).
- 2026-10-26 — Owner checked 0.4.9 on the phone (dev server): "push". **Released 0.4.9** by pushing
  `main` (GitHub Pages deploys it). App-only: the XPS service is unchanged, so no `npm run
  sync-deploy`. The home-screen shortcut can only be tried once the installed app has updated.
- 2026-10-26 — Owner verified the home-screen "Quick add" shortcut on the installed, updated app
  ("Verified."). 0.4.9 is fully checked.
