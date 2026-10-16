/**
 * Alternate-menu gesture arbiter (0.2.44, Colin 2026-10-16).
 *
 * One rule for every handle and pill on the map:
 * - Mouse: the primary button does the primary action (click, drag, resize,
 *   pan). The right button (or a pen barrel button) opens the alternate menu
 *   through `contextmenu` and never starts a pan, drag or resize.
 * - Touch / pen: a tap is the primary action. A press held still for
 *   {@link ALT_HOLD_MS} (within {@link altHoldSlop}) opens the alternate menu
 *   and the gesture is then the menu's: no pan, drag, resize or tap on lift.
 *   Moving past the slop before the timer cancels the hold and the gesture
 *   becomes the pan / drag / resize.
 *
 * Every pointer handler in `createMapView` (canvas pan, pinch, width resize,
 * fold-handle hold, node-menu hold) asks these helpers, so the slop and the
 * timing are the same everywhere.
 */

/** A still press this long opens the alternate menu (touch, pen). */
export const ALT_HOLD_MS = 500;
/** The progress ring appears this long into a hold. */
export const ALT_RING_MS = 150;

/** Movement that turns a press into a pan / drag (and cancels a hold): mouse 4, pen 8, touch 10 px. */
export function altHoldSlop(pointerType: string | undefined): number {
  if (pointerType === 'pen') return 8;
  if (pointerType === 'mouse' || !pointerType) return 4;
  return 10;
}

/** Net displacement / path length a move needs to count as deliberate (~45° of wobble). */
export const ALT_STRAIGHTNESS = 0.7;
/** Wobble cap, in slops: a press that strays this far from its start is a drag whatever its path. */
export const ALT_WOBBLE_CAP = 2.5;

/**
 * Whether a press has committed to a pan / drag / resize. Distance alone is
 * not enough: the net displacement must pass the slop AND be a large share
 * of the path travelled (consistent direction). Back-and-forth jitter keeps
 * the long-press candidate alive until it strays past the wobble cap.
 */
export function altDragCommits(p: { dx: number; dy: number; path: number; pointerType?: string }): boolean {
  const slop = altHoldSlop(p.pointerType);
  const net = Math.hypot(p.dx, p.dy);
  if (net <= slop) return false;
  if (net > slop * ALT_WOBBLE_CAP) return true;
  return net >= ALT_STRAIGHTNESS * Math.max(net, p.path);
}

export type AltPress = 'primary' | 'alt' | 'other';

/**
 * Classify a pointerdown. `alt` (right button, pen barrel) must never start a
 * pan, drag or resize; its `contextmenu` opens the menu. `other` (middle,
 * back, forward) is left alone.
 */
export function altPressKind(p: { button: number; buttons?: number; pointerType?: string }): AltPress {
  if (p.button === 2) return 'alt';
  if ((p.pointerType === 'pen' || p.pointerType === 'mouse') && ((p.buttons ?? 0) & 2) !== 0) return 'alt';
  if (p.button === 0 || p.button === -1) return 'primary';
  return 'other';
}

/** Whether the pointer may open its menu by holding (touch and pen; a mouse uses right-click). */
export function altHoldsOpenMenu(pointerType: string | undefined): boolean {
  return pointerType === 'touch' || pointerType === 'pen';
}

export type AltArbiterPhase = 'pending' | 'drag' | 'menu' | 'cancelled';

/** One press under arbitration, from pointerdown to release. */
export interface AltArbiter {
  pointerType: string;
  x0: number;
  y0: number;
  t0: number;
  /** False when nothing on this target opens a menu by holding (moves still go to drag). */
  holdable: boolean;
  /** Last position and path length travelled (for the direction test). */
  x: number;
  y: number;
  path: number;
  phase: AltArbiterPhase;
}

export function altArbiterStart(p: {
  pointerType: string;
  x: number;
  y: number;
  t: number;
  holdable?: boolean;
}): AltArbiter {
  return {
    pointerType: p.pointerType || 'mouse',
    x0: p.x,
    y0: p.y,
    t0: p.t,
    holdable: p.holdable !== false && altHoldsOpenMenu(p.pointerType),
    x: p.x,
    y: p.y,
    path: 0,
    phase: 'pending',
  };
}

/** A move: a deliberate one (see altDragCommits) while pending becomes a drag (the hold is gone); a menu never drags. */
export function altArbiterMove(a: AltArbiter, x: number, y: number): AltArbiter {
  if (a.phase !== 'pending') return a;
  const path = a.path + Math.hypot(x - a.x, y - a.y);
  const next = { ...a, x, y, path };
  if (altDragCommits({ dx: x - a.x0, dy: y - a.y0, path, pointerType: a.pointerType })) return { ...next, phase: 'drag' };
  return next;
}

/** The hold timer: a still, holdable, pending press becomes the menu. */
export function altArbiterTick(a: AltArbiter, t: number): AltArbiter {
  if (a.phase !== 'pending' || !a.holdable) return a;
  return t - a.t0 >= ALT_HOLD_MS ? { ...a, phase: 'menu' } : a;
}

/** A second pointer, a pinch or a cancel ends arbitration without a menu. */
export function altArbiterCancel(a: AltArbiter): AltArbiter {
  return a.phase === 'menu' ? a : { ...a, phase: 'cancelled' };
}

/** Whether the press may move the map / resize / drag now. */
export function altArbiterAllowsDrag(a: AltArbiter): boolean {
  return a.phase === 'drag';
}

/** What the release does: `tap` (primary action), `consume` (menu opened: swallow), `none` (was a drag / cancelled). */
export function altArbiterRelease(a: AltArbiter): 'tap' | 'consume' | 'none' {
  if (a.phase === 'menu') return 'consume';
  if (a.phase === 'pending') return 'tap';
  return 'none';
}
