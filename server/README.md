# Sync service — Phase 4a, runs A and B

The runtime imports only Node built-ins and other `.mjs` files here. Nothing imports the app
at runtime. `compatibility.test.js` compares the copied constants and image-reference parser
against the app and validates generated backups with the app's validator.

`main.mjs` exposes `serve`, `pair`, `status` and `init-store`. The configuration path comes
from `NOTES_SYNC_CONFIG`; its default is the owner's private configuration, so **tests must
always supply temporary paths**. No installation or live configuration was accessed during
either implementation run.
The full contract remains [`docs/PHASE-4-DIRECTION.md`](../docs/PHASE-4-DIRECTION.md).

## Embedding and hooks

- `initStore(storeDir, { git })` creates a new store; `openStore` reads an existing one without
  filling in missing files. Missing or malformed required files fail closed.
- `createContext(config, overrides)` accepts `store`, `git`, `now`, `logger`, `afterStep`,
  `rebuildView` and `ingestPendingProposals`. `createHandler(context)` returns the plain async
  request handler. `readBody(limit)` must return bytes; it is never called before boundary checks.
- `context.enqueue(task)` owns the mutation queue. Recovery, history retries, pairing, uploads,
  pushes, outcomes and ingestion share it. Reads also pass through it, so they wait for an active
  round. If recovery fails, state/backup reads can still use the cached published snapshot;
  mutation requests receive `storage-problem`.
- `rebuildView(snapshot)` runs after publication, during recovery as necessary, and on startup.
  Its default calls `rebuildView({ storeDir, viewDir, templates })`, rereading the published
  store. It is safe to repeat and never feeds view data back into the private store.
- `ingestPendingProposals(context)` runs under the queue for an authenticated state request and
  returns pending full records in ingestion order. It is skipped while history is blocked.
  The default hostile-inbox reader journals its own `inbox: N new versions` commit and resolves
  it before returning. Both hooks remain overrideable for tests.
- Outcomes acknowledge `(proposal, hash)` pairs, including unknown versions. Known records get
  `status = outcome` and an `outcome` object containing `outcome`, `applied` and `at`. The first
  recorded outcome wins. New filenames use `<pid>-<first 16 hex of hash>.json`; records and the
  wire retain the full SHA-256, checked before an outcome can update a record. Run A's full-hash
  filenames remain readable. Outcomes are `applied`, `dismissed` or `stale`.

## Recovery and history

The journal holds the complete previous and target snapshots, the captured push, resolved
image bindings and the next round number. This costs disk space but lets recovery finish a
partially written set of note files without depending on overwritten rows or expired uploads.
An atomic `meta.json` publication moves the read view. Once at the target round, replay never
applies its rows again.

Each completed stage is checkpointed in the journal before `afterStep(name)`. Round stages
are exported as `ROUND_STEPS`; outcome/inbox stages as `OUTCOME_STEPS`. Tests interrupt each stage,
reopen the store, and also exit actual child processes without opening sockets.
`NOTES_SYNC_TEST_CRASH_AFTER=<step>` is interpreted only by the CLI.

A failed git commit still publishes the accepted round, with `historyError: true`. A later
request retries that commit under the queue. Pushes and outcomes cannot write again until the
accepted version has been recorded. Commit messages contain round numbers and counts only.
Backups are derived from the published snapshot and immutable objects, never from the view.

`NOTES_SYNC_SKIP_TAILSCALE=1` has effect only with `NOTES_SYNC_TEST=1`; it does not bypass
configuration or git-remote checks. Funnel checks inspect the public listener's proxy mapping,
not just the loopback port. An enabled listener with an unknown mapping is refused. The real
forwarded Host and real Tailscale status shape still need run B's temporary-service checks.

## Verification

`npm test -- server` uses generated fixtures in `fs.mkdtemp` directories. Tests call handlers
directly, use injected Tailscale/listener adapters and exercise the HTTP body reader with
in-memory streams. A real git adapter test commits only generated fixtures in a temporary
repository. The owner's service, configuration, notes, keys and backups are never used.

Run `npm test` for the entire app and service suite. Run `node --check` on each `.mjs` file.
Real sockets, Tailscale forwarding, service installation and Claude Code policy enforcement
remain Claude's checks. No phone changes ship in 4a.

## View and proposals

`view-fs.mjs` uses Linux directory descriptors (`/proc/self/fd`) to pin directories after
checking every ancestor from the view root with `lstat`, ownership, `O_DIRECTORY` and
`O_NOFOLLOW`. Before mutations it checks the ancestry again. File reads require a regular
file before and after open and use bounded reads even if a file grows during the read.
Writes use exclusive no-follow temporary files, file fsync, same-directory rename and
directory fsync. The view removes only expected stale note/image filenames, never directories.

`view-manifest.json` maps relative view filenames to hashes. Rebuilds hash previous files,
log damage as path/time only in `view-log.jsonl`, then replace them from the store. Missing
directories are created; symlinked or foreign-owned directories are refused. Inbox directories
are never emptied. An unreadable inbox is skipped without inferring withdrawal.

The ingestion reader never writes into the inbox. Invalid entries get body-free refusal
records: readable malformed JSON is hashed as raw bytes; an oversized or unreadable entry uses
a fixed refusal-marker hash without reading its content or target. New versions supersede old
pending versions, missing pending files become withdrawn,
and handled content cannot be resurrected by putting old bytes back. A monotonically increasing
`sequence` preserves ingestion order even when timestamps tie. Filename hash collisions are
refused instead of overwriting a stored version. Outcomes update the same records and rebuild
both proposal view files. The proposal index contains metadata/status/outcomes, not bodies;
titles are drawn only from currently live notes.

`propose.mjs` reads only `notebook/` and `inbox/`, writes only `inbox/`, and shares the checked
filesystem operations. `submit` checks generation as well as revision and also checks local
pending files that the service has not ingested yet. `list` removes a handled pending file
only if its current canonical hash matches that handled version. The helper checks shape,
references and size; the phone still audits and normalizes HTML in 4c.

## Deployment and remaining verification

`npm run sync-deploy -- --dry-run` prints the plan without executing it. The modes are default
deploy of HEAD, `--install`, `--rollback`, and `--uninstall`; all support `--dry-run`.
`NOTES_SYNC_HOME` overrides HOME for fixture planning. Unit tests inject both inspection and
execution; they never invoke service management or the real installer.

Deploy archives the resolved HEAD's `server/` into a staging directory, publishes a release
directory, atomically switches `current`, reloads/restarts the unit, waits for active service
and successful status, then prunes to three releases. The current and previous release are
protected so rollback remains usable. A failed status check leaves all releases for diagnosis.
Install preserves an existing valid config, stops an existing unit before bootstrap, initializes
the store, rebuilds the view, enables linger/the unit and configures private Serve. Uninstall
removes only the unit, launcher and Serve mapping. Policies, launcher and unit are rendered from
the selected release on deploy and rollback as well as install.

`npm run sync-check` is an explicit, socket-based script for Claude to run. It uses a new
temporary store/view/config, the made-up sample notebook and loopback only; it checks pairing,
image uploads, pushes, helper submission, ingestion/outcomes, import confirmation, backup
counts/hashes and process exits after apply/publication followed by recovery. Its Markdown
projection is fixture-only; the app's view export belongs to 4b. It does not verify Tailscale
forwarding or browser behavior.

Before real notes enter the view, Claude still needs to measure the forwarded Host, verify
Tailscale/Funnel and systemd behavior, and test `claude-notes` in the still-empty view: expected
setting sources, CLAUDE.md loaded, no plugins/connectors/MCP, sandbox available, web/shell network
denied, protected writes and sentinel reads denied, helper allowed, and permissive local
settings unable to loosen any rule. `--restricted` is the requested implementation, not yet a
claim of verified live isolation. No live install/deploy or socket-based check ran in Codex.
