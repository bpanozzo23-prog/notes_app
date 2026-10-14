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
  list and have no Markdown form; HTML round-trips through Tiptap exactly, and Claude reads it.
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
