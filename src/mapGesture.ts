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
 * A pinch keeps its mode when one finger lifts, so the remaining finger
 * cannot pan or fling. One-finger pan resumes only after a later gesture
 * that starts from idle. A third finger does not change mode.
 */
export function nextGestureMode(
  mode: GestureMode,
  pointerCount: number,
  movedPastSlop: boolean,
): GestureMode {
  if (pointerCount >= 2) return 'pinch';
  if (pointerCount === 1) {
    if (mode === 'pinch') return 'pinch';
    if (mode === 'pan') return 'pan';
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

/** Overshoot resistance. Result stays below `limit` (56px pan, or ln(1.25) for zoom). */
export function rubberOffset(distance: number, limit = 56, c = 0.15): number {
  if (distance <= 0 || limit <= 0) return 0;
  return (distance * limit * c) / (limit + c * distance);
}

/** Pull an axis toward the hard range, leaving at most `limit` of overshoot. */
export function softAxis(value: number, min: number, max: number, limit = 56, c = 0.15): number {
  if (value > max) return max + rubberOffset(value - max, limit, c);
  if (value < min) return min - rubberOffset(min - value, limit, c);
  return value;
}

/** Zoom overshoot in log space. `hardK` is already inside [minK, maxK]. */
export function softZoom(kRaw: number, hardK: number, limitLn = Math.log(1.25), c = 0.15): number {
  if (kRaw <= 0 || hardK <= 0) return hardK;
  if (Math.abs(kRaw - hardK) < 1e-6) return hardK;
  const past = kRaw > hardK;
  const d = Math.abs(Math.log(kRaw / hardK));
  const shown = rubberOffset(d, limitLn, c);
  return hardK * Math.exp(past ? shown : -shown);
}

export const INERTIA_TAU_MS = 250;

export function decayVelocity(v: number, dtMs: number, tau = INERTIA_TAU_MS): number {
  if (dtMs <= 0) return v;
  return v * Math.exp(-dtMs / tau);
}

/** Touch/pen only, fast enough, finger not paused, motion allowed. */
export function inertiaEligible(opts: {
  pointerType: string;
  speedPxPerMs: number;
  sinceLastMoveMs: number;
  reducedMotion: boolean;
  enabled: boolean;
}): boolean {
  if (!opts.enabled || opts.reducedMotion) return false;
  if (opts.pointerType !== 'touch' && opts.pointerType !== 'pen') return false;
  if (opts.sinceLastMoveMs > 50) return false;
  return opts.speedPxPerMs >= 0.25;
}

export type LiftAction = 'retarget-pinch' | 'hold' | 'retarget-pan' | 'release';

/**
 * What a driver-pointer lift does. A pinch that still has two drivers retargets.
 * One remaining finger holds: no one-finger pan until a later gesture that
 * starts with every finger up. `singlePanLocked` remembers that hold so the
 * final lift does not fling.
 */
export function afterLift(
  mode: GestureMode,
  driversLeft: number,
  singlePanLocked: boolean,
): { mode: GestureMode; singlePanLocked: boolean; action: LiftAction; skipFling: boolean } {
  if (mode === 'pinch' && driversLeft >= 2) {
    return { mode: 'pinch', singlePanLocked, action: 'retarget-pinch', skipFling: false };
  }
  if (mode === 'pinch' && driversLeft >= 1) {
    return { mode: 'pinch', singlePanLocked: true, action: 'hold', skipFling: false };
  }
  if (mode === 'pan' && driversLeft === 1 && !singlePanLocked) {
    return { mode: 'pan', singlePanLocked, action: 'retarget-pan', skipFling: false };
  }
  if (driversLeft === 0) {
    return { mode: 'idle', singlePanLocked: false, action: 'release', skipFling: singlePanLocked };
  }
  return { mode, singlePanLocked, action: 'hold', skipFling: false };
}

/**
 * True when shifting the camera by (dx, dy) would leave the content union
 * with no intersection with the viewport. That sample is noise, not a pan.
 */
export function translationClearsContent(
  dx: number,
  dy: number,
  cam: { x: number; y: number; k: number },
  content: { x: number; y: number; w: number; h: number },
  viewport: { w: number; h: number },
): boolean {
  if (content.w <= 0 || content.h <= 0 || viewport.w <= 0 || viewport.h <= 0) return false;
  const left = content.x * cam.k + cam.x + dx;
  const right = left + content.w * cam.k;
  const top = content.y * cam.k + cam.y + dy;
  const bottom = top + content.h * cam.k;
  return right <= 0 || left >= viewport.w || bottom <= 0 || top >= viewport.h;
}

/** Coast distance is v * tau. A coast that clears the viewport is noise. */
export function flingClearsContent(
  vx: number,
  vy: number,
  cam: { x: number; y: number; k: number },
  content: { x: number; y: number; w: number; h: number },
  viewport: { w: number; h: number },
  tau = INERTIA_TAU_MS,
): boolean {
  return translationClearsContent(vx * tau, vy * tau, cam, content, viewport);
}

export function capSpeed(vx: number, vy: number, max = 3): { vx: number; vy: number } {
  const s = Math.hypot(vx, vy);
  if (s <= max || s === 0) return { vx, vy };
  const k = max / s;
  return { vx: vx * k, vy: vy * k };
}

/** Speed from samples in the last 100ms. Units are px/ms. */
export function velocityFromSamples(
  samples: { t: number; x: number; y: number }[],
  now: number,
): { vx: number; vy: number; sinceLastMoveMs: number } {
  const recent = samples.filter((s) => now - s.t <= 100);
  if (recent.length < 2) {
    const last = samples[samples.length - 1];
    return { vx: 0, vy: 0, sinceLastMoveMs: last ? now - last.t : Infinity };
  }
  const a = recent[0];
  const b = recent[recent.length - 1];
  const dt = b.t - a.t;
  const since = now - b.t;
  if (dt <= 0) return { vx: 0, vy: 0, sinceLastMoveMs: since };
  return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt, sinceLastMoveMs: since };
}

export function isDoubleTap(dtMs: number, distPx: number): boolean {
  return dtMs > 0 && dtMs <= 300 && distPx <= 30;
}

export function isTwoFingerTap(opts: {
  secondDownDelayMs: number;
  spanMs: number;
  movedA: number;
  movedB: number;
  scaleLive: boolean;
}): boolean {
  return (
    opts.secondDownDelayMs <= 150 &&
    opts.spanMs <= 300 &&
    opts.movedA <= 10 &&
    opts.movedB <= 10 &&
    !opts.scaleLive
  );
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
