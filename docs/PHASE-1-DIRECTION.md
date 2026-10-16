# Phase 1 direction — the core notebook

Approved by the owner on 2026-10-16. This is the contract for Phase 1; `docs/BRIEF.md` remains the
product contract above it and `DECISIONS.md` records why. The plan was drafted by Claude Code,
reviewed by Codex (read-only) and revised; Codex implements each step from this file.


## Context

The spike passed on 2026-10-14: Tiptap is usable on the owner's S25 Ultra with Samsung Keyboard
(`DECISIONS.md`, "Spike result"). Phase 1 turns the single-screen spike into a real notebook that
can replace Samsung Notes for text notes: notes in folders with tags, links between notes, search,
pinning, offline-first storage with a one-file backup, installed from GitHub Pages. Formatting
customisation (custom toolbar, named styles, colour order, format painter, images, callouts) is
Phase 2 and is **not** built here, but the toolbar is structured as data from day one.

Owner decisions 2026-10-14: GitHub Pages from a public repo (notes never enter the repo); one
level of folders plus tags; images wait for Phase 2. Codex reviewed the first draft (read-only,
`codex exec`); its corrections are folded in below and marked *(Codex)*.

## Shape of the app

**Data (Dexie, database `notes_app`, `SCHEMA_VERSION = 1`)**

```
notes:      id, updatedAt, deletedAt, *tags, *linkedIds
folders:    id, position
tombstones: id            (id + purgedAt: "this note once existed", kept for Phase 4 sync)
prefs:      key
```

- A note is `{ id, title, html, text, folderId|null, tags[], linkedIds[], pinned, rev,
  createdAt, updatedAt, deletedAt|null }`. `html` is the Tiptap document; `text` (plain text with
  paragraph breaks preserved) and `linkedIds` (the `note:` hrefs found in `html`) are derived on
  every save and never edited directly. `rev` is an integer bumped on *every* write, including
  pin toggles and link cleanup, so change detection is independent of `updatedAt` *(Codex)*.
- Indexes: only what is indexable and useful. `pinned` (boolean) and null `folderId` cannot be
  indexed in IndexedDB *(Codex)*; the whole notebook is loaded into memory anyway, so filters and
  sort order are computed there. `deletedAt` is indexed so Trash and "live notes" are one query.
- IDs: UUID v4 from `crypto.getRandomValues` (`src/lib/ids.js`), because `crypto.randomUUID` is
  undefined on plain-HTTP pages such as the phone's dev URL *(Codex)*. No prefixes.
- `updatedAt` bumps on title/body/folder/tag edits only (mi-cuaderno's rule); `rev` always.
- **Trash, not hard delete** *(Codex)*: delete sets `deletedAt`; Trash lists deleted notes with
  Restore; notes are purged 30 days after deletion (on app start) and a tombstone row is kept.
  Links to a trashed note stay in place and resolve again on restore; links to a purged note are
  neutralised at purge time (href removed, text kept).

**Saving** *(Codex)*: debounce 400 ms with a 2 s maximum wait during continuous typing; flush on
blur, on leaving the note, on `visibilitychange` → hidden and `pagehide`, and before export or
import. Saves are serialised per note and carry the note id they belong to, so a late save can
never land on a different note. A failed save shows a persistent "Not saved" indicator instead of
failing silently. Opening a note sets editor content once (`setContent` on note change only) and
resets undo history; saves never echo back into the editor.

**Backup** (copy of mi-cuaderno `src/db/backup.js` + `src/lib/file.js`, simplified): envelope
`{ format: "notes_app-backup", schemaVersion, exportedAt, appVersion, notes, folders, tombstones,
preferences }`. Export flushes pending saves and reads all tables in one transaction.
`validateBackup` never throws: format, schema version (older is upgraded step by step as in
mi-cuaderno; newer is refused), duplicate ids, dangling `folderId`/`linkedIds`, field types.
Preferences are exported from an explicit allow-list so Phase 3's API key can never be included
*(Codex)*. **Import previews counts and requires confirmation** ("Replace N notes and M folders
with this file's X notes and Y folders?") *(Codex)*, downloads a `before-import-…` safety copy
first, then replaces all tables in one transaction and recomputes derived fields. `lastBackupAt`
pref; `navigator.storage.persist()` requested on first note and its result shown in Settings.
`.gitignore` gains `before-import-*.json` *(Codex)*.

**Editor**: the spike's Tiptap setup moved into `src/editor/`. The supported HTML vocabulary is
exactly what the extensions define (paragraph, h1–h3, bold, italic, underline, strike, highlight,
colour, font size, bullet/ordered/task lists, blockquote, horizontal rule, code, link); unknown
HTML in a paste is dropped by Tiptap's parser, which is the sanitiser. `DECISIONS.md` is corrected
from "round-trips exactly" to "round-trips within the supported vocabulary", with a test that
round-trips a sample of each *(Codex)*. Toolbar actions live in a registry (`src/editor/actions.js`:
`{ id, label, icon, kind: "toggle" | "command" | "picker", run(ctx), isActive(editor) }`, where
`ctx` carries the editor and UI hooks so pickers and Phase 2's parameterised styles fit without
storing functions in preferences *(Codex)*). The toolbar renders a stored list of ids (`toolbar`
pref, defaulting to a constant); the selection pop-up renders a second list. Phase 2's "customise
the toolbar" is a settings screen over those prefs. Typing shortcuts `## `, `- `, `[] `, `---`
stay. **Internal links** *(Codex)*: `Link.configure({ protocols: ["note"], openOnClick: false,
isAllowedUri })` accepts `note:<uuid>` and refuses everything that is not `https:`/`mailto:`/`note:`;
a click handler routes `note:` links through app navigation (missing target → "This note was
deleted"). "Link to note" is a picker action.

**Screens** (hand-rolled navigation stored in `history.state` so Android Back works; a reduced copy
of mi-cuaderno `src/lib/navigation.js` including its handling of entries that point at a note
that no longer exists; list filter and scroll position preserved on Back *(Codex)*):

1. **Notes list** — pinned first, then by `updatedAt`; filter row (All · each folder · tag
   chips); search box (title + `text`, case- and accent-insensitive, in memory); "+" creates a
   note in the current folder and opens it.
2. **Note** — optional title (the list shows the first line of `text` when empty), editor,
   bottom toolbar, header row with folder picker, tags input, pin, delete-to-trash, and a
   "Linked from" section (`notes.where("linkedIds").equals(id)`, live notes only).
3. **Folders** — create, rename, reorder, delete (notes move to "no folder").
4. **Trash** — restore or leave to expire; shows days remaining.
5. **Settings** — backup export/import, storage-persisted status, "Not saved" diagnostics, app
   and schema version. Claude arrives in Phase 3.

PWA: `registerType: "prompt"` rather than autoUpdate; the update banner is suppressed while a
save is pending, so an update can never reload over unsaved input *(Codex)*. Light theme only,
tokens from the spike in `src/index.css`. Phone layout; wider screens get a max-width.

## Who does what (owner's choice, 2026-10-16)

**Codex implements; Claude directs and reviews; the owner verifies on the phone.** This plan is
copied into the repo as `docs/PHASE-1-DIRECTION.md` so Codex reads the approved contract. Per
step, Claude writes a self-contained task and runs `codex exec --sandbox workspace-write -C
~/code/notes_app` in the background (Codex's configured model, `gpt-6-astra` at xhigh effort).
Codex edits files and runs tests and the build; it cannot commit, push or leave the repo. Claude
installs any new npm packages before each step (the sandbox has no network), reads Codex's report
and the diff, runs `npm test` and `npm run build` itself, fixes small things or sends Codex back
with feedback (`codex exec resume --last`), and commits once satisfied. Phone checks are the
owner's.

## Files

```
src/
  main.jsx, App.jsx                 shell + navigation wiring + update banner
  version.js                        SCHEMA_VERSION, APP_VERSION
  db/db.js                          Dexie instance, stores, prefs helpers
  db/notes.js                       create/update/trash/restore/purge/list, derived fields on save
  db/folders.js
  db/backup.js                      build/validate/import, preference allow-list
  lib/ids.js, dates.js, text.js     uuid (getRandomValues), nowIso, htmlToText, normalize
  lib/file.js                       downloadJson, readFileAsText
  lib/navigation.js
  lib/saveQueue.js                  debounce + max-wait + flush, per-note ordering, failure state
  editor/extensions.js              StarterKit + TextStyleKit + Highlight + TaskList/Item + Link config
  editor/actions.js                 toolbar action registry
  editor/NoteEditor.jsx, Toolbar.jsx, SelectionMenu.jsx, LinkPicker.jsx
  screens/NotesList.jsx, Note.jsx, Folders.jsx, Trash.jsx, Settings.jsx
  components/TagInput.jsx, FolderPicker.jsx, Confirm.jsx
public/icons/                       192, 512, 512-maskable PNGs
.github/workflows/deploy.yml        copy of mi-cuaderno's (checkout → node 24 → npm ci → build → Pages)
vite.config.js                      base "/notes_app/", VitePWA (prompt), manifest "Notes"
vitest.config.js                    jsdom + fake-indexeddb, as mi-cuaderno
docs/DECISIONS-EXPLAINED.md         plain-language companion to DECISIONS.md (the write-up given
                                    to the owner in chat on 2026-10-14, kept current)
```

`src/Spike.jsx` is deleted once `NoteEditor.jsx` exists.

## Steps

Each step ends with tests green, `npm run build` green, new `DECISIONS.md` entries, and a commit.
**Plan approval is the "ask" for those per-step commits and for pushing `main` from 1b on;** the
agent still states what is committed and pushed. Phone checks are the owner's; the agent says what
it did not see.

1. **1a — data, backup, and a thin end-to-end slice** *(Codex: don't build storage in isolation)*.
   `db/`, `lib/`, `version.js`, `saveQueue.js`; tests for notes CRUD, trash/purge, derived fields,
   backup validate/import/upgrade, UUID fallback, save-queue ordering and max-wait. A minimal
   list → note → autosave → Settings export/import flow using the spike's editor. Also: the
   decisions companion doc, the `DECISIONS.md` wording fix, `.gitignore` fix.
2. **1b — real screens, and publish** *(Codex: deploy early; dev and Pages storage are separate)*.
   Notes list with folders and tags, Note screen, navigation with Back, Trash, import
   confirmation. Icons, PWA manifest and prompt-update flow, GitHub repo `notes_app` created
   public with `gh repo create`, Pages enabled (`gh api` or by hand once), deploy workflow, push.
   **Owner phone check on the published app**, Samsung Keyboard *and Gboard*: create, edit, switch
   apps mid-word, Back mid-word, kill the tab, reopen; export a backup, clear site data, import it
   back and compare; trigger an update while a note has unsaved text.
3. **1c — links, search, pin.** Link picker and `note:` links, backlinks, search, pinned-first.
   Phone check: Spanish accents and ñ, undo after autocorrect, undo after a list shortcut,
   selection pop-up after closing a picker, nested-list deletion, a long note's scrolling with the
   keyboard open, rotation in the installed app *(Codex's Android list)*.
4. **1d — closeout.** `README.md` status, decisions companion updated, Codex review of the diff
   (`codex exec review`), fixes. Then the owner can migrate notes (text now; screenshots in
   Phase 2) or start fresh.

## Noted for later phases (from the Codex review; recorded in `docs/BRIEF.md` during 1a)

- Phase 2: images need durable attachment records (a `files` table with blobs, referenced by id,
  included in backups), never temporary `blob:` URLs in the HTML; named styles apply a snapshot of
  formatting rather than staying linked to an editable definition; manual palette order takes
  precedence over recent-first; callouts are a custom node added to the supported vocabulary.
- Phase 3: before applying a Claude-proposed edit, check the note's `rev` still matches the one
  Claude was shown; images change the "whole notebook fits one request" assumption.
- Phase 4: tombstones and `rev` are what sync will use for deletion tracking and conflict detection.

## Verification

- `npm test` (vitest, fake-indexeddb): db operations, trash/purge, derived fields, round-trip of
  the supported HTML vocabulary, backup validate/import/upgrade, search normalisation, navigation,
  save queue (ordering, max-wait, flush).
- `npm run build` after every step.
- Owner on the phone: dev URL `http://brent-dell-system-xps-l502x:5174/` during 1a; the
  published `https://bpanozzo23-prog.github.io/notes_app/` from 1b, with the checklists above,
  including "Add to Home screen" and an airplane-mode reopen.
