/**
 * Map camera: viewport guard (clamp) + follow focus/expand framing (0.2.13).
 * World space = layout/auto-pack coords; screen = world * k + cam.
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
/** Focus must sit this far inside the viewport to skip follow-pan. */
export const COMFORT_INSET_PX = 36;

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
 * True when the rect is fully (or nearly) inside the viewport with comfort inset.
 * Used to skip follow when focus is already comfortable.
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
  // Pan-only clamp — do not force zoom-in on small content (that fights follow framing).
  // Hard min/max k only; soft "don't shrink to a speck" is enforced in zoom-out callers.
  let k = Math.max(minK, Math.min(maxK, cam.k || 1));
  let x = cam.x;
  let y = cam.y;

  // Intersection of viewport with content screen-rect must stay non-empty
  // with `pad` margin (content edge must cross into the padded viewport).
  const cLeft = content.x * k;
  const cRight = (content.x + content.w) * k;
  const cTop = content.y * k;
  const cBottom = (content.y + content.h) * k;

  // left < vw - pad  ⇒  cLeft + x < vw - pad  ⇒  x < vw - pad - cLeft
  // right > pad      ⇒  cRight + x > pad      ⇒  x > pad - cRight
  const maxX = viewport.w - pad - cLeft;
  const minX = pad - cRight;
  const maxY = viewport.h - pad - cTop;
  const minY = pad - cBottom;

  if (minX <= maxX) {
    x = Math.min(maxX, Math.max(minX, x));
  } else {
    // Content wider than viewport (minus pads): centre on content
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
 * Target camera that frames `rects` with padding.
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
    const needW = group.w + (2 * pad) / Math.max(k, 0.01);
    const needH = group.h + (2 * pad) / Math.max(k, 0.01);
    // Iterate once with screen padding in world units ≈ pad/k
    const fit = Math.min(
      viewport.w / Math.max(1, group.w + (2 * pad) / k),
      viewport.h / Math.max(1, group.h + (2 * pad) / k),
    );
    if (Number.isFinite(fit) && fit > 0 && fit < k) {
      // Modest zoom-out only (don't go below 70% of fit or minK)
      k = Math.max(minK, Math.min(k, Math.max(fit * 0.92, fit)));
    }
    void needW;
    void needH;
  }
  k = Math.max(minK, Math.min(maxK, k));

  // Centre target point in viewport
  let x = viewport.w / 2 - tx * k;
  let y = viewport.h / 2 - ty * k;

  return clampCamToContent({ x, y, k }, viewport, group, {
    paddingPx: pad,
    minK,
    maxK,
  });
}

/**
 * Ensure a single focus rect is visible: no-op if comfortable; else frame it.
 */
export function camToEnsureVisible(
  cam: CamState,
  viewport: ViewportSize,
  focus: WorldRect,
  opts: {
    paddingPx?: number;
    insetPx?: number;
    minK?: number;
    maxK?: number;
  } = {},
): CamState {
  if (isRectComfortablyVisible(cam, viewport, focus, { insetPx: opts.insetPx })) {
    return { ...cam };
  }
  return camToFrameRects(cam, viewport, [focus], {
    paddingPx: opts.paddingPx,
    focus,
    focusBias: 1,
    minK: opts.minK,
    maxK: opts.maxK,
    allowZoomOut: true,
  });
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
 * Only raises k when content is large enough that fit is below current intent.
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
  // When content is bigger than the viewport, don't zoom out below ~55% of fit.
  if (content.w * minK > viewport.w * 0.5 || content.h * minK > viewport.h * 0.5) {
    return Math.max(minK, Math.min(maxK, fit * 0.55));
  }
  void pad;
  return minK;
}
