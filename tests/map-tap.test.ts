import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  armSwallow,
  bindTap,
  isTapPointer,
  isTouchTap,
  nodeTapShouldActivate,
  touchClickGuarded,
  swallowConsumes,
  SWALLOW_MS,
  SWALLOW_RADIUS_PX,
  TAP_CLICK_GUARD_MS,
} from '../src/mapTap';

describe('swallow record (0.2.30 C1)', () => {
  it('consumes the gesture click at the release point before it expires', () => {
    const rec = armSwallow(1000, 200, 300);
    expect(rec).toEqual({ until: 1000 + SWALLOW_MS, x: 200, y: 300 });
    expect(swallowConsumes(rec, 1000, 200, 300)).toBe(true);
    expect(swallowConsumes(rec, 1399, 210, 310)).toBe(true);
  });

  it('expires at 400 ms', () => {
    const rec = armSwallow(0, 0, 0);
    expect(SWALLOW_MS).toBe(400);
    expect(swallowConsumes(rec, 399.9, 0, 0)).toBe(true);
    expect(swallowConsumes(rec, 400, 0, 0)).toBe(false);
    expect(swallowConsumes(rec, 1000, 0, 0)).toBe(false);
  });

  it('only covers ~30 px around the release point', () => {
    const rec = armSwallow(0, 100, 100);
    expect(SWALLOW_RADIUS_PX).toBe(30);
    expect(swallowConsumes(rec, 10, 130, 100)).toBe(true);
    expect(swallowConsumes(rec, 10, 121, 121)).toBe(true);
    expect(swallowConsumes(rec, 10, 131, 100)).toBe(false);
    expect(swallowConsumes(rec, 10, 100, 40)).toBe(false);
  });

  it('a cleared record (new pointerdown / resetPointers) consumes nothing', () => {
    expect(swallowConsumes(null, 0, 0, 0)).toBe(false);
    expect(swallowConsumes(undefined, 0, 0, 0)).toBe(false);
  });

  it('mapView has no sticky boolean left and clears the record on reset and primary pointerdown', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/mapView.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/swallowClick/);
    expect(src).not.toMatch(/resetPointers\(\s*(true|false|swallow)/);
    const reset = src.slice(src.indexOf('function resetPointers('), src.indexOf('function schedule('));
    expect(reset).toContain('swallow = null');
    const down = src.slice(src.indexOf("host.addEventListener('pointerdown'"));
    expect(down.slice(0, 400)).toContain('if (e.isPrimary) swallow = null');
  });
});

/** Minimal element: EventTarget + style, enough for bindTap. */
function fakeEl() {
  const el = new EventTarget() as EventTarget & { style: { touchAction?: string } };
  el.style = {};
  return el;
}

function ptr(
  type: string,
  init: { pointerType: string; x?: number; y?: number; id?: number; primary?: boolean },
): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, {
    pointerType: init.pointerType,
    pointerId: init.id ?? 1,
    clientX: init.x ?? 10,
    clientY: init.y ?? 10,
    isPrimary: init.primary ?? true,
    button: 0,
  });
  return e;
}

function click(detail: number): Event {
  const e = new Event('click', { bubbles: true, cancelable: true });
  Object.assign(e, { detail, clientX: 10, clientY: 10 });
  return e;
}

describe('bindTap (0.2.30 C3/C7)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('touch: fires on pointerup and swallows the synthetic click (no double fire)', () => {
    const el = fakeEl();
    const fn = vi.fn();
    bindTap(el, fn);
    el.dispatchEvent(ptr('pointerdown', { pointerType: 'touch' }));
    el.dispatchEvent(ptr('pointerup', { pointerType: 'touch', x: 14, y: 12 }));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].type).toBe('pointerup');
    const c = click(1);
    el.dispatchEvent(c);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c.defaultPrevented).toBe(true);
  });

  it('touch: fires even when the platform drops the click (after a fling)', () => {
    const el = fakeEl();
    const fn = vi.fn();
    bindTap(el, fn);
    el.dispatchEvent(ptr('pointerdown', { pointerType: 'touch' }));
    el.dispatchEvent(ptr('pointerup', { pointerType: 'touch' }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('touch: repeated taps each fire once', () => {
    const el = fakeEl();
    const fn = vi.fn();
    bindTap(el, fn);
    for (let i = 0; i < 4; i++) {
      el.dispatchEvent(ptr('pointerdown', { pointerType: 'touch', id: i + 1 }));
      el.dispatchEvent(ptr('pointerup', { pointerType: 'touch', id: i + 1 }));
      el.dispatchEvent(click(1));
    }
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('touch: a drag of 10 px or more is not a tap', () => {
    const el = fakeEl();
    const fn = vi.fn();
    bindTap(el, fn);
    el.dispatchEvent(ptr('pointerdown', { pointerType: 'touch', x: 10, y: 10 }));
    el.dispatchEvent(ptr('pointermove', { pointerType: 'touch', x: 25, y: 10 }));
    el.dispatchEvent(ptr('pointerup', { pointerType: 'touch', x: 12, y: 10 }));
    expect(fn).not.toHaveBeenCalled();
    el.dispatchEvent(ptr('pointerdown', { pointerType: 'pen', x: 10, y: 10, id: 2 }));
    el.dispatchEvent(ptr('pointerup', { pointerType: 'pen', x: 20, y: 10, id: 2 }));
    expect(fn).not.toHaveBeenCalled();
  });

  it('touch: pointercancel drops the tap', () => {
    const el = fakeEl();
    const fn = vi.fn();
    bindTap(el, fn);
    el.dispatchEvent(ptr('pointerdown', { pointerType: 'touch' }));
    el.dispatchEvent(ptr('pointercancel', { pointerType: 'touch' }));
    el.dispatchEvent(ptr('pointerup', { pointerType: 'touch' }));
    expect(fn).not.toHaveBeenCalled();
  });

  it('mouse: fires on click only', () => {
    const el = fakeEl();
    const fn = vi.fn();
    bindTap(el, fn);
    el.dispatchEvent(ptr('pointerdown', { pointerType: 'mouse' }));
    el.dispatchEvent(ptr('pointerup', { pointerType: 'mouse' }));
    expect(fn).not.toHaveBeenCalled();
    el.dispatchEvent(click(1));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('keyboard (click detail 0) always fires once, even right after a touch tap', () => {
    const el = fakeEl();
    const fn = vi.fn();
    bindTap(el, fn);
    el.dispatchEvent(click(0));
    expect(fn).toHaveBeenCalledTimes(1);
    el.dispatchEvent(ptr('pointerdown', { pointerType: 'touch' }));
    el.dispatchEvent(ptr('pointerup', { pointerType: 'touch' }));
    el.dispatchEvent(click(0));
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('a mouse press ends the touch click guard; the guard also times out', () => {
    let t = 1000;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => t);
    const el = fakeEl();
    const fn = vi.fn();
    bindTap(el, fn);
    el.dispatchEvent(ptr('pointerdown', { pointerType: 'touch' }));
    el.dispatchEvent(ptr('pointerup', { pointerType: 'touch' }));
    el.dispatchEvent(ptr('pointerdown', { pointerType: 'mouse', id: 9 }));
    el.dispatchEvent(click(1));
    expect(fn).toHaveBeenCalledTimes(2);

    el.dispatchEvent(ptr('pointerdown', { pointerType: 'touch' }));
    el.dispatchEvent(ptr('pointerup', { pointerType: 'touch' }));
    expect(fn).toHaveBeenCalledTimes(3);
    t += TAP_CLICK_GUARD_MS - 1;
    el.dispatchEvent(click(1));
    expect(fn).toHaveBeenCalledTimes(3);
    t += 2;
    el.dispatchEvent(click(1));
    expect(fn).toHaveBeenCalledTimes(4);
    spy.mockRestore();
  });

  it('sets touch-action: manipulation unless the host set one; unbind removes listeners', () => {
    const el = fakeEl();
    const fn = vi.fn();
    const off = bindTap(el, fn);
    expect(el.style.touchAction).toBe('manipulation');
    const el2 = fakeEl();
    el2.style.touchAction = 'none';
    bindTap(el2, fn);
    expect(el2.style.touchAction).toBe('none');
    off();
    el.dispatchEvent(click(0));
    expect(fn).not.toHaveBeenCalled();
  });

  it('an aborted signal unbinds', () => {
    const el = fakeEl();
    const fn = vi.fn();
    const ac = new AbortController();
    bindTap(el, fn, { signal: ac.signal });
    ac.abort();
    el.dispatchEvent(click(0));
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('in-map handle tap rule (0.2.30, same as bindTap)', () => {
  it('touch and pen only, moved under 10 px', () => {
    expect(isTapPointer('touch')).toBe(true);
    expect(isTapPointer('pen')).toBe(true);
    expect(isTapPointer('mouse')).toBe(false);
    expect(isTapPointer('')).toBe(false);
    expect(isTouchTap('touch', 0)).toBe(true);
    expect(isTouchTap('touch', 9.9)).toBe(true);
    expect(isTouchTap('touch', 10)).toBe(false);
    expect(isTouchTap('mouse', 0)).toBe(false);
  });

  it('guards the following pointer click for 800 ms; keyboard clicks never', () => {
    expect(touchClickGuarded(1, 1000, 1000)).toBe(true);
    expect(touchClickGuarded(1, 1000 + TAP_CLICK_GUARD_MS - 1, 1000)).toBe(true);
    expect(touchClickGuarded(1, 1000 + TAP_CLICK_GUARD_MS, 1000)).toBe(false);
    expect(touchClickGuarded(0, 1000, 1000)).toBe(false);
    expect(touchClickGuarded(1, 1000, -Infinity)).toBe(false);
  });

  it('honours the gesture swallow record (a pan end never activates a handle)', () => {
    const base = { pointerType: 'touch', movedPx: 2, now: 100, x: 50, y: 50 };
    expect(nodeTapShouldActivate({ ...base, swallow: null })).toBe(true);
    expect(nodeTapShouldActivate({ ...base, swallow: armSwallow(0, 50, 50) })).toBe(false);
    expect(nodeTapShouldActivate({ ...base, swallow: armSwallow(0, 200, 50) })).toBe(true);
    expect(nodeTapShouldActivate({ ...base, now: 500, swallow: armSwallow(0, 50, 50) })).toBe(true);
    expect(nodeTapShouldActivate({ ...base, movedPx: 12, swallow: null })).toBe(false);
    expect(nodeTapShouldActivate({ ...base, pointerType: 'mouse', swallow: null })).toBe(false);
  });

  it('mapView activates handles on touch pointerup through the shared rule', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/mapView.ts'),
      'utf8',
    );
    expect(src).toMatch(/function activateNodeHit\(/);
    expect(src).toMatch(/nodeTapShouldActivate\(/);
    expect(src).toMatch(/touchClickGuarded\(e\.detail, now, nodeTouchTapAt\)/);
    expect(src).toMatch(/e\.type === 'pointerup' && had\.hit/);
  });
});
