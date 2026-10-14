# notes_app — Project Brief (v1)

**For:** coding agents working through Claude Code or Codex, and the owner. This is the product
contract; `AGENTS.md` says how to work, `DECISIONS.md` records why.
**Owner:** the sole builder and only user.
**Written:** 2026-10-14, from the conversation that started the project. Amend with strikethrough
plus the replacement so the original stays readable.

## 1. Why

The owner keeps personal notes in Samsung Notes on a Galaxy S25 Ultra and likes it, with two
complaints: an LLM cannot get at the notes, and the toolbar, shortcuts and formatting options are
fixed. This app is a replacement built for one person, so every toolbar entry, colour and style can
be exactly what that person wants, and the notes are stored in a form Claude can read.

## 2. What the notes are

From the owner's existing notes: Spanish vocabulary, grammar and phrases; notes on books,
audiobooks and podcasts; reflections; things to remember or reuse (comments posted somewhere,
prompts); lists. Some notes carry pasted screenshots or images. Roughly 20–40 notes exist today; the
owner may migrate them or start fresh.

Structured Spanish vocabulary belongs in mi-cuaderno (`~/code/mi-cuaderno`), which is built for it.
Free-form Spanish notes are welcome here.

## 3. Platform

- **Installable web app (PWA)** on the same stack as mi-cuaderno: React, Vite, Tailwind, Dexie over
  IndexedDB, deployed from `main` to GitHub Pages. Runs on the phone (primary), the Surface and the
  browser-only work machine.
- **Phone-first.** The 375 px check on the owner's phone is the real verification; desktop is a
  bonus.
- **Typing, not handwriting.** The S Pen is used only as a precise pointer for fiddly formatting,
  which a web page gets for free. Ink capture and handwriting recognition are out of scope.
- A native Android app is not planned. What it would add (widgets, quick-settings tile) is not worth
  the build and install cost from a headless XPS.

## 4. Editor

- **Tiptap** (ProseMirror) rich-text editor, subject to the spike (§8) passing.
- **Storage format is HTML**, not Markdown: the owner's formatting wishes include colour, font
  size and underline, which Markdown cannot express. Tiptap reads and writes HTML without loss, and
  an LLM reads HTML fine. A Markdown projection may be derived for display or search but is never
  the source of truth.
- **Everything about the toolbar is data**, so the owner can add, remove and reorder entries, and
  the colour menu is a list the owner orders (recent-first is the default).

## 5. Features, by tier

**Tier 1 — core notebook.** Notes with title and body; folders; tags; note-to-note links with
backlinks; search; pinned and recent; export/import of the whole notebook as one JSON file (the
backup); local-first in IndexedDB, works offline.

**Tier 2 — the formatting layer the owner asked for.**
- Customisable toolbar (add, remove, reorder).
- Customisable colour menu (order, recent colours first).
- Named styles: a preset such as "Heading = 17 pt, bold, underline, green" applied in one tap.
- Format painter: copy the formatting of one selection, apply to the next.
- Selection pop-up with common formatting.
- Typing shortcuts (`## `, `- `, `[] `, `---`) and a divider block; callout blocks.
- Pasted screenshots and images, stored with the note and included in the backup.

**Tier 3 — Claude.**
- Ask a question across all notes and get an answer that names the notes it drew from. At the
  owner's scale the whole notebook fits in one request; no search index.
- Tidy or reorganise a note or the notebook: Claude proposes, the owner approves, nothing changes
  without approval.
- Same policy as mi-cuaderno Phase 6: the owner's own Anthropic key, stored on-device, never
  exported, behind an acknowledged spend cap; off by default.

**Tier 4 — later and optional.**
- Sync to the XPS over Tailscale so Claude Code can work on the notes as files, and so the XPS is
  an automatic backup. Conflicts keep both copies.
- "Collect" selection: tap several non-adjacent words, apply one formatting to all (mobile
  browsers cannot select non-contiguous ranges natively).
- Comments / sticky notes attached to a passage, hidden by default.
- Android share-sheet target ("Share → Notes").

## 6. Non-goals

Handwriting and drawing; collaboration; accounts or a hosted backend; any cloud other than the
owner's own XPS; feature parity with Samsung Notes for its own sake.

## 7. Data and privacy

Notes are personal data. They live in the browser's IndexedDB and in backups the owner keeps; the
repo never contains a note, a backup, or a key. If the repo becomes public, that rule is what makes
it safe.

## 8. Phases

0. **Spike.** Throwaway Tiptap editor with a bottom toolbar, selection pop-up and typing shortcuts,
   typed into on the phone with Samsung Keyboard and Gboard. Pass: predictive text, swipe typing,
   Enter/Backspace and mid-word formatting all behave. Fail: pick another editor before building.
1. Core notebook (Tier 1).
2. Formatting layer (Tier 2).
3. Claude (Tier 3).
4. Tier 4 items as the owner asks for them.
