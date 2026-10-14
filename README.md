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
- **Phase 1 — being planned.** The core notebook (see the brief, §Phases).

## Running it

```
npm install
npm run dev        # Vite with --host, port 5174; open from the phone via the XPS's Tailscale name
```
