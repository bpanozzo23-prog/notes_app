# Phase 2 direction — the formatting layer

Approved by the owner on 2026-10-17. This is the contract for Phase 2; `docs/BRIEF.md` remains
the product contract above it, `DECISIONS.md` records why, and `docs/DECISIONS-EXPLAINED.md`
§20–30 explain the lock-in decisions in plain language. Claude Code drafted it, Codex reviewed it
read-only (xhigh), and Codex implements each step from it. Corrections from that review are
marked *(Codex)*.


## Context

Phase 1 is complete and deployed (0.1.1): folders, tags, pins, links, search, Trash, backup,
offline install. Phase 2 makes the editor the owner's own, the main reason the project exists
(BRIEF §1). The toolbar has been data since Phase 1 (`src/editor/actions.js`: a registry of
actions plus a stored list of ids), but only the bottom toolbar reads a preference; the
selection pop-up uses a constant, colours are four fixed buttons, highlight has one colour, and
font size is in the HTML vocabulary with no button. Images need a durable storage design
(BRIEF §9).

The owner starts the notebook fresh (2026-10-17): no Samsung Notes import, and images cover new
images only.

## Owner decisions (2026-10-17, asked before drafting)

- **Toolbar shape:** the owner chooses in Settings: one swiping row, two rows, or one row + More.
- **Colours:** a starter set of text and highlight colours the owner reorders and hides, plus
  custom colours added with the phone's colour picker.
- **Named styles** set bold/italic/underline/strike, text colour, highlight, font size,
  **typeface, line spacing, and optionally make the line a real heading**. With no selection a
  style applies to the **whole line** (the paragraph the cursor is in).
- **Format painter** switches off after one apply.
- **Callouts:** four fixed types.
- **"Page-break line"** means **divider styles** (thin, thick, dashed, dotted), not a print
  page break.
- **Images are shrunk** on the way in (long edge ≤ 2,560 px, compressed).

## Rules that protect the notes

These cut across every step.

1. **The schema version covers the HTML vocabulary** *(Codex)*. Any build that can open or
   import data at schema N must preserve everything a schema-N build can write; an editor
   without a node drops that content on its next save (Codex reproduced images and callouts
   being lost this way). So the schema version moves whenever notes can contain something new,
   not only when tables change: **v2 in 2a** (new preferences), **v3 in 2c** (highlight
   colours, line spacing, callouts, divider styles), **v4 in 2e** (images). Older builds refuse
   newer backups ("newer than this app"), as Phase 1 already does.
2. **A build never writes to a newer database** *(Codex)*. From 2a, after opening, a build
   compares the database's actual version (`db.verno`) with its own `SCHEMA_VERSION`. If the
   database is newer, the app opens **read-only**: notes can be read; editing, import, export
   (an older build would mislabel newer data) and every other write are disabled; a banner says
   "This notebook was updated by a newer version of the app. Reload to update." (Dexie otherwise
   reopens a newer database silently and lets the old code write.) Reloading the published app
   always fetches the newest build, so this state is temporary.
3. **`versionchange`** (another window is upgrading the database) *(Codex)*: a synchronous
   handler returns `false` (so Dexie does not close behind our back), locks editing at once,
   flushes the save queue, then closes the connection and shows "The app was updated in another
   window. Reload to keep editing." If the flush fails, the connection stays open (the upgrade
   waits as "blocked") and **Not saved** with Retry stays visible. Phase 1 builds lack this
   handler and can keep writing after an upgrade, so the phone checklist for 2a says: close
   every other tab or window of the app before updating.
4. **Replacing the notebook invalidates other windows** *(Codex)*. A device-local preference
   `notebookGeneration` (never exported, never cleared by import) changes inside the import
   transaction. Each window remembers the generation it loaded; every write transaction (notes,
   folders, files, preferences) checks it and refuses on a mismatch, and the window locks with
   "The notebook was replaced in another window. Reload." A `BroadcastChannel` message tells
   other windows to lock at once. (Web Locks would need HTTPS, and the phone's dev URL is plain
   HTTP.) Ordinary edits of one note in two windows stay last-write-wins, as in Phase 1.
5. **A failed open or upgrade is never shown as an empty notebook.** The boot error says the
   notes have not been deleted and to reload. (Today a boot failure shows a generic error over
   an empty list.)
6. **Derived data is derived, never trusted.** File references are computed from note HTML
   wherever they are needed (save, export, validation, import, cleanup); they are not stored.

## Shape of Phase 2

### Data

```
notes:      id, updatedAt, deletedAt, *tags, *linkedIds      (unchanged)
folders:    id, position
tombstones: id
prefs:      key
files:      id                                                (new in v4, step 2e)
```

- Dexie declares every version explicitly: `version(1)` as today; `version(2)` and `version(3)`
  with no store changes (identity upgrades: the version moves because of rule 1); `version(4)`
  adds `files: "id"`. No data is rewritten by any of them.
- **File row:** `{ id, type, bytes: ArrayBuffer, size, width, height, createdAt, unusedSince }`.
  `type` is `image/webp`, `image/jpeg`, `image/png` or `image/gif`. The bytes and their
  metadata never change after creation; only `unusedSince` (cleanup bookkeeping) does. An
  `ArrayBuffer` clones the same way in every browser and in fake-indexeddb and converts directly
  to base64.
- **References:** `extractFileIds(html)` (in `src/lib/text.js`, the same attribute parsing as
  `extractNoteLinks`) lists the `data-file` ids of a note's `<img>` tags. Not stored, not
  indexed.
- **Unused images are cleaned up slowly** *(Codex: age since creation does not protect Undo)*.
  At app start (after `purgeExpired`, in a window that is not read-only), one transaction over
  `notes` and `files`: a file that no note references (live or in Trash) gets `unusedSince =
  now` if it has none; a referenced file has `unusedSince` cleared; a file unreferenced since
  **more than 30 days** is deleted. The clock starts when the file is first seen unused, not
  when it was created. An image deleted from a note in one window and brought back with Undo
  (history depth is 100 steps) or cut and pasted into another note is referenced again long
  before 30 days pass. A Trash note's images stay until the note is purged, then 30 more days.

### Preferences: what is customisable and how it is stored

All Phase 2 preferences are defined in step 2a, so later steps add only UI. They are **exported
in backups** (the allow-list in `src/db/backup.js` grows) and validated on import and on read;
each has a code default. A missing preference means "use the default", so owners who never
customise get future default improvements; once customised, the stored value is authoritative.
Device-local keys (`notebookGeneration`, the Phase 3 API key) stay out by construction.

| Key | Shape | Default |
|---|---|---|
| `toolbar` (exists) | action ids, ≤ 100, safe strings ≤ 100 chars | `DEFAULT_TOOLBAR` |
| `toolbarLayout` | `"scroll"` \| `"rows"` \| `"more"` | `"scroll"` |
| `selectionMenu` | action ids, ≤ 40 | `DEFAULT_SELECTION_MENU` |
| `textColors` | `[{ color: "#rrggbb", name, hidden, custom }]`, ≤ 60, unique colours | starter text palette |
| `highlightColors` | same shape | starter highlight palette |
| `namedStyles` | `[{ id, name, look, block, lineHeight }]`, ≤ 50 | one example style |

- `look` = `{ bold, italic, underline, strike: boolean, color: hex|null, highlight: hex|null,
  fontSize: "<6–72>pt"|null, fontFamily: "serif"|"sans-serif"|"monospace"|null }`.
  `block` = `null` (leave the line's type alone) | `"paragraph"` | `"h1"` | `"h2"` | `"h3"`.
  `lineHeight` = `null` | `"1"` | `"1.15"` | `"1.5"` | `"2"`. Names: trimmed, 1–40 characters,
  no control characters. Hex colours: lower-case `#rrggbb`.
- Default style: the owner's example, "Heading": 17 pt, bold, underline, green, `block: "h2"`.
- **Cosmetic preferences never block a restore** *(Codex)*. In a v2+ backup, an invalid value
  for a known key is a **warning** and the default is used; an unknown key is a warning and is
  ignored (never written). The v1 validator stays exactly as it is. The 1→2 upgrade keeps a v1
  `toolbar`; entries beyond the new limits are dropped with a warning.
- Unknown action ids in `toolbar`/`selectionMenu` (from a newer build, or a deleted style) are
  kept in storage, skipped when rendering, and listed in Settings as "Unavailable button" with
  Remove. Deleting a named style removes its `style:<id>` entries from both lists in the same
  write.
- **Import replaces these preferences.** A backup that lacks one resets it to the default (a v1
  backup still carries `toolbar`); the import confirmation says "Your toolbar, colours and
  styles will be replaced by the backup's."

### The action registry (the toolbar is data, extended)

`src/editor/actions.js` keeps the Phase 1 shape (`{ id, label, icon, kind, run(ctx),
isActive(editor) }`) and gains `resolveAction(id, formatting)`, which returns the action for a
fixed id, builds one for a parameterised id, and returns `null` for anything unknown.
`formatting` is the resolved palettes and styles. Every action also has a `group` for the Add
sheet. Chains are still built per tap inside `run` (Phase 1 spike rule).

- **Fixed ids, unchanged meaning:** `bold italic underline strike h1 h2 bulletList orderedList
  taskList blockquote hr link clearFormatting undo redo`, `color:none`.
- **`highlight`** toggles the first visible highlight colour (yellow by default). A Phase 1
  plain `<mark>` counts as highlighted: it shows `highlight` as active and the first tap removes
  it *(Codex: `toggleHighlight({ color })` otherwise adds a colour to it)*. If every highlight
  colour is hidden, `highlight` uses the first starter colour.
- **New fixed ids:** `h3`; pickers `textColor`, `highlightColor`, `fontSize`, `fontFamily`,
  `lineHeight`, `styles`, `callout`, `divider`; tools `painter`, `image`.
- **Parameterised ids:** `color:#rrggbb` (the existing four keep working), `highlight:#rrggbb`,
  `highlight:none`, `style:<styleId>`, `callout:note|tip|warning|important`,
  `hr:thick|dashed|dotted` (`hr` stays the thin divider).
- Icons: colour ids show a swatch (exists); highlight ids a swatch behind a highlighter mark;
  `style:` ids "Aa" drawn in the style's colour, weight and underline, labelled with its name;
  callouts a small tinted box; dividers a line drawn in that style.

### Toolbar, selection pop-up and trays

- **Layouts** (`toolbarLayout`): `scroll` = one row that swipes sideways (as now); `rows` =
  wraps into at most two rows, and whatever doesn't fit goes behind a **⋯ More** button in the
  last slot; `more` = one row with ⋯ More for the overflow. The split is computed from the
  toolbar's measured width (`ResizeObserver`), so the order alone decides what is visible, and a
  wider screen (the Surface) shows more. No second row appears if one is enough.
- **Trays.** Pickers and the More overflow open a **tray**: a panel attached directly above the
  bottom toolbar, not a modal dialog. Tray buttons use the existing `onPointerDown`
  `preventDefault`, so focus stays in the editor, **the keyboard stays open, and the selection
  is kept**. A tray is at most 40 % of the visible viewport's height (`visualViewport`) and
  scrolls inside *(Codex)*. One tray at a time; tapping its button again, choosing an option,
  Escape or **Android Back** closes it. Picker actions in the selection pop-up open the same
  tray. The link picker stays a dialog: it has a search box, which needs the keyboard.
- **Android Back closes overlays first** *(Codex)*: with a tray, sheet or dialog open, Back
  closes it and the screen stays, using the navigation controller's existing "return after a
  failed Back" path (`history.go(1)`). This also fixes Phase 1's dialogs, which Back currently
  leaves behind.
- **Labels.** Long-press (500 ms) on a toolbar, pop-up or tray button shows its name in a small
  bubble and suppresses that tap's action; the timer is cancelled by moving more than 10 px,
  `pointercancel` or lifting early *(Codex)*. As an optional extra, an S Pen hovering over a
  button shows the same bubble, if Chrome reports pen hover. Mouse hover uses `title`.
- **Selection pop-up** renders `selectionMenu` (fixing the Phase 1 gap where it ignored
  preferences). At most two rows; more buttons scroll sideways within the second row
  *(Codex)*. Settings warns past one row (about 8 buttons at phone width). Two contextual
  additions come first: **Apply format** while the painter is armed, and **View / Delete**
  instead of formatting when an image is selected.

### Colours, size, typeface, line spacing

- **Palettes.** Starter text palette of 12 colours: the current four first (red `#dc2626`, green
  `#15803d`, blue `#2563eb`, purple `#7c3aed`), then eight more, each with ≥ 4.5:1 contrast on
  white. Starter highlight palette of 8 light colours, yellow first. The `textColor` and
  `highlightColor` trays show the visible colours in the owner's order plus "No colour". Any
  colour can also be its own toolbar button (`color:#…`, `highlight:#…`).
- **Manual order only.** No recent-colours ordering: BRIEF §9 already gives manual order
  precedence, and the owner chose to order the palettes. BRIEF §4/§5 are amended.
- **Colours are snapshots** in the note: the hex value is written into the HTML, so editing or
  hiding a palette colour never changes existing text.
- **Highlight colours:** `Highlight.configure({ multicolor: true })` →
  `<mark data-color="#fde68a" style="background-color: …">`. A plain `<mark>` still parses and
  shows the default yellow.
- **Font size** in points, matching the owner's words and the existing `17pt` sample:
  `<span style="font-size: 17pt">` (TextStyleKit, already in the vocabulary). The `fontSize`
  tray offers Normal, 10, 12, 14, 17, 20, 24, 28 pt, each label drawn at its size (capped for
  display); styles accept any whole number from 6 to 72.
- **Typeface:** Default, Serif, Sans-serif, Monospace: generic families every device has, so
  nothing is downloaded and it works offline (TextStyleKit `font-family`, already in the
  vocabulary).
- **Line spacing belongs to whole lines.** A small `LineSpacing` extension adds a `lineHeight`
  attribute to paragraphs and headings (`<p style="line-height: 1.5">`) with its own commands,
  `setLineSpacing` / `unsetLineSpacing`, because TextStyleKit already owns `setLineHeight`
  (which writes a span) *(Codex)*. Setting or clearing spacing on a line also removes any older
  inline span `line-height` inside it; otherwise an inline `2` would override a new block `1`.
  Inline line-height still parses and is left alone until then. Choices: Default, 1, 1.15,
  1.5, 2.

### Named styles and the format painter

Both use one helper, `src/editor/look.js`: `captureLook(state)` and
`applyLook(editor, look, { block, lineHeight })`.

- **Snapshot, not link** (BRIEF §9): applying a style writes ordinary formatting into the note.
  Editing or deleting the style later changes nothing already written.
- **What gets styled:** the selection if there is one; otherwise the **whole line** the cursor
  is in; in an empty line, the formatting is set for what is typed next.
- **Replace, not add:** within that range, the formatting marks (bold, italic, underline,
  strike, highlight, text style) are removed and the look's marks applied, so the result looks
  like the style whatever was there before. **Links are kept. Inline code and code blocks are
  skipped entirely** (Tiptap's code mark excludes every other mark), and the rest of the range
  is still styled *(Codex)*.
- **Whole-line parts:** `block` and `lineHeight` apply to every line the range touches. Where a
  line can't become a heading (the first paragraph of a list item), the type change is skipped
  and the rest still applies.
- One tap = one undo step; the selection is unchanged afterwards.
- **Capturing a look** *(Codex)*: from the cursor, the stored marks or the marks at the cursor;
  from a selection, the marks of its first text character outside code. Normalised before use:
  `rgb()` colours → `#rrggbb`; `px` sizes → whole points (rounded, clamped 6–72); a font family
  is kept only if it is one of the three generics; a span `background-color` becomes the look's
  highlight; anything else (such as inline line-height) is dropped. The style editor shows the
  captured result before saving, so nothing invalid or surprising is stored.
- **Styles UI:** a `styles` tray lists the styles, each drawn in its own look, plus **Save this
  look as a style…**, which opens the style editor prefilled from `captureLook`. Any style can
  be its own button (`style:<id>`); the style editor's "Button in the toolbar" switch adds or
  removes it.
- **Format painter** (`painter`): tap Painter with the cursor or a selection in the source text
  → it copies that spot's look (not the line type or spacing) and shows as pressed. Select the
  target text, then tap **Apply format** in the selection pop-up (or Painter again). It applies
  once and switches off. Tapping Painter with nothing selected while armed cancels; leaving the
  note also cancels. It never applies when a selection ends: on a phone the selection changes
  continuously while its handles are dragged, so auto-apply would hit a half-made selection.

### Callouts and divider styles (new HTML vocabulary, schema v3)

- **Callouts live only at the top level of a note** *(Codex: `block+` alone allows nesting)*.
  The callout node is not in the `block` group; `Document` is extended to
  `content: "(block | callout)+"`, and the callout's own content is `block+`. So a callout can
  hold paragraphs, headings, lists, quotes, dividers and images, and the schema itself makes a
  callout inside a callout, list or quote impossible. Pasted nested callouts are re-placed by
  ProseMirror's parser without losing text (tested).
- HTML: `<div data-callout="note|tip|warning|important">…</div>`. Fixed types: Note (blue), Tip
  (green), Warning (amber), Important (red). The icon and tint come from CSS on `data-callout`,
  not from text in the note, so search and Claude see the words and the type name, not an emoji.
  An unknown type parses as `note`. The node is not `isolating`.
- **`toggleCallout(type)`:** selection inside one callout: same type → unwrap, other type →
  change type. Otherwise wrap the top-level blocks the selection touches in one callout; a
  touched callout's contents are merged into the new one. **Enter** on an empty last line leaves
  the callout; Enter on an empty middle line splits it in two with a plain line between;
  **Backspace** at the start of its first line moves that line out (ProseMirror defaults for a
  non-isolating wrapper; each tested). Toolbar: `callout:<type>` buttons and a `callout` tray.
- **Divider styles:** StarterKit's horizontal rule is replaced by
  `@tiptap/extension-horizontal-rule` extended with `style`: thin (the default, written as plain
  `<hr>` so Phase 1 notes are unchanged), thick, dashed, dotted (`<hr data-style="dashed">`).
  Unknown styles parse as thin. With a divider selected (tap it), a divider action changes its
  style instead of inserting another. `---` still makes a thin divider.

### Images (schema v4)

- **Ways in:** the `image` action opens a hidden `<input type="file" accept="image/*" multiple>`
  (Android offers camera, gallery and files); pasting image files; dropping files (desktop).
  Pasted HTML with `<img src="https://…">` from web pages is dropped: the only accepted form is
  `img[data-file]`, so the app never fetches from the network or stores a web address in a note.
- **Processing** (`src/lib/images.js`, one image at a time) *(Codex)*: read the dimensions from
  the file header before decoding and refuse anything over 100 megapixels; decode with
  `createImageBitmap` (camera rotation applied), using its resize options so the full-size image
  is never held in memory where the browser supports them; scale so the long edge is ≤ 2,560 px;
  draw on a white background; encode WebP 0.85 and **check the blob's actual type**, because
  browsers that can't encode WebP silently return PNG. If it isn't WebP, encode JPEG 0.85; a
  null result is a failure. Close bitmaps as soon as they're used. Keep the original bytes
  instead only for a JPEG, PNG or WebP already within 2,560 px and smaller than the re-encoded
  result. GIFs always become a still image (animation is not supported). Refuse anything over
  10 MB after processing, and anything the browser can't decode, with "This image can't be used
  here". The same type, size and dimension limits apply to images in an imported backup.
- **Tracked insertion** *(Codex)*: decoding and storing take time, so each insertion is a
  **pending operation** registered with the save queue (`queue.track(promise)`): while one is in
  flight the save status is pending, and `flush()` (Back, note links, reload for an update,
  export, import) waits for it after the existing before-flush drain. The insertion point is a
  placeholder decoration that maps through edits made meanwhile (ProseMirror's upload-placeholder
  pattern), bound to the editor and note it started in; if its spot was deleted, the image goes
  at the end of the note. Several images are independent: each that succeeds is inserted in
  order, and each that fails says why. The file row is written before the node is inserted; a
  row left unreferenced by a failure is handled by cleanup.
- **Image node:** block-level, atomic, selectable; attributes `file` (required; an `<img>`
  without it is dropped), `width`, `height`, `alt` (empty for now). Its HTML is `<img
  data-file="<id>" width height alt>` with **no `src` ever**. The on-screen node view sets `src`
  to an object URL made from the stored bytes (`src/editor/fileUrls.js`: a cache with reference
  counts, revoked when the last view of a file unmounts, cleared after an import), and
  `width`/`height` reserve the space so the page doesn't jump. Images show at full note width
  (never larger than their own size). A missing file shows an "Image not found" box and keeps
  the node, so a later import can restore it.
- **Using images:** tap selects (outlined); the pop-up offers **View** (full-screen viewer: fit
  to screen, or actual size with scrolling) and **Delete**. Undo brings a deleted image back
  while the note is open. Copying an image between notes copies the reference, which cleanup
  counts.
- **Text projection:** images add nothing to `text`, so search ignores them.
- **Settings** shows "Images: N, X MB" and the browser's storage estimate
  (`navigator.storage.estimate()`).

### Settings screens at phone width

Settings gains a **Formatting** group with four rows, each a sub-screen with Back: Toolbar,
Selection pop-up, Colours, Named styles. Changes save immediately (no Save button), except the
style editor, which is a form with Save and Cancel. The navigation allow-list (`SCREENS` in
`src/lib/navigation.js`) gains the sub-screens; an unknown one restores to Settings.

```
← Toolbar                              ← Named styles
Layout  (•) One row, swipe             Heading        ↑ ↓ ⋮     ← each name drawn
        ( ) Two rows                   Vocab word     ↑ ↓ ⋮       in its own look
        ( ) One row + More             [ + New style ]
Preview [B][I][U][▮][●][H1][•][⋯]
In your toolbar                        ── style editor (full-screen sheet) ──
 B  Bold              ↑  ↓  ⋮          Name      [ Heading          ]
 I  Italic            ↑  ↓  ⋮          Preview   Heading
 …                                     Text      [B] [I] [U] [S]
 ── below this line: in ⋯ More ──      Colour    none ● ● ● ● ●
 …                                     Highlight none ▮ ▮ ▮ ▮
[ + Add buttons ]  [ Reset ]           Size      Normal 10 12 14 [17] 20 …
                                       Typeface  Default Serif Sans Mono
← Colours      [ Text | Highlight ]    Spacing   Default 1 1.15 1.5 2
 ●  Red         ↑ ↓  Hide  ⋮           Line      Leave · Paragraph · H1 H2 H3
 ●  Green       ↑ ↓  Hide  ⋮           [x] Button in the toolbar
 ○  Grey (hidden)                      [Delete]          [Cancel] [Save]
[ + Add a colour ]  [ Reset ]
```

- **Reordering** uses the Folders pattern (↑/↓ buttons), plus **Move to top** and **Move to
  bottom** in each row's ⋮ menu for long distances (new buttons arrive at the bottom). No drag
  library: on a phone, dragging competes with scrolling and needs a long-press, and the
  maintained library (`@dnd-kit/react`) is pre-1.0. Taps work the same with a finger and the
  S Pen. ⋮ also holds Remove (toolbar) or Delete (custom colours; styles, with confirmation).
- **Rows stay compact** *(Codex)*: names truncate to one line, and style previews are capped at
  the size of a heading, so a 72 pt or 40-character style can't swamp the list.
- **Add buttons** opens the existing `Dialog` as a sheet, grouped: Text, Colours (the two colour
  menus and each palette colour), Size & font, Lines & blocks (headings, lists, quote,
  callouts, dividers, spacing), Named styles, Insert (link, image), Tools (painter, clear
  formatting, undo, redo). Buttons already in the list show "Added"; the editor doesn't create
  duplicates (stored duplicates still render, as today).
- **Preview** is a live strip at the real width; in `rows`/`more` layouts a line in the list
  marks where ⋯ More begins.
- **Add a colour:** a name, the native colour picker (`<input type="color">`), and sample text
  shown in that colour or highlight.
- **Reset** (per screen) restores the defaults after a confirmation.

### S Pen and finger

No separate code path. Shared tap handlers serve both. Chrome on Android delivers S Pen taps as
pointer and click events, like a finger, though pen and touch events are not identical in every
detail *(Codex)*, so the long-press timer cancels on movement and `pointercancel` for both.
Touch targets stay at least 40 px, the finger size. Pen hover labels are an optional extra.
Nothing depends on telling pen and finger apart, and the phone check covers both.

### Backup and restore

- The backup stays **one JSON file** with the same envelope; v2 adds the new preference keys, v3
  only raises the version (new HTML vocabulary), and v4 adds `files: [{ id, type, size, width,
  height, createdAt, data }]`, where `data` is the bytes in **base64** (binary written as plain
  text so it fits in JSON). Export, the before-import safety download, preview and
  confirmation work as in Phase 1.
- **Upgrades** are pure functions, one version at a time: 1→2 keeps a valid `toolbar` and adds
  nothing else; 2→3 changes only the number; 3→4 adds `files: []`.
- **References come from HTML** *(Codex)*: validation derives each note's file references from
  its HTML (including Trash) before any check. A reference to a missing file is a **warning**
  (the note shows "Image not found"); a file no note references is skipped with a warning.
  Export writes only referenced files.
- **validateV4 file checks:** `id` safe and unique across all tables; `type` in the allow-list;
  `data` valid base64 whose decoded length equals `size`; the same size and dimension limits as
  insertion; `createdAt` canonical. Import sets `unusedSince: null`.
- **Memory** *(Codex)*: export reads `files` in the same transaction as the other tables and
  assembles the download as a `Blob` from parts, one per image, never one giant string.
  Validation and upgrade never copy image data (no `structuredClone` of the files array). Import
  parses once, decodes one image at a time, and writes everything in the existing
  all-or-nothing transaction. If storage runs out mid-import, the old notebook stays intact
  (tested with a failing write). Export is never refused for size: the app doesn't block saving
  a notebook it let the owner create.
- **Size:** text is tiny (the whole sample notebook is a few KB). A shrunk screenshot is about
  200–500 KB, about 0.27–0.67 MB in the backup after base64, so 100 images ≈ 30–65 MB. **The
  practical ceiling is measured, not assumed** *(Codex)*: in 2e, export and import a generated
  notebook of 100 and 300 images on the phone, record the result in `DECISIONS.md`, and show a
  gentle warning in Settings above the measured comfortable size.

### Phase 3 impact: "the whole notebook in one request"

Current Claude models accept 1 million input tokens and images up to about 2,576 px on the long
edge, at roughly width × height / 750 tokens, up to about 4,800 per image. A shrunk screenshot
(≈ 1,180 × 2,560) costs ≈ 4,000 tokens, ≈ $0.016 on Opus 5.5 ($4 per million input tokens). The
text of 40 notes is ≈ 25,000 tokens (≈ $0.10 a question). Sending 100 images with every question
adds ≈ 400,000 tokens (≈ $1.60 a question). **Recommendation for Phase 3** (recorded in BRIEF §9;
decided then): whole-notebook questions send text with an `[image]` marker where images sit;
images go only when asking about one note or chosen images. Phase 3 still checks the
per-request image limits and resizes if a model needs it; Phase 2's storage doesn't promise
images are request-ready *(Codex)*.

## Not in Phase 2

- "Collect" (several separate selections at once): stays Tier 4.
- Recent-first colour ordering; per-folder or per-note toolbars; several toolbar sets.
- Owner-defined callout types; print page breaks or PDF export.
- Image resizing, cropping, captions, side-by-side images, images inside a line of text, alt
  text editing, keeping full-size originals, animated images; downloaded web fonts.
- Drag-to-reorder; pick-and-place "Move…".
- New typing shortcuts beyond Phase 1's (`## `, `- `, `[] `, `---`); keyboard shortcuts for
  styles.
- Styles that stay linked to their definition; dark mode; share-sheet target; Samsung Notes
  import; a zip backup format; conflict detection between two windows editing the same note.

## Who does what (unchanged from Phase 1)

**Codex implements; Claude directs and reviews; the owner verifies on the phone.** Per step,
Claude writes a self-contained task in the scratchpad and runs `codex exec --sandbox
workspace-write -C ~/code/notes_app` in the background (Codex's configured model). Claude installs
any npm packages first (the sandbox has no network), reads Codex's report and the diff, runs
`npm test`, `npm run build` and `npm run shots`, looks at the PNGs, fixes small things or sends
Codex back (`codex exec resume --last`), then commits and pushes `main`. **Plan approval is the
"ask" for those per-step commits and pushes.** Each step ends with tests and build green,
`DECISIONS.md` entries with absolute dates, a plain-language section in
`docs/DECISIONS-EXPLAINED.md`, README status, shots extended for new screens, the sample
notebook generator extended for new content, the version bumped, and a short phone checklist.
The agent says what it did not see.

Packages: `@tiptap/extension-horizontal-rule@3.32.0` (already present as a StarterKit
dependency; added to `package.json` in 2c so the import is explicit). No image or drag library.

## Files

```
src/version.js                      SCHEMA_VERSION 2 → 3 → 4
src/db/db.js                        versions 1–4, files store (v4), newer-database guard,
                                    versionchange handler, generation check for writes
src/db/files.js                     addImageFile, getFile, cleanup (unusedSince)
src/db/notes.js, folders.js         writes go through the generation check
src/db/backup.js                    v2–v4 validators and upgrades, files, preference keys,
                                    Blob-part export
src/lib/text.js                     extractFileIds
src/lib/base64.js                   ArrayBuffer ⇄ base64, chunked
src/lib/images.js                   header dimensions, decode, shrink, encode
src/lib/saveQueue.js                track(promise) for pending image operations
src/editor/formatting.js            preference defaults and validators (shared by Settings and
                                    backup), starter palettes, stored prefs → formatting object
src/editor/actions.js               registry, resolveAction, groups
src/editor/look.js                  captureLook, applyLook (styles and painter)
src/editor/nodes/                   Callout.js, Divider.js, LineSpacing.js, Image.js (+ node view,
                                    upload placeholder)
src/editor/extensions.js            the above; Document content; multicolour Highlight; samples
src/editor/Toolbar.jsx              layouts, ⋯ More, labels
src/editor/Tray.jsx                 colour, size, typeface, spacing, styles, callout, divider, More
src/editor/SelectionMenu.jsx        selectionMenu pref, row cap, Apply format, image View/Delete
src/editor/ImageViewer.jsx, fileUrls.js
src/screens/settings/               ActionListEditor.jsx (toolbar + pop-up), ToolbarSettings.jsx,
                                    PopupSettings.jsx, ColourSettings.jsx, StyleSettings.jsx,
                                    StyleEditor.jsx (also opened from the styles tray)
src/screens/Settings.jsx            Formatting group, image count and size, storage estimate
src/lib/navigation.js               sub-screens; Back closes an open overlay first
src/App.jsx                         resolved formatting passed down; cleanup at boot; boot-failure,
                                    read-only and replaced-notebook banners
scripts/make-sample-notebook.mjs    schema bump each time; callouts, dividers, highlight colours,
                                    sizes, a custom toolbar and a style (2c/2d); a made-up
                                    generated PNG (2e)
scripts/screenshot.mjs              new screens and editor states; a 375 px context and a
                                    reduced-height (keyboard open) context *(Codex)*
```

## Steps

Each step: Codex implements → Claude reviews, tests, builds, shoots, commits, pushes → owner
checks the published app. A step that adds content to the vocabulary adds it to the sample
notebook in the same step, never before. **Before a step that changes the schema (2a, 2c, 2e),
the owner exports a backup on the published app and closes other tabs of it.**

1. **2a — Guards and preferences** (schema 2, app 0.2.0). Rules 2–5 above (newer-database
   read-only mode, `versionchange`, `notebookGeneration` with `BroadcastChannel`, boot-failure
   message); backup v2 with every Phase 2 preference key; `formatting.js` validators and
   defaults; `resolveAction`; the selection pop-up reads `selectionMenu`. Nothing new to see
   but "Schema version: 2". Tests: upgrade from a seeded v1 database keeps every note; a build
   opening a newer database is read-only (no writes, no import or export); a write after another window's
   import is refused; `versionchange` with a failing flush keeps the connection; every
   validator branch, including warnings for cosmetic preferences.
   *Phone:* after updating, all notes present and Settings shows schema 2; export, then import
   that file; import the pre-update backup ("will be upgraded").
2. **2b — Customise the toolbar and the pop-up** (0.2.1). Layout modes and ⋯ More, trays,
   Android Back closing overlays, labels, `h3`, Settings → Formatting → Toolbar and Selection
   pop-up (reorder, Add sheet, Remove, Reset, live preview).
   *Phone:* each layout above the keyboard (Samsung Keyboard and Gboard); the keyboard stays
   open while a tray is open; Back closes a tray and a dialog without leaving the note;
   long-press label; reorder with finger and S Pen; settings survive export/import.
3. **2c — Colours and new formatting** (schema 3, 0.2.2). Palettes and the Colours screen with
   custom colours; text and highlight colour trays; multicolour highlight (with plain `<mark>`
   compatibility); font size, typeface and line spacing trays; callouts; divider styles.
   *Phone:* the native colour picker; highlights in several colours; removing a Phase 1
   highlight; sizes mid-word while typing; Enter twice leaves a callout; Backspace at a
   callout's start; changing a divider's style; swipe typing inside a callout.
4. **2d — Named styles and the format painter** (0.2.3). `look.js`, the styles tray, style
   buttons, Named styles screen and style editor, "Save this look as a style", painter.
   *Phone:* a style on a selection, on a line with no selection, on an empty line then typing;
   undo; a heading style inside a list; a selection containing inline code; painter copied from
   the cursor and applied from the pop-up; editing a style leaves old text unchanged.
5. **2e — Images** (schema 4, 0.2.4). `files` table, tracked insertion, processing, node view,
   viewer, Delete, missing-file box, cleanup, image counts and storage estimate, backups with
   images, the size measurement, sample notebook image, shots of a note with an image.
   *Phone:* camera and gallery insert; a camera photo appears the right way up; paste a
   screenshot from the Samsung Keyboard and Gboard clipboards (Chrome may not hand keyboard
   images to web pages; the button is the guaranteed path); Back immediately after choosing a
   photo; export/import with images, compare; airplane mode shows images; delete then undo; the
   100/300-image backup measurement.
6. **2f — Closeout.** Codex reviews `git diff phase-2-base...HEAD` read-only (xhigh) against
   this document (`phase-2-base` = a local tag on the commit that adds this file); fixes;
   README status; `DECISIONS-EXPLAINED.md` brought up to date; BRIEF amendments checked.

## BRIEF amendments (in the commit that adds this file)

Strikethrough plus replacement, as the BRIEF asks: §2 "the owner may migrate them or start
fresh" → starts fresh (2026-10-17); §4 and §5 Tier 2 "recent-first is the default" / "recent
colours first" → manual order chosen by the owner; §5 Tier 2 adds divider styles; §9 Phase 2
note gains "the schema version covers the HTML vocabulary"; §9 Phase 3 note gains the image
numbers and the text-only recommendation above.

## Noted for later phases

- **Phase 3:** whole-notebook questions send text with `[image]` markers; images on demand,
  checked against the model's per-request limits. Empty `alt` attributes could be filled by
  Claude later, with approval.
- **Phase 4:** files are immutable and referenced by id, so sync copies each once; cleanup must
  then respect the other device's references before deleting.

## Verification

- `npm test` (Vitest, jsdom, fake-indexeddb, fixtures only), with **semantic** assertions
  *(Codex: today's round-trip test only checks that a tag or style attribute exists)*: every new
  attribute and value survives editor → save → reopen → export → import (highlight colour,
  divider style, callout type, line spacing, size, typeface); unknown values sanitise as
  specified. Plus: schema upgrades from seeded v1/v2/v3 databases; read-only mode on a newer
  database; generation check across an import; `versionchange` with a failing flush; backup
  upgrades 1→4 and each validator branch; image bytes identical after a round trip (separately
  from metadata); references derived from HTML when stored data disagrees; cleanup (unused mark,
  re-use clears it, deletion after 30 days, Trash references kept, delete → other window starts
  → undo, cut → paste between notes); preference validators and fallbacks; `resolveAction` for
  every id form; `applyLook` (selection, whole line, empty line, replace semantics, links kept,
  code skipped, heading in a list skipped, one undo step); painter arm/apply/cancel; legacy
  highlight toggle and all-hidden fallback; line spacing tighter than legacy inline spacing;
  callout wrap/unwrap/type change/merge, Enter and Backspace cases, pasted nested callouts keep
  text; divider style change; image HTML never contains `src` or `blob:`; a pending image
  operation delays `flush()`; toolbar split for given widths.
- `npm run build` after every step.
- `npm run shots` after every step, at 412 px, 375 px and a reduced keyboard-open height, PNGs
  read before reporting: Formatting group, Toolbar, Pop-up, Colours, Named styles, style
  editor, each toolbar layout, an open tray, callouts and dividers, a note with an image, the
  image viewer.
- Owner on the published app, with each step's checklist above. The agent cannot see Samsung
  Keyboard, Gboard, the S Pen, the camera, downloads or a real update.

