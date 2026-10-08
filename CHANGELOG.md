# Changelog

## 0.2.34 — unreleased

### Map: #N and thread chips open the link popover
- A click, tap, `Enter` or `Space` on a `#N` note chip or a thread chip now opens the same popover as the globe (same classes, right of the chip, camera pans to fit, open through pan and zoom, same ways to close). Before, a `#N` chip opened a new tab straight away and a thread chip called `onThread` straight away.
- `#N` rows: `Open #N`, `Open map`, `Open details`, each with its destination's host muted (or its path when same-site); each opens a new tab with `rel="noopener noreferrer"` and fires `onNoteLink` with `open: 'note' | 'map' | 'details'`. Without a noteUri, `Open #N` only fires `onNoteLink`. No `Go to #N`: N is a note number, never a node id (removed during 0.2.34).
- Thread row: `Open thread`, which fires `onThread`.
- Each `#N` chip in a caption opens its own popover (`data-note-index`). The SVG anchor stays, so middle-click and Ctrl/Cmd/Shift-click still open the note in a new tab straight away (and fire `onNoteLink`).
- One implementation for the globe, `#N` and thread chips. New exports: `renderLinkPopRows`, `captionLinkRows`, `noteLinkRows`, `noteLinkWhere`, `threadRows`, type `LinkPopRow`. The popover carries `data-kind` (`links`, `note`, `thread`) and each row `data-row`.
- Link popover placement uses exact px (CI fonts put the globe at x.5, so the rounded gap read 8.5 px); the fitted edge is exactly 8 px inside.
- Tests: `tests/note-pop.test.ts`, `e2e/note-pop.spec.ts`, `e2e/touch-note-pop.spec.ts` (fixture `examples/e2e-touch/notes.md`); `touch-map` and `map-controls` now expect the popover for these chips. Link popover e2e waits for the camera to settle instead of sleeping.

### Links: `<r:id>` jumps, `[label](#pnid:N)` note links, typed `node.links`
- New `<r:id>` tag: a jump to the node with `<id:id>`, the tag twin of `[label](#id:id)`. Same id characters as `<id:>`; read with spaces like every tag (`<r : x>`), written in the tag group after `<thread:…>` with its spelling kept (`<r:x>` when the software adds it).
- New `[label](#pnid:N)`: a note link like `<t:N>` (digits). It stays in the caption as written; the Map gives it a `#N` chip with the same popover rows and keeps the label on the pill; `toHtml` draws it as an `of-note-link`.
- `node.links`: every link on a line, typed `{ kind: 'note' | 'jump', target, form: 'tag' | 'markdown', source, label? }` (tags in source order, then markdown links). `noteLinks` and `noteLinkTags` are unchanged. Exports `NodeLink`, `resolveJumps`, `findNodeById`, `jumpChipLabel`, `parseNoteTarget`, `markdownLinkSpans`.
- `#id:` hop targets take the `<id:>` characters only (`[A-Za-z0-9][A-Za-z0-9_-]*`; `.` and `:` used to be accepted, though no id can contain them). `clean` matches the same set and follows `<r:…>` too.
- Ids stay lazy: the parser never writes one. Session ids skip ids a jump names; `serialize` writes a session id only when a jump points at it.
- An unresolved jump or hop stays visible, muted and inert (`of-link-broken`, `.map-jump-hit.is-broken`, `data-broken` popover row).
- Map: `<r:id>` draws a `→ caption` chip (target's first line, 24 chars; `→ id` when missing). The chip, `Enter`/`Space` on it, or a hop row selects the target, unfolds its ancestors and pans to it. New `createMapView` option `onHop(id, from)`.
- Outline: `toHtml` draws `<r:id>` as `a.of-jump[data-hop-id]`; `attachOutlineTree` follows `a.of-hop` / `a.of-jump` on click, `Enter` or `Space` without a hash change (unfolds ancestors, focuses and scrolls the row) and calls the new `onHop(id, node, from)` option.

### `#N` popover: Open map and Open details
- URL templates `noteMapUri` (default `/notes/{id}/map`) and `noteDetailsUri` (default `/notes/{id}/details`), same shape as `noteUri` (`{id}` / `{pnid}`, http(s) or root-relative). Taken from the layout block or frontmatter first, then the `createMapView` option of the same name, then the default. `none` in the layout block, or `null` / `''` as an option, hides the row. `formatLayoutBlock` writes them back.
- Exports `noteUriTemplate`, `noteLinkHrefs`, `DEFAULT_NOTE_MAP_URI`, `DEFAULT_NOTE_DETAILS_URI`, types `NoteUriKey`, `NoteUriOptions`.

### Map: thread pill inside the node
- The thread pill sits in the chip row after the caption's widest line (thread, `#N`, then jump chips), inside the node, and `pillSize` reserves its width (`thread`, `jumps` options; `mapChipPieces`, `mapChipSpan`, `THREAD_CHIP_LABEL`, `THREAD_CHIP_H`). It was drawn over the node's top-right edge. Fill `--map-menu-bg`, stroke `--map-menu-stroke`, muted 11 px label; same hit target.
- A caption whose only links are `#pnid:` gets no globe badge.

### Tests
- `tests/links.test.ts`, `tests/link-templates.test.ts`, `tests/thread-pill.test.ts`, `tests/jumps-render.test.ts`; `e2e/jumps.spec.ts`, `e2e/touch-jumps.spec.ts` (fixture `examples/e2e-touch/jumps.md`, Outline via `?view=outline`); note-pop specs expect the three rows.

## 0.2.33 — 2026-10-08

### Map link popover (globe badge): restyle
- Styled by classes in `outline-fold.css` instead of inline `cssText`, in the fold-level menu's language: same surface, border, radius, shadow and 14 px `--of-font` (was 13 px monospace), 32 px rows (44 px on touch), hover and focus highlight, gold focus ring.
- New shared tokens `--map-menu-bg`, `--map-menu-stroke`, `--map-menu-hover`, `--map-menu-shadow` (dark defaults, the values the level menu already used); the level menu reads them too, so it looks the same. Neither has light-theme values yet.
- Each link is a menu row: label in the text colour, no underline, and a muted destination after it. External links show the host (`example.org`, no `www.`); same-site links show the file or folder they open (`?doc=../potholes/potholes.md` → `potholes.md`); a hop link (`#id:…`) shows only its label. Nothing is shown when the label already says it.
- `role="menu"` with `menuitem` rows (was `role="dialog"`). The first row gets focus on open; arrows, `Home` / `End`, `Enter` / `Space`; `Esc` or `Tab` closes and focus goes back to the map.
- Placed inside the map host, to the right of the globe with an 8 px gap and centred on it, so it never covers the pill's caption or the pill above. When that would cross the map's right, top or bottom edge, the camera pans just enough to bring it 8 px inside (smooth, immediate with reduced motion, zoom unchanged). It moves with the globe through pan and zoom. Was fixed to the page below the globe's left edge. New `placeLinkPop`, `LINK_POP_GAP`, `LINK_POP_INSET`.
- Closing: a tap or click outside it without a drag (anywhere on the page), `Esc`, `Tab`, or following a link; the globe's node folding away also closes it. A pan, pinch or wheel zoom keeps it open (it used to close on pan), and so does a drag that starts outside it. 180 ms fade (class `is-closing`; none with reduced motion).
- Unchanged: hop links select their node; external links open in a new tab with `rel="noopener noreferrer"`.
- New exports: `linkPopWhere`, `renderLinkPop`, `placeLinkPop`.
- Tests: `tests/link-pop.test.ts`, `e2e/link-pop.spec.ts` and `e2e/touch-link-pop.spec.ts` (fixture `examples/e2e-touch/links.md`).

## 0.2.32 — 2026-10-08

### Map handle and connectors (phases 2 and 3)
- `--map-handle-bg` (default `transparent`) fills the − ring. The + glyph uses `--map-handle-glyph-on-gold` (`#0a1f28`), so it stays opaque when `--map-bg` has alpha.
- A halo under the − ring and dash in `--map-halo`, default `--map-bg` at 85%, taken from the nearest `--map-bg`. It paints before the stem, so the stub stays 8 px.
- `--connector-casing` (default `transparent`): when a host sets it, every edge and stem gets a 3.2 px casing underneath, all casings before any line.
- `.of-theme-light`: light canvas, connector, gold and glyph tokens; connector and gold meet 3:1 in both themes.

### Fold to level
- `seedDefaultFold(doc, { rule })` and `hasSavedFold(doc)`: with no `(+)` and no `fold-` / `fold+` list, the first view is level 1 (each root and its children). `cold-start` keeps the older rule; `all` leaves it open.
- `foldLevelPicker(doc, id)`: the picker model (items, key hints, counts, current level, sameAsAll / disabled), `foldLevelNeedsConfirm` (All above 1,500 nodes), `foldLevelSkipsAnimation` (above 300 changes), live-region text.
- Tests pin L16: a level folds every node at and below the boundary, so the next + shows one level.

### Map: fold-to-level picker (spec 20261006 L1–L16, backlog P2 + P3)
- Hold a fold handle 450 ms to open Fold · 1 · 2 · 3 · All. A ring fills from 150 ms. Movement past 10 px (touch) or 4 px (mouse) before then, a second finger, or a pan or pinch cancels the hold, so drag-to-pan and the label text hold work as before. A short tap or click still toggles once; the lift that opens the menu never toggles.
- Touch: keep the finger down and slide onto an item, lift to apply. Lifting anywhere else keeps the menu open for a tap. Tiles are at least 44 px; the phone gets a 10 ms buzz where supported.
- Right-click a fold handle or a foldable pill opens the same menu (rows: Fold, Level 1, Level 2, Level 3, All, with counts and key hints). A label with selected text keeps the browser menu. `ContextMenu` or `Shift+F10` opens it for the selected node.
- In the menu: arrows (wrap, skip disabled), `Home` / `End`, `Enter` / `Space`, the hint key (`0` `1` `2` `3` `*`), `Esc` / `Tab` close and focus goes back to the map. The current level is checked; levels deeper than the branch are disabled.
- All above 1,500 nodes asks first: `Show all 1,641` / `Cancel`.
- Apply uses `setExpandLevel(doc, level, { under })` in one `setDoc`, fold state only (no id written into a caption). The handle stays in place (L10): the camera follows it, zoom does not change, and an expand pans only enough to keep the shown branch in view. FLIP is skipped above 300 changes. The result is read out in a polite `.map-live` region, e.g. "Branches folded to level 1. 11 items hidden."
- Foldable nodes carry `aria-haspopup="menu"`.
- Levels toolbar (P3, opt-in): `mountMapLevels(map, el)` or `mountMapControls(map, el, { levels: true })` adds `Levels 1 2 3 All` for the whole map, with the current level pressed. The Pages viewer shows it.
- Handle methods: `openLevelMenu`, `closeLevelMenu`, `applyFoldLevel`, `setWholeMapLevel`, `currentWholeMapLevel`, `onPaint`. Pure helpers in `foldLevelMenu` are exported.
- The menu's levels row is a `role="group"` with `data-row="levels"`; a second row (hold-to-fit Child widths) can sit beside it later.
- Not yet: the "Whole map to level ▸" menu entry (L8), an edit-menu entry (D4), undo (host).

### Map gestures
- Fix: a mouse press in the first 700 ms after page load was ignored as a touch ghost (`lastFingerDown` started at 0).

### Saved view (package side)
- New `savedView` helpers: capture, exact restore, anchored fit, slot pick, focus choice, anchor when the focus is folded away or gone, start source, live text, and the v2 localStorage record (a v1 record loads with its folds and without its camera).

### Tag spacing
- Readers are lenient for every colon tag (`<id:>`, `<t:>`, `<kind:>`, `<enc:>`, `<action:>`, `<thread:>`, `<db:>`): optional whitespace around the colon and just inside the brackets (`<id : craft-lab>`, `<t: 41609 >`). Parse, the `taskChrome` helpers, `cleanIds`, `cleanMarkdown` and `validateDocument` all read them. Bare words (`<doc>`, `<private>`) stay exact.
- Storage keeps every tag as the author typed it, spaces included. Only tags the software generates use the no-space form: a note link with no stored spelling is written `<t:N>` (was `<t: N>`), a host id `<id:x>`.
- New `OutlineNode.tagSpellings` (id, kind, action, thread, db) beside `noteLinkTags`; serialize writes a kept spelling back while it still names the node's value, so fold and tick leave the line's tags as they were.
- Display is clean: new `displayTags(text)` (render only) shows every colon tag as `<name:value>`; `captionToHtml`, `captionVisibleText`, `captionStyleRuns` and the Map pill text use it. Code spans stay literal. Also exported: `canonTag`.
- `tests/tag-spacing.test.ts`.

### Tests
- `tests/map-handle-tokens.test.ts`, `tests/map-default-fold.test.ts`, `tests/fold-level.test.ts`, `tests/fold-level-menu.test.ts`, `tests/saved-view.test.ts`; `e2e/fold-level.spec.ts` (mouse, right-click, keyboard, toolbar, confirm) and `e2e/touch-fold-level.spec.ts` (hold, drag-to-level, slop, second finger, tap, label hold) on the `examples/e2e-touch/levels.md` fixture; `e2e/pages-viewer.spec.ts` checks the halo, casing and light tokens in the viewer.

## 0.2.31 — 2026-10-08

**Breaking:** the short `<word>` id form is removed (see Parse). Use `<id:N>`.

### Pages viewer
- A click on **Map** while the outline is still loading is kept. Before this, the end of loading switched the viewer back to Outline.
- The viewer parses with `sessionIds: true`. An outline written without `<id:…>` tags now gets fold handles and task boxes in Outline, the same as one with ids. Examples with an id on every line are unchanged.

### Parse: `<script>` and inline code stay text (breaking: short ids removed)
- A bare `<word>` is caption text, not a tag. Before, `tryShortId` / `tryShortIdTrailing` read any `<word>` at the start or end of a line as a short id, so `- inject <script>` parsed as id `script`, title `inject`, and serialize wrote `- inject <id:script>`. A `<script>` mid-line went too: the typed-suffix rule (for `<id:n>3`) peeled everything after the last `>` when the text before it ended in *any* `<…>`, so `the <script> tag` became id `script`, title `the tag`. A `<script>` after a real `<id:lab3>` replaced that id.
- Only the known tags are read: `<id:…>`, `<t: N>`, `<kind:…>`, `<enc:…>`, `<action:…>`, `<thread:…>`, and the flag and kind words (`<private>`, `<encrypted>`, `<db>`, `<doc>`, …). The typed-suffix rule now needs one of those (or a fold marker) before the suffix.
- **Breaking: the short id form is removed.** A bare `<word>` (`<design>`, `<script>`, `<br>`) is never an id, at the start, middle or end of a line; it stays in the caption and round-trips byte for byte. Use `<id:N>`. Ids are lazy integers, written only when a link needs one, so a bare-word id had no use and only caused misreads. There is no option to turn it back on. An outline that used `- Title <design>` now shows `<design>` in the caption, and a `fold-:`/`fold+:` or layout entry keyed `design` no longer matches a line: change the line to `- Title <id:design>` to keep the link.
- Inline code is literal. Nothing between backticks is read as a tag, id, note link, flag or fold marker (`` `<script>` ``, `` `<id:7>` ``, `` `(+)` ``), and `captionToHtml` does not turn a URL or markdown link inside backticks into a link.
- Display was already safe: `captionToHtml` escapes an unknown tag as text. Tests now pin that `<script>` renders as `&lt;script&gt;`, is never an element and is never dropped.

### Fold marker on a line without an id
- `- Plain caption (+)` now round-trips byte for byte with or without session ids. Before, `parse` without `sessionIds` read the `(+)` and `serialize` dropped it, because it only wrote a marker for a node with an id. Folding is the inline marker; it never writes an id.
- New `OutlineNode.foldMark` (`'collapsed'` | `'expanded'`): set by parse only on a node left without an id, written back by serialize. With session ids the fold stays in `doc.fold` as before. `assignPersistentId` moves a `foldMark` into `doc.fold` when it gives the node an id.
- The document's expanded marker on an id-less line round-trips the same way.

### Clean
- `cleanIds` and `cleanMarkdown` leave anything inside backticks alone, as parse does: `` `<id:9>` `` is not stripped, and a `#id:` inside code does not keep an id.

### Map pill: only a lone link line is hoisted
- `captionWithoutLinks` (the Map pill text) removed every bare URL and every markdown link, label included, and left them to the globe popover. `Slides at https://… before Friday` showed as `Slides at before Friday`.
- Now only a line that is nothing but one link (a lone bare URL or a lone `[label](url)`) leaves the pill. A URL inside a sentence stays in the pill text; a markdown link inside a sentence keeps its label. The globe still lists every link (`captionLinks` is unchanged), so they stay one tap away.
- New export from `captionRich`: `isLoneLinkLine(line)`.
- `tests/caption-rich.test.ts`: `Index · this map · [Open](…)` now keeps `Open` in the pill (it used to expect the label dropped).

### Map: fold handle and connectors (phase 1)
Design UX spec `20261007-map-fold-handle-connector-polish-ux.md`, locked 2026-10-07 with defaults H1–H10. Phase 1 is H1, H2, H3 (a), H5 and H7.
- Child connectors start at the outer edge of the fold handle's ring (`foldCx + r + ring stroke / 2`, which is pill edge + 26.8 px with the default slot) instead of the pill edge. No line runs under the handle any more, so seven children no longer bunch up behind the −. A node without a handle still starts at its pill edge.
- Every foldable node has the same 8 px stem from the pill edge to the handle's inner rim, folded or expanded. Before, the expanded stem ran to the far rim and was lost among the child lines.
- The expanded − is see-through (`fill: none`). It used to be hard-coded black (`fill="#000"` in `mapView.ts` and `fill: #000` in the css, from `a1619fd`), which read as a hole on `--map-bg`. With the lines starting outside the ring it doesn't need to hide anything.
- `.map-edge` and `.map-fold-stem` no longer have `opacity: .85`, so connectors show at full `--connector` contrast.
- Unchanged: paint order (edges, pills, stem, handle, hit rect), `FOLD_SLOT` 34, the 32 × 32 fold hit area and its centre, and node positions.
- New exports from `mapView`: `FOLD_R`, `FOLD_RING_W`, `foldHandleGeometry`, `connectorStartX`, `childConnectorPath`, `foldStemSvg`, `foldHandleSvg`, `foldChromeSvg`, `mapEdgeSvg`. Paint uses them, and the tests check them.
- Not yet (phases 2 and 3 of the same spec): `--map-handle-bg` (opt-in solid disc, default transparent), `--map-handle-glyph-on-gold` for the + glyph, a `--map-halo` casing under the − ring and dash, opt-in `--connector-casing`, a stated ≥ 3:1 `--connector` contrast target, and light-theme tokens.
- The fold animation still draws edges at their final place and fades them in while pills slide. With the new start, the fan's join point sits just past the handle's final position for the first part of the slide, as it sat at the pill edge before. It meets the handle when the slide ends.

### Examples
- New outline, `examples/lighthouse/lighthouse.md`: a lighthouse keeper's week, with task boxes, two done, and Tuesday folded with `(+)`. It has no `<id:…>` tags or layout block. Linked from the README, the landing page, the demos index and the fixtures page, with a twin in `examples/fixtures/`.

### Tests
- `tests/literal-text.test.ts`: `<script>`, `<em>`, `<br>` and backticked tags stay literal through parse, serialize, fold, tick and render; a real `<id:…>` is never replaced; outline-view's minted-id chain keeps a leading or trailing `<script>`.
- `tests/outline-fold.test.ts`: `<design>`, `<script>`, `<br>` at the start, middle and end of a line, before `(+)` and next to `<id:7>`, round-trip byte for byte.
- `tests/fold-mark.test.ts`: an inline `(+)` (and custom collapsed / expanded markers) on an id-less line round-trips with and without session ids, under fold- and fold+.
- `tests/pill-url-hoist.test.ts`: a URL in a sentence stays on the pill; a lone URL line is hoisted.
- `tests/clean.test.ts`: tags inside backticks survive `cleanIds` and `cleanMarkdown`.
- `tests/examples.test.ts`: every example outline validates with no errors, and an outline without ids round-trips byte for byte through `parse(text, { sessionIds: true })` and `serialize`.
- `e2e/pages-viewer.spec.ts`: the lighthouse outline gets a session id, task box and fold handle on every row in the viewer, and **Handoff text** stays free of ids. A **Map** click made while the outline is still loading is kept.
- `tests/map-fold-handle.test.ts`: a node with children starts every connector at the handle's outer rim; a node without a handle starts at its pill edge; the stem is the same for folded and expanded, runs 8 px to the inner rim and paints before the handle; no `#000` in the handle markup or css; no opacity on connectors or stems; `FOLD_RING_W` matches the css ring stroke. `tests/outline-fold-css.test.ts` now expects the expanded circle to be `fill: none`.
- `e2e/pages-viewer.spec.ts`: on the lighthouse Map, the root's seven connectors start at the handle's outer rim, the − and + have the same 8 px stub, the fold hit is still 32 × 32 on the handle centre, the − circle's computed fill is `none`, and edges and stems have computed opacity 1.
- `examples/e2e-touch/fixture.md`: the globe pill's link is now a lone URL line under its caption (`key 1004\nhttps://…`). A URL inside a sentence stays on the pill since this release, which made the pill long enough to push its globe off screen after a pinch.

## 0.2.30 — 2026-10-06

### Map: single-tap activation on touch
- The click swallow after a pan, pinch or touch tap is one-shot. It expires after 400 ms, only covers about 30 px around the point where the finger lifted, and the next press clears it. Cancel, blur and a hidden page clear it too. Before this, the first tap on a fold handle, task box, globe, `#N` chip or popover button after a pan was eaten.
- `zoomAt` and `resetCam` stop a running spring-back, Fit or glide first, so −/+ zoom the camera shown at that moment and no later frame overwrites it.
- New export `bindTap(el, fn)`. Touch and pen activate on `pointerup` (a press that started on the button and moved < 10 px), and the click that follows is ignored. Mouse and keyboard keep `click`. One activation per tap, including after a fling, when the browser can drop the click. `mountMapControls`, the resize popover, and the example hosts' − / + / Fit use it.
- In-map handles (fold handle, task box, body more/less, globe, `#N` chip, thread chip) use the same rule on touch and pen: they activate on `pointerup` and ignore the click that follows within 800 ms. A tap right after a fling, when the browser drops the click, now lands. A pan end never activates a handle (the swallow record still applies). Mouse keeps `click`; keyboard is unchanged.
- `touch-action: manipulation` on `.of-map-controls`, its buttons, and the popover buttons (and the example toolbars), so quick repeated taps don't become a double-tap zoom.
- The map ignores a press on its own controls: `.of-map-controls` inside the host gets no `preventDefault`, pointer capture or double-tap zoom. Controls and the resize popover inside the host survive `paint()`.
- Touch capture is lazy: the host captures a finger only once a pan or pinch is recognised (or a corner press turns into a width drag), so a tap still reaches the pill's own handler.
- No glide from any gesture that had two fingers down. A second finger drops the one-finger velocity samples. The finger-lift-after-pinch behaviour is unchanged (gesture spec amendment 2026-10-05).

### Map: resize popover
- The popover opens above and left of the corner, so the finger doesn't cover it, and flips below only when there's no room. It is measured and kept fully inside the map, 8 px from every edge.
- Buttons are at least 44 × 44 px. Items are `menuitemradio`. The current choice shows `✓` and `aria-checked` (Auto when the pill has no stored width).
- Esc closes it. Arrow keys move between items, and Enter / Space on an item no longer reach the map's fold keys.

### Outline text
- A note link keeps the spelling it was written with. `<t:1002>` stays `<t:1002>` and `<t: 1002>` stays `<t: 1002>` through parse, serialize, a fold toggle and a task tick. Before this, serialize wrote every link as `<t: N>`, so a fold or a tick in the Map rewrote `<t:N>` tags across the whole body. Parse keeps the spelling in the new optional `node.noteLinkTags` (id → tag, only when it isn't `<t: N>`). A link the host adds, or a kept spelling that no longer names the id, is written as `<t: N>`. Leading and mid-caption links still move to the trailing slot, and a repeated id still writes one tag (spelled as its first occurrence).
- A character typed right after a closing tag or fold marker (`<id:n>3`, `(+)3`) no longer hides the token. The id and fold state still parse, and the character stays on the caption. (Shipped in `7349c83` without an entry.)

### Lazy ids
- `parse(text, { sessionIds: true })` gives every line without `<id:…>` a session id (`node.autoId: true`) from `nextAutoId`, which skips ids already on lines and keys in the payloads and layout blocks, so sparse ids (`<id:2>`, `<id:5>`) never collide. A `(+)` on such a line folds it. Without the option parse is unchanged.
- Serialize does not write a session id. A fold toggle on an id-less outline changes only the `(+)` marker: the text round-trips byte for byte otherwise.
- A width (`assignPersistentId`, or a `layout.w` at serialize), a payload, or a fold+ entry writes the node's session id onto its line; it is already unique, so fold state and map keys keep pointing at it.
- Serialize leaves out a `--- layout ---` block that would only hold defaults (fold- with no ids, `collapsedMarker: "(+)"`, no widths or other keys). Under fold- a session id stays off the `fold-:` list; the line's `(+)` carries it.

### Clean
- `cleanIds(text)` removes `<id:…>` tags nothing points at and returns `{ text, removed, kept }`. An id stays when a payloads or layout entry is keyed by it, a `#id:` link names it, or a fold+ list holds it. A fold- entry whose line already ends with `(+)` is redundant: the id and the entry both go. Everything else in the text, line endings included, is left as written.
- `cleanMarkdown(text, { tasks? })` returns a plain markdown list (`- ` bullets, two spaces per level): captions and task boxes only, with no ids, note links, kind / flag / action / thread / enc tags, fold markers, or layout and payload blocks. Grammar tags a translation moved into a caption are dropped too.

### Examples
- Plain-language pass on the demo outlines, fixtures, READMEs and the Pages viewer. All example names, places and numbers are made up.
- Locked rows in the examples hold real demo ciphertext, sealed by `npm run demo:seal`, instead of `ct: PLACEHOLDER`. When an outline has them, the viewer shows **Unlock** and `Demo password: 123`. The password comes from `examples/demo-values.json` (the demo values provider), never from the outline text. `examples/_shared/unlock.js` replaces `unlockStub.js`. `DEMO_PASSPHRASE` stays as a sample constant for tests.
- Test sample text uses a made-up garden-club outline with note ids 1001+. Structure, link spellings and assertions are unchanged.
- The cafe 2D and 3D maps load one outline, `examples/cafe-map.md`. Its two locked rows (Supplier accounts, Alarm monitoring contact) carry real payloads sealed by `npm run demo:seal` with the demo password. Both pages show **Unlock** and `Demo password: 123`, and a click on a locked node opens just that row.
- The 3D map draws a caption label under every sphere (`CSS2DRenderer`). Locked rows show `🔒 locked`, then the opened text. The page never had label code; spheres were the only output. Leaves get their own x slot, so siblings from different branches no longer sit on top of each other, and the camera backs off until the tree fits.
- The 2D map lists its labels as canvas fallback content, scales clicks when the canvas is shrunk, and drops the blank row after each open branch.

### Tests
- Playwright projects `touch-pixel` (Pixel 7) and `touch-iphone` (iPhone 13 profile), both Chromium with touch, drive CDP touch events against `examples/e2e-touch`: −/+/Fit and popover single taps (fresh, after a slow pan, after a fling, after Fit, edge pills, repeated and double taps), taps on map handles after a pan or pinch and 60 / 200 ms after a fling, swallow expiry, and the pinch-lift regression (no camera motion after the last finger lifts).
- `e2e/cafe-maps.spec.ts`: 3D labels present, visible, inside the window and not overlapping (1400 × 900, and 1024 × 700 with every branch open); locked rows in both maps show caption + `🔒 locked` and open with the demo password.
- `tests/examples.test.ts`: every private / encrypted row in an example outline has a sealed payload; the cafe maps load `examples/cafe-map.md`.

## 0.2.29 — 2026-10-04

### Notes
- The layout block accepts `noteUri`. `{id}` is the `<t:N>` id, and the chip opens that http(s) or root-relative link in a new tab.

## 0.2.28 — 2026-10-04

### Map
- A task checkbox sits in the left pad. The caption starts just after the box.
- A `<t:N>` link draws as `#N` on the caption line. The outline chip uses the same label.

## 0.2.27 — 2026-10-04

### Tasks
- The map draws a gold dash for a pending task. A click cycles open, then pending, then done.
- Outline task buttons use `aria-checked="mixed"` while a task is pending.

## 0.2.26 — 2026-10-04

### Tasks
- A leading `[]` is an open task, the same as `[ ]`.
- A leading `[-]` is a pending task. An en dash or minus inside the brackets counts too.
- A leading `☐` is an open task. `☑`, `☒`, and `✓` are done. The saved text uses `[ ]`, `[x]`, or `[-]`.

## 0.2.25 — 2026-10-04

### Styles
- `dist/outline-fold.css` is the default outline and map paint. Link it before host CSS.
- A collapsed fold circle is solid gold. An expanded circle stays black so the dash stays visible.

## 0.2.24 — 2026-10-04

### Examples
- The Pages viewer and the React live demo fill the window. Zoom is − / + / Fit on the map.

### Map
- Pinching at maximum zoom stays on the pinch point. The scale cap no longer draws the unclamped pinch position, which flung the map off screen.
- The link globe sits in the top-right corner, flush with the top of the pill.
- The child connector runs through the fold circle.
- A pill taller than its expanded children no longer overlaps the sibling above it.
- The expanded fold circle is opaque black, so the connector does not cover the yellow dash.

## 0.2.23 — 2026-10-03

### Map
- The link globe sits on the pill’s top-right corner, clear of the fold handle.
- A connector runs from the pill edge through the fold handle. Expanded, it joins the child edge.

## 0.2.22 — 2026-10-03

### Outline text
- `fold-`, `fold+`, `collapsedMarker`, `expandedMarker`, and `fontSize` may live in the trailing `--- layout ---` block, beside per-node `w:` widths.
- `serialize` writes those keys there. The outline text starts with the first bullet, so a note summary is that line. A leading `---` block still parses, and layout keys win when both are present.

## 0.2.21 — 2026-10-02

### Map
- Captions are left-aligned inside the pill.
- The fold handle sits outside the right border. Expanded nodes use an open circle with a minus. Collapsed nodes keep the filled plus.
- The resize mark sits outside the bottom-right corner. On a mouse it shows while the pointer is in that corner. On touch it arms from that corner and appears once the drag is sideways.
- An http(s) URL stays whole, including parentheses, so the link is not cut at the column width.
- Folding reuses caption measurements instead of measuring every character with a layout flush.
- A canvas pan cancels the browser drag-select at pointer-down so the highlight does not grow across the map.

### Map pill width
- Each pill has a handle on its right edge. Dragging it sets the caption column width and wraps the text to that width.
- The width is stored in the outline text as a `--- layout ---` block (`id:` / `w:`), not in a sidecar file.
- An id is written on the outline line only when a layout width or sealed payload needs a stable key. Until then a node is addressed by its 1-based position, and that integer is not added to the caption.
- Auto ids are plain integers (`<id:3>`). Existing word ids still parse.
- Auto width widens a little when the last line is one leftover word, or much shorter than the two, three, or four lines above it. A line break stays its own line.
- A tap on the bottom-right corner opens Slim, Wider, and Auto. Wider adds a small step. Auto clears the stored width. A drag still sets the width directly.
- Sibling pills share the left edge of the painted caption. The stored x is still the pill centre.
- Opening a map, and Reset view, pin that outline to the left of the panel. Fit still frames the whole diagram.

## 0.2.20 — 2026-10-01

### Map caption links
- A pill with a markdown or https link shows a globe. The popup uses the link caption when there is one.
- The pill text leaves the markdown link out.
- The popup fades when you pan or tap away.
- Demos index no longer links the empty shared viewer.

## 0.2.16 — 2026-09-29

### Map keyboard: single stable focus owner (regression fix, 0.2.12–0.2.15)

**Root cause.** Node click focused the per-node `<g tabindex>`; the same click's
`onChange → paint()` rewrote `host.innerHTML`, detaching that `<g>` so DOM focus
fell to `<body>`. The post-paint restore then checked `host.contains(oldNode)` on
the now-detached element (always false), so focus was never restored and the
keydown gate (`mapKeyboardShouldHandle`, no body fallback since 0.2.12) rejected
every arrow / digit / `.` / Space / Enter. Only the first key after re-clicking the
*already* selected node (no repaint) worked, which is why it looked key-specific.

**Fix.**
- The map **host** is the only focus owner: `tabindex="0"` (upgrades `-1`),
  `role="tree"`; nodes are **not** focusable (`role="treeitem"`, stable `id`,
  `aria-selected`) and the host carries **`aria-activedescendant`** → selected node.
  Paint never destroys the host, so focus survives every repaint.
- Focus snapshot is a **boolean taken before** the DOM rebuild
  (`mapHostOwnsFocus`); `mapPaintFocusAction` decides `none | keep | focus-host`
  (never steals from a textarea; re-focuses the host, never a node).
- **Keydown bound on the host** (plus the optional mode button) instead of
  `document`; modifier chords (Ctrl/Meta/Alt) are left to the browser.
- Canvas background pointerdown also focuses the host (pan `preventDefault`
  suppressed native focus). Space is always swallowed on the host (no page scroll).
- Keyboard fold / digits / `*` now run camera follow like circle-+ (selection and
  newly shown kids stay in view).
- New exports: `mapHostOwnsFocus`, `mapPaintFocusAction`, `mapNodeDomId`.
  `mapPaintShouldRestoreFocus` kept (deprecated alias).

### react-live / Pages viewer
- Host focus-visible outline CSS; build stamp now shows **git sha**
  (`data-testid="pkg-stamp"` / `pkg-git`).
- Typing in the textarea no longer resets in-memory (cold-start / resume) fold to
  the text frontmatter unless the fold line itself changed.
- Cafe fixture: 3-line caption `staff-close` and a 35-line body node
  `staff-handbook` (more/less); generator template synced (fiction only).

### Stability gate (CI)
- Playwright headless Chromium e2e (`e2e/`, `npm run test:e2e`) against locally
  built site/ served under `/audroam-outline-fold/` (react-live + Pages viewer):
  click → host focus + activedescendant + ring; every arrow (incl. edge no-ops);
  Space/Enter/`.` fold; `1`/`2`/`3` depth; textarea typing never drives Map and
  keeps focus; textarea ↔ map round trips; re-click same node; label drag-select +
  pan; pill hit-test (fails on overlays); version + sha stamps.
- `ci.yml` job `e2e`; `pages.yml` runs e2e before upload and a post-deploy
  `verify` job against the live Pages URL (waits for stamp == version + sha).
- Unit tests: `tests/map-focus-owner.test.ts`.

## 0.2.15 — 2026-09-29

### Caption breaks: literal `\n` / `\r` / `\r\n` escapes

Design lock follow-up (react-live dogfood): markdown captions are single-line in the
textarea, so typing `\n` stores two characters (backslash + n), not a real LF.
`normalizeCaptionBreaks` now converts those literal escapes **and** real LF/CR/CRLF
plus `<br>`/`<nr>` before wrap/measure/paint (Map) and `captionToHtml` (Outline).
SVG multi-`tspan` paint path was already fine once wrap saw real LFs.


### Map selection focus ring (focusId → `is-focused`)

Click/arrow selection sets `focusId` and keyboard works, but the pill ring used
`:focus-visible` only — mouse click and programmatic `focus()` after paint did not
paint the accent stroke. Paint now adds `is-focused` (+ `aria-current`) from
`focusId`; demo CSS styles `.map-node.is-focused .map-pill` (accent ring). Collapsed
gold stroke yields to the focus accent when selected.

## 0.2.14 — 2026-09-29

### Map camera follow — proportion + disableable recentre + edit ensure

Design amend #2 (Colin): replace binary fully-off and comfort-inset aggressive follow.

- **Visible fraction** of focus pill: ≥ **~0.6** keep → no-op; below → gentle **ensure-visible**; **recentre** when `cameraRecentre` on and fraction **≲ 0.25** (or expand kids mostly off-screen)
- **`cameraRecentre`** option (default **on**): off disables group recentre; ensure-visible for focus still runs
- **Edit mode** (`isEditing` / `getEditRegion` / `ensureEditVisible()`): always gentle-ensure edit node + caret region — even when recentre off
- **Expand hint:** with recentre on, kids mostly off-screen → frame focus + new kids (~60% bias)
- Kept: viewport clamp; manual pan wins until next follow trigger; resume camera on load unchanged
- Helpers: `visibleFractionOfRect`, `followActionForFocus`, `followActionForExpand`

## 0.2.13 — 2026-09-29

### Map / Outline caption rich newlines + tiny HTML

Design lock (Colin treat-now): normalize break tokens **before** wrap/measure/paint, and allow a tiny safe HTML subset for emphasis.

- Breaks: `\n` / `\r` / `\r\n` / `<br>` / `<br/>` / `<nr>` (any case) → line breaks; collapse 3+ LFs to one blank line
- Allowlist: `<b>`/`<strong>`, `<i>`/`<em>` (no attributes); everything else stripped (inner text kept) or escaped at render
- Shared helpers: `normalizeCaptionBreaks`, `captionVisibleText`, `captionStyleRuns` / `parseTinyHtmlRuns`
- Map: measure counts **visible** chars; SVG paint uses `font-weight` / `font-style` on tspans
- Outline `captionToHtml` / `toHtml`: same normalize + allowlist (`<br>` + bold/italic); markdown links unchanged
- `displayCaption` preserves newlines (horizontal ws only)

### Map camera follow + viewport guard

Design lock (Colin treat-now): keep painted content on-screen and follow focus/expand.

- **Clamp** pan/zoom so viewport always intersects content + ~56px padding (no empty infinity)
- **Focus change** (click / arrows): ease focus into view when clipped or far; no jump if already comfortable
- **Expand children** (fold / `.` / Space / digits): after auto-pack, frame focus + newly visible kids, centroid biased ~60% toward focus
- Manual pan/wheel wins until the next follow trigger; resume camera on load unchanged (follow only after user acts)

### Map focus-on-click (fix 0.2.12 over-tight gate)

Clicking a Map node (pill / fold-slot / task / more / thread) now `focus()`es the map host (or pill) **before** paint so arrows / digits / `.` / Space / Enter work after select. Still: paint does **not** steal focus from textarea/editor; `mapKeyboardShouldHandle` still rejects `TEXTAREA`/`INPUT`/`SELECT`/contenteditable.

## 0.2.12 — 2026-09-29

### Map keyboard only when Map has focus

`createMapView` no longer steals focus on every `paint()`/`onChange` (that made react-live jump focus into Map after each editor keystroke). Map digit / fold / arrow keys run only when focus or the event target is inside the map host (or the Map mode button) — not while typing in a textarea/input. Pan-vs-selection fix from 0.2.11 kept.

## 0.2.11 — 2026-09-29

### Map pan no longer drag-selects text

Panning the canvas (pointer drag on background / pinch) clears `window.getSelection()` and temporarily sets `user-select: none` on the map host so the gesture does not paint a huge accidental text range. Intentional drag-select on node labels for copy is unchanged (`pointerdown` on `.map-node` still skips the pan path).

## 0.2.10 — 2026-09-29

### Map digits relative to selection

Digit keystrokes (`0`–`9` / `*`) when a Map node is selected now expand/collapse **relative to that node** via `setExpandLevel(doc, n, { under: focusId })`:

- `1` = expand the selected node (show its children); deeper foldables collapse
- `2`+ = show that many levels under the selection
- `0` = collapse the selected subtree
- `*` = expand all foldables under the selection
- Outside the subtree: fold state unchanged
- Digits still require a selection (Design lock)

### Map label text selection

Pill labels allow native browser text selection / copy. Click still focuses the node for keyboard (digits / fold keys). Text drag does **not** fold — fold stays on circle-+ / fold-slot only. Paint is skipped when a selection intersects the node so the range is not wiped.

Absolute `setExpandLevel(doc, n)` (Outline / cold-start seed) unchanged.

## 0.2.9 — 2026-09-29

### Map scrapbook body — generous ~30-line clip + more/less

Design lock (Colin compromise): journal/scrapbook leaves show a **generous ~30-line** product clip (not a harsh 6, not unlimited-by-default). **“more”** expands that pill’s body to full text (up to soft engine safety); **“less”** returns to ~30. Soft safety remains **~500 lines / ~50k chars** for pathological paste only.

- `DEFAULT_MAX_LINES = 30`; `bodyExpanded` on layout/resume nudges
- “more” / “less” hit target in text region — **orthogonal** to child fold (circle-+ / `.` / Space / Enter)
- Auto-pack **reflows** on more/less; wrapCh default 32 (per-node wider OK; no auto-bump on expand)
- Pages viewer + react-live persist `bodyExpanded` in localStorage resume
- No WYSIWYG (display + select only)

### Kept from 0.2.8

FOLD_SLOT 34, task SVG chrome, click≠fold, cold-start lineage seed, resume fold+camera, react-live single-paint FLIP.

## 0.2.8 — 2026-09-29

Scrapbook pack: multi-line wrap, lineage height cold-start, localStorage resume, click≠fold, task SVG + action/thread. SHA `ce98930`.
