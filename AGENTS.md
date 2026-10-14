# notes_app — Codex entry point

**Read `docs/AGENT-GUIDE.md` before doing anything else.** It is the single shared copy of the
read order, working agreement and environment for every agent on this project. `CLAUDE.md`
(Claude Code) points at the same file. Do not restate its content here.

Codex-specific notes only:

- **The owner's real browser data is not available in Codex's test browser.** Verify against
  seeded fixture data; never treat an empty notebook as the owner's actual state.
- **On the XPS the shell is bash** inside `tmux` over SSH. Plain `npm` is correct; there is no
  browser pane, so report the Tailscale URL for the owner to check on the phone.
- **Subagents:** at most two, read-only, for substantial reviews or independent investigations.
  The primary agent owns implementation, decisions and final synthesis.
