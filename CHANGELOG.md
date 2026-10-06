# Changelog

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

### Examples
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
