# notes_app — shared agent guide

**Read this first, whichever tool you are.** `CLAUDE.md` (Claude Code) and `AGENTS.md` (Codex)
both point here and add only what is specific to their tool. Rules live here once.

A personal notes app (PWA) for one owner, one phone, no server. Simplicity and durability beat
features; the owner's notes are the one thing that must never be lost or leaked.

## Read order

1. `README.md` → Status: which phase is in progress.
2. `docs/BRIEF.md`: the contract. Read the sections a change touches; read all of it before
   planning a phase or changing storage, the editor, the data model, backup or the Claude policy.
3. `DECISIONS.md`: search it for the component or concept before re-litigating a choice.
4. The code the task touches. Look for existing components and utilities before adding a
   duplicate.

## Working agreement

- **Propose before building** anything larger than a fix: a short plain-language plan, then wait
  for approval.
- **Record decisions as they are made**, in `DECISIONS.md`, with absolute dates and the reason.
- **Verify on the phone.** The dev server runs on the XPS with `--host`; report the Tailscale URL
  (`http://brent-dell-system-xps-l502x:5174/`) and ask the owner to check. The agent has no screen:
  say plainly what it did not see.
- **Never commit a note, a backup or a key.** `.gitignore` covers the known paths; keep it that way
  and check `git status` before every commit.
- **Explain choices and define jargon the first time it appears.** The owner reads everything.
- **Copy mi-cuaderno's patterns, not its code.** `~/code/mi-cuaderno` has the Dexie layer, backup
  export/import, the on-device Anthropic key with a spend cap, and the PWA/GitHub Pages setup.
  Read them when building the equivalent here.

## Environment

- The XPS (`uname` says `Linux`) is where the CLIs run, inside `tmux`; the owner's machines and
  how they connect are documented in `~/code/devices`, not here.
- `npm run dev` serves on port 5174 with `--host` (mi-cuaderno uses 5173).
- Node 24, npm 11 on the XPS.
