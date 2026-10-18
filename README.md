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
  cursor. Format painter: copy a look, select text, tap Apply format. Next: 2e, images.

## Running it

```
npm ci             # only for a fresh checkout; dependencies are already installed on the XPS
npm run dev        # Vite with --host, port 5174; app is under /notes_app/
npm test           # Vitest, jsdom, fake-indexeddb; fixture data only
npm run build      # dist/ includes sw.js and manifest.webmanifest
npm run preview -- --host  # serve the built app under /notes_app/ for local review
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
