# notes_app

A personal notes app for one person: a phone-first installable web app (PWA) that replaces Samsung
Notes with an editor whose toolbar, shortcuts and formatting the owner can shape, and whose notes an
LLM can read. The code may become public; the notes never are.

- **Brief:** [docs/BRIEF.md](docs/BRIEF.md) — the contract: what it is for, what it is not, the
  feature tiers and the decisions already taken.
- **Decision log:** [DECISIONS.md](DECISIONS.md) — dated reasoning, append-only.
- **Agent instructions:** [AGENTS.md](AGENTS.md) — one file for Claude Code and Codex (`CLAUDE.md` imports it).

## Status

- **Spike — passed, 2026-10-14.** A throwaway Tiptap editor, typed into on the owner's Galaxy S25
  Ultra with Samsung Keyboard: typing, swipe, shortcuts, selection pop-up and a keyboard-aware
  toolbar all behave. Details under "Spike result" in `DECISIONS.md`. Tiptap is the editor.
- **Phase 1a — committed and owner-verified on the phone.** Local storage, queued autosave,
  editor and backup export/import.
- **Phase 1b — deployed and owner-verified on the phone, 2026-10-17.** Notes, Note, Folders, Trash
  and Settings screens; Android Back with save protection; folder/tag filters and pinning;
  installable offline app with a guarded update prompt. Published at
  `https://bpanozzo23-prog.github.io/notes_app/` (GitHub Pages, deployed by the workflow on every
  push to `main`). The owner checked install, Back, saving under app switches, Trash, export/import
  and airplane-mode reopen. The update prompt gets its first real test with the 1c deployment.
- **Phase 1c — deployed 2026-10-17.** Link picker and note navigation, "Linked from", and
  accent-insensitive search combined with filters and remembered on Back. Owner phone check of
  the Android edge cases (accents, undo after autocorrect, selection pop-up after a picker,
  nested lists, long-note scrolling, rotation) still pending.
- **Phase 1d — closeout, 2026-10-17.** Codex reviewed the whole Phase 1 diff; fixes landed for
  the one data-loss gap it found (editor input still held by ProseMirror when an update reloads)
  and two backup issues. Phase 1 is complete: the app can replace Samsung Notes for text notes.
  The owner starts the notebook fresh (no migration from Samsung Notes). Next is Phase 2
  (formatting layer: toolbar customisation, named styles, colour order, format painter,
  callouts, images).
- **Phase 2 — planned and approved, 2026-10-17.** Contract: `docs/PHASE-2-DIRECTION.md`
  (Codex-reviewed); plain-language lock-in review in `docs/DECISIONS-EXPLAINED.md` §20–30. Six
  steps: 2a guards and preferences (schema 2), 2b toolbar and pop-up customisation, 2c colours
  and new formatting (schema 3), 2d named styles and painter, 2e images (schema 4), 2f closeout.
  2a done; see below.
- **Phase 2a — deployed 2026-10-17 (0.2.0, schema 2).** Guards that protect the notes: an
  older app version that finds a newer notebook opens it read-only; importing a backup stops
  other windows from saving over it; a failed start says the notes are safe instead of showing
  an empty list. Backups carry the Phase 2 settings (toolbar, layout, pop-up, colours, styles),
  and the selection pop-up now follows its setting. Nothing new to see yet except "Schema
  version: 2" in Settings. Owner-verified on the phone 2026-10-17 (update, notes intact, schema 2,
  export/import round trip, v1 backup preview, selection pop-up).
- **Phase 2b — deployed 2026-10-17 (0.2.1).** Settings → Formatting → Toolbar and Selection
  pop-up: add, remove and reorder buttons, choose one swiping row, two rows, or one row + ⋯ More,
  with a live preview. Long-press any formatting button to see its name. Android Back closes an
  open panel or dialog before leaving the screen. Owner-verified on the phone 2026-10-17.
- **Phase 2c — committed 2026-10-17 (0.2.2, schema 3), released after the owner's 2b check and a
  fresh backup.** Colour menus in the owner's order (Settings → Formatting → Colours: reorder,
  hide, add your own), highlights in several colours, font size, typeface and line spacing,
  four callout types (Note, Tip, Warning, Important) and four divider styles. The default
  toolbar gains the colour, highlight and size menus and Callout (a customised toolbar is kept).
- **Phase 2d — committed 2026-10-17 (0.2.3), released with 2c.** Named styles: a Styles button
  lists them, each tap applies a snapshot of its look (with no selection, to the whole line);
  Settings → Formatting → Named styles creates, edits, reorders and deletes them, and any style
  can be its own toolbar button. "Save this look as a style" starts one from the text at the
  cursor. Format painter: copy a look, select text, tap Apply format.
- **Phase 2c and 2d — deployed together 2026-10-18 (0.2.3, schema 3).** Owner-verified on the phone
  2026-10-18.
- **Phase 2e — committed 2026-10-18 (0.2.4, schema 4), released after the owner's 2c/2d check
  and a fresh backup.** Images from the camera, gallery, paste or drop, shrunk to at most
  2,560 px (WebP, or JPEG where WebP can't be made), stored once in their own tables and
  referenced from the note by id; tap an image for View (full screen, fit or actual size) and
  Delete. Images unused by any note are deleted after 30 days. Backups carry the images notes
  use, as text inside the same JSON file. Settings shows image count, size and storage. Backups
  of 100 and 300 generated images (about 40 and 118 MB) import and export on the phone in about
  1–2 seconds; Settings warns above 150 MB. Also in this release: one Heading button (Normal text, Heading
  1–3) at the owner's request. Deployed 2026-10-18; owner phone check pending.
- **Phase 2f — closeout, 2026-10-18 (0.2.5).** Codex reviewed the whole Phase 2 diff; fixes
  landed for its two serious findings (an image being added during an upgrade in another
  window, and a re-used image's stale cleanup mark) and four smaller ones (nested dialogs, the
  heading panel inside callouts and lists, line spacing on an empty line, a Reset for Named
  styles). **Phase 2 is complete**; the owner's backup-size measurement (2026-10-18:
  about 1–2 seconds each way for 118 MB) keeps the "backup is getting large" warning at 150 MB. Owner-verified on the phone
  2026-10-18. Next is Phase 3 (Claude: questions across the notebook, tidy with approval).
- **Phase 3 — planned and approved, 2026-10-18.** Contract: `docs/PHASE-3-DIRECTION.md`
  (Codex-reviewed); plain-language lock-in review in `docs/DECISIONS-EXPLAINED.md` §38–50. Claude
  Opus 5.5 with the owner's own key on this device, off by default. Seven steps: 3a settings and
  the request layer, 3b questions across the notebook with cited sources, 3c clean up one note,
  3d titles/tags/folders, 3e links between notes, 3f merge and split, 3g closeout. No schema
  change.
- **Phase 3a — committed 2026-10-18 (0.3.0).** Settings → Claude: spend-limit acknowledgement,
  API key stored on this phone only, Test key (free), Turn off, Remove key; backups refuse a key;
  the request layer and test harness for later steps. Nothing is sent except Test key.
  Owner-verified on the phone 2026-10-18 with the owner's key.
- **Phase 3b — committed 2026-10-18 (0.3.1).** Ask Claude across the notebook (notes list) or
  about one note (note screen, pictures optional): a disclosure of what goes and the estimated
  cost before sending, streamed answers with numbered, tappable sources, follow-ups using the
  cached notes, Cancel and Try again, the cost per answer and a monthly total. Owner-verified on
  the phone 2026-10-18.
- **Note dates — committed 2026-10-18 (0.3.2, owner's request).** Each note ends with "Created …
  · Edited …"; the notes list shows each note's last edit beside its folder. The remaining Phase 3
  steps are each one version later than the direction file lists (3c is 0.3.3).
- **Phase 3c — committed 2026-10-18 (0.3.3).** Tidy this note: Claude proposes, the review shows
  each change Before/After with ticks (all ticked to start), Apply only if the note is unchanged
  since Claude read it, all-or-nothing, and Undo (or "(before Claude)" copies after a later
  edit). Deployed after the owner's backup; owner-verified on the phone 2026-10-18.
- **Text export — committed 2026-10-18 (0.3.4, owner's request).** Settings → Export notes as text
  (a readable Markdown file of all live notes, by folder) and Copy as text on each note, for
  other apps and AI tools. Owner-verified on the phone 2026-10-18.
- **Measured costs — 0.3.5, 2026-10-18.** The agent's first real-request check (`npm run
  claude-check -- --real`, sample notebook, test key): question 6¢, follow-up 2¢, tidy 2¢.
  Estimates now use the measured token ratios; quoted sources drop internal markers. 3d is 0.3.6.
- **Phase 3d — committed 2026-10-18 (0.3.6).** Tidy the notebook → Titles, tags and folders: per-note
  cards with a tick per suggestion, all-or-nothing Apply, and Undo that skips notes edited since
  for metadata-only changes. Real-request run on the sample: 5.5¢. Owner-verified on the phone
  2026-10-18.
- **Free browser checks — 2026-10-18.** `npm run browser-checks` (headless, made-up answers, no
  cost): update prompt, offline reopen, a frozen page mid-answer and a dropped connection all behave
  (15 of 15).
- **Phase 3e — committed 2026-10-18 (0.3.7).** Tidy the notebook → Links between notes: Claude
  suggests links, the app places each one on the words that name the other note (when they occur
  once) or on a "See also:" line, a tick per link, all-or-nothing Apply, and Undo that skips notes
  edited since. Real-request runs on the sample: about 5¢ per links request. Owner-verified on
  the phone 2026-10-18.
- **Phase 3f — committed 2026-10-18 (0.3.8).** Tidy the notebook → Find duplicates to merge, and
  Split this note on a note's Claude button. Each is approved as a whole: the review shows the
  result, what goes to Trash, which links are redirected, and every line not kept word for word.
  Undo puts everything back if nothing changed since; otherwise it never overwrites anything and
  brings earlier versions back as "(before Claude)" notes. Real-request run on the sample: find
  duplicates 3¢, merge 2¢, split 3¢. Owner phone check pending.
- **Phase 3g — closeout, 2026-10-18 (0.3.9).** Codex reviewed the whole Phase 3 diff; five fixes,
  each with a test: two windows editing one note now save a "(conflict copy)" instead of silently
  overwriting each other (older than Phase 3); nothing is sent if a disclosed note was moved to
  Trash or deleted before Send; swapped links are flagged in a tidy review; Apply refuses a new
  link to a note deleted meanwhile; a citation is marked edited after an Undo. Owner-verified on
  the phone 2026-10-18. **Phase 3 is complete** apart from the owner's merge/split (3f) phone
  check, still pending.
- **Visual quick wins — 2026-10-18 (0.3.10).** "Saved" instead of "idle"; the list's end clears
  the + button; a proper Import button and plain wording in Settings; one filled main action per
  screen and red for anything that deletes. Approved by the owner from before/after screenshots.
- **Note screen, more room to write — 2026-10-19 (0.3.11).** Folder and tags share one line
  (tags are edited in their own sheet); Pin moved to the top row; Copy as text and Move to Trash
  are in a ⋯ sheet. Text starts about 95 points higher, roughly double the visible text with the
  keyboard open.
- **Phase 4 — planned and approved 2026-10-19.** Sync to the XPS:
  the phone copies the notebook one way to a small service on the XPS over Tailscale (a private
  copy with history and daily backups); Claude Code reads a locked-down view there and proposes
  edits the owner reviews and applies on the phone. The spike passed on the phone 2026-10-19.
  Contract: `docs/PHASE-4-DIRECTION.md` (Codex-reviewed); plain-language review in
  `docs/DECISIONS-EXPLAINED.md` §63–73. Steps: 4a the XPS service, 4b the app sends (0.4.0), 4c
  the inbox for edits (0.4.1), 4d new notes and Trash (optional), 4e closeout.
- **Phase 4a — the XPS service, installed 2026-10-20.** `server/` (request handler, pairing,
  private store with git history, crash-safe rounds, the generation-aware guard, images by
  content, daily backups, the read-only `~/notes` view, the inbox scan for proposal file pairs),
  the `claude-notes` launcher (no shell: Read, Edit, Write, Glob, Grep only; owner's choice after
  the sandbox couldn't run), `notes-sync` (`pair`, `status`), `npm run sync-deploy` and
  `npm run sync-check`. Running on the XPS as the user service `notes-sync`, empty and unpaired;
  the lock-down passed in real sessions. No app change until 4b. Maintainer notes:
  [`server/README.md`](server/README.md).
- **Phase 4b — the app sends, 0.4.0, released 2026-10-20.** Settings → Sync connects the
  phone to the XPS with a code from `notes-sync pair`; after that the notebook copies itself about
  10 seconds after edits and whenever the app opens or comes back. "Last synced" and the counts
  show there, with Sync now, Restore from the XPS and Disconnect; problems show as plain
  sentences. If the XPS copy would lose notes or get older versions (after an import, or on a new
  phone), the app asks first. Verified with 1,948 tests, a 17-step end-to-end check and 190
  screenshots. Owner phone check pending; **export a backup before connecting.**
- **Phase 4c — Claude Code's suggestions on the phone, 0.4.1, released 2026-10-20.** Every
  Claude review has a new look the owner approved from mockups: changed words shown inline
  (struck red, added green), Before/After on demand, compact rows with ticks, tag chips, the Apply
  bar always at the bottom, and an amber warning when a note changed after Claude read it.
  Suggestions Claude Code writes on the XPS (`claude-notes`) arrive as "Claude Code suggests
  changes to N notes · Review": one card per note with its reason and Dismiss; Apply changes the
  ticked ones together, with Undo (also in Settings → Sync); outcomes go back to the XPS.
  Owner-verified on the phone 2026-10-20 (partial Apply, Undo, a stale card, Dismiss, the new
  look); the two-window Undo is left for 4e.

## Running it

```
npm ci             # only for a fresh checkout; dependencies are already installed on the XPS
npm run dev        # Vite with --host, port 5174; app is under /notes_app/
npm test           # Vitest, jsdom, fake-indexeddb; fixture data only
npm run build      # dist/ includes sw.js and manifest.webmanifest
npm run preview -- --host  # serve the built app under /notes_app/ for local review
npm run browser-checks     # free headless checks: update prompt, offline, freeze, dropped connection
```

Phone dev entry: `http://brent-dell-system-xps-l502x:5174/`; with the Pages base configured, open
`http://brent-dell-system-xps-l502x:5174/notes_app/`. Check rapid typing and Android Back, list
filter/scroll restoration, switching apps mid-edit, folder/tag/pin edits, Trash restore/delete,
and backup export/import (including the before-import safety download).

The GitHub repository is public and Pages is enabled with the GitHub Actions source. The workflow
deploys pushes to `main` and can also be started manually; the live URL is
`https://bpanozzo23-prog.github.io/notes_app/`. Installation, airplane-mode reopen and update prompts
need that HTTPS deployment; the plain-HTTP phone dev URL cannot install a service worker. The
published app has separate storage from the dev server: transfer notes with export/import.

A made-up sample notebook for trying the app without personal notes is published at
`https://bpanozzo23-prog.github.io/notes_app/sample-notebook.json` (Settings → Import backup).

Automated checks use fixtures. The agent has not seen the phone layout, Samsung Keyboard/Gboard,
downloads, installation or a real service-worker update; those remain owner verification.
