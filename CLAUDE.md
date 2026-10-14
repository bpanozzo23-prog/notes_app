# notes_app — Claude Code entry point

**Read `docs/AGENT-GUIDE.md` before doing anything else.** It is the single shared copy of the
read order, working agreement and environment for every agent on this project. `AGENTS.md` (Codex)
points at the same file. Do not restate its content here.

Claude-Code-specific notes only:

- **Use Plan Mode** for anything larger than a fix: propose in plain language, wait for approval.
- **XPS: the CLI is the tool, inside `tmux`.** No browser pane. Start Vite with `npm run dev` (it
  already passes `--host`) and report the Tailscale URL for the owner to open on the phone. `/rc`
  hands the session to the Claude mobile app.
- **Multi-line commit messages: use a bash heredoc** (`git commit -F - <<'MSG' … MSG`) and read the
  message back with `git log -1 --pretty=%B`.
- **Never run `npx skills remove`** (it switched a checkout's branch mid-command once in
  mi-cuaderno).
