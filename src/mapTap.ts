/**
 * Single-tap activation helpers (0.2.30).
 *
 * - `armSwallow` / `swallowConsumes`: the map's one-shot click swallow after a
 *   pan, pinch or touch tap. It is bound to the release point and expires, so it
 *   can only eat the click that the gesture itself produced.
 * - `bindTap`: activate a button on touch/pen `pointerup` (the platform can
 *   drop the synthetic `click` for a while after a fling), keep `click` for mouse
 *   and keyboard, and never fire twice for one activation.
 */

/** How long a gesture's click swallow stays armed. */
export const SWALLOW_MS = 400;
/** A click further than this from the gesture's release point is a new tap. */
export const SWALLOW_RADIUS_PX = 30;

export interface SwallowRecord {
  /** `performance.now()` deadline. */
  until: number;
  /** Client coordinates of the gesture point (refreshed at release). */
  x: number;
  y: number;
}

export function armSwallow(now: number, x: number, y: number, ms = SWALLOW_MS): SwallowRecord {
  return { until: now + ms, x, y };
}

/**
 * True when `rec` should consume a click at (x, y). The caller always clears
 * the record after asking, whatever the answer.
 */
export function swallowConsumes(
  rec: SwallowRecord | null | undefined,
  now: number,
  x: number,
  y: number,
  radius = SWALLOW_RADIUS_PX,
): boolean {
  if (!rec) return false;
  if (!(now < rec.until)) return false;
  return Math.hypot(x - rec.x, y - rec.y) <= radius;
}

/** Touch/pen movement allowed between down and up for a tap. */
export const TAP_SLOP_PX = 10;
/** A synthetic click this soon after a touch activation belongs to it. */
export const TAP_CLICK_GUARD_MS = 800;

/** Touch and pen get pointerup activation; mouse keeps click. */
export function isTapPointer(pointerType: string | undefined): boolean {
  return pointerType === 'touch' || pointerType === 'pen';
}

/**
 * The tap rule shared by `bindTap` and the map's in-map handles: a touch/pen
 * press that moved less than 10 px between down and up.
 */
export function isTouchTap(pointerType: string | undefined, movedPx: number): boolean {
  return isTapPointer(pointerType) && movedPx < TAP_SLOP_PX;
}

/**
 * True when a `click` belongs to a touch activation that already ran on
 * `pointerup` (within 800 ms). Keyboard / programmatic clicks (`detail` 0)
 * are never guarded.
 */
export function touchClickGuarded(detail: number | undefined, now: number, lastTouchActivation: number): boolean {
  return (detail ?? 0) !== 0 && now - lastTouchActivation < TAP_CLICK_GUARD_MS;
}

/**
 * In-map handle on `pointerup`: activate when it is a touch tap and the
 * gesture swallow record (a pan / pinch end) does not cover this point.
 */
export function nodeTapShouldActivate(opts: {
  pointerType: string | undefined;
  movedPx: number;
  swallow: SwallowRecord | null | undefined;
  now: number;
  x: number;
  y: number;
}): boolean {
  if (!isTouchTap(opts.pointerType, opts.movedPx)) return false;
  return !swallowConsumes(opts.swallow, opts.now, opts.x, opts.y);
}

type TapEl = Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & {
  style?: { touchAction?: string };
};

export interface BindTapOptions {
  /** Abort to unbind (same as calling the returned function). */
  signal?: AbortSignal;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Bind `fn` as the single activation of `el`.
 *
 * - Touch / pen: fires on `pointerup` when the `pointerdown` began on `el` and
 *   moved < 10 px. The synthetic `click` that follows (within ~800 ms) is
 *   swallowed. A mouse `pointerdown` ends that window.
 * - Mouse: fires on `click`.
 * - Keyboard (Enter / Space → `click` with `detail === 0`) and programmatic
 *   `el.click()`: fires on `click`.
 *
 * Sets `touch-action: manipulation` on `el` when the host has not set one.
 * Returns an unbind function.
 */
export function bindTap(
  el: TapEl,
  fn: (ev: Event) => void,
  opts: BindTapOptions = {},
): () => void {
  const ac = new AbortController();
  const signal = ac.signal;
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort();
    else opts.signal.addEventListener('abort', () => ac.abort(), { once: true });
  }
  try {
    if (el.style && !el.style.touchAction) el.style.touchAction = 'manipulation';
  } catch {
    /* style not writable (tests / SVG) */
  }
  let down: { id: number; x: number; y: number } | null = null;
  let lastTouchActivation = -Infinity;

  const isTouchLike = isTapPointer;

  el.addEventListener(
    'pointerdown',
    (ev) => {
      const e = ev as PointerEvent;
      if (!isTouchLike(e.pointerType)) {
        // A mouse press ends any pending touch click guard.
        down = null;
        lastTouchActivation = -Infinity;
        return;
      }
      if (e.isPrimary === false || (e.button ?? 0) > 0) return;
      down = { id: e.pointerId, x: e.clientX, y: e.clientY };
    },
    { signal },
  );
  el.addEventListener(
    'pointermove',
    (ev) => {
      const e = ev as PointerEvent;
      if (!down || e.pointerId !== down.id) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) >= TAP_SLOP_PX) down = null;
    },
    { signal },
  );
  el.addEventListener(
    'pointerup',
    (ev) => {
      const e = ev as PointerEvent;
      const d = down;
      down = null;
      if (!d || e.pointerId !== d.id) return;
      if (!isTouchTap(e.pointerType, Math.hypot(e.clientX - d.x, e.clientY - d.y))) return;
      lastTouchActivation = nowMs();
      fn(e);
    },
    { signal },
  );
  el.addEventListener(
    'pointercancel',
    () => {
      down = null;
    },
    { signal },
  );
  el.addEventListener(
    'click',
    (ev) => {
      const e = ev as MouseEvent;
      // detail 0 = keyboard / programmatic click: always a real activation.
      if (touchClickGuarded(e.detail, nowMs(), lastTouchActivation)) {
        e.preventDefault?.();
        e.stopImmediatePropagation?.();
        return;
      }
      fn(e);
    },
    { signal },
  );
  return () => ac.abort();
}
