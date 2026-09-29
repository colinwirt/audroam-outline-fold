# Changelog

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
