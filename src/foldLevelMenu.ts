/**
 * Fold-to-level menu: gesture, placement, keys and markup (Design UX
 * 2026-10-06, L1, L4–L6, L8–L10, L13, L14). The pure parts (hold timing,
 * placement, key handling, labels, camera keep-visible) are exported for tests;
 * `renderLevelMenu` builds the overlay. `createMapView` wires them to a hold
 * or right-click on the fold handle and to `map.openLevelMenu(id)`.
 */

import { isCollapsed, setExpandLevel } from './fold.js';
import {
  foldLevelNeedsConfirm,
  type FoldLevelItem,
  type FoldLevelKey,
  type FoldLevelPicker,
} from './foldLevel.js';
import type { OutlineFoldDoc, OutlineNode } from './types.js';

/** A hold this long on a fold handle opens the menu (L4). */
export const LEVEL_HOLD_MS = 450;
/** The progress ring shows after this long (L4). */
export const LEVEL_RING_MS = 150;
/** The menu stays this far inside the map panel (L6). */
export const LEVEL_MENU_INSET = 8;
/** Gap between the handle and the menu. */
export const LEVEL_MENU_GAP = 10;

/** Movement that cancels a hold: 10 px on touch and pen, 4 px on mouse (L4). */
export function levelHoldSlop(pointerType: string | undefined): number {
  return pointerType === 'mouse' || !pointerType ? 4 : 10;
}

export type LevelHoldPhase = 'arming' | 'ring' | 'open' | 'cancelled';

/** One press on a fold handle, from pointerdown to release. */
export interface LevelHold {
  pointerId: number;
  pointerType: string;
  /** Node id (the handle's `data-id`). */
  id: string;
  x0: number;
  y0: number;
  t0: number;
  phase: LevelHoldPhase;
}

export function startLevelHold(p: {
  pointerId: number;
  pointerType: string;
  id: string;
  x: number;
  y: number;
  t: number;
}): LevelHold {
  return {
    pointerId: p.pointerId,
    pointerType: p.pointerType || 'mouse',
    id: p.id,
    x0: p.x,
    y0: p.y,
    t0: p.t,
    phase: 'arming',
  };
}

/** Movement past the slop before the menu opens cancels the hold. After it opens, movement only slides (L5). */
export function levelHoldMoved(h: LevelHold, x: number, y: number): LevelHold {
  if (h.phase !== 'arming' && h.phase !== 'ring') return h;
  if (Math.hypot(x - h.x0, y - h.y0) > levelHoldSlop(h.pointerType)) return { ...h, phase: 'cancelled' };
  return h;
}

/** Ring at 150 ms, open at 450 ms. A cancelled or open hold stays as it is. */
export function levelHoldAt(h: LevelHold, t: number): LevelHold {
  if (h.phase === 'cancelled' || h.phase === 'open') return h;
  const dt = t - h.t0;
  if (dt >= LEVEL_HOLD_MS) return { ...h, phase: 'open' };
  if (dt >= LEVEL_RING_MS) return { ...h, phase: 'ring' };
  return h;
}

/** A second pointer, a pan or a pinch cancels a hold that has not opened yet. */
export function levelHoldCancel(h: LevelHold): LevelHold {
  return h.phase === 'open' ? h : { ...h, phase: 'cancelled' };
}

/**
 * What the release does:
 * - `toggle`: a short tap, so today's toggle runs on pointerup (touch) or click (mouse);
 * - `consume`: the menu opened, so this release never toggles and its click is swallowed (L4);
 * - `none`: cancelled (pan, pinch, slop).
 */
export function levelHoldRelease(h: LevelHold): 'toggle' | 'consume' | 'none' {
  if (h.phase === 'open') return 'consume';
  if (h.phase === 'cancelled') return 'none';
  return 'toggle';
}

/**
 * What a `contextmenu` event on the map does with the fold-level menu
 * (Colin, 2026-10-08: the menu opens only from the fold handle itself):
 * - `open`: a right-click on the fold handle of a node with children opens
 *   the menu; the event is the package's (preventDefault + stopPropagation);
 * - `own`: inside the open menu, or on a handle whose hold runs the menu
 *   (touch and pen long-press, a hold in progress, the menu already open):
 *   the package keeps the event, so the platform and host menus stay shut;
 * - `close`: anywhere else while a package menu is open: close it and leave
 *   the event to the host (its own node menu may open);
 * - `pass`: anywhere else, or inside the link or width popover or the map
 *   controls: the event is left untouched for the host.
 */
export type LevelContextAction = 'open' | 'own' | 'close' | 'pass';

export function levelContextAction(p: {
  /** Target is inside `.map-level-menu`. */
  inMenu: boolean;
  /** Target is inside another package overlay (link or width popover, map controls). */
  inOverlay?: boolean;
  /** Target is inside a fold handle (`.map-fold-hit` / `.map-fold-indicator`) of a node. */
  onHandle: boolean;
  /** That node has children, so a picker exists. */
  foldable: boolean;
  menuOpen: boolean;
  holding: boolean;
  /** `PointerEvent.pointerType` of the contextmenu, `''` when the engine gives none. */
  pointerType: string;
}): LevelContextAction {
  if (p.inMenu) return 'own';
  if (p.inOverlay) return 'pass';
  if (p.onHandle && p.foldable) {
    if (p.holding || p.menuOpen) return 'own';
    // Touch and pen open it with the hold (L4); the long-press menu is swallowed.
    if (p.pointerType === 'touch' || p.pointerType === 'pen') return 'own';
    return 'open';
  }
  return p.menuOpen ? 'close' : 'pass';
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the menu goes, in panel-local px (L6): centred on the handle and above
 * it, below when there is no room above, clamped 8 px inside the panel.
 */
export function placeLevelMenu(opts: {
  anchor: Rect;
  panel: { w: number; h: number };
  menu: { w: number; h: number };
  inset?: number;
  gap?: number;
}): { left: number; top: number; below: boolean } {
  const inset = opts.inset ?? LEVEL_MENU_INSET;
  const gap = opts.gap ?? LEVEL_MENU_GAP;
  const { anchor, panel, menu } = opts;
  const cx = anchor.x + anchor.w / 2;
  let top = anchor.y - gap - menu.h;
  let below = false;
  if (top < inset) {
    top = anchor.y + anchor.h + gap;
    below = true;
  }
  let left = cx - menu.w / 2;
  const maxLeft = Math.max(inset, panel.w - menu.w - inset);
  const maxTop = Math.max(inset, panel.h - menu.h - inset);
  left = Math.min(maxLeft, Math.max(inset, left));
  top = Math.min(maxTop, Math.max(inset, top));
  return { left: Math.round(left), top: Math.round(top), below };
}

export type LevelMenuKeyAction =
  | { type: 'move'; index: number }
  | { type: 'apply'; index: number }
  | { type: 'close' }
  | null;

/**
 * Menu keys (L13): arrows / Home / End move between enabled items, Enter or
 * Space applies, Esc and Tab close, and the item's own key (`0 1 2 3 *`)
 * applies it.
 */
export function levelMenuKeyAction(
  key: string,
  index: number,
  items: readonly { disabled?: boolean; hint?: string }[],
): LevelMenuKeyAction {
  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
  if (!enabled.length) return key === 'Escape' || key === 'Tab' ? { type: 'close' } : null;
  const pos = enabled.indexOf(index);
  const step = (d: number): number => {
    if (pos < 0) return d > 0 ? enabled[0]! : enabled[enabled.length - 1]!;
    return enabled[(pos + d + enabled.length) % enabled.length]!;
  };
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return { type: 'move', index: step(1) };
    case 'ArrowUp':
    case 'ArrowLeft':
      return { type: 'move', index: step(-1) };
    case 'Home':
      return { type: 'move', index: enabled[0]! };
    case 'End':
      return { type: 'move', index: enabled[enabled.length - 1]! };
    case 'Enter':
    case ' ':
      return pos >= 0 ? { type: 'apply', index } : null;
    case 'Escape':
    case 'Tab':
      return { type: 'close' };
    default: {
      const hit = items.findIndex((it) => !it.disabled && it.hint != null && it.hint === key);
      return hit >= 0 ? { type: 'apply', index: hit } : null;
    }
  }
}

/** Item to focus on open: the checked one, else the first enabled one (L13). */
export function levelMenuInitialIndex(items: readonly Pick<FoldLevelItem, 'checked' | 'disabled'>[]): number {
  const checked = items.findIndex((it) => it.checked && !it.disabled);
  if (checked >= 0) return checked;
  return Math.max(0, items.findIndex((it) => !it.disabled));
}

/** Visible label. Rows on a fine pointer read `Level 1`; touch tiles read `1`. */
export function levelItemLabel(key: FoldLevelKey, fine: boolean): string {
  if (key === 0) return 'Fold';
  if (key === '*') return 'All';
  return fine ? `Level ${key}` : String(key);
}

/** Accessible name of an item: always the long form. */
export function levelItemName(key: FoldLevelKey): string {
  return levelItemLabel(key, true);
}

/** Desktop count (L3): `hides 36` for Fold, `16 shown` for the others. */
export function levelItemCount(item: Pick<FoldLevelItem, 'key' | 'shown' | 'hidden'>): string {
  if (item.key === 0) return `hides ${item.hidden.toLocaleString('en')}`;
  return `${item.shown.toLocaleString('en')} shown`;
}

/** Label of the confirm item for All above 1,500 nodes (L14). */
export function levelConfirmLabel(picker: Pick<FoldLevelPicker, 'total'>): string {
  return `Show all ${picker.total.toLocaleString('en')}`;
}

/** Whether picking `key` goes through the confirm step first (L14). */
export function levelPickNeedsConfirm(picker: FoldLevelPicker, key: FoldLevelKey): boolean {
  return foldLevelNeedsConfirm(picker, key);
}

/** Nodes below `id` that are visible in `doc` (not counting `id`). */
export function shownBelow(doc: OutlineFoldDoc, id: string): number {
  const find = (nodes: OutlineNode[] | undefined): OutlineNode | null => {
    for (const n of nodes || []) {
      if (n.id === id) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return null;
  };
  const anchor = find(doc.nodes);
  if (!anchor) return 0;
  let c = 0;
  const walk = (n: OutlineNode) => {
    if (n.id && isCollapsed(doc, n.id)) return;
    for (const k of n.children || []) {
      c++;
      walk(k);
    }
  };
  walk(anchor);
  return c;
}

/** Whole-map levels on the toolbar (L8): counted from each root. */
export type WholeMapLevel = 1 | 2 | 3 | '*';
export const WHOLE_MAP_LEVELS: readonly WholeMapLevel[] = [1, 2, 3, '*'];

/** Every root to `level`: `setExpandLevel(doc, level + 1)`, which resets every node (L16). */
export function wholeMapLevelDoc(doc: OutlineFoldDoc, level: WholeMapLevel | 0): OutlineFoldDoc {
  return setExpandLevel(doc, level === '*' ? '*' : level + 1);
}

function visibleSig(doc: OutlineFoldDoc): string {
  const out: string[] = [];
  const walk = (nodes: OutlineNode[] | undefined, path: string) => {
    (nodes || []).forEach((n, i) => {
      const key = n.id ?? `${path}.${i}`;
      out.push(key);
      if (!(n.id && isCollapsed(doc, n.id))) walk(n.children, key);
    });
  };
  walk(doc.nodes, '');
  return out.join('\n');
}

/** The toolbar level the whole map is at now (All wins over an equal number), or null. */
export function currentWholeMapLevel(doc: OutlineFoldDoc): WholeMapLevel | null {
  const now = visibleSig(doc);
  for (const level of ['*', 1, 2, 3] as const) {
    if (visibleSig(wholeMapLevelDoc(doc, level)) === now) return level;
  }
  return null;
}

/**
 * Keep-visible after an expand (L10), pan only: when less than `keepFrac` of
 * the shown subtree is on screen, move it into the padded viewport, but never
 * so far that the pressed handle leaves it. Zoom is unchanged. Screen px.
 */
export function levelKeepVisibleShift(opts: {
  viewport: { w: number; h: number };
  /** Screen rect of the pressed node's pill and handle. */
  anchor: Rect;
  /** Screen rect of the shown subtree (null when nothing is shown below). */
  shown: Rect | null;
  paddingPx?: number;
  keepFrac?: number;
}): { dx: number; dy: number } {
  const { viewport: vp, anchor, shown } = opts;
  if (!shown || shown.w <= 0 || shown.h <= 0) return { dx: 0, dy: 0 };
  const pad = opts.paddingPx ?? 56;
  const keep = opts.keepFrac ?? 0.6;
  const ix = Math.max(0, Math.min(vp.w, shown.x + shown.w) - Math.max(0, shown.x));
  const iy = Math.max(0, Math.min(vp.h, shown.y + shown.h) - Math.max(0, shown.y));
  if ((ix * iy) / (shown.w * shown.h) >= keep) return { dx: 0, dy: 0 };
  const axis = (lo: number, size: number, aLo: number, aSize: number, span: number): number => {
    let d = 0;
    if (lo + size > span - pad) d = span - pad - (lo + size);
    if (lo + d < pad) d = pad - lo;
    // The pressed handle stays inside the padded viewport.
    const minD = pad - aLo;
    const maxD = span - pad - (aLo + aSize);
    if (minD <= maxD) d = Math.min(maxD, Math.max(minD, d));
    else d = 0;
    return d;
  };
  return {
    dx: axis(shown.x, shown.w, anchor.x, anchor.w, vp.w),
    dy: axis(shown.y, shown.h, anchor.y, anchor.h, vp.h),
  };
}

export interface LevelMenuView {
  el: HTMLElement;
  /** Items in order (Fold, 1, 2, 3, All), or the confirm step's items. */
  items: HTMLElement[];
}

function mk<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

/**
 * The menu (L3, L6, L13): `role="menu"` named "Fold <title> to level", one
 * `role="group"` "Levels" row of `menuitemradio` items with key hints, counts
 * on a fine pointer, the current level checked, deeper levels disabled.
 * The Levels group leaves room for the Child widths row (hold-to-fit F2).
 */
export function renderLevelMenu(
  picker: FoldLevelPicker,
  opts: { fine: boolean; confirm?: boolean },
): LevelMenuView {
  const title = picker.title.replace(/\s+/g, ' ').trim() || 'Node';
  const el = mk('div', 'map-level-menu');
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', `Fold ${title} to level`);
  el.dataset.nodeId = picker.id;
  el.dataset.pointer = opts.fine ? 'fine' : 'coarse';
  el.style.position = 'absolute';
  el.style.zIndex = '7';
  el.style.touchAction = 'none';
  const head = mk('div', 'map-level-title', title);
  head.setAttribute('aria-hidden', 'true');
  el.appendChild(head);
  const items: HTMLElement[] = [];
  if (opts.confirm) {
    const group = mk('div', 'map-level-group map-level-confirm');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'All');
    const yes = mk('button', 'map-level-item map-level-yes');
    yes.type = 'button';
    yes.setAttribute('role', 'menuitem');
    yes.dataset.level = 'confirm';
    yes.appendChild(mk('span', 'map-level-label', levelConfirmLabel(picker)));
    const no = mk('button', 'map-level-item map-level-no');
    no.type = 'button';
    no.setAttribute('role', 'menuitem');
    no.dataset.level = 'cancel';
    no.appendChild(mk('span', 'map-level-label', 'Cancel'));
    for (const b of [yes, no]) {
      b.tabIndex = -1;
      group.appendChild(b);
      items.push(b);
    }
    el.appendChild(group);
    return { el, items };
  }
  const group = mk('div', 'map-level-group');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Levels');
  group.dataset.row = 'levels';
  for (const it of picker.items) {
    const b = mk('button', 'map-level-item');
    b.type = 'button';
    b.tabIndex = -1;
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', it.checked ? 'true' : 'false');
    if (it.disabled) b.setAttribute('aria-disabled', 'true');
    b.dataset.level = String(it.key);
    b.setAttribute('aria-keyshortcuts', it.hint);
    b.appendChild(mk('span', 'map-level-label', levelItemLabel(it.key, opts.fine)));
    if (opts.fine && !it.disabled) b.appendChild(mk('span', 'map-level-count', levelItemCount(it)));
    const kbd = mk('kbd', 'map-level-key', it.hint);
    kbd.setAttribute('aria-hidden', 'true');
    b.appendChild(kbd);
    b.setAttribute(
      'aria-label',
      opts.fine && !it.disabled ? `${levelItemName(it.key)}, ${levelItemCount(it)}` : levelItemName(it.key),
    );
    group.appendChild(b);
    items.push(b);
  }
  el.appendChild(group);
  return { el, items };
}
