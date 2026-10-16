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
