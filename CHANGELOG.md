# Changelog

## Unreleased

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
## 0.2.11 — 2026-09-29

### Map pan no longer drag-selects text

Panning the canvas (pointer drag on background / pinch) clears `window.getSelection()` and temporarily sets `user-select: none` on the map host so the gesture does not paint a huge accidental text range. Intentional drag-select on node labels for copy is unchanged (`pointerdown` on `.map-node` still skips the pan path).

## 0.2.10 — 2026-09-29
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
