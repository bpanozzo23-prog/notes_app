# Decisions, explained

The plain-language companion to `DECISIONS.md`. That file is the terse, dated record for agents;
this one is for the owner: what was chosen, why, what it means for the app, what was not chosen,
and how hard it would be to reverse ("lock-in"). Ordered by lock-in, hardest first. Updated whenever
`DECISIONS.md` gains an entry with consequences for how the app behaves.

Last updated 2026-10-16, during the Phase 1a implementation.

---

## Hard to change later

### 1. A web app you install from the browser, not a true Android app

**Chosen:** A "PWA" (progressive web app): a website that Chrome lets you add to your home screen,
open full-screen, and use offline. Same approach as mi-cuaderno.
**Why:** It runs on all four devices, including the work machine that only has a browser, and it
can be built and published from the XPS without an Android toolchain.
**What it means:** It looks and feels like an app, but it's Chrome underneath. Some things a real
app can do are off the table: home-screen widgets, a quick-settings tile, lock-screen shortcuts,
being set as the default notes app. Samsung's "Share to Notes" equivalent *is* possible later.
**Not chosen:** A native Android app (Kotlin). Better system integration, but a much bigger build,
install-from-APK friction, and nothing for the Surface or work machine.
**Lock-in: high.** Switching later means rewriting the screens; the notes would carry over.

### 2. Notes are stored as HTML, the web's page format

**Chosen:** Each note's body is saved as HTML, the format web pages use: `<b>bold</b>`,
`<span style="color:green">`, and so on.
**Why:** The wish list includes colours, font sizes and underline. The simpler alternative,
Markdown (plain text with `**bold**` and `# headings`), has no way to say "green" or "17 pt". HTML
can hold everything the editor does, and Claude reads it well.
**What it means:** Raw files have tags in them. Converting to another app later is easy (every
notes app imports HTML). The Phase 4 "notes as files on the XPS" idea produces `.html` files.
One precise point (from the Codex review): the editor keeps only the formatting it has been
taught. Anything else in pasted or imported HTML is dropped. That is a feature when pasting (it
keeps junk out), and it means the list of supported formatting is written down and tested.
**Not chosen:** Markdown (can't express the formatting). The editor's own internal format (JSON):
equally capable, but only Tiptap can read it.
**Lock-in: medium.** HTML converts to anything; the only loss would be if Markdown-style
simplicity were wanted later, when colour and size would have to go.

### 3. Notes live on the phone, in the browser's storage; no account, no server

**Chosen:** Notes are saved inside Chrome's storage on the device in use. The app works fully
offline. Nothing is sent anywhere unless a backup is exported or Claude is asked a question.
**Why:** Simplest, most private, proven by mi-cuaderno. No monthly cost, no login, nothing to
maintain.
**What it means, and this is the one to understand well:**
- Each device has its *own* copy. A note written on the phone isn't on the Surface until Phase 4
  (sync) exists. For now the phone is the notebook.
- The notes are only as safe as that device. If Chrome's site data is cleared, or the phone is
  lost, the notes are gone *unless there is a backup file*. The app exports one JSON file with
  everything in it and will nag gently about doing so. Think Samsung Notes without Samsung Cloud.
- Chrome *can* evict a site's storage if the phone is desperate for space. The app asks Chrome
  for "persistent" storage, which normally prevents that for installed apps, and shows whether
  it was granted.
- The dev server on the XPS and the published app on GitHub Pages count as two different sites,
  so they have separate storage. Trial notes made during development stay on the dev address
  unless exported and imported. That is why publishing happens early (step 1b).
**Not chosen:** A cloud database (Firebase, Supabase): automatic multi-device and backup, but an
account, a third party holding the notes, and a bill or free-tier limits. Hosting on the XPS from
day one: private, but the XPS being down or being off Tailscale would mean no notes.
**Lock-in: medium.** Adding sync later (Phase 4) is planned and the data model allows it, but sync
is the one feature that is genuinely hard to get right.

### 4. Tiptap as the editor

**Chosen:** A ready-made open-source editor engine, tested in the spike on 2026-10-14.
**Why:** Building a rich-text editor from scratch is a multi-year project. Tiptap gives
bold/lists/headings/undo and a plugin system for everything on the wish list: custom colours,
named styles, callouts, selection pop-up, format painter.
**What it means:** The editor's behaviour is partly theirs, partly ours. Android keyboard quirks
that live inside Tiptap are something to work around, not fix. The spike found none.
**Not chosen:** Other engines (Lexical from Meta, Slate, Quill, CodeMirror): comparable, with
smaller plugin ecosystems or weaker rich text. A plain text box with Markdown: no colours, no
inline formatting as you type.
**Lock-in: high.** Every Phase 2 formatting feature is a Tiptap plugin. Swapping editors later
means rebuilding those. The notes themselves (HTML) would survive a swap.

### 5. Public code on GitHub, app served from GitHub Pages

**Chosen:** The code lives in a public GitHub repository and GitHub publishes it as a website for
free, at `https://bpanozzo23-prog.github.io/notes_app/`. Same as mi-cuaderno.
**Why:** Free, reachable from every device including the work machine, and every push to `main`
republishes automatically.
**What it means:** The *code* is visible to anyone. The *notes* are never in the code; they are in
the phone's storage. `AGENTS.md` and `.gitignore` exist to keep it that way. The app's address is
public but there is nothing at it except an empty notebook for anyone else.
**Not chosen:** Private repo (GitHub Pages needs a paid plan for that). Serving from the XPS over
Tailscale (private, but the work machine can't reach it).
**Lock-in: low.** Moving to another host is a config change.

### 6. The data model: one level of folders, plus tags, plus links

**Chosen:** A note is in one folder (or none) and can have any number of tags. A note can link to
other notes, and each note shows which notes link *to* it ("backlinks"). Folders can't contain
folders yet.
**Why:** Matches Samsung Notes (folders, tags) and adds the one thing it can't do (links between
notes). One level keeps the first version simple.
**What it means:** Three ways to find things: by folder, by tag, by following links. Nesting can be
added later without touching existing notes.
**Not chosen:** Nested folders from the start (more UI, not asked for). Tags only (simpler, less
familiar).
**Lock-in: low to medium.** Adding nesting is straightforward; removing folders if they went
unused would be awkward.

### 7. Deleted notes go to a Trash for 30 days

**Chosen:** Delete asks "are you sure?", then moves the note to a Trash screen where it can be
restored. After 30 days it is removed for good, leaving only a tiny "this note once existed"
marker (a "tombstone").
**Why:** Codex's review made the case: a confirmation cannot undo a slip of the thumb, and the
future sync (Phase 4) needs to know a note was deleted on purpose, or the other device would
bring it back. The first draft had permanent delete; this replaced it.
**What it means:** A mistaken delete is recoverable for a month without touching backups. Trash
is one more screen.
**Not chosen:** Permanent delete with confirmation (simpler, unrecoverable).
**Lock-in: low.**

---

## Easier to change later

### 8. The toolbar is a saved list, not a fixed piece of the app

**Chosen:** From day one, the toolbar is "a list of button names" stored as a setting. In Phase 1
the list is fixed; Phase 2 adds the screen to reorder, add and remove. Each button is defined
once in a registry that also knows how to open a picker (colour, link, and later named styles),
so Phase 2's richer buttons fit the same slots.
**Why:** It is the top formatting request, and designing for it now costs nothing.
**Lock-in: none.** This is the flexible choice.

### 9. Save is automatic; there is no Save button, and saving has guarantees

**Chosen:** Changes are saved shortly after typing pauses, and at the latest every two seconds
during continuous typing; always when leaving the note, switching apps, or exporting a backup.
Saves are tied to the note they belong to so a late save can never land in a different note. If a
save fails, a visible "Not saved" marker appears rather than nothing. An app update never reloads
the page while there is unsaved text.
**Why:** Samsung Notes works this way, and a Save button on a phone is a way to lose work. The
guarantees come from Codex's review of the first draft, which only said "save after a pause".
**What it means:** Never think about saving. There is no "discard changes"; undo is the way back.
**Lock-in: low.**

### 10. Navigation: the Back button works, but notes don't have their own web address

**Chosen:** The app manages its own screens so Android's Back button does what you expect. The
address bar always shows the same URL.
**Why:** Copied from mi-cuaderno, where it has been reliable. No routing library.
**What it means:** No bookmarking or sharing a link to a specific note, and no opening a note from
another app by URL. Fine for a one-person notes app; say so if note links from, say, the calendar
would matter.
**Not chosen:** URL-based routing (each note at `/note/abc`): shareable links, slightly more
work, and it interacts with the GitHub Pages subfolder address.
**Lock-in: medium.** Adding URLs per note later is doable but touches every screen.

### 11. Search is simple: it scans the text of all notes, ignoring case and accents

**Chosen:** The search box checks titles and body text of every note, in memory. No index, no
ranking beyond "most recently edited first".
**Why:** With tens or hundreds of notes it is instant. An index is work with no visible benefit.
**Lock-in: none.**

### 12. Claude gets the whole notebook with each question; you pay with your own key

**Chosen (Phase 3):** A question sends all notes plus the question to Claude and shows the
answer. It uses an API key pasted in once (stored only on the phone, never in backups: backups
are built from an explicit list of allowed settings, so the key cannot slip in). Before enabling,
you tick a box saying a spending cap is set in Anthropic's console; the app itself does not count
cost. Before Claude's proposed edit is applied, the app checks the note hasn't changed since Claude
read it.
**Why:** At this scale "send everything" is simpler and *better* than a search index, because
Claude sees everything. This is mi-cuaderno's Phase 6 pattern.
**What it means:** Each question costs a few cents, more as the notebook grows. Notes go to
Anthropic's servers when you ask, and only then. The "spend cap" is a promise, not something the
app enforces; the cap in the console is the real safety.
**Not chosen:** Embeddings/vector search (standard for big collections; pointless under a few
hundred notes). Running Claude Code against the notes on the XPS instead (that is Phase 4, and
additional).
**Lock-in: low.**

### 13. Who builds it: Codex implements, Claude directs and reviews

**Chosen:** Each step is written up as a complete task; Codex writes the code and tests in a
sandbox that cannot commit or leave the repo; Claude reads the result, runs the tests, sends it
back or fixes small things, and commits. The owner tests on the phone.
**Why:** Codex usage is plentiful; a separate reviewer on every step catches what the author
misses (Codex's review of the plan found several real problems).
**What it means:** Codex cannot ask questions mid-task, so the task write-ups have to be complete,
and a wrong guess costs a round trip. Progress is visible at step boundaries, not live.
**Lock-in: none.**

### 14. A separate project that copies mi-cuaderno's patterns, not its code

Its own repo; where mi-cuaderno solved something, the same approach is re-implemented here rather
than importing files. Two personal apps sharing code becomes a chore. **Lock-in: low.**

### 15. Light theme only, phone layout first

Dark mode and a wider desktop layout are not in Phase 1. The colour system is set up so dark mode
is a later addition, not a redo. **Lock-in: none.**

### 16. What Phase 1a adds, and how failures behave

The first working slice has a notes list, an editor, and Settings for backups. Folder and Trash
operations exist underneath, with their screens coming in 1b. The toolbar is already a list of
action names; its customisation screen comes later. Opening a different note creates a fresh
editor, so Undo cannot bring text across from the previous note.

If saving fails, **Not saved** remains visible and the latest text stays in memory. Retry save,
typing again, or Back tries the write again. Back waits for a successful save; export and import
also wait. Closing or killing the browser before a successful retry can still lose that unsaved
text. Automated tests deliberately fail writes to check this behavior; the owner's phone check
is still needed for switching apps and keyboard composition.

Import first shows the file's counts and any errors. Missing folders block the import; missing
note links appear as warnings. Confirming replacement starts a download of the existing notebook
before changing storage. The browser does not tell the app whether a download ultimately reached
the Downloads folder, so verify both files on the phone. Replacement itself is one transaction:
all tables change together, or the old notebook stays intact if a write fails. Only the three
approved preferences go into a backup; unrelated settings such as a future API key are excluded.

Deleted targets lose their links at purge time. If the linking note was also in Trash, restoring
it cleans up links to already-purged notes then. Neither operation makes old notes look newly
edited in the list.

### 17. Back, Trash and app updates in Phase 1b

Android Back and the app's Back button return to the list with its filter and scroll position
remembered. They finish saving first; if saving fails, the note stays open with **Not saved** so
you can retry. Deleting a note puts it in Trash for 30 days, where you can restore it. **Delete now**
asks for confirmation and removes it permanently; deleting a folder keeps its notes under “No
folder”. An app update shows **Update available — Reload**, but Reload is disabled while notes
are waiting to save or a save has failed. Once saving succeeds, Reload checks again before applying
the update. A brief **Ready to work offline** message marks the first offline installation. The
published app and the phone's dev URL have separate storage, so use a backup to move notes between
them. These phone and installation behaviors still need the owner's check after deployment.
