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
- **Phase 1c — built, awaiting review and deployment.** Link picker and note navigation,
  "Linked from", and accent-insensitive search combined with filters and remembered on Back.

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

Automated checks use fixtures. The agent has not seen the phone layout, Samsung Keyboard/Gboard,
downloads, installation or a real service-worker update; those remain owner verification.
