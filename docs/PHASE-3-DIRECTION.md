
# Phase 3 direction — Claude reads the notebook

Approved by the owner on 2026-10-18. This is the contract for Phase 3; `docs/BRIEF.md`
remains the product contract above it, `DECISIONS.md` records why, and
`docs/DECISIONS-EXPLAINED.md` §38 onward explain the lock-in decisions in plain language. Claude
Code drafted it, Codex reviewed it read-only (xhigh), and Codex implements each step from it.
Corrections from that review are marked *(Codex)*.

## Context

Phase 2 is complete and deployed (0.2.5, schema 4). Phase 3 delivers the second half of the
brief's reason for existing (BRIEF §1: "an LLM cannot get at the notes"): ask Claude a question
across the whole notebook and get an answer that names its sources; let Claude propose tidying a
note or reorganising the notebook, with nothing changing until the owner approves. The policy is
mi-cuaderno's Phase 6 (owner's own key on this device, never exported, behind an acknowledged
spend limit, off by default); its patterns are copied, not its code, and not its model
(`claude-opus-5` there; Claude Opus 5.5 is newer and cheaper).

Foundations already in place: `rev` on every note (Phase 1, for exactly this check); guarded
writes (`writeTransaction` in `src/db/db.js`: read-only on a newer database, the replaced-notebook
generation check); the backup preference allow-list (`EXPORTED_PREFS` in `src/db/backup.js`);
device-local preferences that survive an import; the text projection and link/image reference
parsers (`src/lib/text.js`); save-protected navigation (`src/lib/navigation.js`).

## Owner decisions (2026-10-18, asked before drafting)

- **Tidy covers all four kinds**, built in this order: clean up one note; titles, tags and folders
  across the notebook; links between notes; merge or split notes (last, the largest and riskiest).
- **Answers are kept until the app closes**: a conversation survives tapping into a cited note and
  coming Back; closing or reloading the app, or New question, clears it. Nothing stored.
- **All live notes are sent** with a whole-notebook question (no private folders). Trash is never
  sent.

## Rules that protect the notes

These cut across every step.

1. **Nothing leaves the phone until the owner taps Send, and what is sent is exactly what was
   shown.** Preparing a request is a short protected operation (`nav.run`): it flushes the save
   queue (including input ProseMirror still holds and image insertions in progress), then reads
   notes, folders and the notebook generation **in one read transaction** into an immutable
   payload *(Codex)*. The disclosure (how many notes, which kinds of information, whether images
   go, the estimate) is built from that payload, and Send sends exactly it; anything that would
   change it means preparing and disclosing again. Not even a token count goes first: Anthropic's
   free counting endpoint would itself transmit the notes, so the estimate is computed on the
   phone. The only request made without notes is Settings' Test key.
2. **The key never leaves this device except to Anthropic.** It is stored in `prefs` under
   `claudeApiKey`; its value is read only by `src/claude/client.js` at send time and sent only in
   the `x-api-key` header (Claude never sees it). It is typed into an **uncontrolled** password
   field that is cleared after saving; React state holds only "a key is saved" *(Codex)*. It is
   not in `EXPORTED_PREFS`, so no export can include it; `validateBackup` refuses any backup
   whose preferences contain `claudeApiKey`, checked **before** version upgrades (v2+ sanitising
   would otherwise discard the evidence) *(Codex)*, with "This file contains an Anthropic API
   key, so it was not made by this app's export. Nothing was imported." `useNotebook()` strips
   every Claude preference before putting `prefs` in React state. Errors shown to the owner are
   the app's own fixed sentences; raw SDK errors, requests and headers are never logged or
   displayed *(Codex)*.
3. **Claude proposes; only the owner's tap writes.** Apply and Undo are short protected
   operations (`nav.run`: input locked, queue flushed), and every write goes through
   `writeTransaction` (so the newer-database and replaced-notebook guards apply) *(Codex)*. **One
   approval is one transaction**: all approved changes land, or none. Inside it, every note the
   change touches, including notes whose links a merge rewrites, must still have the `rev`
   recorded when the proposal was reviewed; one mismatch refuses the whole apply ("A note changed
   since Claude read it. Ask again."). A Claude change can never leave a note half-changed. Only
   the network wait runs outside `nav.run`, and a finished request never navigates on its own
   *(Codex)*.
4. **Claude's HTML is never trusted.** A proposed note body goes through three steps *(Codex)*:
   (a) parsed through the editor's own schema (`generateJSON` with the same `extensions`; unknown
   tags are unwrapped and their text kept, scripts and forbidden link protocols are dropped);
   (b) an explicit validation pass over the parsed tree: images and note links resolve only from
   **handles** the app issued for this request (`I1`, `N12`); anything else (a raw id, an unknown
   handle) is removed; link attributes Claude could set (`class`, `target`, `rel`) are replaced by
   the app's own; the document is checked against the schema; (c) serialised with `generateHTML`.
   The review shows that result, which is exactly what gets saved. Removals and changed
   destinations of images and links are counted per occurrence (not as sets of ids) and listed on
   the change that contains them. A new web link shows its full address. Links in previews are
   inert.
5. **The app never acts on what Claude writes.** Answers are rendered as plain React text (line
   breaks and simple `- ` bullets, by our own code): no HTML, no Markdown-to-HTML, no clickable web
   links, no images. A note containing hidden instructions (text pasted from a web page: "prompt
   injection") cannot make the app open, load or send anything. Notes are marked as data in the
   prompt, and every change still passes the owner's review.
6. **No schema change in Phase 3.** No new tables and no new note vocabulary, so the schema stays
   at 4 and the backup format is unchanged. Everything new is a **device-local** preference
   (never exported): `claudeEnabled`, `claudeApiKey`, `claudeSpend`, `claudeLastChange`. The text
   sent to Claude is derived from stored HTML at send time; nothing new is stored on notes.
7. **A request never locks the app, and an update never silently discards an answer.** Requests
   run outside the navigation lock, so the screen stays usable for the 10–60 seconds an answer
   takes. While a request runs, Reload is disabled ("Waiting for Claude's answer"). While a
   conversation or proposal is in memory, an update never reloads automatically, including when
   another tab activated it; the banner says "Reload (clears Claude's conversation)" and the app
   stays usable *(Codex)*. The SDK chunk is loaded when Claude is turned on and when a Claude
   screen opens, so an update can't leave its file missing mid-session.
8. **One request at a time, and late replies can't resurrect cleared state** *(Codex)*. The
   session store allows one active request. Every conversation, proposal and request carries an
   identity token and the notebook generation; New question, Cancel, an import (here: a local
   post-commit notification; elsewhere: the existing broadcast) abort the request and invalidate
   the token, and callbacks with an obsolete token are ignored.
9. **Tests and screenshots never call the real API.** The client takes an injected `fetch`;
   Vitest feeds made-up fixture responses as chunked streams; `npm run shots` intercepts
   Anthropic's address before the first navigation, blocks service workers in its browser
   context, and fails closed on any request to Anthropic it didn't expect. Test setup makes a real
   `fetch` to Anthropic throw. A real request is made only by the owner, or by the agent after
   asking (it spends the owner's money).

## Shape of Phase 3

### Model and request settings (`src/claude/config.js`, one place)

- **Model `claude-opus-5-5`** (Claude Opus 5.5: $4 per million input tokens, $20 per million
  output; cache writes $5, cache reads $0.20). Thinking is always on in this model; `thinking`,
  `temperature`, `top_p` and `budget_tokens` are **not sent** (the last three return errors);
  tests assert their absence.
- **Effort** (`output_config.effort`): `medium` for questions (set explicitly; it is also this
  model's default), `high` for proposals, which must return whole notes as valid HTML.
- **Streaming** for every request (`client.messages.stream`), so answer text appears as it
  arrives and long requests don't time out. `max_tokens`: 16,000 for questions, 32,000 for
  proposals (thinking counts toward it).
- **Refusal fallback:** requests carry `fallbacks: "default"` with the beta header
  `server-side-fallback-2026-07-01`. If Opus 5.5's safety checks decline (unlikely for notes, but a
  note about medicine or security could trigger one), Anthropic re-runs the request on another
  Claude model inside the same call; the answer says which model answered. One constant turns it
  off. If the whole chain declines: "Claude declined to answer this." Checked before reading
  `content` (mi-cuaderno lesson: a refusal can arrive with empty content).
- **SDK:** `@anthropic-ai/sdk` (0.135.0, installed by Claude before 3a), created per request with
  `dangerouslyAllowBrowser: true` (this sets the `anthropic-dangerous-direct-browser-access` header
  a browser call needs), the key from `prefs`, `maxRetries: 2` (it retries rate limits, overloads
  and dropped connections, honouring `retry-after`), and an injectable `fetch` that defaults to
  `globalThis.fetch` looked up at call time. Loaded with a dynamic `import()` (rule 7). mi-cuaderno
  used plain `fetch` for one non-streaming call; here streaming, citations and typed errors make
  the SDK the safer choice.
- **Prices** for Opus 5.5, Sonnet 5.5, Haiku 5.5 and the fallback models Anthropic may use live in
  a table in `config.js`, so a model change is one line and the cost display stays right. Checked
  against Anthropic's docs on 2026-10-18.

### What is sent

**A whole-notebook question (Ask)**

- A fixed system prompt (`src/claude/prompts.js`).
- One **document block** per live note, in a stable order (creation time, then id), each with:
  - `title`: the note's displayed title (`noteTitle`), cut to 100 characters;
  - `context` (shown to Claude, never quoted as a source): folder, tags, created and edited dates
    (day only), pinned;
  - `source.text`: the note's **Claude text** (`src/claude/projection.js`, built from the parsed
    schema tree, deterministic), a plain-text projection that keeps structure: `# ` headings,
    `- ` and `1. ` list items, `[ ]`/`[x]` tasks, `> ` quotes, `[Tip]`-style callout labels, `---`
    dividers, `[image]` where an image sits, note links as `link text [→ Target title]` and web
    links as `text <https://…>`. Colours, sizes and typefaces are left out (formatting isn't
    meaning, and HTML would roughly double the size);
  - `citations: { enabled: true }`.
- `cache_control` on the last document block, so the instructions plus all notes are cached
  (5-minute lifetime) and follow-ups read them back at 5% of the price. Automatic caching
  (top-level `cache_control`) covers the growing conversation after it.
- After the notes, in the same first user message: "Today is Sunday 18 October 2026." and the
  question. The date sits after the cache point so the cached part doesn't change daily.
- **Not sent:** note ids, Trash, deletion records, images (only `[image]`), settings, toolbar,
  styles, the key (header only), anything about the device.
- **The snapshot is frozen per conversation.** The payload captured for the first question (rule
  1) is reused for every follow-up, so the cache keeps working and answers stay consistent. The
  Ask screen says "Using your 34 notes as of 14:02. Start a new question to include later
  changes." **Before every follow-up or retry**, the app checks that every note in the snapshot is
  still live and the generation still matches; if a note was moved to Trash or deleted, the
  conversation ends ("A note in this conversation was moved to Trash or deleted. Start a new
  question.") rather than sending it again *(Codex)*. Earlier messages are never edited.
- **Follow-ups** append to the conversation. **Only completed turns are sent back** *(Codex)*: a
  turn joins the history Claude sees only when its answer finished normally (`end_turn`), and then
  exactly as received, thinking blocks included (Opus 5.5 checks that earlier turns are
  unchanged). A stopped, cut-short or failed answer stays on screen, labelled, but is not sent
  with follow-ups; Try again resends that question without duplicating it. At most 10 follow-ups,
  then "Start a new question", so the resent history stays small.

**A question about one note** (from the note screen): the same shape with one document. Its images
go only if the owner ticks "Include its 3 images (about 12,000 tokens, about 5¢ more)". At most 20
images (beyond 20, the API applies a stricter 2,000-pixel limit to every image). Images are made
request-ready from their stored size *(Codex)*: one whose long edge exceeds 2,576 px (possible
for imported images, up to 10,000 px) or whose base64 exceeds 5 MB gets a request-only copy
shrunk with the Phase 2 pipeline (`src/lib/images.js`); the stored original is untouched; an
image that can't be prepared is left out, and the disclosure lists what is left out and the size
actually sent. Image cost estimate: ⌈width/28⌉ × ⌈height/28⌉ tokens of the size sent, at most
4,784 per image (Anthropic's current formula; a 1,180 × 2,560 screenshot ≈ 3,956 tokens ≈ 1.6¢,
so Phase 2's numbers hold).

**A proposal request (tidy, reorganise, links, merge, split):** no citations (Anthropic rejects
citations combined with the structured output proposals need). The note bodies Claude may change
are sent as stored HTML with images and note links rewritten to handles (`<img data-file="I1">`,
`<a href="note:N12">`); other notes appear as `N12 · title` lines or as Claude text, depending on
the kind (below). The reply is JSON matching a schema (`output_config.format`, "structured
output"), so the app reads fields rather than parsing prose.

**The disclosure** (before the first question of a conversation, and before every proposal):

```
Send to Anthropic?
34 notes: titles, text, folders, tags, dates
Images: not sent ([image] marks where they are)
Trash: not sent
About 27,000 tokens · about 17¢
                         [Cancel] [Send]
```

### What a question costs (worked through, Opus 5.5)

A token is roughly three-quarters of an English word (Spanish uses more). Assumptions: 40 notes ≈
25,000 tokens of text (Phase 2 estimate) plus ≈ 2,000 for instructions and citation overhead =
27,000 tokens in; an answer plus Claude's hidden thinking ≈ 1,500 tokens out (thinking is billed
though not shown, and its length varies a lot).

| Request | Working | Cost |
|---|---|---|
| First question, 40 notes (cache written) | 27,000 × $5/M = 13.5¢ + 1,500 × $20/M = 3¢ | ≈ 17¢ |
| Same, if caching were off | 27,000 × $4/M = 10.8¢ + 3¢ | ≈ 14¢ |
| Follow-up within 5 minutes | 27,000 × $0.20/M = 0.5¢ + earlier turns ≈ 1¢ + 3¢ | ≈ 5¢ |
| First question, 20 notes | 14,500 × $5/M = 7.3¢ + 3¢ | ≈ 10¢ |
| One note, no images / with 3 screenshots | ≈ 2,700 / 14,600 tokens in + 3¢ | ≈ 4¢ / 10¢ |
| Tidy one note | ≈ 5,000 in (2¢) + ≈ 4,500 out: new note + thinking (9¢) | ≈ 10–15¢ |
| Titles, tags and folders, whole notebook | ≈ 28,000 in (11¢) + ≈ 6,000 out (12¢) | ≈ 20–25¢ |
| Links between notes | similar | ≈ 20¢ |
| Find merge candidates / one merge or split | ≈ 28,000 in, short out / two notes in and out | ≈ 15¢ each |

- **Caching** costs about 3¢ extra on a one-off question and saves about 9¢ on each follow-up; it
  pays for itself if roughly one question in four gets a follow-up within 5 minutes. It is on.
  The 1-hour cache lifetime (writes at double price) is not used.
- **A month** at three questions a day, half with a follow-up, plus a few tidies: ≈ $15–20 on
  Opus 5.5; about half on Sonnet 5.5; under $1 on Haiku 5.5 (see the lock-in review).
- **The estimate before sending** *(Codex: defined)*, per request kind:
  - input = instructions + payload characters ÷ 3 (rounded up) + earlier turns (their real token
    counts, known from the previous answers) + images (the formula above);
  - priced as a cache write for a first request, and as a cache read for a follow-up that starts
    within 5 minutes of the previous request (otherwise a write again); no cache below 512 tokens;
  - plus an output allowance: 1,500 tokens for a question; for a tidy, twice the note's estimated
    tokens plus 3,000; 6,000 for notebook-wide proposals;
  - shown as "about 17¢"; above 100,000 tokens the disclosure adds "This is a large request".
- **The cost after each answer** comes from the token counts Anthropic returns (`usage`: input,
  cache write, cache read, output; the final cumulative values, never summed per event), priced
  for the model that actually answered (a fallback may differ). If the stream was interrupted
  before final counts arrived, or the model isn't in the price table, it shows "cost unknown" (or
  "at least …"). Shown under the answer ("17¢ · Opus 5.5") and added once, in one guarded write
  keyed by the request id, to a **this-month total on this phone** (`claudeSpend`). The Anthropic
  console stays the authoritative record and the real limit.

### Answers, sources and follow-ups

- The answer streams in as text. Each stretch Claude cites from a note gets a small number
  (`¹`); below the answer, **Sources** lists each cited note once, numbered: its current title and
  folder, and the quoted passage(s) (`cited_text`, cut to 200 characters). Tapping a source opens
  the note through the existing save-protected navigation; Back returns to the conversation.
- A citation's `document_index` maps to the snapshot entry, which holds the note's id, `rev` and
  `updatedAt` at send time. On display: a deleted note shows "No longer exists" (not tappable); a
  note in Trash shows "In Trash" (the existing restore message on tap); a note whose `updatedAt`
  moved shows "Edited since Claude read it" (still opens). (`updatedAt` moves only on content
  edits; `rev` also moves on pinning, so it would mislabel.)
- A note Claude mentions without citing is not linked: no guessing from titles.
- **The conversation lives in memory** (`src/claude/session.js`, an app-level store read with
  `useSyncExternalStore`, outside any screen): the payload, the completed protocol messages and,
  separately, the text on display (partial or complete), each turn's cost and the request state.
  Leaving the Ask screen keeps it; a request keeps running while the owner looks at a source. New
  question asks "Clear this conversation?" and clears it; closing or reloading the app forgets it.
  Never in backups, never in `history.state`.
- An import (here or in another window) clears the conversation and any proposal (rule 8): they
  describe a notebook that no longer exists.

### What tidy may change, and how it is built (owner's order)

Claude never deletes a note or a folder, never renames folders, never touches settings, toolbar or
styles, and never changes anything the review didn't show. Proposed metadata is validated locally
against the same rules a backup enforces (tags: trimmed, unique, no control characters, at most
512 characters; titles at most 200 characters); a note named twice, or conflicting operations,
make the proposal unusable *(Codex)*. **Folder changes are explicit actions** *(Codex)*: keep;
move to an existing folder (by its id, with its name checked again inside Apply); create a new
folder (only if an approved change uses it; a name matching an existing folder, ignoring case,
uses that folder); or no folder.

1. **Clean up one note (3c).** From the note screen: Claude → Tidy this note, with an optional
   instruction ("fix my accents", "make this a list"; default: fix mistakes and make the
   formatting consistent, changing as little as possible). Sent: the note's HTML with handles, its
   title, folder and tags; the folder names and tags in use; the other notes as `N12 · title`
   lines (for link suggestions). Proposal: `{ summary, title, html, tags, folder }`, where each
   field is either "unchanged" or a new value, each change with a one-line reason. Claude keeps
   the owner's voice and language, never translates or invents content unless asked, and keeps
   every `I` handle unless the instruction asks to remove an image.
2. **Titles, tags and folders across the notebook (3d).** From Ask: Tidy the notebook → Titles,
   tags and folders. Sent: every live note as Claude text with its handle, title, folder and tags;
   folders and tags in use. Proposal: `{ summary, changes: [{ note, title, folder, addTags,
   removeTags, reason }] }`, at most 40 changes. Body text is never changed here. Renaming a note
   doesn't rewrite link texts in other notes (Phase 1c rule: link text is a snapshot).
3. **Links between notes (3e).** Proposal: `{ links: [{ from, to, phrase, reason }] }`. Applied
   locally, not by Claude rewriting the note: if `phrase` occurs exactly once in the source note
   outside code and existing links, it becomes a `note:` link; otherwise the link goes in one
   "See also:" paragraph at the end of the note, with the target's current title as text (as the
   link picker does). The review shows which.
4. **Merge or split (3f).** Two stages. *Find duplicates* (from Ask) returns candidate groups with
   reasons; the owner taps one group → a merge proposal with the combined HTML (handles from all
   sources), title, tags and folder. Applying keeps the **first note's identity** (so links to it
   keep working), writes the merged content there, and moves the other notes to **Trash**
   (recoverable for 30 days). **Every link rewrite is computed and shown before approval**
   *(Codex)*: live notes that link to a source being trashed are listed ("Also updates links in:
   …"), have their `rev` recorded, and are rewritten to point at the kept note; Apply refuses if
   that set of notes or their `rev` changed. Notes in Trash are not rewritten (Trash is never shown
   to or edited by Claude). Links inside the merged text that would point at the merged note
   itself lose the link and keep their text. Those rewrites move `rev` but not `updatedAt`
   (housekeeping, like purge cleanup), through a shared in-transaction note writer with an explicit
   housekeeping mode (`updateNote` always moves `updatedAt` on an HTML change). *Split this note*
   (from the note screen) proposes the note's remaining HTML plus new notes (title, HTML, folder,
   tags); applying creates them and adds a "Split into:" line of links to the original. Images
   move by reference. Merges and splits are approved as a whole (one tick): partial merges have no
   sensible result; the text is reviewable before and editable after.

### Reviewing a proposal at phone width

The review screen (`claude-review`) opens when the owner sends a proposal request. Its state lives
in the same in-memory session store as answers. Claude actions started from the note screen run
their preparation in `nav.run` and open their own screen. If the owner goes Back while Claude
works, nothing navigates when the proposal arrives: a bar says "Claude's proposal is ready ·
Review" *(Codex)*. A proposal for a note edited meanwhile is stale (below).

```
← Review Claude's changes
"Fixed 6 spelling and accent mistakes, made the
 verb list a bulleted list."   12¢ · Opus 5.5
Subjunctive triggers
[✓] Title  Subjunctive triggrs → Subjunctive triggers
[✓] Tags   + grammar
 ⋯ 3 unchanged paragraphs (show)
[✓] Change 1 of 3
    Before  Quiero que tu vengas.
    After   Quiero que tú vengas.
    Words   tu → tú
[✓] Change 2 of 3
    Before  ojala, espero que, …   (paragraph)
    After   • ojalá  • espero que  • …
    Formatting  now a bulleted list
[ ] Change 3 of 3  Removes an image
    Before  [image thumbnail]
 ⋯ 2 unchanged paragraphs (show)
[ Untick all ]          [ Apply 4 changes ]
```

- **Body changes are found locally.** The current and proposed bodies are split into top-level
  blocks (paragraph, heading, list, quote, callout, image, divider); a block-level diff (the `diff`
  package's `diffArrays` over normalised block HTML) groups differences into numbered changes.
  Each shows Before (muted, marked −) above After (tinted, marked +), rendered with the note's real
  formatting by a read-only editor on the same schema, never by inserting Claude's HTML; a "Words"
  line lists word changes (`diffWords` on the text); a formatting-only change says what changed
  ("now a heading", "bold added").
- **Effects inside a block share that block's tick** *(Codex)*: a change card lists everything its
  block change does to images and links, counted per occurrence (removes an image; a link now
  points at a different note or address, with old and new shown; adds a web link with its full
  address). An image that is its own top-level block is its own change. Symbols and labels, not
  colour alone.
- **Partial approval:** every change and every title/tags/folder row has its own tick, **ticked
  by default**; the button counts what will be applied. The applied body is the current blocks
  with only the ticked changes swapped in, validated again as a whole (an empty result becomes
  one empty paragraph). The proposed title can be edited in its row before applying.
- **Apply** (in `nav.run`): flush the queue, then `applyClaudeChanges`
  (`src/db/claudeChanges.js`) in one `writeTransaction` over notes, folders, tombstones, files and
  prefs: checks the generation and every recorded `rev` (and folder ids and names), creates the
  folders approved changes need, writes each note through a shared in-transaction writer that does
  what `updateNote` does (`cleanPatch`: text, links; `clearReferencedFileMarks`; `rev` + 1;
  `updatedAt` only on content changes, or never in housekeeping mode), and writes the undo record.
  Then a refresh, and "Applied 4 changes · Undo".
- A stale proposal (a `rev` moved, a folder changed, or the generation changed) says so and offers
  Ask again; it can never be applied.

### Undo after applying *(Codex: rewritten)*

- The apply transaction also stores `claudeLastChange` (device-local): a unique change id; the
  notebook generation; for every note it changed, created or trashed, a **complete copy of the
  note as it was before** (title, html, folder, tags, pinned, deletedAt, createdAt), which fields
  changed, and the `rev` it wrote; and the folders it created. Only the last change is kept; it
  survives closing the app.
- **While that record exists, the images its copies reference are kept** *(Codex)*: image cleanup
  counts them as used. When the record is replaced or cleared, the ordinary 30-day unused clock
  starts for any image no note uses.
- **Undo Claude's last change** (in the success message and in Settings → Claude) runs in
  `nav.run` and one transaction over notes, folders, tombstones, files and prefs, re-checking the
  change id and generation:
  - If every affected note still exists with the `rev` Claude's change wrote, it restores the
    changed fields from the copies; untrashes merge sources; moves notes a split created **to
    Trash** (not deletion: another note may link to them by now); reverts merge link rewrites; and
    deletes folders the change created if they are now empty.
  - Otherwise (a note edited since, or purged), it offers **Restore the earlier versions as new
    notes** ("… (before Claude)", fresh ids) instead, so nothing written afterwards is overwritten
    and nothing is lost.
  - Either way, restored HTML goes through the same cleaning as Trash restore: links to purged
    notes lose their link (tombstones), text and link projections are recomputed, image marks are
    cleared; a folder that no longer exists becomes "No folder"; `rev` moves forward from its
    current value, never back to an old number.
- An import deletes `claudeLastChange` in its transaction; the generation check refuses an Undo
  from before an import.

### Settings → Claude (`settings-claude`)

Off by default; mi-cuaderno's card, re-implemented:

```
← Claude
Claude can answer questions about your notes and
suggest tidying, when you ask. Your notes go to
Anthropic only when you tap Send.
The API key is stored in this browser, where code
on this page can read it. A spend limit in the
Anthropic console bounds what a leak could cost.
Backups never include the key.
[ ] I have set a monthly spend limit in the Anthropic console
[ sk-ant-…                          ]
[ Save key and turn on ]
── when on ──
On · key saved on this phone
[ Test key ] [ Turn off ] [ Remove key ]
This month on this phone: $1.24 (estimate)
[ Undo Claude's last change ]
```

- The acknowledgement is a gate each time Claude is turned on, not a stored consent (a limit can
  be changed after it was ticked). The console link is `https://platform.claude.com/settings/billing`
  (Spend limits).
- The key's value is never shown back, only that one is saved (rule 2). Turn off keeps it; Remove
  key (confirmed) deletes the row with `delPref`.
- **Test key** uses Anthropic's free token-counting endpoint with the word "Hi". A successful
  count: "The key works." 401 or 403: "Anthropic rejected this key." A rate limit, billing problem,
  server error or no connection: "Couldn't check the key: …" *(Codex: inconclusive, not success)*.
  It costs nothing and sends no notes (mi-cuaderno's version made a paid request).
- Claude's buttons appear only when Claude is on **and** a key is saved: **Ask Claude** on the
  notes list header; a **Claude** button on the note screen (Ask about this note, Tidy this note,
  Split this note); **Tidy the notebook** (Titles, tags and folders · Links between notes · Find
  duplicates to merge) on the Ask screen.
- An import keeps the key and the on/off state (device-local, as Phase 1 decided), so a restore
  on the same phone needs no retyping.

### Failures

All messages are the app's own sentences (rule 2); Anthropic's error type and request id may be
shown, never its raw text.

| Situation | What the owner sees | Charged? |
|---|---|---|
| Offline before sending | Send disabled: "You're offline. Claude needs a connection." | No |
| Connection drops mid-answer (also: switching apps on Android can freeze the page) | What arrived, marked "Connection lost", with Try again (same snapshot) | Possibly, for what was generated |
| Key rejected (401, 403) | "Anthropic rejected the API key. Check it in Settings → Claude." | No |
| Owner's spend limit reached (400 "specified API usage limits") or account's monthly cap (429 `enforced_spend_limit_reached`) | "Your Anthropic spend limit has been reached. Raise it in the console, or wait for next month." | No |
| Billing problem (402) | "Anthropic reports a billing problem with your account." | No |
| Rate limited (429) | SDK retries twice, honouring `retry-after`; then "Too many requests just now. Try again in a minute." | No |
| Anthropic busy or erroring (5xx, 529) | after retries: "Anthropic is busy. Try again shortly." | No |
| Other refusal of the request (400, 413) | "Anthropic couldn't accept this request (invalid_request_error)." | No |
| Claude declines (`stop_reason: "refusal"`, after the fallback) | "Claude declined to answer this." | Usually not |
| Cut short (`max_tokens`) | Answer: what arrived, marked "Cut short". Proposal: "The proposal was cut short; nothing was changed." | Yes |
| Proposal unusable (bad JSON, schema mismatch, failed validation) | "Claude's proposal couldn't be used; nothing was changed." with Ask again | Yes |
| Cancel (while thinking or streaming) | Answer: what arrived, marked "Stopped". Proposal: discarded. | Possibly, for what was generated |
| Update waiting | Rule 7 | — |
| Newer database (read-only), upgrade in another window, or notebook replaced | New Claude requests disabled until reload, with the guard's message; a request already running finishes and stays on screen, but its cost isn't added to the month's total (that is a write) *(Codex)* | — |

### Navigation

`SCREENS` gains `ask`, `claude-review` and `settings-claude`. History entries hold only the screen
name (rule: never restore note content from history). After a reload, `ask` shows an empty Ask
screen and `claude-review` says "This proposal is no longer available" with Back.

### Backup and restore

- Format and schema unchanged (4). `buildBackup` is unchanged: the allow-list already keeps every
  Claude preference out, so export and the before-import safety download work with a key stored.
- `validateBackup`: `claudeApiKey` in preferences → error, checked before `upgradeEnvelope` (rule
  2). Other Claude preferences present → warning, ignored (added to `IGNORED_PREFS`, which already
  works for v1–v4).
- `importBackup` keeps device-local preferences (Phase 1) but deletes `claudeLastChange` in the
  same transaction, then notifies the session store after commit (rule 8).
- `cleanupFiles` also counts image references in `claudeLastChange`'s copies as used.

### Sample notebook, fixtures and screenshots

- `scripts/make-sample-notebook.mjs` gains made-up content for Claude's features: a note with
  spelling and accent mistakes, two near-duplicate notes, notes that should link, and an untagged
  note in no folder. Schema stays 4; `sampleNotebook.test.js` keeps it valid.
- `src/claude/fixtures/`: hand-written, made-up API responses as server-sent-event streams: an
  answer with citations to several notes, a follow-up, each proposal kind, a refusal, a
  `max_tokens` cut, and 401/429/529 errors. In Vitest they are fed to the SDK as **chunked**
  `ReadableStream` responses through the injected `fetch`, which also drives abort and mid-stream
  errors *(Codex)*.
- `scripts/screenshot.mjs`: a browser context with service workers blocked; `page.route` installed
  before the first navigation, failing closed; and an init script that wraps `fetch` for
  Anthropic's address to return fixture streams whose chunks the script releases step by step, so
  it can shoot an answer mid-stream and press Cancel *(Codex)*. It enables Claude through the real
  Settings flow with the obviously fake key `sk-ant-FAKE-KEY-FOR-SCREENSHOTS`, and shoots Settings
  → Claude (off, on), the disclosure, a streaming answer, sources, a source opened then Back, a
  follow-up, each error, the tidy review (partial ticks), after Apply and after Undo, notebook
  reorganise, links, merge and split reviews; at 412 px, 375 px and the reduced keyboard height.

## Not in Phase 3

- A search index or embeddings; sending Trash; images with whole-notebook questions.
- A history of past conversations (owner chose in-memory); saving an answer as a note (easy
  later).
- Claude acting without approval, in the background, or on a schedule; the Batch API (half price
  but answers take minutes to hours).
- A model choice in Settings (one constant; switching is a one-line change).
- A server or proxy to keep the key off the phone; Claude Code working on the notes on the XPS
  (Phase 4).
- Claude renaming or deleting folders, deleting notes outright, or editing settings, toolbar or
  styles; Claude filling image `alt` text (noted in Phase 2; later).
- Per-folder privacy (owner chose to send all notes).
- More than one level of Undo; a version history of notes.

## Who does what (unchanged from Phase 2)

**Codex implements; Claude directs and reviews; the owner verifies on the phone.** Per step,
Claude writes a self-contained task in the scratchpad and runs `codex exec --sandbox
workspace-write -C ~/code/notes_app` in the background. Claude installs packages first (the
sandbox has no network), reads Codex's report and the diff, runs `npm test`, `npm run build` and
`npm run shots`, looks at the PNGs, fixes small things or sends Codex back (`codex exec resume
--last`), then commits and pushes `main`. **Plan approval is the "ask" for those per-step commits
and pushes.** No real API request is made by the agent without asking the owner first. Each step
ends with tests and build green, `DECISIONS.md` entries with absolute dates, a plain-language
section in `docs/DECISIONS-EXPLAINED.md`, README status, shots and the sample notebook extended,
the version bumped, and a short phone checklist. The agent says what it did not see.

Packages: `@anthropic-ai/sdk@0.135.0` (3a), `diff@9.0.0` (3c). No other new runtime dependency.

## Files

```
src/claude/config.js          model, effort, max_tokens, fallback switch, price table, limits
src/claude/prefs.js           preference names, ready check (enabled AND key), spend total
src/claude/client.js          lazy SDK client, injected fetch, error → { kind, message } mapping
src/claude/prompts.js         system prompts (tests pin their load-bearing rules)
src/claude/projection.js      note → Claude text (schema tree, deterministic)
src/claude/payload.js         protected capture, handles, frozen snapshot, estimates
src/claude/ask.js             question requests, citations → sources
src/claude/proposals.js       proposal schemas, request builders, metadata validation
src/claude/html.js            handles out/in, parse → validate → serialise
src/claude/diff.js            block and word diffs, reference occurrences, partial assembly
src/claude/images.js          request-ready image copies
src/claude/session.js         in-memory conversation/proposal store, one request, tokens
src/claude/fixtures/          made-up API responses (SSE)
src/db/claudeChanges.js       applyClaudeChanges, undoClaudeChange (guarded, one transaction)
src/db/notes.js               shared in-transaction note writer (normal / housekeeping)
src/db/files.js               cleanup counts the undo record's image references
src/db/backup.js              key refusal before upgrades, IGNORED_PREFS, import clears undo
src/lib/useNotebook.js        strips Claude preferences from React state
src/lib/navigation.js         ask, claude-review, settings-claude
src/screens/Ask.jsx, ClaudeReview.jsx, settings/ClaudeSettings.jsx
src/components/Sources.jsx, ChangeCard.jsx, Disclosure.jsx, ClaudeReadyBar.jsx
src/screens/NotesList.jsx, Note.jsx, Settings.jsx, App.jsx   entry points, update rules
src/test/setup.js             real fetch to Anthropic throws
scripts/make-sample-notebook.mjs, scripts/screenshot.mjs
```

## Steps

Each step: Codex implements → Claude reviews, tests, builds, shoots, commits, pushes → owner
checks the published app with their own key. No step changes the schema; **before 3c** (the first
step that can write Claude's changes) the owner exports a backup on the published app.

1. **3a — Settings and the request layer** (0.3.0). Settings → Claude (acknowledgement, key entry,
   Test key, Turn off, Remove key), device-local preferences, `useNotebook` stripping, the backup
   refusal, the SDK client with injected fetch and error mapping, the session store's lifecycle
   (one request, tokens, import notification), the update rules, chunked-stream test harness,
   fixtures and the shots fetch wrapper and route guard. Nothing is sent except Test key.
   *Phone:* turn Claude on with your key (published app); Test key; a wrong key → "rejected";
   turn off and on (asks for the limit again, keeps the key); export a backup, import it, Claude
   still on; Remove key.
2. **3b — Ask across the notebook** (0.3.1). Projection, protected payload capture, disclosure,
   estimate, streaming answer with citations, Sources, opening a source and Back,
   changed/Trash/deleted labels, follow-ups with caching and the liveness check, actual cost and
   the monthly total, Cancel, every failure row, Ask about this note with optional request-ready
   images.
   *Phone:* a real question; tap each source, Back; a follow-up within 5 minutes shows a lower
   cost; compare with the Anthropic console's usage; airplane mode; Cancel; switch apps while it
   answers; a question about a note with a screenshot, images ticked.
3. **3c — Clean up one note** (0.3.2). Handles and parse → validate → serialise, the tidy
   proposal, the review screen (block and word diffs, effects per block, ticks, editable title),
   the ready bar, apply with the `rev` check, the shared note writer, the undo record with image
   retention, and Undo (both paths).
   *Phone:* tidy a note with mistakes; untick one change; Apply; check the note; Undo; tidy again,
   edit the note before applying (refused); Undo after editing (offers copies).
4. **3d — Titles, tags and folders** (0.3.3). Notebook-wide metadata proposal, folder actions,
   local metadata validation, review grouped by note, apply and Undo across many notes.
5. **3e — Links between notes** (0.3.4). Link proposals, phrase-or-See-also placement, review.
6. **3f — Merge and split** (0.3.5). Find duplicates, merge proposal with link rewrites shown and
   `rev`-checked, apply (identity kept, sources to Trash, housekeeping rewrites), split proposal
   and apply, Undo for both.
7. **3g — Closeout** (0.3.6). Codex reviews `git diff phase-3-base...HEAD` read-only (xhigh)
   against this document (`phase-3-base` = a local tag on the commit that adds this file); fixes;
   README; `DECISIONS-EXPLAINED.md` brought up to date; BRIEF amendments checked.

## BRIEF amendments (in the commit that adds this file)

Strikethrough plus replacement, as the BRIEF asks: §5 Tier 3 gains the owner's 2026-10-18 choices
(answers kept until the app closes, follow-ups, the four tidy kinds, all live notes sent, Trash
never); §7 gains "Notes leave the device only when the owner sends a Claude request, and then only
to Anthropic"; §9's Phase 3 image note gains the current formula (⌈w/28⌉ × ⌈h/28⌉ tokens, at most
4,784 per image; a stricter 2,000-px limit above 20 images per request).

## Verification

- `npm test` (Vitest, jsdom, fake-indexeddb, fixtures only):
  - Requests: model, effort and `max_tokens` per kind; no `thinking`, `temperature`, `top_p`,
    `budget_tokens`; citations on every document and never with `output_config.format`;
    `cache_control` on the last document; the date after it; the same notebook gives a
    byte-identical cached part; follow-ups append only completed turns and never modify earlier
    ones; nothing is sent before Send (fetch not called while the disclosure shows); what is sent
    equals the disclosed payload even if a note is saved in between.
  - Responses (chunked streams): refusal checked before content; `max_tokens`; cancel; abort and
    mid-stream errors; every error row's message; citations → sources, including several citations
    to one note and the deleted/Trash/edited labels; cost from final `usage` against the price
    table, unknown models and interrupted streams; the monthly total counted once; estimate
    arithmetic per kind.
  - Lifecycle: one request at a time; New question, Cancel and import (local and broadcast)
    invalidate the request, and a late callback changes nothing; a follow-up after a note was
    trashed ends the conversation; guard states disable new requests; an update with a
    conversation in memory does not reload automatically.
  - Safety: a sentinel key appears in no exported backup (JSON text searched, every Claude
    preference seeded), no request body, React state, rendered output, history state or console
    output, including when simulated errors contain it; a backup carrying `claudeApiKey` is refused
    at every schema version; import deletes the undo record and clears the session.
  - Proposals: unknown handles and raw ids removed; link attributes replaced; `src`, `blob:`,
    scripts and unknown tags handled as specified; repeated image/link occurrences counted;
    every image or link effect listed on its change; partial assembly validated; metadata
    validation and folder actions; one stale `rev` (or changed folder or backlink set) refuses
    the whole apply; a failed write mid-transaction leaves everything unchanged; apply refused
    when read-only, replaced or from another generation.
  - Undo: clean path; after an edit (copies with fresh ids); after a purge; split notes go to
    Trash; links to purged notes neutralised; deleted folder → No folder; `rev` only moves
    forward; images in the undo record survive cleanup beyond 30 days and start their clock when
    the record is replaced; merge rewrites reverted; links placed by phrase or See also.
- `npm run build` after every step.
- `npm run shots` after every step at 412 px, 375 px and reduced height, PNGs read before
  reporting; the run fails on any unexpected request to Anthropic.
- Owner on the published app with each step's checklist. The agent cannot see real answers,
  Anthropic's billing, the phone's network behaviour or app switching.
