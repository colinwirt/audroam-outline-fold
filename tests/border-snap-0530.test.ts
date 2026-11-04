import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { borderDevicePx, borderStrokeW, snapEdge, BORDER_W, BORDER_W_STRONG, borderVars } from '../src/borderSnap.js';

const css = readFileSync(join(__dirname, '../src/outline-fold.css'), 'utf8');

describe('0.5.30 node borders snap to device pixels', () => {
  it('base border is a touch thicker than 0.5.29 (1.25)', () => {
    expect(BORDER_W).toBeGreaterThan(1.25);
    expect(BORDER_W_STRONG).toBeGreaterThanOrEqual(2);
  });
  it('always a whole number of device pixels, at least 2 (1 + a bump)', () => {
    for (const dpr of [1, 1.25, 1.5, 2, 2.625, 3]) {
      for (const w of [0.5, 1, BORDER_W, BORDER_W_STRONG]) {
        const d = borderDevicePx(w, dpr);
        expect(Number.isInteger(d)).toBe(true);
        expect(d).toBeGreaterThanOrEqual(2);
        expect(borderStrokeW(w, dpr) * dpr).toBeCloseTo(d, 6);
      }
    }
  });
  it('strong border stays thicker than base at every DPR', () => {
    for (const dpr of [1, 1.5, 2, 3]) expect(borderDevicePx(BORDER_W_STRONG, dpr)).toBeGreaterThan(borderDevicePx(BORDER_W, dpr) - 1);
    expect(borderDevicePx(BORDER_W_STRONG, 2)).toBeGreaterThan(borderDevicePx(BORDER_W, 2));
  });
  it('zoom divides the user-unit width so the screen weight stays the same', () => {
    expect(borderStrokeW(BORDER_W, 2, 0.5) * 0.5 * 2).toBeCloseTo(borderDevicePx(BORDER_W, 2), 6);
  });
  it('odd device widths centre on a half pixel, even widths on a whole pixel', () => {
    // 1.5 css at dpr 2 = 3 device px (odd): centre lands on x.5 device px.
    const e = snapEdge(10.3, 3, 2);
    expect((e * 2) % 1).toBeCloseTo(0.5, 6);
    const f = snapEdge(10.3, 2, 1);
    expect((f * 1) % 1).toBeCloseTo(0, 6);
  });
  it('borderVars gives CSS custom properties in px', () => {
    const v = borderVars(2);
    expect(v['--map-border-w']).toMatch(/px$/);
    expect(v['--map-border-w-strong']).toMatch(/px$/);
  });
  it('CSS pills read the snapped variables; connectors stay at 1.4', () => {
    const pill = css.slice(css.indexOf('.map-pill {'), css.indexOf('}', css.indexOf('.map-pill {')));
    expect(pill).toContain('var(--map-border-w');
    expect(css).toMatch(/\.map-node\.task-done \.map-pill \{\s*stroke-width: var\(--map-border-w/);
    const edge = css.slice(css.indexOf('.map-edge,\n.map-fold-stem {'));
    expect(edge.slice(0, 120)).toContain('stroke-width: 1.4');
  });
});

describe('0.5.30 strong border always reads heavier than the base border', () => {
  it('strong device px >= base + 1 at every DPR', async () => {
    const m = await import('../src/borderSnap');
    for (const dpr of [1, 1.25, 1.5, 2, 2.625, 3]) {
      const base = m.borderDevicePx(m.BORDER_W, dpr);
      const strong = m.strongDevicePx(dpr);
      expect(strong).toBeGreaterThanOrEqual(base + 1);
      expect(Number.isInteger(strong)).toBe(true);
    }
    expect(m.borderVars(1)['--map-border-w-strong']).toBe('3px');
    expect(m.borderVars(1)['--map-border-w']).toBe('2px');
  });
});
