# notes_app

A personal notes app for one person: a phone-first installable web app (PWA) that replaces Samsung
Notes with an editor whose toolbar, shortcuts and formatting the owner can shape, and whose notes an
LLM can read. The code may become public; the notes never are.

- **Brief:** [docs/BRIEF.md](docs/BRIEF.md) — the contract: what it is for, what it is not, the
  feature tiers and the decisions already taken.
- **Decision log:** [DECISIONS.md](DECISIONS.md) — dated reasoning, append-only.
- **Agent instructions:** [AGENTS.md](AGENTS.md) — one file for Claude Code and Codex (`CLAUDE.md` imports it).

## Status

- **Spike — in progress** (started 2026-10-14). A throwaway Tiptap editor served from the XPS dev
  server, to be typed into on the owner's Galaxy S25 Ultra with Samsung Keyboard. Its only job is to
  answer whether a ProseMirror-based editor is usable on that phone. Result goes in `DECISIONS.md`.
- **Phase 1 — not started.** The core notebook (see the brief, §Phases).

## Running it

```
npm install
npm run dev        # Vite with --host, port 5174; open from the phone via the XPS's Tailscale name
```
