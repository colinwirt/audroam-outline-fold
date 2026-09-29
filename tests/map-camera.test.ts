import { describe, expect, it } from 'vitest';
import {
  clampCamToContent,
  camToEnsureVisible,
  camToFrameRects,
  isRectComfortablyVisible,
  pillWorldRect,
  unionWorldRects,
  lerpCam,
  easeOutCubic,
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
    // Content should still intersect the viewport
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

describe('follow focus / expand framing', () => {
  const vp = { w: 400, h: 300 };

  it('skips move when focus already comfortable', () => {
    const focus = pillWorldRect(200, 150, 80, 40);
    // Centre focus in view at k=1
    const cam = { x: 200 - 200, y: 150 - 150, k: 1 }; // identity-ish: world=screen at origin… 
    // world centre (200,150) → screen (200+x, 150+y); want (200,150) → set x=0,y=0
    const cam0 = { x: 0, y: 0, k: 1 };
    // focus screen: left=160, top=130, right=240, bottom=170 — inside 400x300 with inset 36
    expect(isRectComfortablyVisible(cam0, vp, focus)).toBe(true);
    const next = camToEnsureVisible(cam0, vp, focus);
    expect(next.x).toBe(cam0.x);
    expect(next.y).toBe(cam0.y);
  });

  it('eases focus into view when off-screen', () => {
    const focus = pillWorldRect(2000, 1500, 80, 40);
    const cam = { x: 0, y: 0, k: 1 };
    expect(isRectComfortablyVisible(cam, vp, focus)).toBe(false);
    const next = camToEnsureVisible(cam, vp, focus, { paddingPx: 40 });
    const sLeft = focus.x * next.k + next.x;
    const sRight = (focus.x + focus.w) * next.k + next.x;
    expect(sLeft).toBeGreaterThanOrEqual(-1);
    expect(sRight).toBeLessThanOrEqual(vp.w + 1);
  });

  it('frames focus + children with bias toward focus', () => {
    const focus = pillWorldRect(100, 100, 60, 40);
    const kid = pillWorldRect(300, 100, 60, 40);
    const cam = { x: 0, y: 0, k: 1 };
    const next = camToFrameRects(cam, vp, [focus, kid], {
      focus,
      focusBias: 0.6,
      paddingPx: 40,
    });
    // Group should be roughly in view
    const u = unionWorldRects([focus, kid])!;
    const left = u.x * next.k + next.x;
    const right = (u.x + u.w) * next.k + next.x;
    expect(left).toBeLessThan(vp.w);
    expect(right).toBeGreaterThan(0);
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
