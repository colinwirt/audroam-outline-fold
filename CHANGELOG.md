# Changelog

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
