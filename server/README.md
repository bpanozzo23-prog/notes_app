# Sync service — Phase 4a and the Phase 4b checks

The runtime imports only Node built-ins and other `.mjs` files here. Nothing imports the app
at runtime. `compatibility.test.js` compares the copied constants and image-reference parser
against the app and validates generated backups with the app's validator.

`main.mjs` exposes `serve`, `pair`, `status` and `init-store`. The configuration path comes
from `NOTES_SYNC_CONFIG`; its default is the owner's private configuration, so **tests must
always supply temporary paths**. No installation or live configuration was accessed during
these implementation runs.
The full contract remains [`docs/PHASE-4-DIRECTION.md`](../docs/PHASE-4-DIRECTION.md).

## Embedding and hooks

- `initStore(storeDir, { git })` creates a new store; `openStore` reads an existing one without
  filling in missing files. Missing or malformed required files fail closed.
- `createContext(config, overrides)` accepts `store`, `git`, `now`, `logger`, `afterStep`,
  `rebuildView` and `scanInbox`. `createHandler(context)` returns the plain async
  request handler. `readBody(limit)` must return bytes; it is never called before boundary checks.
- `context.enqueue(task)` owns the mutation queue. Recovery, history retries, pairing, uploads,
  pushes, outcomes and ingestion share it. Reads also pass through it, so they wait for an active
  round. If recovery fails, state/backup reads can still use the cached published snapshot;
  mutation requests receive `storage-problem`.
- `rebuildView(snapshot)` runs after publication, during recovery as necessary, and on startup.
  Its default calls `rebuildView({ storeDir, viewDir, templates })`, rereading the published
  store. It is safe to repeat and never feeds view data back into the private store.
- `scanInbox(context)` runs under the queue for an authenticated state request and every
  3 seconds from `serve`. Both use the same context and in-memory observations. Polling skips a
  tick if a state/timer scan is queued or running. The timer is unreferenced (it cannot keep a
  test process alive); server close stops it, as does the returned `stopInboxTimer()` hook.
  Timer scans resolve journals and retry history first, just like state requests. A blocked
  history prevents ingestion and cleanup. Polling failures log a fixed event without content.
  Tests inject the scheduler/listener or call the handler directly; no socket is needed.
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
not just the loopback port. An enabled listener with an unknown mapping is refused. Prior
live forwarding checks are recorded in `DECISIONS.md`; this run uses injected fixtures.

## Verification

`npm test -- server` uses generated fixtures in `fs.mkdtemp` directories. Tests call handlers
directly, use injected Tailscale/listener adapters and exercise the HTTP body reader with
in-memory streams. A real git adapter test commits only generated fixtures in a temporary
repository. The owner's service, configuration, notes, keys and backups are never used.

Run `npm test` for the entire app and service suite. Run `node --check` on each `.mjs` file.
Real sockets, Tailscale forwarding, service installation and Claude Code policy enforcement
remain Claude's checks. No phone changes ship in 4a.

### Temporary service and browser checks

From the repository root, with the existing dependencies and Playwright Chromium installed:

```sh
npm run sync-check                 # server checks, then browser end-to-end checks
npm run sync-check -- --server-only # just the original server checks
npm run shots                     # existing dev app, default phone viewport
npm run shots -- private-data/shots http://localhost:5174/notes_app/
```

The server part checks pairing, uploads, store/view counts and hashes, incremental pushes,
timer ingestion of proposal file pairs, outcomes, stale refusals, superseding, import
confirmation, backup contents, and crash recovery after apply/publication.
Its optional `--origin http://127.0.0.1:5174` changes only that part's allowed Origin.

The browser part builds with Vite into a temporary `dist/`, serves `/notes_app/` on an
automatically chosen loopback port, and starts `server/main.mjs serve` on another loopback
port. Its temporary config allows that app origin and its own service host. Both
`NOTES_SYNC_TEST=1` and `NOTES_SYNC_SKIP_TAILSCALE=1` are set; `pair` and `status` use that
same config. A child-only temporary `tailscale` stub prevents `status` from probing the
machine's real Serve/Funnel configuration.

Playwright uses the Pixel 7 profile, blocks service workers, grants local-network access,
and aborts/fails on any Tailscale or Anthropic request. Through the UI it imports the sample,
connects, types and waits up to 75 seconds for autosync, approves exactly one changed and one
removed note, restores through the normal preview, and proves the restore sends every row
without confirmation. It then disconnects with a real response held, imports during an image
upload with different bytes for the same image id, and crashes the service after commit.
Checks read only the temporary keyed note files, image objects, view and journal. They verify
old/new notebook isolation and a successful browser round after recovery. Expect several
minutes; each stage prints PASS or FAIL, and any failure exits non-zero. Children, browser
contexts and temporary directories are cleaned up on success or failure.

Shots 163–177 cover the Sync entry, pairing, connected counts/time, wrong code, unreachable,
unpaired, history failure, missing pictures, copy confirmation (also at 375 px), notes-list
bar, restore preview/result and Disconnect confirmation. The default sync address is intercepted
and passed to the **real in-process handler on a temporary store**; no sync socket is opened.
Every other `*.ts.net` request is aborted and fails the run. The temporary store is removed
even if a shot fails. The existing app server must already be running for shots.

These scripts cost nothing and never use the owner's notebook, configuration or live service.
Codex wrote the browser/socket steps without running them in its sandbox. Claude must run
both scripts and inspect the PNGs; phone keyboard and real Tailscale permission behavior remain
owner checks at `http://brent-dell-system-xps-l502x:5174/notes_app/`.

## View and proposals

`view-fs.mjs` uses Linux directory descriptors (`/proc/self/fd`) to pin directories after
checking every ancestor from the view root with `lstat`, ownership, `O_DIRECTORY` and
`O_NOFOLLOW`. Before mutations it checks the ancestry again. File reads require a regular
file before and after open and use bounded reads even if a file grows during the read.
Writes use exclusive no-follow temporary files, file fsync, same-directory rename and
directory fsync. The view removes only expected stale note/image filenames, never directories.

`view-manifest.json` maps relative view filenames to hashes. Rebuilds hash previous files,
log damage as path/time only in `view-log.jsonl`, then replace them from the store. Missing
directories are created; symlinked or foreign-owned directories are refused. Rebuilds create
only `inbox/`, leave its contents alone, and retire the old root helper file without following
links. Legacy inbox subdirectories, if present, are unrelated entries and are left alone.

Claude Code writes `inbox/<pid>.html` first (complete raw UTF-8 HTML, at most 512 KiB), then
`inbox/<pid>.json` (at most 16 KiB) with exactly `note`, `basedOnRev`, `generation`, `title`,
`folderId`, `tags`, `why`. A pid matches `^p-[a-z0-9-]{3,80}$`. There is no shell in note
sessions. The launcher names only Read, Edit, Write, Glob and Grep, passes CLAUDE.md explicitly
with `--append-system-prompt-file`, and both policy templates deny Bash. The fail-closed sandbox
block remains as defence in depth.

The scanner remembers size, modification time and inode for both files, and ingests only after
two unchanged observations. It rechecks stats during reads and before cleanup to avoid
capturing or removing a changed pair. Observations are in memory; a restart needs two scans
again and restarts half-pair timers. A lone file older than ten minutes is refused as
`missing-body` or `missing-details`. Nonmatching names and nonregular entries (including
symlinks) are ignored, never followed or deleted; a pid with either path nonregular is skipped
as a whole. An unsafe inbox is logged and skipped without affecting pending proposals.

All shape, revision, generation, Trash, folder, live-note link and existing-image checks use
`store.published`, never view metadata. The body is valid UTF-8 but is not normalized: the
phone still audits formatting in 4c. At most 50 versions are pending. A valid proposal for the
same note supersedes its pending version, even at the limit; refused replacements leave it
alone. Deleting inbox files does not withdraw proposals.

Versions use SHA-256 of canonical fields plus body, without the filename pid. Malformed or
unreadable input uses bounded byte hashes/refusal markers when a canonical value cannot be
formed. Refusals retain validated details and a reason but no body. A monotonically increasing
`sequence` preserves ingestion order even when timestamps tie. Truncated filename hash
collisions are refused instead of overwriting a stored version. Repeating a pid/hash never
resurrects it. `commitProposalUpdates` journals and commits captured versions and rebuilds
both view status files before pinned unlink removes the pair. If a crash leaves those files,
the next stable scan finds the stored hash, repairs the view and repeats cleanup without
another version. History failure retains files until repaired. The proposal index contains
metadata/status/reason/outcomes, not bodies; titles come only from currently live notes.

`server/view/CLAUDE.md` documents the precise field limits and every refusal reason with its
next step. Writing a fresh pair requires no helper or command-line tool.

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

`npm run sync-check` now includes both server and browser checks described above. The server
part retains its fixture-only Markdown projection; the browser part exercises the app's real
view export. Neither part verifies real Tailscale forwarding.

Run C does not repeat live installation, Tailscale or Claude Code sessions. The prior live
checks and the AppArmor sandbox failure are recorded in `DECISIONS.md`. Before using this
release, Claude must verify in the still-empty view: CLAUDE.md loaded, exactly the five file
tools, no plugins/connectors/MCP, Bash unavailable, protected writes and sentinel reads denied,
file-pair submission working, and permissive local settings unable to loosen any rule. The
sandbox remains fail-closed; note sessions no longer depend on starting it. Codex's checks use
only temporary fixtures, with no live install/deploy, socket-based check or phone changes.
