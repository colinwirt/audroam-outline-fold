import { describe, expect, it } from 'vitest';
import {
  anchorPan,
  anchorPinch,
  nextGestureMode,
  panFrame,
  pinchFrame,
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
  it('promotes two fingers to pinch and the remaining finger to pan', () => {
    expect(nextGestureMode('pending', 2, false)).toBe('pinch');
    expect(nextGestureMode('pinch', 1, true)).toBe('pan');
    expect(nextGestureMode('pending', 1, false)).toBe('pending');
    expect(nextGestureMode('pending', 1, true)).toBe('pan');
    expect(nextGestureMode('pinch', 3, false)).toBe('pinch');
    expect(nextGestureMode('pan', 0, false)).toBe('idle');
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

  it('restores wheel-zoom when asked', () => {
    const z = wheelIntent(base, 'zoom', 800);
    expect(z.kind).toBe('zoom');
    if (z.kind === 'zoom') expect(z.s).toBeCloseTo(-0.02);
  });
});
