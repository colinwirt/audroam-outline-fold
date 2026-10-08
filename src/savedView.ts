/**
 * Saved map view, phase 1 package side (Design UX 2026-10-08, V1, V2, V4–V9,
 * V12, V14). Pure maths plus the v2 localStorage record. The host wires it:
 * capture on camera settle, restore after folds are painted, flush on
 * pagehide.
 *
 * A view is anchored to a node, not to pan pixels: the focus pill's left
 * edge and vertical centre as fractions of the viewport, the zoom, and the
 * viewport size at save time. Records hold ids and numbers only.
 */

import type { CamState, ViewportSize, WorldRect } from './mapCamera.js';
import { DEFAULT_CAM_PADDING_PX, visibleFractionOfRect } from './mapCamera.js';
import type { MapNodeNudge, MapResumeState } from './mapResume.js';
import { isCollapsed } from './fold.js';
import type { FoldState, OutlineFoldDoc, OutlineNode } from './types.js';

/** Same zoom range as createMapView. */
export const VIEW_K_MIN = 0.35;
export const VIEW_K_MAX = 3.5;
/** Same shape: aspect within ±15% and width within ±25% (V5). */
export const VIEW_ASPECT_TOLERANCE = 0.15;
export const VIEW_WIDTH_TOLERANCE = 0.25;
/** Wide slot: width ≥ 600 px and aspect ≥ 0.8 (V7). */
export const VIEW_WIDE_MIN_W = 600;
export const VIEW_WIDE_MIN_ASPECT = 0.8;
/** A different shape never zooms out past this, unless the saved zoom was lower (V6). */
export const VIEW_FALLBACK_K_FLOOR = 0.75;
/** A frame wider than the screen puts its left edge here (V6). */
export const VIEW_WIDE_FRAME_LEFT_PX = 16;
/** The selected node is the focus when this much of it shows (V8). */
export const VIEW_SELECTED_KEEP_FRAC = 0.6;

/** One saved view (V1). */
export interface SavedView {
  /** Anchor node id (or outline position key when the node has no id). */
  focus: string;
  /** Ancestor ids of the focus, root first. */
  path: string[];
  /** Focus pill left edge, as a fraction of the viewport width. */
  fx: number;
  /** Focus pill vertical centre, as a fraction of the viewport height. */
  fy: number;
  k: number;
  /** Viewport in CSS px at save time. */
  vw: number;
  vh: number;
  /** Save time (ms). */
  at: number;
  /** Re-select the focus on restore. */
  sel?: boolean;
}

export type ViewSlot = 'wide' | 'narrow';

/** Personal record v2 (V2). The v1 camera is dropped; v1 folds are kept. */
export interface MapResumeStateV2 {
  version: 2;
  fold?: FoldState;
  views?: Partial<Record<ViewSlot, SavedView>>;
  nudges?: Record<string, MapNodeNudge>;
  savedAt?: number;
}

/** "Start with" preference (V11), per user for all notes. */
export type ViewStartWith = 'last' | 'fitted' | 'author';

export interface ViewPrefs {
  startWith: ViewStartWith;
}

/** Personal view key: `of-map:u{userId}:pnid:{pnid}` (V2). */
export function savedViewStorageKey(userId: string | number, pnid: string | number): string {
  return `of-map:u${userId}:pnid:${pnid}`;
}

/** Per-user preferences key: `of-map:u{userId}:prefs` (V11). */
export function viewPrefsStorageKey(userId: string | number): string {
  return `of-map:u${userId}:prefs`;
}

/** Wide when width ≥ 600 px and aspect ≥ 0.8, else narrow (V7). */
export function viewSlotFor(viewport: ViewportSize): ViewSlot {
  const aspect = viewport.w / Math.max(1, viewport.h);
  return viewport.w >= VIEW_WIDE_MIN_W && aspect >= VIEW_WIDE_MIN_ASPECT ? 'wide' : 'narrow';
}

/** Same shape: aspect within ±15% and width within ±25% of the saved view (V5). */
export function isSameViewShape(view: Pick<SavedView, 'vw' | 'vh'>, viewport: ViewportSize): boolean {
  if (!(view.vw > 0 && view.vh > 0 && viewport.w > 0 && viewport.h > 0)) return false;
  const aspect = viewport.w / viewport.h / (view.vw / view.vh);
  const width = viewport.w / view.vw;
  // Small epsilon so a value on the boundary counts as inside.
  return Math.abs(aspect - 1) <= VIEW_ASPECT_TOLERANCE + 1e-9 && Math.abs(width - 1) <= VIEW_WIDTH_TOLERANCE + 1e-9;
}

function clampK(k: number): number {
  return Math.max(VIEW_K_MIN, Math.min(VIEW_K_MAX, k));
}

/** Capture a view from the camera and the focus pill's world rect (V1). */
export function captureSavedView(
  cam: CamState,
  viewport: ViewportSize,
  focus: { id: string; path: string[]; rect: WorldRect; selected?: boolean },
  now: number = Date.now(),
): SavedView {
  const left = focus.rect.x * cam.k + cam.x;
  const midY = (focus.rect.y + focus.rect.h / 2) * cam.k + cam.y;
  const view: SavedView = {
    focus: focus.id,
    path: [...focus.path],
    fx: left / viewport.w,
    fy: midY / viewport.h,
    k: cam.k,
    vw: viewport.w,
    vh: viewport.h,
    at: now,
  };
  if (focus.selected) view.sel = true;
  return view;
}

/** Camera that puts the focus pill's left edge and centre at (fx, fy) at zoom k. */
function placeFocus(fx: number, fy: number, k: number, rect: WorldRect, viewport: ViewportSize): CamState {
  return {
    x: fx * viewport.w - rect.x * k,
    y: fy * viewport.h - (rect.y + rect.h / 2) * k,
    k,
  };
}

/** Exact restore: the focus pill back at (fx, fy), zoom k clamped to 0.35–3.5 (V5). */
export function exactViewCam(view: SavedView, focusRect: WorldRect, viewport: ViewportSize): CamState {
  return placeFocus(view.fx, view.fy, clampK(view.k), focusRect, viewport);
}

/**
 * Different shape: anchored fit around the same node (V6).
 * - zoom fits `frame` (the focus pill plus its visible children) inside the
 *   padding, between min(k_saved, 0.75) and k_saved, then 0.35–3.5;
 * - the focus pill goes to (fx, fy), then the frame is shifted inside the
 *   padding; a frame wider than the screen puts its left edge at 16 px.
 */
export function anchoredFitViewCam(
  view: SavedView,
  focusRect: WorldRect,
  frame: WorldRect,
  viewport: ViewportSize,
  opts: { paddingPx?: number } = {},
): CamState {
  const pad = opts.paddingPx ?? DEFAULT_CAM_PADDING_PX;
  const fitK = Math.min(
    (viewport.w - 2 * pad) / Math.max(1, frame.w),
    (viewport.h - 2 * pad) / Math.max(1, frame.h),
  );
  const floor = Math.min(view.k, VIEW_FALLBACK_K_FLOOR);
  const ceil = view.k;
  const k = clampK(Math.max(floor, Math.min(ceil, fitK)));
  const cam = placeFocus(view.fx, view.fy, k, focusRect, viewport);

  const left = frame.x * k + cam.x;
  const right = (frame.x + frame.w) * k + cam.x;
  if (frame.w * k > viewport.w - 2 * pad) {
    cam.x += VIEW_WIDE_FRAME_LEFT_PX - left;
  } else if (left < pad) {
    cam.x += pad - left;
  } else if (right > viewport.w - pad) {
    cam.x -= right - (viewport.w - pad);
  }

  const top = frame.y * k + cam.y;
  const bottom = (frame.y + frame.h) * k + cam.y;
  if (frame.h * k <= viewport.h - 2 * pad) {
    if (top < pad) cam.y += pad - top;
    else if (bottom > viewport.h - pad) cam.y -= bottom - (viewport.h - pad);
  }
  // A frame taller than the screen keeps the focus at fy (the spec names no rule).
  return cam;
}

/** Pick the view for this screen: the matching slot, else the other one (V7). */
export function pickSavedView(
  record: Pick<MapResumeStateV2, 'views'> | null | undefined,
  viewport: ViewportSize,
): { view: SavedView; slot: ViewSlot; exact: boolean } | null {
  const views = record?.views;
  if (!views) return null;
  const slot = viewSlotFor(viewport);
  const other: ViewSlot = slot === 'wide' ? 'narrow' : 'wide';
  const mine = views[slot];
  if (mine) return { view: mine, slot, exact: isSameViewShape(mine, viewport) };
  const theirs = views[other];
  if (theirs) return { view: theirs, slot: other, exact: false };
  return null;
}

/**
 * Focus for a capture (V8): the selected node if at least 60% of it shows,
 * else the pill whose centre is nearest the viewport centre.
 */
export function chooseViewFocus(
  cam: CamState,
  viewport: ViewportSize,
  pills: Array<{ id: string; rect: WorldRect }>,
  selectedId?: string | null,
): { id: string; selected: boolean } | null {
  if (selectedId) {
    const sel = pills.find((p) => p.id === selectedId);
    if (sel && visibleFractionOfRect(cam, viewport, sel.rect) >= VIEW_SELECTED_KEEP_FRAC) {
      return { id: sel.id, selected: true };
    }
  }
  const cx = viewport.w / 2;
  const cy = viewport.h / 2;
  let best: { id: string; d: number } | null = null;
  for (const p of pills) {
    const sx = (p.rect.x + p.rect.w / 2) * cam.k + cam.x;
    const sy = (p.rect.y + p.rect.h / 2) * cam.k + cam.y;
    const d = (sx - cx) ** 2 + (sy - cy) ** 2;
    if (!best || d < best.d) best = { id: p.id, d };
  }
  return best ? { id: best.id, selected: false } : null;
}

function ancestorsOf(nodes: OutlineNode[], id: string, trail: OutlineNode[] = []): OutlineNode[] | null {
  for (const n of nodes) {
    if (n.id === id) return trail;
    if (n.children?.length) {
      const hit = ancestorsOf(n.children, id, [...trail, n]);
      if (hit) return hit;
    }
  }
  return null;
}

export type ViewAnchor =
  /** The focus itself shows. */
  | { kind: 'focus'; id: string }
  /** The focus is folded away: anchor its nearest visible ancestor at the same fx, fy, k. */
  | { kind: 'hidden'; id: string; hiddenId: string }
  /** The focus is gone: nearest surviving id in path, restored through V6. */
  | { kind: 'moved'; id: string }
  /** Nothing survives: Fit. */
  | { kind: 'fit' };

/** Where to anchor a saved view in the doc as it is now (V8, V9). Never opens folds. */
export function resolveViewAnchor(doc: OutlineFoldDoc, view: Pick<SavedView, 'focus' | 'path'>): ViewAnchor {
  const visibleAncestor = (id: string): { id: string; folded: boolean } | null => {
    const trail = ancestorsOf(doc.nodes, id);
    if (!trail) return null;
    // The first collapsed ancestor from the root hides everything below it.
    for (const a of trail) {
      if (a.id && isCollapsed(doc, a.id)) return { id: a.id, folded: true };
    }
    return { id, folded: false };
  };
  const trail = ancestorsOf(doc.nodes, view.focus);
  const pathMatches =
    !!trail && (view.path.length === 0 || trail.map((a) => a.id ?? '').join('/') === view.path.join('/'));
  if (trail && pathMatches) {
    const v = visibleAncestor(view.focus)!;
    return v.folded ? { kind: 'hidden', id: v.id, hiddenId: view.focus } : { kind: 'focus', id: view.focus };
  }
  for (let i = view.path.length - 1; i >= 0; i--) {
    const id = view.path[i]!;
    const v = visibleAncestor(id);
    if (v) return { kind: 'moved', id: v.id };
  }
  return { kind: 'fit' };
}

/** Camera source on load and for `v` (V4, V12): last view, else author view, else Fit. */
export function viewStartSource(
  startWith: ViewStartWith,
  has: { personal: boolean; author: boolean },
): 'last' | 'author' | 'fit' {
  if (startWith === 'fitted') return 'fit';
  if (startWith === 'author') return has.author ? 'author' : has.personal ? 'last' : 'fit';
  return has.personal ? 'last' : has.author ? 'author' : 'fit';
}

/** Live text, one per load (V14). */
export function viewRestoreAnnouncement(
  how: 'exact' | 'fitted' | 'author' | 'hidden',
  title: string,
  shownTitle?: string,
): string {
  if (how === 'exact') return `Last view restored. ${title}.`;
  if (how === 'fitted') return `Last view, fitted to this screen. ${title}.`;
  if (how === 'author') return `Author's view. ${title}.`;
  return `${title} is hidden. Showing ${shownTitle ?? ''}.`;
}

/** v1 → v2: keep folds and nudges, drop the camera (it has no viewport). */
export function migrateResumeToV2(v1: MapResumeState): MapResumeStateV2 {
  const out: MapResumeStateV2 = { version: 2 };
  if (v1.fold) out.fold = { mode: v1.fold.mode, ids: [...v1.fold.ids] };
  if (v1.nudges) out.nudges = { ...v1.nudges };
  if (v1.savedAt) out.savedAt = v1.savedAt;
  return out;
}

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Load a v2 record; a v1 record comes back migrated. */
export function loadSavedViews(key: string, storage: Storage | null = store()): MapResumeStateV2 | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version === 2) return parsed as MapResumeStateV2;
    if (parsed?.version === 1) return migrateResumeToV2(parsed as MapResumeState);
    return null;
  } catch {
    return null;
  }
}

function cleanView(v: SavedView): SavedView {
  const out: SavedView = {
    focus: String(v.focus),
    path: (v.path || []).map(String),
    fx: Number(v.fx),
    fy: Number(v.fy),
    k: Number(v.k),
    vw: Number(v.vw),
    vh: Number(v.vh),
    at: Number(v.at),
  };
  if (v.sel) out.sel = true;
  return out;
}

/** Save one slot's view (ids and numbers only); the other slot is kept (V7). */
export function saveSavedView(
  key: string,
  slot: ViewSlot,
  view: SavedView,
  opts: { fold?: FoldState; storage?: Storage | null; now?: number } = {},
): MapResumeStateV2 {
  const storage = opts.storage === undefined ? store() : opts.storage;
  const prev = loadSavedViews(key, storage) ?? { version: 2 as const };
  const next: MapResumeStateV2 = {
    ...prev,
    version: 2,
    views: { ...(prev.views || {}), [slot]: cleanView(view) },
    savedAt: opts.now ?? Date.now(),
  };
  if (opts.fold) next.fold = { mode: opts.fold.mode, ids: [...opts.fold.ids] };
  try {
    storage?.setItem(key, JSON.stringify(next));
  } catch {
    /* private mode / quota */
  }
  return next;
}

/** Forget my views (this note): drop both slots, keep folds (V11). */
export function forgetSavedViews(key: string, storage: Storage | null = store()): void {
  const prev = loadSavedViews(key, storage);
  if (!prev) return;
  const { views: _drop, ...rest } = prev;
  try {
    storage?.setItem(key, JSON.stringify(rest));
  } catch {
    /* ignore */
  }
}

/** Sign-out: remove every `of-map:u{userId}:*` key (V2, V13). Returns how many. */
export function clearUserMapState(userId: string | number, storage: Storage | null = store()): number {
  if (!storage) return 0;
  const prefix = `of-map:u${userId}:`;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith(prefix)) keys.push(k);
  }
  for (const k of keys) storage.removeItem(k);
  return keys.length;
}

/** Read the per-user "Start with" preference; Last view by default (V11). */
export function loadViewPrefs(userId: string | number, storage: Storage | null = store()): ViewPrefs {
  try {
    const raw = storage?.getItem(viewPrefsStorageKey(userId));
    const parsed = raw ? JSON.parse(raw) : null;
    const s = parsed?.startWith;
    if (s === 'last' || s === 'fitted' || s === 'author') return { startWith: s };
  } catch {
    /* fall through */
  }
  return { startWith: 'last' };
}

export function saveViewPrefs(userId: string | number, prefs: ViewPrefs, storage: Storage | null = store()): void {
  try {
    storage?.setItem(viewPrefsStorageKey(userId), JSON.stringify({ startWith: prefs.startWith }));
  } catch {
    /* ignore */
  }
}
