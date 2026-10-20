# Decisions, explained

The plain-language companion to `DECISIONS.md`. That file is the terse, dated record for agents;
this one is for the owner: what was chosen, why, what it means for the app, what was not chosen,
and how hard it would be to reverse ("lock-in"). Ordered by lock-in, hardest first. Updated whenever
`DECISIONS.md` gains an entry with consequences for how the app behaves.

Last updated 2026-10-20, at step 4c (§77).

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
**Refined in Phase 3 (2026-10-18):** the app now shows an estimate before sending and the
reported cost after each answer, with a monthly total for this phone; the console's spend limit
is still the real cap. See §38–50.

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

### 33. Step 2c: colours, sizes, callouts and dividers

**Chosen:** Settings → Formatting → **Colours** lists your text colours and highlight colours
(two tabs). Reorder them with ↑ ↓ and ⋮, **Hide** the ones you don't use, and **Add a colour**
with the phone's colour picker; your own colours can also be deleted. The **text colour** and
**highlight colour** buttons open a panel with your visible colours in your order. New panels
also give **font size** (in points), **typeface** (default, serif, sans-serif, monospace) and
**line spacing** (whole lines only). **Callout** wraps the lines you're on in a tinted box: Note,
Tip, Warning or Important; tap it again to remove the box. Inside a callout, Enter on an empty
line leaves it, and a callout can't be put inside a list, a quote or another callout. **Divider**
offers thin, thick, dashed and dotted lines; tap an existing divider, then choose a style, to
change it. Highlights and dividers from before this step look exactly as they did.
**What you'll notice:** if you never changed the toolbar (or you tap Reset), it now includes
the colour, highlight and size menus and Callout. A toolbar you customised in 2b is kept as it is;
add the new buttons from Add buttons if you want them. Your notes move to schema version 3, so
an older copy of the app opens them read-only until it updates.
**Lock-in:** as §24: these are now written into notes' HTML.

### 34. Step 2d: named styles and the format painter

**Chosen:** the **Styles** button opens a panel listing your named styles, each drawn in its own
look; tap one to apply it. With text selected it styles the selection; with nothing selected it
styles the whole line; on an empty line, what you type next comes out in that style. Applying a
style replaces the earlier look of that text (bold, italics, colours, size, typeface), keeps
links, and leaves code alone. A style can also make the line a heading and set its spacing; a
style whose spacing is "Default" sets the line back to normal spacing. One Undo removes the whole
change. Settings → Formatting → **Named styles** creates, edits, reorders and deletes styles; the
editor has a "Button in the toolbar" switch that gives a style its own button. **Save this look
as a style…** at the bottom of the Styles panel starts a new style from the text at the cursor.
The **format painter** copies the look where the cursor is; a bar says "Format copied. Select
text, then tap Apply format." Select the target text and tap **Apply format** in the pop-up; it
applies once and switches off. Cancel or tapping the painter with nothing selected stops it.
**What you'll notice:** two example styles come with the sample notebook only; your own notebook
starts with the "Heading" example (17 pt, bold, underline, green, as a heading). If you never
customised the toolbar, Styles and the painter appear after the size button.
**Lock-in:** as §25 and §28: styles are snapshots, and applying one replaces the earlier look.

### 35. Step 2e: images

**Chosen:** add a picture with the **Image** button (add it from Toolbar → Add buttons; the
phone offers the camera, the gallery or files), by pasting one, or on a computer by dropping
one. The app shrinks it (at most 2,560 pixels on the long side), keeps it in the app's own
storage, and the note holds only a reference to it. While it works you see "Adding image…";
you can keep typing, and Back or an update waits until the picture is in place and saved. Tap
an image to select it: **View** opens it full screen (fit, or actual size you can scroll), and
**Delete** removes it from the note (Undo brings it back while the note is open). An image no
note uses any more is kept for 30 days, then deleted when the app starts. Backups include the
images your notes use, inside the same single file. Settings shows how many images you have,
their size, and how much storage the app uses.
**What changed during review:** each image's small details (size, dates) are kept apart from
the picture itself, so starting the app and opening Settings never read the pictures. Without
this, a few hundred images would have slowed every start.
**What you'll notice:** pasting from the Samsung Keyboard or Gboard clipboard may or may not
reach the app, depending on Chrome; the Image button always works. Pictures from web pages
pasted as part of text are dropped (the app never downloads anything). Your notes move to
schema version 4.
**Lock-in:** as §20, §21, §23 and §26.

### 36. One Heading button

**Chosen (your request):** a **Heading** button (an H) opens a small panel with Normal text,
Heading 1, Heading 2 and Heading 3, each shown at its size, with the current one marked. It
replaces the separate Heading 1 and Heading 2 buttons in the default toolbar. Your own toolbar
isn't changed automatically: in Settings → Formatting → Toolbar, tap **Add buttons** → Heading,
then remove Heading 1 and Heading 2 with ⋮ → Remove. The separate buttons stay available if you
ever want one back.
**Lock-in: none.**

### 37. Phase 2 closeout: what the review changed

**Chosen:** before calling Phase 2 done, Codex read every change against the plan, as it did
for Phase 1. It found two serious problems, both needing two windows of the app open at once,
which is rare on the phone: a picture being added while another window installed an update could
be stored but never placed in the note; and a picture you removed, brought back, then removed
again could be deleted before its 30 days were up. Both are fixed: the picture now finishes
going in before the update proceeds, and bringing a picture back restarts its 30 days. Four
smaller fixes: deleting a style from inside its edit screen no longer freezes the app; choosing
the heading level a line already has no longer pulls it out of a callout or list; changing line
spacing on an empty line keeps the bold, colour or size you set for typing; and Named styles has
a Reset button like the other formatting screens.
**Still open:** the big-backup timing test on the phone, which sets when Settings warns that a
backup is getting large.
**Lock-in: none.**

---

## Phase 3: Claude (planned and approved 2026-10-18)

The decisions in `docs/PHASE-3-DIRECTION.md` that could lock the app in, in the order the plan
raises them. Terms used: an **API key** is the password-like
code that lets the app use your Anthropic account and bills it; a **token** is the unit Anthropic
counts and charges (about three-quarters of an English word); a **cache** here is Anthropic
keeping the start of a request for a few minutes so a repeat costs less; a **citation** is Claude
pointing at the exact passage it used; **structured output** means Claude must answer in a fixed
form of fields the app reads; **streaming** means the answer arrives word by word instead of all at
once; a **diff** is the list of differences between two versions of a text; **`rev`** is the
counter every note carries that goes up on every save; **prompt injection** is text inside a note
(say, pasted from a web page) that tries to give Claude instructions.

### 38. Your API key lives in this browser on the phone

**Chosen:** the key you paste in Settings is stored in the app's storage on this phone and sent
only to Anthropic, in the request's header. It never goes into a backup (a backup that contains
one is refused), and it is never shown back, logged, or kept anywhere else in the app. You tick "I
have set a spend limit" each time you turn Claude on.
**Why:** no server, no account, nothing else to run. mi-cuaderno has lived with the same
arrangement since August.
**What it leads to:** anything running inside this web page could read the key. The app runs only
its own code, but if that were ever compromised, the spend limit in the Anthropic console is what
caps the damage, so set one. After restoring a backup on a new phone, you paste the key again.
**Not chosen:** a small relay server on the XPS that holds the key (the key never on the phone,
but Claude stops working whenever the XPS or Tailscale is down, and the work machine can't reach
it); typing the key each time (safe, tiresome).
**Lock-in: low.** Moving to a relay later changes one file.

### 39. Your notes go to Anthropic when you ask, the whole notebook each time

**Chosen:** a whole-notebook question sends every note outside Trash: titles, text, folders, tags
and dates, with `[image]` where pictures are. A question about one note sends that note, and its
pictures only if you tick "include images". You see what goes and the estimated cost and tap Send
first; what is sent is exactly what you were shown. Claude reads; it can't change anything by
answering.
**Why:** with 20–40 notes, sending everything is simpler and gives better answers than a search
that picks a few notes (BRIEF, 2026-10-14). You chose not to have private folders.
**What it leads to:** each question costs more as the notebook grows: about half a cent more per
extra 1,000 tokens (roughly one long note) on a first question, almost nothing on a follow-up.
Your notes are on Anthropic's servers for that request; what Anthropic keeps and for how long is
set by its API terms, worth a read once. A private-folder setting can be added later without
changing anything stored.
**Not chosen:** a search index that sends only matching notes (worth it at thousands of notes,
not 40); private folders (your choice).
**Lock-in: low.**

### 40. Claude Opus 5.5 is the model

**Chosen:** Claude Opus 5.5, Anthropic's current Opus model. It thinks before answering (you
don't see the thinking, but it is billed), at medium depth for questions and high depth for
tidying.
**Why:** it is the strongest model at its price and, in Anthropic's own notes, much less likely
to cite a source that doesn't support what it says, which is exactly the job. mi-cuaderno uses the
older Opus 5, which costs more ($5/$25 against $4/$20 per million tokens); it is not copied.
**What it leads to:** about 17¢ for a first question over 40 notes, about 5¢ for a follow-up,
10–25¢ for a tidy; roughly $15–20 a month at three questions a day. Set your spend limit with that
in mind.
**Not chosen** (same notebook, first question / follow-up):

| Model | Price in/out per million | First question | Follow-up | Trade-off |
|---|---|---|---|---|
| Opus 5.5 (chosen) | $4 / $20 | ≈ 17¢ | ≈ 5¢ | best answers and citations |
| Sonnet 5.5 | $2 / $10 | ≈ 8¢ | ≈ 2–3¢ | good, a step weaker at pulling scattered notes together |
| Haiku 5.5 | $0.10 / $0.50 | ≈ 0.4¢ | ≈ 0.1¢ | very cheap, noticeably weaker reasoning |
| Fable 5.1 | $10 / $50 | ≈ 41¢ | ≈ 10¢ | most capable; overkill for notes |

**Lock-in: none.** It is one line; the price table already holds the others. Say if you'd rather
start cheaper.
**Measured 2026-10-18:** see §56 for what real requests actually cost.

### 41. Answers cite the passages they used, and you tap through to the note

**Chosen:** each note goes to Claude as a separate "document" with Anthropic's citations switched
on. Claude's answer comes back with pointers to the exact sentences it used; the app numbers them
and lists the notes under the answer with the quoted passages. Tap one to open the note; Back
returns to the answer. A note deleted, trashed or edited since is labelled.
**Why:** Anthropic checks that the quoted text really is in that note, so the sources are not
Claude's guess at a title. That is the brief's "names the notes it drew from", made reliable.
**What it leads to:** answers are plain text (no tables or headings), and questions and tidying
are two different kinds of request, because Anthropic doesn't allow citations together with the
fixed-form replies that proposals need.
**Not chosen:** asking Claude to list note titles at the end of its answer (simpler, but it can
name a note it didn't really use, or a title that matches two notes).
**Lock-in: low.**

### 42. A conversation keeps a snapshot of your notes, and lasts until the app closes

**Chosen (your answer):** the first question takes a copy of your notes' text; follow-ups use the
same copy, so Claude stays consistent and Anthropic's cache makes each follow-up about 5¢ instead
of about 14¢. The screen says when the copy was taken. If you move one of those notes to Trash,
the conversation ends rather than sending it again. New question, or closing the app, clears the
conversation. Nothing is stored or backed up.
**Why:** edits you make between follow-ups would otherwise change what Claude sees mid-
conversation and cancel the discount. Keeping answers only in memory means copies of your notes'
contents don't pile up on the phone.
**What it leads to:** follow-ups send the notes as they were when you asked, so to include a note
you just edited (or to stop sending text you just deleted from one), start a new question. An
answer you want to keep has to be copied out by hand (a "Save answer as a note" button is easy to
add later). Caching adds about 3¢ to a question that gets no follow-up. An app update waits for
you to tap Reload while a conversation is open, and says it will clear the conversation.
**Not chosen:** re-reading the notes for each follow-up (always current, full price every time);
a stored history (your choice).
**Lock-in: none.**

### 43. You see an estimate before sending, and the reported cost after

**Chosen:** the confirmation shows "about 17¢", worked out on the phone from the length of what
is being sent and a typical length for Claude's reply. Each answer then shows what it cost,
priced from the token counts Anthropic reports for that answer, and Settings → Claude shows a
running total for the month on this phone.
**Why:** Anthropic's exact token counter is free, but it works by sending the notes, which would
break the rule that nothing leaves before you tap Send. The counts reported with each answer are
Anthropic's own.
**What it leads to:** the estimate is rounded up, and the real cost depends mostly on how long
Claude thinks, which varies. If an answer is interrupted before Anthropic reports its counts, the
app says "cost unknown". The monthly total is only this phone's view; the Anthropic console is
the real record and the real limit.
**Not chosen:** an exact count before sending (sends your notes first); no cost display (the app
couldn't tell you what a question cost).
**Lock-in: none.**

### 44. Claude proposes a whole new version; the app works out and checks the differences

**Chosen:** to tidy a note, Claude sends back the complete tidied note. The app runs it through
the editor's own rules (anything the editor doesn't support is unwrapped to plain text or
dropped), then checks it again on its own: pictures and links are referred to by short labels
(`I1`, `N12`) that the app handed out, so Claude can't invent a picture or point a link at a note
that doesn't exist, and anything else is removed. Then it compares the result with your note
paragraph by paragraph and shows each difference as a numbered change, listing any picture or
link that change removes or redirects.
**Why:** what you approve is exactly what gets saved, and the app, not Claude, decides what
counts as a change: Claude can't slip in an edit the review doesn't show.
**What it leads to:** the reply repeats the whole note, so a tidy costs about 10–15¢ (most of it
Claude's writing). Very long notes cost proportionally more.
**Not chosen:** Claude listing edit instructions ("replace paragraph 3 with…"): shorter replies,
but numbering mistakes would apply edits in the wrong place, and the review would show Claude's
description of a change rather than the change itself.
**Lock-in: low.**

### 45. You approve change by change; every change starts ticked

**Chosen:** the review stacks Before above After for each change, at phone width, with a line
listing changed words ("tu → tú") or what formatting changed ("now a bulleted list"). Each
change, and each title, tag or folder suggestion, has its own tick. A change covers one whole
paragraph, list or callout: if a list gains a fixed word and loses a picture, both are listed on
that one change and go together. All start ticked; you untick what you don't want; the button
says how many changes will be applied. You can edit a suggested title before applying. Merges and
splits are approved as a whole.
**Why:** "approve all except these two" is the common case, and the count on the button means
nothing is applied without you seeing how much.
**What it leads to:** tapping Apply without reading applies everything ticked; the review is the
safeguard, so it has to be read. Undo covers mistakes (§47).
**Not chosen:** all unticked (forces a tap per change; tedious for a note with ten accent
fixes); a tick for every word or picture inside a paragraph (finer control, much fiddlier at
phone width); side-by-side Before | After (too narrow on a phone).
**Lock-in: none.**

### 46. A change is applied only if nothing changed since Claude read it, and all at once

**Chosen:** when you tap Apply, the app checks, inside a single save, that every note involved
still has the `rev` Claude saw (for a merge, also the notes whose links it updates). If any of
them changed, nothing is saved and you're asked to ask again. Otherwise all the ticked changes
are saved together: if anything fails partway, none of them are.
**Why:** this is what `rev` was added for in Phase 1. Without the check, a suggestion based on an
old version would overwrite what you wrote since.
**What it leads to:** editing a note while a proposal waits makes that proposal unusable; ask
again (about 10¢). Pinning a note also counts as a change for this check. If you leave the review
while Claude works, nothing jumps screens when the proposal arrives; a bar offers Review.
**Not chosen:** merging Claude's suggestion into your newer text (clever, and a source of
surprising results).
**Lock-in: none.**

### 47. Undo for Claude's last change, even after closing the app

**Chosen:** before applying, the app saves a full copy of each note it changes. **Undo Claude's
last change** puts them back. If you edited one of those notes after Claude's change, Undo doesn't
overwrite your edit: it offers to restore the earlier versions as new notes marked "(before
Claude)". Notes a split created go to Trash rather than being deleted. Pictures the copies
contain are kept for as long as Undo is possible. Only the most recent Claude change can be undone
this way, and importing a backup clears it.
**Why:** the editor's own Undo doesn't reach changes made from another screen, and a mistaken
Apply should be cheap to reverse.
**What it leads to:** one level of undo. For older changes, a backup or the Trash (merged notes
stay there 30 days) is the way back. Export a backup before the first tidy.
**Not chosen:** a full version history for every note (a new table and a schema change, and
copies of every version kept forever).
**Lock-in: low.**

### 48. Merging keeps the first note and puts the others in Trash

**Chosen:** a merge writes the combined text into the first note of the group (so links to it
keep working) and moves the other notes to Trash (you have 30 days to restore them). Notes that
linked to a trashed one are listed in the review and updated to point at the merged note.
Splitting creates the new notes and leaves a "Split into:" line of links in the original.
**Why:** nothing is permanently deleted, and links don't break.
**What it leads to:** the merged note keeps the first note's creation date and identity; the
others' history stays in Trash until it empties itself. Updating those links doesn't move the
linking notes to the top of your list, since you didn't edit them.
**Not chosen:** creating a fresh note and trashing all sources (every incoming link would need
rewriting, and the merged note would look brand new).
**Lock-in: low.** It only decides what one merge does.

### 49. Answers are shown as plain text, and the app never acts on what Claude writes

**Chosen:** answers appear as plain text with line breaks and simple bullet lists. No web links
you can tap, no pictures, nothing loaded from anywhere. Proposed changes are shown and checked
before anything is saved, and a new web link Claude adds shows its full address.
**Why:** a note can contain text pasted from the web that tries to give Claude instructions. If
the app turned Claude's words into links or pictures, such text could make the app quietly send
your notes somewhere. Showing plain text closes that door.
**What it leads to:** a web address in an answer has to be copied by hand. Answers look plainer
than Claude's usual formatting.
**Not chosen:** full formatted answers (nicer to read, and a door left open).
**Lock-in: none.**

### 50. Smaller choices, all easy to change

- **Fallback when Claude declines:** if Opus 5.5's safety checks refuse a question (unlikely for
  notes), Anthropic quietly retries it on another Claude model in the same request, and the answer
  says which model answered. Your notes still only go to Anthropic. One switch turns it off; say
  if you'd rather see "Claude declined" instead.
- **Anthropic's own code library** (the "SDK") makes the requests, instead of hand-written
  requests as in mi-cuaderno: it handles answers arriving word by word, retries when Anthropic is
  busy, and clear error types. It loads when Claude is turned on, not at every app start.
- **Test key costs nothing:** it uses Anthropic's free token counter with the word "Hi". It says
  "works", "rejected", or "couldn't check" (for example when offline).
- **One request at a time:** while Claude answers, Send stays disabled until it finishes or you
  tap Cancel.
- **No schema change:** nothing new is stored in notes or backups, so no upgrade and no backup
  needed before updating (one is still wise before the first tidy).
- **Follow-ups are capped at ten** per conversation, so a long conversation can't quietly grow
  expensive.
- **What Claude may not do:** delete notes or folders, rename folders, or touch your toolbar,
  colours or styles.

### 51. Step 3a: turning Claude on

**Chosen:** Settings has a new **Claude** row (Off or On). Its screen explains what Claude does
and the risk of keeping the key in the browser. To turn Claude on you tick "I have set a monthly
spend limit in the Anthropic console" (a link takes you there), paste your key into the
**Anthropic API key** field, and tap **Save key and turn on**. The field empties itself and the
key is never shown again. When Claude is on: **Test key** checks the key with Anthropic's free
token counter ("The key works.", "Anthropic rejected this key." or "Couldn't check the key: …");
**Turn off** keeps the key, so turning on again needs only the tick; **Remove key** deletes it
after a confirmation. A running total for this month on this phone starts at $0.00.
**Behind the scenes:** the app now has the code that talks to Anthropic and turns its errors into
plain sentences, and the rules that keep the key out of backups, the screen and logs (tests plant
a fake key everywhere it could leak and check it never appears). An app update can no longer
reload over a Claude conversation (there are none yet; they arrive in 3b). A backup file that
contains a key is refused.
**What you'll notice:** only the new Settings screen; nothing is sent to Anthropic except Test
key, which costs nothing. App version 0.3.0; schema version stays 4.
**Lock-in: none** beyond §38.

### 52. Step 3b: asking Claude about your notes

**Chosen:** with Claude on, the notes list has an **Ask Claude** button (a sparkle) and each note
has a **Claude** button with **Ask about this note**. Type a question and tap Send; before anything
leaves the phone, a box shows the question, how many notes go and what kinds of information,
that images and Trash are not sent, and the estimated tokens and cost. Send there sends exactly
that. While Claude works you see "Claude is thinking… 12 s", then the answer appears as it is
written; **Cancel** stops it. Under the answer, **Sources** lists the notes it used with the
quoted passages, numbered to match small numbers in the answer; tap one to open the note, Back
returns. A note changed, moved to Trash or deleted since is labelled. Each answer shows its cost
and the model, and the cost is added to this month's total in Settings → Claude. Follow-ups show
their estimate on the Send button and cost much less while Claude still has your notes cached (a
few minutes). A question about one note can include its pictures if you tick the box. Answers
stay until you tap New question or close the app.
**What you'll notice:** the first real question is the time to compare the cost the app shows
with the Anthropic console's usage page. The sample notebook gained five made-up notes (spelling
mistakes, near-duplicates, unlinked mentions, an untagged note) for the tidy steps.
**Lock-in: none** beyond §39–43.

### 53. Creation and edit dates (your request)

**Chosen:** every note ends with a small grey line, "Created 3 Oct 2026 · Edited today, 14:02"
(a note you never changed shows only when it was created). In the notes list, each note's grey
line now includes when it was last edited: "Español · 16 Oct" (a time for today, day and month
for this year, the year too for older notes).
**Why:** the app has recorded both dates since Phase 1 but never showed them. The end of the
note keeps the top free for typing; in the list, the date explains the order, which is already
most recently edited first.
**What "edited" means:** changing the note's text, title, folder or tags. Pinning, and
housekeeping such as a deleted folder, don't change it. From step 3c, applying a change Claude
proposed counts as an edit.
**Lock-in: none.** Nothing new is stored.

### 54. Step 3c: Claude tidies one note, with your approval

**Chosen:** in a note, the Claude button now also offers **Tidy this note**, with an optional
instruction ("fix my accents", "make this a list"; leave it blank and Claude fixes mistakes and
makes the formatting consistent, changing as little as possible). A confirmation box says what
goes (this note's text, formatting, title, folder and tags; your folder names, tags and the
titles of your other notes; no images, no Trash) and the estimated cost. Claude's suggestion
opens on **Review Claude's changes**: each changed paragraph, list or callout is a numbered
change with Before above After, a "Words" line for small fixes ("tu → tú") or what the
formatting became ("now a bulleted list"), and anything it does to a picture or link. A new title,
tags or folder are rows of their own; you can edit the title. Everything starts ticked; untick
what you don't want and tap **Apply N changes**. If the note changed since Claude read it,
nothing is applied and you're asked to ask again. **Undo** appears right after applying and in
Settings → Claude; if you've edited the note since, it offers to restore the earlier version as a
new note "(before Claude)" instead of overwriting your edit. If you leave while Claude works, a
bar at the top says "Claude's proposal is ready · Review"; nothing jumps screens on its own.
**What changed during review:** opening a note Claude had just tidied quietly re-saved it,
because the editor adds an empty line after a list or heading at the end of a note and Claude's
version didn't have it; that made the note look edited and stopped a clean Undo. The app now
adds that line the same way the editor does, and a test checks the two always agree.
**What you'll notice:** applied changes count as an edit (the note moves to the top of the list
with today's date). Undo puts the note back exactly, including its old edit date.
**Lock-in:** as §44–47.

### 55. Your notes as text, for other apps and AI tools (your request)

**Chosen:** Settings → Backup has **Export notes as text**: one readable file (`.md`, plain text
with headings) of every note outside Trash, grouped by folder, each with its title, tags and
dates, and its text with headings, lists and links kept and `[image]` where pictures are. It's
small enough to paste or upload into claude.ai or any chat app, or to send me through Taildrop.
Each note also has a **Copy as text** button (next to pin) that copies that one note the same
way. Neither sends anything anywhere: the file downloads, the copy goes to your clipboard.
**Why:** the backup file works but is full of web-page code and pictures written as text; this is
the same tidy text the app already sends Claude when you ask a question.
**What it leads to:** once exported or copied, the text is outside the app's protections, so
treat it like any copy of your notes. It isn't a backup: it can't be imported, has no pictures or
settings, and doesn't change "Last backup".
**Lock-in: none.**

### 56. What Claude actually costs, measured

**Measured (2026-10-18)** with my own test key on the made-up sample notebook (18 short notes),
not your notes: a question across all the notes cost **6¢**, a follow-up a minute later **2¢**
(Anthropic's cache worked: the notes were read back at a twentieth of the price), and tidying a
short note **2¢**. The costs the app showed matched Anthropic's own counts.
**What it changes:** the estimate shown before you send is now based on these measurements. It
had been counting the size of your notes too low: turning on citations (so Claude can point at
the exact sentences it used) makes Anthropic split every note into sentences, which roughly
doubles what a question costs to send. As a rule of thumb, a first question costs about **half a
cent per 1,000 characters of notes** (a long note is a few thousand characters), plus about 2¢
for the answer; follow-ups cost a fraction of that. The cost shown after each answer was always
exact; only the before-sending estimate changes.
**How it's checked from now on:** I can rerun this check with the test key whenever the Claude
features change (about 10¢ a run, within the $1-per-step allowance).
**Lock-in: none.**

### 57. Step 3d: titles, tags and folders across the notebook

**Chosen:** the Ask screen has **Tidy the notebook → Titles, tags and folders**. Claude reads
every note outside Trash (text, title, folder, tags; no pictures) and suggests better titles where
a note has none or a vague one, tags (reusing yours where they fit) and folders (preferring your
existing ones; a new folder only when several notes clearly belong together). It never changes a
note's text and never deletes or renames folders. The review shows one card per note with Claude's
reason and a tick per suggestion (title, folder, tags), all ticked to start; the title can be
edited; **Untick this note** and **Untick all** help. Apply saves everything ticked at once, or
nothing if any of those notes changed since Claude read them.
**Undo, changed from the plan:** if you edit one of the affected notes afterwards, Undo offers
**Undo the N unchanged notes**: it puts back the notes you haven't touched since and leaves your
edited ones as they are, naming them. (The plan's "restore earlier versions as new notes" would
have copied every note just to undo a few tags.) When Claude changed a note's text (a tidy), Undo
still works as in §47.
**Measured:** on the 18-note sample this cost 5.5¢, and Claude's suggestions were sensible.
**Lock-in: none.**

### 58. Step 3e: links between notes

**Chosen:** the Ask screen's **Tidy the notebook** now also offers **Links between notes**. Claude
reads every note outside Trash (titles, text and the links they already have; no pictures, folders
or tags) and suggests which notes should point to which. Claude never rewrites a note: **the app**
places each link. If the words Claude picked appear exactly once in that note, as whole words and
not inside code or an existing link, those words become the link. Otherwise the
link goes on one **"See also:"** line at the end of the note, written with the other note's title,
as the link picker does; a second run adds to that line instead of starting another. The review
shows one card per note, a tick per link (all ticked to start), which of the two it will be, and
the sentence with the linked words in bold. Apply saves the ticked links at once, or nothing if
any of the notes involved, including the ones being linked to, changed since Claude read them.
**Undo after you've edited one of the notes:** like titles, tags and folders (§57), Undo offers
**Undo the N unchanged notes** and names the ones you edited, which keep their links. Adding links
never changes your words, so a "(before Claude)" copy of an edited note would hold nothing you
haven't kept or deliberately deleted; copies would only clutter the notebook. This departs from
the plan's Undo rule, as 3d did; you approved it with the 3e plan.
**What changed during review:** in my first real test, Claude linked loose phrases that only
illustrated a topic ("el examen es" pointing at the grammar note). Claude is now told to link
words only when they name the other note or its subject, and to leave looser connections to
"See also:". The second test linked "ser y estar" to the grammar note and "Frases útiles" to that
note, and put the rest under See also.
**What you'll notice:** linked notes count as edited (they move to the top of the list). A link
to an untitled note shows its whole first line. Harmless slips in Claude's reply (a note linking
to itself, a link that already exists, the same link twice) are dropped rather than wasting the
request; more than 30 links makes the reply unusable.
**Measured:** about 5¢ on the 18-note sample; the estimate before sending said about 6¢.
**Lock-in: none.** Links are ordinary note links; delete any you don't want.

### 59. Step 3f: merging and splitting notes

**Chosen:** two new Claude actions, each approved as a whole (one Apply button, no ticks).
- **Merge.** The Ask screen's **Tidy the notebook** now offers **Find duplicates to merge**.
  Claude reads every note outside Trash and suggests groups of notes that hold the same thing
  (two copies of a list, an earlier draft). You tick which notes of a group to merge (two to five)
  and tap **Merge**. That sends a second request with only those notes in full, and Claude writes
  one combined note.
- **Split.** A note's **Claude** button now offers **Split this note**, with an optional "how". Claude
  moves parts of the note into new notes, and the app adds a **"Split into:"** line of links at
  the end of the original.

**What the merge review shows:** the whole merged note, and that the **oldest** note is the one
kept, so links to it keep working. It shows which notes go to **Trash**, restorable for 30 days.
It names which other notes link to those and will be pointed at the merged note instead.
Two lists, worked out on the phone for free:
- every line of the originals that isn't in the result word for word;
- every line Claude worded newly.

Merging is where something could be dropped quietly; these lists make it visible before you
apply. The split review shows the same lists, plus any change in formatting such as bold.

**Undo:**
- **If nothing has changed since,** Undo puts everything back. The merged note gets its earlier
  content, the merged-away notes come out of Trash, and redirected links point where they did. A
  split's original is restored and its new notes go to Trash.
- **If anything changed since,** Undo never overwrites or removes anything, and lists what it will
  do before you confirm. Notes still in Trash come back out. The merged (or split) note stays as
  you left it, and its earlier version comes back as a new note "… (before Claude)".

This departs from the plan's Undo rule, as 3d and 3e did; you approved it with the 3f plan.
Restoring some notes in place after a later change could lose words you had moved between them.

**What changed during review:**
- A reviewer read my first plan against the code before building and found the Undo holes the
  rule above closes.
- After building, I fixed one case: merging an exact duplicate, where the kept note doesn't need
  to change, was being refused. It now just moves the copy to Trash.

**What you'll notice:**
- After a merge, **Other suggested merges** goes back to Claude's list without asking again.
- A merge ends any Ask conversation that included a merged-away note, because that note is now
  in Trash.
- Don't keep the merged note open in a second tab while merging: typing there could overwrite
  the merged text (the merged-away notes would still be in Trash).

**Measured, on the 18-note sample:**
- Find duplicates about 3¢; its estimate now says about 4¢.
- A merge of two notes about 2¢.
- A split about 3¢.

**Lock-in: none.** Merged notes are ordinary notes, and Trash keeps the originals for 30 days.

### 60. Phase 3 closeout: the whole-phase review and its fixes

**Chosen:** before calling Phase 3 done, Codex read every Phase 3 change at once, without being
able to change anything, and checked it against the plan you approved. It found five problems.
It found no way for your key to leak. It found the merge/split Undo rules, the all-or-nothing
saves and the protection for pictures sound. All five are fixed, each with a test that failed
before the fix:
- **Two windows on one note can no longer overwrite each other.** This was older than Claude: if
  a note was open in two places (say the installed app and a browser tab), whichever saved last
  won, silently. Now each window remembers which version it opened. If the note changed elsewhere,
  that window's edits are saved as a new note, "… (conflict copy)", next to the other version.
  The note screen there says so, stops editing, and offers **Open the copy**. Nothing is
  overwritten; you combine them by hand if you want.
- **Nothing goes to Anthropic if a note left the notebook after you saw the Send box.** If you
  move a note to Trash, or delete it for good, between seeing "Send to Anthropic?" and tapping
  Send, nothing is sent and you're asked to review again. An ordinary edit in between still sends
  what you saw, as the plan says.
- **A tidy review now flags links that were swapped** (two links pointing to each other's notes
  with the same words). Before, this showed no warning.
- **Apply refuses to add a link to a note that was deleted for good** while the review was open.
- **"Edited since Claude read it"** now also appears after an Undo puts back an older version.

**What you'll notice:** almost certainly nothing, unless you edit one note in two places at once,
which now gives you a conflict copy instead of a silent loss.

**Lock-in: none.** A conflict copy is an ordinary note.

### 61. Visual quick wins (your request, after Phase 3)

**Chosen:** four small fixes from reading the app at phone size, the first step of the visual work.
- **Save status:** "Saved", "Saving…" or "Not saved" instead of the internal word "idle".
- **The end of the list** leaves room for the + button and the phone's gesture bar.
- **Settings:**
  - a proper **Choose a backup file…** button instead of the browser's raw file picker;
  - "Images: 1 (5 KB)";
  - "Protected from automatic clearing" instead of the technical "Persistent storage".
- **Buttons** follow three rules:
  - the action a screen or dialog exists for is filled dark (Send, Apply, Merge, Export backup,
    Save);
  - anything that deletes or replaces is red, and its final confirmation is filled red;
  - everything else stays as it was.

**Why these first:** they're small and low-risk, and they remove things that looked unfinished
or made every button look equally important.

**How visual work continues:** one area at a time, most-used screens first. For each, I show you
before/after pictures at phone size before anything is published.

**Lock-in: none.** All of this is styling and wording.

### 62. Note screen: more room to write (your request, 2026-10-19)

**Chosen:** the area above a note's text is about 95 points shorter (roughly 165 instead of 260 on
your phone). With the keyboard open, about twice as much of the note shows when you start at the
top.
- **Top row:** ← Note … Saved · Pin · Claude · **⋯**.
  - Pin moved up here. It stays one tap and stays blue when the note is pinned, so you can see it
    at a glance.
- **⋯ (Note options)** opens a small sheet with **Copy as text** and **Move to Trash…**, the two
  actions you use rarely. Trash still asks you to confirm.
- **Folder and tags share one line** ("📁 Español #spanish #vocab").
  - Tapping the tags opens a **Tags** sheet with the same tag editor as before. The keyboard is
    ready, your earlier tags are shown ready to tap, and Done closes it.
  - A note without tags shows "+ Tags".

**Why:** the tag box, "Used before" and the row of icons took about a third of the screen on
every note, and you use them far less often than you write.

**What didn't change:** saving, your data and Claude. Read-only notes still allow only Copy as
text. Android Back closes each sheet first.

**Lock-in: none.** It's layout only. Moving Pin into the ⋯ sheet, or anything back, is a small
change.

## Phase 4: your notes on the XPS (planned 2026-10-19)

The decisions in `docs/PHASE-4-DIRECTION.md` that could lock the app in. Terms used: **sync** is
the app copying your notes to the XPS on its own; **Tailscale** is the private network joining
your phone, Surface and XPS, and **Tailscale Serve** is the part that lets your devices reach a
program on the XPS over HTTPS; a **token** is a long random password the app keeps to prove it's
your phone; the **private store** is the XPS's exact copy of what your phone sent; the **view**
is the `~/notes` folder rebuilt from it for Claude Code; **git history** is a record of every
version of every file; the **generation** is a random id your notebook gets each time you import
a backup; a **tombstone** is the record a note leaves when you delete it for good; a **sandbox**
is a fence around the commands Claude Code runs; **prompt injection** is text inside a note that
tries to give Claude instructions.

### 63. One-way from the phone, plus an inbox you approve

**Chosen:** your phone keeps the one true copy. It copies your notes to the XPS by itself.
Claude Code on the XPS reads them and can only *propose* changes. Proposals appear in the app,
and you review and Apply them the way you approve Tidy, with Undo afterwards.
**Why:** you wanted Claude Code to read and change notes, with every change waiting for your
tap. Copying one way keeps the hard part simple: the XPS can never overwrite a note on the
phone.
**What it leads to:**
- The XPS is an automatic backup from the first sync.
- Changes from Claude Code land only through the same checked Apply that Phase 3 uses.
- If you edited a note after Claude Code read it, its proposal can't be applied. Claude Code's
  version stays in the XPS history, so both versions are kept.
**Not chosen:**
- Full two-way sync. It's needed for the Surface to share the notebook, and you tabled that. It
  would also need real conflict handling.
- A read-only copy. Claude Code couldn't change anything.
- Applying Claude Code's changes automatically with Undo. You chose to see changes first.
**Lock-in: medium.** Two-way sync later would build on the same store and rounds. The app's side
would change, the notes wouldn't.

### 64. Two places on the XPS, and only one is trusted

**Chosen:** the XPS keeps a **private store** of exactly what your phone sent, with its history
and daily backups. Claude Code never touches it. From it, the XPS rebuilds **`~/notes`**, a
read-only view where Claude Code reads. Claude Code can write only in its `inbox/` folder. If a
view file is ever changed, it's rewritten from the store.
**Why:** if Claude Code could edit the files backups are made from, an edit could reach your
phone through a Restore without you ever seeing it. A planning review found that hole in the
first draft.
**What it leads to:** Restore from the XPS always gives you back what your phone sent. A change
from the XPS reaches your notes only as a proposal you approve.
**Not chosen:** one folder for everything (simpler, but it had the hole above).
**Lock-in: low.** The view is rebuilt every sync, so its layout can change freely. An
Obsidian-style folder later is a small change.

### 65. Claude Code is locked down when it works on your notes

**Chosen:** a settings file in `~/notes`, and a launcher (`claude-notes`), restrict any Claude
Code session there:
- no web tools, and none of your connected accounts (Google Drive, Notion, Calendar);
- **no command line at all** (your choice, 19 October): it can only read files, search them and
  write in `inbox/`;
- it can't read your SSH keys, the test API key or the sync service's own files.

Its instructions say note text is information, never instructions.
**Why:** some notes contain text pasted from web pages. A Claude Code session that could run
commands could be talked by a hidden instruction in a note into sending your notes somewhere.
Claude Code's own command fence (its sandbox) can't start on the XPS without loosening an Ubuntu
security setting for every program there, so the commands were removed instead. Inside the
app, Claude can only propose. On the XPS, the lock-down plays that role.
**What it leads to:**
- Claude Code in `~/notes` can read, search, think and propose, nothing else. It can't run
  scripts on your notes (word counts and the like). For anything that needs the web or commands,
  use a session somewhere else.
- The launcher also leaves out your own Claude Code settings, hooks and plugins, so nothing there
  can loosen the rules by accident.
- Step 4a tests every rule in a real session before any note arrives, including with deliberately
  loose settings added.
- If the isolation can't be proven, Claude Code doesn't get the notes, and you still get the
  automatic backup.
**Not chosen:** relying on instructions alone, which a clever injection might override.
**Lock-in: none.** It's a settings file and a launcher.

### 66. Connecting your phone: a one-time code, then a token kept like your API key

**Chosen:** you run `notes-sync pair` on the XPS (or ask me to). It shows a 6-digit code for 10
minutes. You type it in Settings → Sync, and the XPS gives the app a long token. The token
behaves like your API key:
- it stays on this phone and is never in a backup (a backup containing one is refused);
- it's never shown.

The XPS keeps only a fingerprint of it. One phone is connected at a time.
**Why:** only your devices can reach the XPS at all. Even so, the token makes sure only the app
you connected can use the service, so another website, or another app on the same web address,
can't.
**What it leads to:** after restoring a backup on a new phone, you connect again with a new
code.
**Not chosen:** no token, relying on Tailscale alone; a password you'd have to remember.
**Lock-in: low.**

### 67. How a sync round stays safe

**Chosen:** each sync asks the XPS what it holds, uploads missing pictures, then sends
everything that differs in one request. The XPS handles one change at a time. It applies a
request in one go, and only if nothing changed in between. A note's revision number tells the
two sides apart. After you import a backup, the generation changes, and the XPS takes a complete
fresh copy, pictures included: an imported picture can reuse an old picture's id. A round cut
short by a freeze is finished from a journal when the XPS restarts. If you import, disconnect or
update the app during a sync, that sync stops without changing anything.
**Why:** your phone keeps no record of what it sent, so nothing can get out of step. The XPS
has frozen several times this month, and a half-written copy must be impossible.
**What it leads to:** syncing starts about 10 seconds after you stop editing, and when you open
or come back to the app. Typing never waits for it. If the XPS is off, the app says so quietly
and catches up later.
**Not chosen:** a list of sent changes kept on the phone. It's faster, but it can drift out of
step after an import or a crash.
**Lock-in: low.**

### 68. Nothing vanishes from the XPS copy without a tombstone or your OK

**Chosen:** in everyday use, a note can disappear from the XPS copy only if you deleted it for
good on the phone, which leaves a tombstone. After you import a backup, or on a newly connected
phone, the rule is stricter: any note that would be removed from the XPS copy or changed there
asks you first. Revision numbers from a different notebook can't be trusted to say which version
is newer. Identical notes and new notes pass without a question. The question offers "Restore
from the XPS instead", "Replace the XPS copy" and "Not now".
**Why:** a wiped phone, an old backup or the wrong notebook should never quietly overwrite your
good copy.
**What it leads to:** you'll see this question only after imports or on a new phone.
**Not chosen:** "ask above 5 notes or a quarter of them" (arbitrary; smaller losses would pass
silently).
**Lock-in: none.**

### 69. History is kept and never pushed anywhere, and Delete forever doesn't reach it

**Chosen:** every sync is saved in the private store's history. That history has no remote, and
the service refuses to start if one is ever added. It also refuses if Tailscale Funnel would
expose it to the public internet. Fourteen daily backups sit beside it, in the app's own format.
**Why:** being able to see any note as it was on any day is most of the value of an automatic
backup. Nothing about your notes should leave your machines.
**What it leads to:** if the XPS ever can't record history, syncing pauses with a message rather
than let a version slip through unrecorded. Your notes stay safe on the phone meanwhile.
**Delete forever on the phone doesn't erase a note from the XPS history.**
If a note ever needs wiping there, ask me; it's a manual step. Keep exporting a backup now and
then while the XPS keeps freezing, so the XPS isn't your only backup.
**Not chosen:** an encrypted copy in a cloud, which the brief rules out.
**Lock-in: low.**

### 70. The service runs from a fixed copy and restarts itself

**Chosen:** the sync service is a small program in this repo, with no extra packages. It runs
from a copy of a committed version, installed by `npm run sync-deploy`, never from the working
folder agents edit. It's a user service that restarts after a crash. **Linger**, which lets your
services run without you being logged in, starts it at boot. You can switch linger on without
sudo.
**Why:** after a freeze and reboot, half-finished code must never be what handles your notes.
Automatic login is off on the XPS, so without linger the service would stay down after every
freeze.
**Lock-in: none.**

### 71. What changes for your privacy

**Chosen and recorded in the brief (§7):**
- your notes will also sit on the XPS, whose disk isn't encrypted;
- every program running under your account there can read them;
- a Claude Code session in `~/notes` sends what it reads to Anthropic under your **Claude
  account** (your subscription), not the API terms the app uses;
- Claude Code keeps session transcripts, with note text, in `~/.claude/projects/`.

Already true and now written down: the published app shares its web address with mi-cuaderno.
Their stored data is technically readable by each other's code, and Chrome's local-network
permission covers both.
**Please check:** the "help improve Claude" (model training) setting in your Claude account.
**Lock-in: none.** Disconnecting stops new copies. The XPS copy and its history stay until
deleted.

### 72. Proposals: edits first, new notes and Trash later if you want them

**Chosen:** step 4c lets Claude Code propose changes to an existing note's title, text, tags and
folder. It writes a proposal as two files in its inbox (the new text, and a few details such as
which version of the note it read). Within seconds the XPS checks them against its private copy
and records the proposal, or refuses it with a reason Claude Code can read and fix.
Step 4d adds new notes, moving a note to Trash, and "Keep both" for a refused proposal. 4d
happens only if you ask after using 4c.
**Why:** edits reuse Phase 3's apply and Undo almost unchanged. New notes and Trash need more
new code. Using the simpler version first shows whether they're wanted.
**Lock-in: none.**

### 73. Smaller choices, all easy to change

- **Port 8443** on the XPS's Tailscale address. The health tracker keeps the main address.
- **10 seconds** of quiet before a sync, at most 60 seconds after the first change.
- **14 daily backups** kept on the XPS.
- **Chrome's local-network permission** is asked once. Tap Allow. If it was refused, Settings →
  Sync says how to allow it.
- **No Obsidian for now.** The view can be laid out for it later.
- **One connected phone at a time.** Connecting another replaces it.

### 74. The XPS service is built and installed (2026-10-19)

- **It's running.** The sync service is installed on the XPS as a user service: it starts at
  boot, restarts itself after a crash (tested by killing it), and answers only your devices on
  Tailscale port 8443. Its private copy is empty and no phone is connected yet.
- **It survives freezes.** A sync cut short is finished from its journal after a restart (tested
  by stopping it mid-sync).
- **The folder Claude Code reads** is rebuilt entirely from the private copy. If a read-only file
  in it is changed, the next sync puts it back and records the file name and time. It refuses
  folders that try to redirect its writes elsewhere.
- **Proposals** written into the inbox are captured in the history before your phone ever sees
  them. Claude Code learns within seconds whether one was accepted or refused, and why. A newer
  proposal for the same note replaces a waiting one.
- **Tested through Tailscale** with the made-up sample notebook on a temporary copy: connecting,
  refusing other websites and wrong tokens, uploading pictures, syncing 19 notes, and getting the
  backup back with identical pictures.
- **No shell in note sessions** (§65): the first real lock-down test showed Claude Code's command
  fence can't run on the XPS, so note sessions have no command line.
- The phone side (Settings → Sync) comes in 4b.

### 75. The phone's sync engine, before its controls (2026-10-20)

Run D builds the background work; run E will add Settings → Sync and its messages. Nothing
connects until a connection has been saved.

Each sync takes one consistent copy of the stored notebook. Editing stays available while
that copy travels; edits made meanwhile go in another round. Importing, disconnecting or
updating cancels old work, so a late answer cannot mix notebooks or reconnect the phone.
If replacing the XPS copy needs approval, that approval belongs to the exact copy reviewed;
another edit means asking again.

The connection token stays on the device and goes only in the request's authorization header.
Backups exclude it, and imports refuse a file containing one. Restore only prepares the
existing preview: it never replaces notes on its own. Missing pictures are reported without
preventing the notes themselves from being backed up.

Tests call the real server logic with made-up notebooks in temporary folders, without a
network connection. Phone behavior and the controls remain for run E.

### 76. Step 4b: your phone sends its notes to the XPS (0.4.0)

**What you'll see:**
- **Settings → Sync.** Run `notes-sync pair` on the XPS (or ask me) and type the 6-digit code it
  shows. Chrome asks once to let the site reach devices on your local network; tap Allow.
- **After that, syncing is automatic.** It runs about 10 seconds after you stop editing, and when
  you open the app or come back to it. Typing never waits for it. Settings → Sync shows "last
  synced …" and how many notes and pictures the XPS holds, with Sync now, Restore from the XPS
  and Disconnect.
- **Problems show as one plain sentence there,** never as a pop-up while you type. Examples:
  Tailscale is off, Chrome is blocking the connection, or the XPS no longer recognises the phone.
- **A question before anything is lost.** If a sync would remove notes from the XPS copy or
  replace them with different versions, a bar on the notes list says "The XPS copy needs your
  decision". Settings → Sync then lists the notes, with Restore from the XPS instead, Replace the
  XPS copy, or Not now. This happens after you import a backup, or on a new phone.
- **A new or wiped phone** is offered "The XPS has 43 notes. Restore them?" before it sends
  anything.

**Unchanged:** importing a file works as before (it now has a Cancel button, and Back closes the
preview). The "Your notes go to Anthropic" sentence in Claude settings now begins "From this
app", because Claude Code on the XPS is a separate path.

**Lock-in: low.** Disconnect stops it. The XPS keeps its copy and history until deleted.

### 77. Step 4c: Claude Code's suggestions on your phone, and a clearer review (0.4.1)

**What you'll see:**
- **Every Claude review looks new.** That covers Tidy, titles, tags and folders, links, and
  Claude Code's suggestions:
  - a changed paragraph shows once, with removed words struck through on red and added words on
    green;
  - **Show before and after** brings back the full formatted versions;
  - each change is one row with a tick and a short label, tags show as chips, and a new title
    shows first with "was: …" under it;
  - the Apply button stays at the bottom of the screen.
- **When a note changed after Claude read it,** an amber box says so, and its rows are greyed and
  can't be applied.
- **Claude Code's suggestions.** Run `claude-notes` on the XPS and ask it to change some notes.
  Within seconds of your next sync, the notes list says "Claude Code suggests changes to N notes
  · Review".
  - Each note gets a card with Claude Code's one-line reason and a **Dismiss** button.
  - **Apply** changes everything ticked, across notes, in one go. **Undo Claude Code's last
    change** puts it back, from the success message or Settings → Sync.
  - What you applied or dismissed goes back to the XPS, so Claude Code can see it.
- **Nothing changes on its own.** A suggestion for a note you edited since can't be applied. Its
  card shows what applying it would have undone, and Claude Code's version stays on the XPS.

**What Claude Code can suggest in 4c:** an existing note's title, text, tags and folder. New
notes, moving notes to Trash and new pictures are 4d, if you want them.

**Lock-in: none.** It's presentation, plus a review that can only apply what you tick.

### 78. Step 4d: new notes, Trash and Keep both from Claude Code (0.4.2)

**What you'll see:**
- **More kinds of suggestion.** In a `claude-notes` session, Claude Code can now suggest:
  - **a new note**, with its title, text, tags and folder. The folder can be an existing one,
    No folder, or a **new folder** by name. A new note may reuse a picture already in one of
    your notes, never a new picture;
  - **moving a note to Trash**, where it stays 30 days as usual.
- **The notes list** now says "Claude Code has 3 suggestions · Review".
- **In the review:**
  - a new note is one card with one tick: its title in green (with Edit), its folder,
    "(new folder)" if one would be created, its tags, the whole text, and where its links go;
  - a Trash move is one red "Move to Trash" row, with "Show the note" and the notes that link to
    it;
  - a new folder is created only if you tick a change that uses it.
- **Keep both.** When you edited a note after Claude Code read it, its amber card now has a
  **Keep both** button. It shows you the exact copy first: Claude Code's version, titled
  "… (from Claude Code)", in the folder your note is in. **Add as a new note** saves it beside
  your note; nothing of yours changes.
- **Undo** works as it does for split:
  - new notes go to Trash, notes moved to Trash come back, edits go back, and a folder the change
    created disappears if it's empty and still has its name;
  - if you changed anything since, nothing is overwritten. You see a list first: your later
    version stays, the earlier one comes back as a "(before Claude)" copy, and a new note you
    kept working on stays.

**Choices you made (20 October):** Claude Code picks a new note's folder; one tick per new note
and per Trash move; Undo as split does; Keep both puts the copy beside your note. New notes are
never pinned, and Claude Code still can't delete anything for good, rename or delete folders, or
add pictures.

**Safety added after Codex's two reviews:**
- **What you see is what's saved.** Keep both saves exactly the copy its sheet shows. If
  anything it depends on changed meanwhile, it asks you to look again.
- **No doubles.** The phone remembers every suggestion you've applied, kept or dismissed, so two
  open windows can't add the same note twice.
- **Old app versions are safe.** The XPS shows the new kinds of suggestion only to 0.4.2, so an
  older window can't show them as broken cards.
- **Trash stays private.** The XPS stops showing a new note's title in Claude Code's list once
  you've handled it, so a note you later moved to Trash doesn't stay readable there.

**Lock-in: none.** No change to how notes are stored; the XPS keeps every suggestion in its
history.
