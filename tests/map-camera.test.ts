import { describe, expect, it } from 'vitest';
import {
  clampCamToContent,
  camToEnsureVisible,
  camToFrameRects,
  followActionForFocus,
  followActionForExpand,
  visibleFractionOfRect,
  worldRectToScreen,
  isRectComfortablyVisible,
  isRectIntersectingViewport,
  isRectFullyInvisible,
  pillWorldRect,
  unionWorldRects,
  lerpCam,
  easeOutCubic,
  DEFAULT_KEEP_VISIBLE_FRAC,
  DEFAULT_RECENTRE_FRAC,
} from '../src/mapCamera.js';

describe('unionWorldRects / pillWorldRect', () => {
  it('unions pill rects from centres', () => {
    const a = pillWorldRect(100, 50, 40, 20);
    expect(a).toEqual({ x: 80, y: 40, w: 40, h: 20 });
    const u = unionWorldRects([
      pillWorldRect(0, 0, 20, 20),
      pillWorldRect(100, 50, 20, 20),
    ]);
    expect(u).toEqual({ x: -10, y: -10, w: 120, h: 70 });
  });
});

describe('clampCamToContent', () => {
  const vp = { w: 400, h: 300 };
  const content = { x: 0, y: 0, w: 200, h: 150 };

  it('pulls camera back when panned into empty space', () => {
    const wild = clampCamToContent(
      { x: 5000, y: 5000, k: 1 },
      vp,
      content,
      { paddingPx: 40 },
    );
    const left = content.x * wild.k + wild.x;
    const right = (content.x + content.w) * wild.k + wild.x;
    expect(left).toBeLessThanOrEqual(vp.w - 40);
    expect(right).toBeGreaterThanOrEqual(40);
  });

  it('keeps content reachable at high zoom', () => {
    const c = clampCamToContent(
      { x: -10000, y: 0, k: 2 },
      vp,
      content,
      { paddingPx: 40, minK: 0.35, maxK: 3.5 },
    );
    const right = (content.x + content.w) * c.k + c.x;
    expect(right).toBeGreaterThanOrEqual(40);
  });
});

describe('visibleFractionOfRect', () => {
  const vp = { w: 400, h: 300 };

  it('is 1 when fully on-screen', () => {
    const focus = pillWorldRect(200, 150, 80, 40);
    expect(visibleFractionOfRect({ x: 0, y: 0, k: 1 }, vp, focus)).toBe(1);
  });

  it('is 0 when fully off-screen', () => {
    const focus = pillWorldRect(2000, 1500, 80, 40);
    expect(visibleFractionOfRect({ x: 0, y: 0, k: 1 }, vp, focus)).toBe(0);
  });

  it('is ~0.5 when half clipped on the right', () => {
    // left=360, right=440 → 40px of 80 inside 400-wide vp
    const focus = pillWorldRect(400, 150, 80, 40);
    const frac = visibleFractionOfRect({ x: 0, y: 0, k: 1 }, vp, focus);
    expect(frac).toBeCloseTo(0.5, 2);
  });
});

describe('follow proportion (0.2.14)', () => {
  const vp = { w: 400, h: 300 };

  it('ensures when the pill is taller than the viewport even if most of it shows', () => {
    const focus = pillWorldRect(140, 240, 200, 480);
    const cam = { x: 0, y: 0, k: 1 };
    expect(visibleFractionOfRect(cam, vp, focus)).toBeGreaterThanOrEqual(
      DEFAULT_KEEP_VISIBLE_FRAC,
    );
    expect(followActionForFocus(cam, vp, focus)).toBe('ensure');
    const next = camToEnsureVisible(cam, vp, focus, { paddingPx: 40 });
    expect(next.k).toBeLessThan(cam.k);
    expect(visibleFractionOfRect(next, vp, focus)).toBeGreaterThan(0.9);
  });

  it('keeps the bottom of an oversized pill inside the viewport', () => {
    const focus = pillWorldRect(200, 800, 120, 2200);
    const cam = { x: 0, y: 0, k: 0.35 };
    const next = camToEnsureVisible(cam, vp, focus, { paddingPx: 40, minK: 0.35 });
    const s = worldRectToScreen(focus, next);
    expect(s.bottom).toBeLessThanOrEqual(vp.h - 40 + 0.5);
  });

  it('no-ops when focus visible fraction ≥ keep (~0.6)', () => {
    const focus = pillWorldRect(200, 150, 80, 40);
    const cam = { x: 0, y: 0, k: 1 };
    expect(visibleFractionOfRect(cam, vp, focus)).toBeGreaterThanOrEqual(
      DEFAULT_KEEP_VISIBLE_FRAC,
    );
    expect(followActionForFocus(cam, vp, focus)).toBe('noop');
    const next = camToEnsureVisible(cam, vp, focus);
    expect(next).toEqual(cam);
  });

  it('ensures when partially visible below keep but above recentre', () => {
    // ~0.5 visible — below 0.6 keep, above 0.25 recentre
    const focus = pillWorldRect(400, 150, 80, 40);
    const cam = { x: 0, y: 0, k: 1 };
    const frac = visibleFractionOfRect(cam, vp, focus);
    expect(frac).toBeGreaterThan(DEFAULT_RECENTRE_FRAC);
    expect(frac).toBeLessThan(DEFAULT_KEEP_VISIBLE_FRAC);
    expect(followActionForFocus(cam, vp, focus, { recentre: true })).toBe(
      'ensure',
    );
    expect(followActionForFocus(cam, vp, focus, { recentre: false })).toBe(
      'ensure',
    );
    const next = camToEnsureVisible(cam, vp, focus, { paddingPx: 40 });
    expect(next.x).not.toBe(cam.x); // gently nudged
    const after = visibleFractionOfRect(next, vp, focus);
    expect(after).toBeGreaterThan(frac);
  });

  it('recentres when fraction ≲ 0.25 and recentre on', () => {
    // mostly off: left=380, right=460 → 20/80 = 0.25
    const focus = pillWorldRect(420, 150, 80, 40);
    const cam = { x: 0, y: 0, k: 1 };
    const frac = visibleFractionOfRect(cam, vp, focus);
    expect(frac).toBeLessThanOrEqual(DEFAULT_RECENTRE_FRAC + 0.01);
    expect(followActionForFocus(cam, vp, focus, { recentre: true })).toBe(
      'recentre',
    );
    expect(followActionForFocus(cam, vp, focus, { recentre: false })).toBe(
      'ensure',
    );
  });

  it('ensures (not recentre) when fully off-screen but recentre disabled', () => {
    const focus = pillWorldRect(2000, 1500, 80, 40);
    const cam = { x: 0, y: 0, k: 1 };
    expect(isRectFullyInvisible(cam, vp, focus)).toBe(true);
    expect(followActionForFocus(cam, vp, focus, { recentre: false })).toBe(
      'ensure',
    );
    expect(followActionForFocus(cam, vp, focus, { recentre: true })).toBe(
      'recentre',
    );
    const next = camToEnsureVisible(cam, vp, focus, { paddingPx: 40 });
    expect(visibleFractionOfRect(next, vp, focus)).toBeGreaterThan(0.5);
  });

  it('expand: recentre when kids mostly off-screen and recentre on', () => {
    const focus = pillWorldRect(100, 100, 60, 40); // on-screen
    const kid = pillWorldRect(2000, 100, 60, 40); // off-screen
    const cam = { x: 0, y: 0, k: 1 };
    expect(
      followActionForExpand(cam, vp, focus, [kid], { recentre: true }),
    ).toBe('recentre');
    expect(
      followActionForExpand(cam, vp, focus, [kid], { recentre: false }),
    ).toBe('noop'); // focus still well visible
  });

  it('expand: ensure focus when recentre off and focus below keep', () => {
    const focus = pillWorldRect(400, 150, 80, 40); // ~0.5
    const kid = pillWorldRect(2000, 150, 60, 40);
    const cam = { x: 0, y: 0, k: 1 };
    expect(
      followActionForExpand(cam, vp, focus, [kid], { recentre: false }),
    ).toBe('ensure');
  });

  it('edit force ensure nudges even when above keep', () => {
    // Fully visible but force=true still runs reveal (may no-op if already padded)
    const focus = pillWorldRect(200, 150, 80, 40);
    const cam = { x: 0, y: 0, k: 1 };
    const next = camToEnsureVisible(cam, vp, focus, {
      paddingPx: 40,
      force: true,
    });
    // Already well inside with pad → same cam
    expect(next.x).toBe(cam.x);
    expect(next.y).toBe(cam.y);
  });

  it('frames focus + children with bias toward focus when recentring', () => {
    const focus = pillWorldRect(100, 100, 60, 40);
    const kid = pillWorldRect(300, 100, 60, 40);
    const cam = { x: 0, y: 0, k: 1 };
    const next = camToFrameRects(cam, vp, [focus, kid], {
      focus,
      focusBias: 0.6,
      paddingPx: 40,
    });
    const u = unionWorldRects([focus, kid])!;
    const left = u.x * next.k + next.x;
    const right = (u.x + u.w) * next.k + next.x;
    expect(left).toBeLessThan(vp.w);
    expect(right).toBeGreaterThan(0);
  });

  it('keeps legacy intersection helpers consistent', () => {
    const focus = pillWorldRect(200, 150, 80, 40);
    const cam = { x: 0, y: 0, k: 1 };
    expect(isRectIntersectingViewport(cam, vp, focus)).toBe(true);
    expect(isRectFullyInvisible(cam, vp, focus)).toBe(false);
    expect(isRectComfortablyVisible(cam, vp, focus)).toBe(true);
  });
});

describe('lerp / ease', () => {
  it('lerps and eases', () => {
    const a = lerpCam({ x: 0, y: 0, k: 1 }, { x: 10, y: 20, k: 2 }, 0.5);
    expect(a).toEqual({ x: 5, y: 10, k: 1.5 });
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});
