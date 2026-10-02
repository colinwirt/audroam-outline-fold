/**
 * Map camera: viewport guard (clamp) + proportion follow focus/expand (0.2.14).
 * World space = layout/auto-pack coords; screen = world * k + cam.
 *
 * Follow uses visible fraction of focus (not binary fully-off):
 *   ≥ keep (~0.6) and the pill fits the viewport → no-op
 *   pill taller or wider than the viewport → ensure (zoom out so the whole pill, including more/less, is on screen)
 *   below keep → ensure-visible (gentle)
 *   recentre when cameraRecentre on AND (expand kids hint OR fraction ≲ 0.25)
 */

export interface CamState {
  x: number;
  y: number;
  k: number;
}

export interface ViewportSize {
  w: number;
  h: number;
}

/** Axis-aligned rect in world (layout) coordinates — top-left origin. */
export interface WorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DEFAULT_CAM_PADDING_PX = 56;
export const DEFAULT_FOLLOW_EASE_MS = 280;
/** Legacy comfort inset (fully-inside check); prefer visible-fraction APIs. */
export const COMFORT_INSET_PX = 36;
/** Visible fraction ≥ this → leave camera alone. */
export const DEFAULT_KEEP_VISIBLE_FRAC = 0.6;
/** Visible fraction ≤ this (with recentre on) → full recentre. */
export const DEFAULT_RECENTRE_FRAC = 0.25;

export type FollowAction = 'noop' | 'ensure' | 'recentre';

export function pillWorldRect(
  cx: number,
  cy: number,
  w: number,
  h: number,
): WorldRect {
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function unionWorldRects(rects: WorldRect[]): WorldRect | null {
  if (!rects.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (!r || !(r.w >= 0) || !(r.h >= 0)) continue;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Screen-space AABB of a world rect under cam. */
export function worldRectToScreen(
  rect: WorldRect,
  cam: CamState,
): { left: number; top: number; right: number; bottom: number } {
  return {
    left: rect.x * cam.k + cam.x,
    top: rect.y * cam.k + cam.y,
    right: (rect.x + rect.w) * cam.k + cam.x,
    bottom: (rect.y + rect.h) * cam.k + cam.y,
  };
}

/**
 * Visible fraction of a world rect inside the viewport (area ∩ / area).
 * Returns 0 when fully off-screen or zero-area; 1 when fully on-screen.
 */
export function visibleFractionOfRect(
  cam: CamState,
  viewport: ViewportSize,
  rect: WorldRect,
): number {
  const sw = rect.w * cam.k;
  const sh = rect.h * cam.k;
  const area = sw * sh;
  if (!(area > 0) || !Number.isFinite(area)) return 0;
  const s = worldRectToScreen(rect, cam);
  const iLeft = Math.max(0, s.left);
  const iTop = Math.max(0, s.top);
  const iRight = Math.min(viewport.w, s.right);
  const iBottom = Math.min(viewport.h, s.bottom);
  const iw = iRight - iLeft;
  const ih = iBottom - iTop;
  if (iw <= 0 || ih <= 0) return 0;
  return Math.max(0, Math.min(1, (iw * ih) / area));
}

/**
 * True when the rect is fully (or nearly) inside the viewport with comfort inset.
 */
export function isRectComfortablyVisible(
  cam: CamState,
  viewport: ViewportSize,
  rect: WorldRect,
  opts: { insetPx?: number } = {},
): boolean {
  const inset = opts.insetPx ?? COMFORT_INSET_PX;
  const s = worldRectToScreen(rect, cam);
  return (
    s.left >= inset &&
    s.top >= inset &&
    s.right <= viewport.w - inset &&
    s.bottom <= viewport.h - inset
  );
}

/** True when world rect has any non-empty intersection with the viewport. */
export function isRectIntersectingViewport(
  cam: CamState,
  viewport: ViewportSize,
  rect: WorldRect,
): boolean {
  return visibleFractionOfRect(cam, viewport, rect) > 0;
}

/** Completely invisible: bbox ∩ viewport = ∅. */
export function isRectFullyInvisible(
  cam: CamState,
  viewport: ViewportSize,
  rect: WorldRect,
): boolean {
  return visibleFractionOfRect(cam, viewport, rect) <= 0;
}

/**
 * Decide follow action for a focus change (click / arrows / hop).
 * recentre=false → never returns 'recentre' (ensure still runs below keep).
 */
export function followActionForFocus(
  cam: CamState,
  viewport: ViewportSize,
  focus: WorldRect,
  opts: {
    keepFrac?: number;
    recentreFrac?: number;
    recentre?: boolean;
  } = {},
): FollowAction {
  const keep = opts.keepFrac ?? DEFAULT_KEEP_VISIBLE_FRAC;
  const recentreAt = opts.recentreFrac ?? DEFAULT_RECENTRE_FRAC;
  const recentre = opts.recentre !== false;
  const frac = visibleFractionOfRect(cam, viewport, focus);
  const pad = DEFAULT_CAM_PADDING_PX;
  const fits =
    focus.w * cam.k <= viewport.w - pad * 2 &&
    focus.h * cam.k <= viewport.h - pad * 2;
  if (!fits) return 'ensure';
  const screen = worldRectToScreen(focus, cam);
  const inside =
    screen.top >= pad &&
    screen.left >= pad &&
    screen.bottom <= viewport.h - pad &&
    screen.right <= viewport.w - pad;
  if (inside) return 'noop';
  if (frac >= keep) return 'ensure';
  if (recentre && frac <= recentreAt) return 'recentre';
  return 'ensure';
}

/**
 * Decide follow action after expand / digits pack.
 * Recentre hint when recentre on and new kids (or focus) mostly off-screen.
 * When recentre off: ensure focus only if below keep.
 */
export function followActionForExpand(
  cam: CamState,
  viewport: ViewportSize,
  focus: WorldRect,
  newKids: WorldRect[],
  opts: {
    keepFrac?: number;
    recentreFrac?: number;
    recentre?: boolean;
  } = {},
): FollowAction {
  const keep = opts.keepFrac ?? DEFAULT_KEEP_VISIBLE_FRAC;
  const recentreAt = opts.recentreFrac ?? DEFAULT_RECENTRE_FRAC;
  const recentre = opts.recentre !== false;
  const focusFrac = visibleFractionOfRect(cam, viewport, focus);

  if (recentre) {
    let kidsFrac = 1;
    if (newKids.length) {
      const kidsUnion = unionWorldRects(newKids);
      kidsFrac = kidsUnion
        ? visibleFractionOfRect(cam, viewport, kidsUnion)
        : 1;
    }
    // Expand hint: kids mostly off-screen, or focus very low → recentre group
    if (newKids.length && kidsFrac <= recentreAt) return 'recentre';
    if (focusFrac <= recentreAt) return 'recentre';
  }

  if (focusFrac >= keep) return 'noop';
  return 'ensure';
}

/**
 * Clamp pan (and optionally floor zoom) so viewport always intersects
 * content+padding — no “lost in empty infinity”.
 */
export function clampCamToContent(
  cam: CamState,
  viewport: ViewportSize,
  content: WorldRect,
  opts: {
    paddingPx?: number;
    minK?: number;
    maxK?: number;
  } = {},
): CamState {
  const pad = opts.paddingPx ?? DEFAULT_CAM_PADDING_PX;
  const minK = opts.minK ?? 0.35;
  const maxK = opts.maxK ?? 3.5;
  let k = Math.max(minK, Math.min(maxK, cam.k || 1));
  let x = cam.x;
  let y = cam.y;

  const cLeft = content.x * k;
  const cRight = (content.x + content.w) * k;
  const cTop = content.y * k;
  const cBottom = (content.y + content.h) * k;

  const maxX = viewport.w - pad - cLeft;
  const minX = pad - cRight;
  const maxY = viewport.h - pad - cTop;
  const minY = pad - cBottom;

  if (minX <= maxX) {
    x = Math.min(maxX, Math.max(minX, x));
  } else {
    x = (viewport.w - (cLeft + cRight)) / 2;
  }
  if (minY <= maxY) {
    y = Math.min(maxY, Math.max(minY, y));
  } else {
    y = (viewport.h - (cTop + cBottom)) / 2;
  }

  return { x, y, k };
}

/**
 * Target camera that frames `rects` with padding (recentre).
 * Centroid bias: when `focus` is set, blend group centre toward focus (default 0.6).
 * Modest zoom-out only — never zooms in past current k (pan-first).
 */
export function camToFrameRects(
  cam: CamState,
  viewport: ViewportSize,
  rects: WorldRect[],
  opts: {
    paddingPx?: number;
    focus?: WorldRect | null;
    focusBias?: number;
    minK?: number;
    maxK?: number;
    /** If true, allow zooming out so the group fits; never zoom in. Default true. */
    allowZoomOut?: boolean;
  } = {},
): CamState {
  const group = unionWorldRects(rects);
  if (!group) return { ...cam };
  const pad = opts.paddingPx ?? DEFAULT_CAM_PADDING_PX;
  const bias = opts.focusBias ?? 0.6;
  const minK = opts.minK ?? 0.35;
  const maxK = opts.maxK ?? 3.5;
  const allowZoomOut = opts.allowZoomOut !== false;

  const focus = opts.focus ?? null;
  const gx = group.x + group.w / 2;
  const gy = group.y + group.h / 2;
  let tx = gx;
  let ty = gy;
  if (focus) {
    const fx = focus.x + focus.w / 2;
    const fy = focus.y + focus.h / 2;
    tx = fx * bias + gx * (1 - bias);
    ty = fy * bias + gy * (1 - bias);
  }

  let k = cam.k;
  if (allowZoomOut) {
    const fit = Math.min(
      viewport.w / Math.max(1, group.w + (2 * pad) / k),
      viewport.h / Math.max(1, group.h + (2 * pad) / k),
    );
    if (Number.isFinite(fit) && fit > 0 && fit < k) {
      k = Math.max(minK, Math.min(k, Math.max(fit * 0.92, fit)));
    }
  }
  k = Math.max(minK, Math.min(maxK, k));

  const x = viewport.w / 2 - tx * k;
  const y = viewport.h / 2 - ty * k;

  return clampCamToContent({ x, y, k }, viewport, group, {
    paddingPx: pad,
    minK,
    maxK,
  });
}

/**
 * Gentle ensure-visible: minimum pan (and zoom-out if needed) so `rect`
 * sits inside the viewport with padding. A pill taller than the pan floor
 * (0.35) may zoom further so its bottom controls stay on screen.
 * Does not centre unless required.
 * No-op when the pill already sits inside the padded viewport.
 */
export function camToEnsureVisible(
  cam: CamState,
  viewport: ViewportSize,
  focus: WorldRect,
  opts: {
    paddingPx?: number;
    insetPx?: number;
    keepFrac?: number;
    minK?: number;
    maxK?: number;
    /** When true, always nudge even if above keep (edit mode). Default false. */
    force?: boolean;
  } = {},
): CamState {
  const pad = opts.paddingPx ?? opts.insetPx ?? DEFAULT_CAM_PADDING_PX;
  const minK = opts.minK ?? 0.35;
  const maxK = opts.maxK ?? 3.5;
  const k0 = cam.k || 1;
  const screenNow = worldRectToScreen(focus, cam);
  const fits =
    focus.w * k0 <= viewport.w - pad * 2 &&
    focus.h * k0 <= viewport.h - pad * 2;
  const inside =
    fits &&
    screenNow.top >= pad &&
    screenNow.left >= pad &&
    screenNow.bottom <= viewport.h - pad &&
    screenNow.right <= viewport.w - pad;
  if (!opts.force && inside) {
    return { ...cam };
  }

  let k = Math.min(maxK, cam.k || 1);
  // Zoom out if the focus is larger than the padded viewport. The pan floor
  // (minK) must not pin a tall pill so its bottom control stays clipped.
  const needW = focus.w + (2 * pad) / Math.max(k, 0.01);
  const needH = focus.h + (2 * pad) / Math.max(k, 0.01);
  const fit = Math.min(viewport.w / Math.max(1, needW), viewport.h / Math.max(1, needH));
  if (Number.isFinite(fit) && fit > 0 && fit < k) {
    k = Math.max(0.12, fit * 0.95);
  }

  let x = cam.x;
  let y = cam.y;
  // Recompute screen after possible k change (keep world point under same screen intent)
  if (k !== cam.k) {
    const cx = (viewport.w / 2 - cam.x) / cam.k;
    const cy = (viewport.h / 2 - cam.y) / cam.k;
    x = viewport.w / 2 - cx * k;
    y = viewport.h / 2 - cy * k;
  }

  const s = worldRectToScreen(focus, { x, y, k });
  let dx = 0;
  let dy = 0;
  if (s.left < pad) dx = pad - s.left;
  else if (s.right > viewport.w - pad) dx = viewport.w - pad - s.right;
  const topOut = s.top < pad;
  const botOut = s.bottom > viewport.h - pad;
  // A pill taller than the viewport cannot show both edges. Keep the bottom
  // inside: that is where the body more/less control is drawn.
  if (topOut && botOut) dy = viewport.h - pad - s.bottom;
  else if (topOut) dy = pad - s.top;
  else if (botOut) dy = viewport.h - pad - s.bottom;

  return clampCamToContent(
    { x: x + dx, y: y + dy, k },
    viewport,
    focus,
    { paddingPx: pad, minK: Math.min(minK, k), maxK },
  );
}

/** Linear interpolate cameras (for ease). */
export function lerpCam(a: CamState, b: CamState, t: number): CamState {
  const u = Math.max(0, Math.min(1, t));
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    k: a.k + (b.k - a.k) * u,
  };
}

/** Ease-out cubic. */
export function easeOutCubic(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - u, 3);
}

/**
 * Soft min zoom: content+padding should not shrink to a speck.
 */
export function minKForContent(
  viewport: ViewportSize,
  content: WorldRect,
  opts: { paddingPx?: number; minK?: number; maxK?: number } = {},
): number {
  const pad = opts.paddingPx ?? DEFAULT_CAM_PADDING_PX;
  const minK = opts.minK ?? 0.35;
  const maxK = opts.maxK ?? 3.5;
  const fit = Math.min(
    viewport.w / Math.max(1, content.w),
    viewport.h / Math.max(1, content.h),
  );
  if (!Number.isFinite(fit) || fit <= 0) return minK;
  if (content.w * minK > viewport.w * 0.5 || content.h * minK > viewport.h * 0.5) {
    return Math.max(minK, Math.min(maxK, fit * 0.55));
  }
  void pad;
  return minK;
}
