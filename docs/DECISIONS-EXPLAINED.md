# Decisions, explained

The plain-language companion to `DECISIONS.md`. That file is the terse, dated record for agents;
this one is for the owner: what was chosen, why, what it means for the app, what was not chosen,
and how hard it would be to reverse ("lock-in"). Ordered by lock-in, hardest first. Updated whenever
`DECISIONS.md` gains an entry with consequences for how the app behaves.

Last updated 2026-10-17, with step 2b (§32).

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

### 18. Links between notes and search

**Chosen:** Link to note opens a searchable list of other notes. Selected words become the link;
without a selection, the app inserts the target's title and a space. That wording stays as written
even if the target is renamed. Tapping a note link saves first and opens it; Back returns to the
previous note. A cursor inside a link offers Open and Remove link in the formatting pop-up. A
trashed target explains how to restore it, and a missing target says it no longer exists. “Linked
from” shows the live notes that point here. Search ignores case and accents, requires all typed
words, works together with folder/tag filters, and is remembered on Back. Trash is not searched.
**Why:** Notes can connect without copying their contents, and finding them should be forgiving
about Spanish accents. Existing save protection also applies when following a link.
**Lock-in: low.** Links are ordinary HTML with a note id; search scans the notebook in memory.

### 19. Phase 1 closeout: what the review changed

**Chosen:** Before Phase 1 was called done, Codex read the whole diff against the plan. Its one
serious finding was fixed: on Android, the editor sometimes holds a deletion for a fraction of a
second, and an app update reloading in exactly that moment would have saved the text from before
the deletion. Every save now asks the editor to hand over anything it is still holding. Two
backup details also changed: the "keep my storage" answer is no longer copied between devices
through backups, and a backup cannot contain ids the app would refuse to open. One finding was
kept as it was and written down: deleting a folder does not move the notes that were in it to
the top of the list, because you did not edit those notes.
**Why:** A second reader finds what the author no longer sees. The review cost nothing but
Codex usage.
**Lock-in: none.**

---

## Phase 2: the formatting layer (planned and approved 2026-10-17)

The decisions in `docs/PHASE-2-DIRECTION.md` that could lock the app in, hardest to undo first.
Three terms: an **attribute** is a label inside an HTML tag, such as `data-callout="tip"`; the
**schema version** is the number saying which layout the stored data and backup files use;
**base64** is a standard way of writing binary data (such as a picture) as letters and digits.

### 20. Images are stored apart from the note text and pointed to by an id

**Chosen:** each image is stored once in its own table in the phone's storage. The note holds
only a placeholder tag with the image's id (`<img data-file="…">`), never the picture itself and
never a web address.
**Why:** autosave rewrites the whole note every couple of seconds while you type; a note with
3 MB of picture inside would be rewritten each time. The same image can appear in two notes. And
the brief rules out the browser's temporary picture addresses, which stop working after a reload.
**What it leads to:** a note's HTML on its own doesn't contain the picture. Anything that reads
notes (Claude in Phase 3, files on the XPS in Phase 4) needs the image table too. Backups carry
both.
**Not chosen:** the picture written into the note's HTML as text (each note self-contained, but
every autosave and search handles megabytes).
**Lock-in: high.** Every note with an image relies on it; changing later means converting them.

### 21. Images are shrunk when added; the original is not kept

**Chosen (your answer):** long side at most 2,560 pixels, saved as WebP (a compressed image
format, smaller than JPEG at the same quality); GIFs become still images.
**Why:** a phone screenshot drops from 1–3 MB to roughly 200–500 KB with its text still
readable, and 2,560 is about the largest size Claude reads in full.
**What it leads to:** backups stay manageable. Detail beyond 2,560 px is gone for good for that
image. A later "keep originals" setting would help new images only.
**Not chosen:** keeping originals (backups grow about five times faster).
**Lock-in: high for each image** (it can't be un-shrunk), low for the rule.

### 22. The schema version also covers what notes can contain

**Chosen** (from Codex's review): the version number moves not only when storage changes but
whenever notes can hold something new: version 2 in step 2a (new settings), 3 in 2c (highlight
colours, line spacing, callouts, divider styles), 4 in 2e (images). An app that finds newer data
than it understands opens it read-only instead of editing it, and refuses a newer backup.
**Why:** Codex showed that an editor which doesn't know a kind of content silently deletes it the
next time it saves that note: an older copy of the app (another window, or an old installation on
another device fed a new backup) would erase images or callouts.
**What it leads to:** three small upgrades of your stored data instead of one. Two of them change
nothing but the number. You export a backup before each (2a, 2c, 2e). A backup from a newer
version can't go into an older app until that app updates.
**Not chosen:** one version for the whole phase (the first draft: fewer upgrades, but builds in
the middle of the phase could damage later content); building every new kind of content into
step 2a (safe too, but delays the toolbar work you care most about).
**Lock-in: low**, and it is the rule for every later phase too.

### 23. Images go inside the same single backup file, written as text

**Chosen:** the backup stays one `.json` file. Each image's bytes are written in **base64**, a
standard way of spelling binary data with letters and digits, which makes them about a third
bigger. Only images that notes actually use are included.
**Why:** export, the safety download before import, the preview and the confirmation all keep
working as now. One file to keep or move.
**What it leads to:** backups grow with images: 100 shrunk screenshots is about 30–65 MB. How
large a backup the phone handles comfortably will be measured in step 2e and written down;
beyond that, a zip-style backup would be the next step.
**Not chosen:** a zip with image files beside the notes (smaller, but a new format, a library,
and two kinds of backup); leaving images out of backups (they'd be lost with the phone).
**Lock-in: medium.** Today's backups stay readable forever; a zip format would be added, not
swapped in.

### 24. New kinds of formatting are written into the notes' HTML

**Chosen:** highlight colours as `<mark data-color="#fde68a">`; sizes in points
(`font-size: 17pt`); typeface as one of three families every device has (serif, sans-serif,
monospace); line spacing on whole lines (`<p style="line-height: 1.5">`); callouts as
`<div data-callout="tip">`, allowed only at the top level of a note (not inside lists, quotes or
other callouts); divider styles as `<hr data-style="dashed">`.
**Why:** standard, readable HTML that Claude and other apps understand. Phase 1 notes need no
conversion: a plain highlight stays yellow and a plain divider stays thin.
**What it leads to:** once notes contain these, any future editor or converter must understand
them. Changing how one is written later (say, callouts) means converting stored notes.
**Not chosen:** sizes in pixels (your words were points); spacing on individual words (it can't
make lines tighter); callout icons stored as emoji in the text (search and Claude would treat
them as words); callouts inside lists (harder to edit on a phone and to keep consistent).
**Lock-in: medium.**

### 25. Named styles are snapshots

**Chosen:** tapping a style writes ordinary formatting into the text. The text does not remember
which style it came from.
**Why:** the brief's choice: simple and predictable, and notes stay plain HTML.
**What it leads to:** if you change "Heading" to blue later, old headings stay green; restyle
them by tapping the style again or with the painter. Deleting a style never changes a note.
**Not chosen:** linked styles like Word's, where editing a style updates every use. That needs
the style's name stored in every styled piece of text, and an edited or deleted style can
silently change old notes.
**Lock-in: medium.** Switching to linked styles later couldn't find text styled before the
switch.

### 26. Unused images are deleted after 30 days

**Chosen** (changed after Codex's review): when the app starts, an image no note uses (including
notes in Trash) is marked "unused since today". If it is still unused 30 days later, it is
deleted. If it is used again (Undo, or pasted into another note), the mark is cleared.
**Why:** otherwise every deleted or replaced picture takes space forever. The first draft deleted
after one day, which could remove a picture that Undo in another window still needed.
**What it leads to:** deleted pictures take space for a month, the same as notes in Trash. After
that only a backup has them.
**Not chosen:** never deleting (storage grows without limit); deleting quickly (breaks Undo).
**Lock-in: low**, but it deletes data, which is why it is slow and tested.

### 27. Replacing the notebook stops other windows from saving over it

**Chosen** (from Codex's review): importing a backup gives the notebook a new internal marker.
Any other open window of the app notices before its next save, refuses to save, and asks you to
reload.
**Why:** without it, a note still waiting to save in a second tab could overwrite the notebook
you just restored.
**What it leads to:** after an import, other tabs show "The notebook was replaced in another
window. Reload." Two windows editing the same note normally is still "last save wins", as now;
on the phone you'll almost always have one window.
**Lock-in: none.**

### 28. Applying a style or the painter replaces the previous look

**Chosen:** within the text being styled, earlier bold, italics, colours and sizes are cleared,
then the style's are applied. Links are kept; inline code is left alone.
**Why:** the result always looks like the style, whatever was there before.
**Not chosen:** adding on top (an italic word stays italic inside a non-italic heading style).
**Lock-in: low.** It only decides what one tap does.

### 29. Everything you customise is a setting that travels in backups

**Chosen:** the toolbar, its layout, the pop-up, both colour lists and the named styles are
settings, each named in the backup's allow-list and checked on import. A broken or unknown
setting in a backup is skipped with a warning; it never stops your notes being restored.
**Why:** a restore brings your editor back exactly, and the explicit list keeps the Phase 3 API
key out.
**What it leads to:** importing a backup that predates these settings resets them to the
defaults (the confirmation says so). Settings you never touch follow the app's defaults as they
improve.
**Not chosen:** settings kept per device (you'd rebuild the toolbar after every restore).
**Lock-in: low.**

### 30. Smaller choices, all easy to change

- **Four fixed callout types** (Note, Tip, Warning, Important), your choice. Adding a type later
  is easy; renaming or removing one means mapping existing callouts. Lock-in: low to medium.
- **Colour order is yours; no "recent colours first".** Colours are snapshots too: editing a
  palette colour doesn't change old text. A "recent" row could be added later.
- **Toolbar layouts split by screen width:** the order decides what fits; the rest goes behind
  ⋯ More. Not chosen: placing each button in a chosen row (more control, fiddlier settings).
- **Pickers open as a tray above the toolbar**, not a window, so the keyboard stays open and the
  selection survives. Android Back closes a tray (and, newly, any dialog) before leaving the
  screen. The link picker stays a window because it has a search box.
- **Reordering with arrows, plus Move to top / bottom**, as in Folders today. Dragging on a phone
  fights with scrolling and needs a long-press, and the good library for it isn't finished; it
  can be added later if you miss it.
- **The S Pen is a precise finger:** no separate behaviour, all buttons finger-sized. If Chrome
  reports pen hover, a button's name appears while the pen hovers over it; long-press shows it
  with either.
- **The painter copies the look of words** (bold, colour, size, typeface, highlight), not
  heading level or line spacing, which styles cover. It applies when you tap Apply, once.
- **Phase 3 consequence:** whole-notebook questions should send text only, with a marker where
  each image is, and images only for questions about one note. Claude counts input in *tokens*
  (a token is roughly three-quarters of a word). One shrunk screenshot is about 4,000 tokens,
  about 1.6 cents per question on Opus 5.5; the text of 40 notes is about 25,000 tokens, about
  10 cents. Decided in Phase 3.

### 31. Step 2a: what changed and what you'll notice

**Chosen:** the first Phase 2 step adds safety rules, not features. Your stored notes move to
schema version 2 (nothing in them changes). If an older copy of the app ever opens a notebook a
newer copy has upgraded, it shows "This notebook was updated by a newer version of the app.
Reload to update." and refuses to edit, import or export until reloaded. After you import a
backup, any other open tab of the app shows "The notebook was replaced in another window.
Reload." and saves nothing more. If the app can't open your notes at start, it says they have
not been deleted, instead of showing an empty list. Backups now include the settings Phase 2
will let you change; a backup's broken setting only produces a warning, never a refused import.
The colour lists exist already (12 text colours, 8 highlights) but have no screen yet.
**What you'll notice:** Settings shows "Schema version: 2" and app version 0.2.0. The import
confirmation adds "Your toolbar, colours and styles will be replaced by the backup's."
**Lock-in: none** beyond §22.

### 32. Step 2b: your toolbar and pop-up

**Chosen:** Settings → Formatting has two screens, **Toolbar** and **Selection pop-up**. Each
lists its buttons in order: ↑ and ↓ move a button one place; ⋮ offers Move to top, Move to bottom
and Remove; **Add buttons** lists everything available by group; **Reset** returns to the
defaults. Changes apply immediately. The toolbar screen also picks the layout (one swiping row,
two rows, or one row + ⋯ More) and shows a live preview; in the two layouts with ⋯ More, a line
in the list shows where the More panel starts. The selection pop-up shows at most two rows and
also uses ⋯ More beyond that (instead of the planned sideways scroll, so both behave the same).
Long-pressing any formatting button shows its name instead of applying it. Android Back now
closes an open panel, sheet or confirmation before it leaves the screen.
**Why:** the first thing you asked Phase 2 for. ⋯ More keeps the keyboard open and your
selection in place, because it is a panel above the toolbar rather than a separate window.
**Lock-in: none.** All of it is settings and app behaviour; nothing is written into notes.

