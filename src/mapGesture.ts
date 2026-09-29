/**
 * Phase-1 map gestures (0.2.18): anchored pinch+pan and wheel intent.
 * Rubber-band, inertia, and double-tap stay in phase 2.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Cam {
  x: number;
  y: number;
  k: number;
}

export const MIN_PINCH_DIST = 16;
export const SCALE_DEADZONE_PX = 12;

export type GestureMode = 'idle' | 'pending' | 'pan' | 'pinch';

export function slopPx(pointerType: string): number {
  if (pointerType === 'pen') return 8;
  if (pointerType === 'mouse') return 4;
  return 10;
}

export function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function spread(a: Pt, b: Pt): number {
  return Math.max(MIN_PINCH_DIST, Math.hypot(a.x - b.x, a.y - b.y));
}

export interface PinchAnchor {
  d0: number;
  k0: number;
  W: Pt;
  scaleLive: boolean;
}

/** Remember the map point under the midpoint. Zoom starts after the dead-zone. */
export function anchorPinch(cam: Cam, a: Pt, b: Pt): PinchAnchor {
  const m = mid(a, b);
  return {
    d0: spread(a, b),
    k0: cam.k,
    W: { x: (m.x - cam.x) / cam.k, y: (m.y - cam.y) / cam.k },
    scaleLive: false,
  };
}

/** k = k0 × spread/spread0; camera keeps W under the current midpoint. */
export function pinchFrame(anchor: PinchAnchor, a: Pt, b: Pt): Cam {
  const m = mid(a, b);
  const d = spread(a, b);
  if (!anchor.scaleLive && Math.abs(d - anchor.d0) > SCALE_DEADZONE_PX) {
    anchor.scaleLive = true;
    anchor.d0 = d;
  }
  const k = anchor.scaleLive ? anchor.k0 * (d / anchor.d0) : anchor.k0;
  return { k, x: m.x - anchor.W.x * k, y: m.y - anchor.W.y * k };
}

export interface PanAnchor {
  W: Pt;
  k: number;
}

export function anchorPan(cam: Cam, p: Pt): PanAnchor {
  return {
    k: cam.k,
    W: { x: (p.x - cam.x) / cam.k, y: (p.y - cam.y) / cam.k },
  };
}

export function panFrame(anchor: PanAnchor, p: Pt): Cam {
  return { k: anchor.k, x: p.x - anchor.W.x * anchor.k, y: p.y - anchor.W.y * anchor.k };
}

/**
 * Finger-count transitions. A second finger always becomes a pinch.
 * Dropping to one finger continues as a pan. A third finger does not change mode.
 */
export function nextGestureMode(
  mode: GestureMode,
  pointerCount: number,
  movedPastSlop: boolean,
): GestureMode {
  if (pointerCount >= 2) return 'pinch';
  if (pointerCount === 1) {
    if (mode === 'pinch' || mode === 'pan') return 'pan';
    return movedPastSlop ? 'pan' : 'pending';
  }
  return 'idle';
}

export function normWheelDelta(delta: number, deltaMode: number, viewport: number): number {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * 0.9 * viewport;
  return delta;
}

export type WheelIntent =
  | { kind: 'pan'; dx: number; dy: number }
  | { kind: 'zoom'; s: number };

function clampStep(s: number): number {
  return Math.max(-0.25, Math.min(0.25, s));
}

/** Plain wheel pans. Ctrl/Cmd or wheel:'zoom' zooms. Shift with no deltaX scrolls sideways. */
export function wheelIntent(
  e: {
    deltaX: number;
    deltaY: number;
    deltaMode: number;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
  },
  mode: 'pan' | 'zoom',
  viewportH: number,
): WheelIntent {
  let dx = normWheelDelta(e.deltaX, e.deltaMode, viewportH);
  let dy = normWheelDelta(e.deltaY, e.deltaMode, viewportH);
  if (dx === 0 && e.shiftKey) {
    dx = dy;
    dy = 0;
  }
  if (e.ctrlKey || e.metaKey) return { kind: 'zoom', s: clampStep(-dy * 0.01) };
  if (mode === 'zoom') return { kind: 'zoom', s: clampStep(-dy * 0.002) };
  return { kind: 'pan', dx, dy };
}
