import { describe, expect, it } from 'vitest';
import {
  anchorPan,
  anchorPinch,
  afterLift,
  flingClearsContent,
  nextGestureMode,
  translationClearsContent,
  INERTIA_TAU_MS,
  panFrame,
  pinchFrame,
  retargetZoom,
  decayVelocity,
  inertiaEligible,
  isDoubleTap,
  isTwoFingerTap,
  rubberOffset,
  softAxis,
  softZoom,
  wheelIntent,
} from '../src/mapGesture.js';

describe('anchored pinch', () => {
  it('keeps the world point under the midpoint while zooming and panning', () => {
    const cam = { x: 10, y: 20, k: 2 };
    const a0 = { x: 100, y: 100 };
    const b0 = { x: 140, y: 100 };
    const anchor = anchorPinch(cam, a0, b0);
    const start = pinchFrame(anchor, a0, b0);
    expect(start.k).toBeCloseTo(2);
    expect(start.x).toBeCloseTo(10);
    expect(start.y).toBeCloseTo(20);

    pinchFrame(anchor, { x: 80, y: 100 }, { x: 160, y: 100 });
    const zoomed = pinchFrame(anchor, { x: 60, y: 100 }, { x: 180, y: 100 });
    expect(zoomed.k).toBeGreaterThan(2);
    const midX = 120;
    const worldX = anchor.W.x;
    expect(midX).toBeCloseTo(worldX * zoomed.k + zoomed.x);

    const panned = pinchFrame(anchor, { x: 90, y: 130 }, { x: 170, y: 130 });
    const mid = { x: 130, y: 130 };
    expect(mid.x).toBeCloseTo(anchor.W.x * panned.k + panned.x);
    expect(mid.y).toBeCloseTo(anchor.W.y * panned.k + panned.y);
  });

  it('keeps the pinch point when a sample past max zoom is drawn at the cap', () => {
    const cam = { x: -500, y: -200, k: 3.5 };
    const a0 = { x: 160, y: 150 };
    const b0 = { x: 240, y: 150 };
    const anchor = anchorPinch(cam, a0, b0);
    const screen = { x: 200, y: 150 };
    // First sample only arms the dead-zone. The next one past that spreads.
    pinchFrame(anchor, { x: 120, y: 150 }, { x: 280, y: 150 });
    const raw = pinchFrame(anchor, { x: 80, y: 150 }, { x: 320, y: 150 });
    expect(raw.k).toBeGreaterThan(3.5);
    const worldX = (screen.x - cam.x) / cam.k;
    expect(worldX * 3.5 + raw.x).not.toBeCloseTo(screen.x);
    const shown = retargetZoom(raw, 3.5, screen);
    expect(shown.k).toBe(3.5);
    expect(worldX * shown.k + shown.x).toBeCloseTo(screen.x);
    expect((screen.y - cam.y) / cam.k * shown.k + shown.y).toBeCloseTo(screen.y);
  });
});

describe('pan anchor', () => {
  it('keeps the grabbed point under the finger', () => {
    const cam = { x: 0, y: 0, k: 1 };
    const anchor = anchorPan(cam, { x: 40, y: 50 });
    const next = panFrame(anchor, { x: 70, y: 20 });
    expect(next).toEqual({ k: 1, x: 30, y: -30 });
  });
});

describe('finger-count state machine', () => {
  it('promotes two fingers to pinch and holds that pinch when one finger lifts', () => {
    expect(nextGestureMode('pending', 2, false)).toBe('pinch');
    expect(nextGestureMode('pinch', 1, true)).toBe('pinch');
    expect(nextGestureMode('pending', 1, false)).toBe('pending');
    expect(nextGestureMode('pending', 1, true)).toBe('pan');
    expect(nextGestureMode('pinch', 3, false)).toBe('pinch');
    expect(nextGestureMode('pan', 0, false)).toBe('idle');
  });
});

describe('lift after pinch', () => {
  it('holds the remaining finger and skips the fling once every finger is up', () => {
    const held = afterLift('pinch', 1, false);
    expect(held).toEqual({
      mode: 'pinch',
      singlePanLocked: true,
      action: 'hold',
      skipFling: false,
    });
    expect(afterLift(held.mode, 0, held.singlePanLocked)).toEqual({
      mode: 'idle',
      singlePanLocked: false,
      action: 'release',
      skipFling: true,
    });
  });

  it('still retargets a pinch that has two drivers', () => {
    expect(afterLift('pinch', 2, false).action).toBe('retarget-pinch');
  });

  it('lets a later one-finger gesture pan after the lock has cleared', () => {
    expect(afterLift('pan', 1, false).action).toBe('retarget-pan');
    expect(afterLift('pan', 0, false).skipFling).toBe(false);
  });
});

describe('fling noise', () => {
  const cam = { x: 0, y: 0, k: 1 };
  const content = { x: 0, y: 0, w: 200, h: 80 };
  const viewport = { w: 400, h: 800 };

  it('keeps a shift that still shows the map', () => {
    expect(translationClearsContent(50, 20, cam, content, viewport)).toBe(false);
  });

  it('drops a shift that leaves the map fully outside the viewport', () => {
    expect(translationClearsContent(-500, 0, cam, content, viewport)).toBe(true);
    expect(translationClearsContent(0, -900, cam, content, viewport)).toBe(true);
  });

  it('drops a coast that would leave the map and keeps a short one', () => {
    const coast = 2 * INERTIA_TAU_MS;
    expect(flingClearsContent(-2, 0, cam, content, viewport)).toBe(
      translationClearsContent(-coast, 0, cam, content, viewport),
    );
    expect(flingClearsContent(-0.05, 0, cam, content, viewport)).toBe(false);
  });
});

describe('wheel', () => {
  const base = {
    deltaX: 0,
    deltaY: 10,
    deltaMode: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
  };

  it('pans on a plain wheel and zooms on ctrl+wheel', () => {
    expect(wheelIntent(base, 'pan', 800)).toEqual({ kind: 'pan', dx: 0, dy: 10 });
    const z = wheelIntent({ ...base, ctrlKey: true }, 'pan', 800);
    expect(z.kind).toBe('zoom');
    if (z.kind === 'zoom') expect(z.s).toBeCloseTo(-0.1);
  });

  it('rubber-bands overshoot under the 56px cap and decays inertia', () => {
    expect(rubberOffset(0)).toBe(0);
    expect(rubberOffset(1000)).toBeLessThan(56);
    expect(softAxis(80, 0, 10)).toBeGreaterThan(10);
    expect(softAxis(80, 0, 10)).toBeLessThan(10 + 56);
    expect(softZoom(3, 2)).toBeGreaterThan(2);
    expect(softZoom(3, 2)).toBeLessThan(2 * 1.25);
    expect(decayVelocity(1, 250)).toBeCloseTo(Math.exp(-1));
    expect(
      inertiaEligible({
        pointerType: 'touch',
        speedPxPerMs: 0.4,
        sinceLastMoveMs: 10,
        reducedMotion: false,
        enabled: true,
      }),
    ).toBe(true);
    expect(
      inertiaEligible({
        pointerType: 'mouse',
        speedPxPerMs: 1,
        sinceLastMoveMs: 10,
        reducedMotion: false,
        enabled: true,
      }),
    ).toBe(false);
    expect(isDoubleTap(200, 10)).toBe(true);
    expect(isDoubleTap(400, 10)).toBe(false);
    expect(
      isTwoFingerTap({
        secondDownDelayMs: 40,
        spanMs: 120,
        movedA: 2,
        movedB: 3,
        scaleLive: false,
      }),
    ).toBe(true);
  });

  it('restores wheel-zoom when asked', () => {
    const z = wheelIntent(base, 'zoom', 800);
    expect(z.kind).toBe('zoom');
    if (z.kind === 'zoom') expect(z.s).toBeCloseTo(-0.02);
  });
});
