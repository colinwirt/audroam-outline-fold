import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse, pillSize, FOLD_SLOT, displayCaption, resolveTask } from '../src/index.js';
import { captionWithoutLinks } from '../src/captionRich.js';
import {
  FOLD_R,
  FOLD_RING_W,
  childConnectorPath,
  connectorStartX,
  foldChromeSvg,
  foldHandleGeometry,
  foldHandleSvg,
  mapEdgeSvg,
} from '../src/mapView.js';

// Map fold handle and connector polish, phase 1 (Design UX 2026-10-07, H1-H3, H7).

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../src/outline-fold.css'), 'utf8');
const mapSrc = readFileSync(join(here, '../src/mapView.ts'), 'utf8');

function cssRule(selector: string): string {
  const start = css.indexOf(selector + ' {');
  expect(start, `css rule ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start) + 1);
}

function startX(d: string): number {
  const m = /^M\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(d);
  expect(m, `path start in ${d}`).not.toBeNull();
  return Number(m![1]);
}

function stemOf(svg: string): string {
  const m = /<path class="map-fold-stem"[^>]*\/>/.exec(svg);
  expect(m).not.toBeNull();
  return m![0];
}

function sizeOf(n: ReturnType<typeof parse>['nodes'][number]) {
  return pillSize(captionWithoutLinks(displayCaption(n.title)), {
    reserveFold: !!n.children?.length,
    reserveTask: !!resolveTask(n),
  });
}

const doc = parse(
  readFileSync(join(here, '../examples/lighthouse/lighthouse.md'), 'utf8'),
  { sessionIds: true },
);
const root = doc.nodes[0]!;

describe('fold handle geometry', () => {
  it('puts the outer rim at boxRight + 26.8 with the default slot', () => {
    const g = foldHandleGeometry(100);
    expect(g.cx).toBe(100 + FOLD_SLOT / 2);
    expect(g.r).toBe(FOLD_R);
    expect(g.innerRim).toBe(108);
    expect(g.outerRim).toBeCloseTo(126.8, 9);
  });

  it('keeps FOLD_RING_W in step with the expanded ring in outline-fold.css', () => {
    expect(cssRule('.map-fold-indicator.is-expanded circle')).toContain(
      `stroke-width: ${FOLD_RING_W};`,
    );
  });
});

describe('child connectors start at the handle outer rim (H1)', () => {
  it('starts every connector of a node with children at the outer rim', () => {
    expect(root.children!.length).toBeGreaterThan(3);
    const ps = sizeOf(root);
    expect(ps.foldSlot).toBe(FOLD_SLOT);
    const parent = { x: 240, y: 300, w: ps.w, foldSlot: ps.foldSlot };
    const boxRight = parent.x - ps.w / 2 + (ps.w - ps.foldSlot);
    const g = foldHandleGeometry(boxRight);
    root.children!.forEach((c, i) => {
      const cs = sizeOf(c);
      const d = childConnectorPath(parent, { x: 520, y: 120 + i * 58, w: cs.w });
      const x = startX(d);
      expect(x).toBeCloseTo(g.outerRim, 9);
      expect(x).toBeCloseTo(boxRight + FOLD_SLOT / 2 + FOLD_R + FOLD_RING_W / 2, 9);
      // Nothing starts inside the circle.
      expect(x).toBeGreaterThanOrEqual(g.cx + FOLD_R);
      expect(d).toMatch(/ 300 C /);
    });
  });

  it('keeps the pill right edge as the start when there is no handle', () => {
    expect(connectorStartX(200, 120, 0)).toBe(260);
    const d = childConnectorPath({ x: 200, y: 50, w: 120, foldSlot: 0 }, { x: 400, y: 80, w: 100 });
    expect(startX(d)).toBe(260);
  });
});

describe('one stem stub for folded and expanded (H2)', () => {
  const boxRight = 317;
  const folded = foldChromeSvg(boxRight, 40, true);
  const expanded = foldChromeSvg(boxRight, 40, false);

  it('draws the same stem in both states', () => {
    expect(stemOf(folded)).toBe(stemOf(expanded));
  });

  it('runs the stem 8 px, from the pill edge to the inner rim', () => {
    const stem = stemOf(expanded);
    const { innerRim } = foldHandleGeometry(boxRight);
    expect(innerRim - boxRight).toBe(8);
    expect(stem).toContain(`d="M ${boxRight} 40 H ${innerRim}"`);
  });

  it('paints the stem before the handle', () => {
    for (const svg of [folded, expanded]) {
      expect(svg.indexOf('map-fold-stem')).toBeLessThan(svg.indexOf('map-fold-indicator'));
    }
  });
});

describe('no black disc behind the − (H3)', () => {
  const black = /#000\b|#000000|\bblack\b|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)/i;

  it('has no #000 fill in the handle markup', () => {
    for (const collapsed of [true, false]) {
      expect(foldChromeSvg(317, 40, collapsed)).not.toMatch(black);
    }
    expect(foldHandleSvg(317, 40, false)).toMatch(/<circle r="9" fill="none"\/>/);
    expect(mapSrc).not.toMatch(/fill="#000/);
  });

  it('has no #000 in the fold handle css', () => {
    for (const sel of [
      '.map-fold-indicator',
      '.map-fold-indicator circle',
      '.map-fold-indicator path',
      '.map-fold-indicator.is-expanded circle',
      '.map-fold-indicator.is-expanded path',
    ]) {
      expect(cssRule(sel)).not.toMatch(black);
    }
    expect(cssRule('.map-fold-indicator.is-expanded circle')).toContain('fill: none;');
  });
});

describe('connectors have no opacity (H7)', () => {
  it('sets no opacity on .map-edge or .map-fold-stem in css', () => {
    const start = css.indexOf('.map-edge,\n.map-fold-stem {');
    expect(start).toBeGreaterThan(-1);
    expect(css.slice(start, css.indexOf('}', start))).not.toMatch(/opacity/);
    const own = css.lastIndexOf('.map-fold-stem {');
    expect(own).toBeGreaterThan(start);
    expect(css.slice(own, css.indexOf('}', own))).not.toMatch(/opacity/);
  });

  it('puts no opacity on edge or stem markup', () => {
    expect(mapEdgeSvg('M 0 0 C 1 0, 1 1, 2 1')).not.toMatch(/opacity/);
    expect(stemOf(foldChromeSvg(317, 40, false))).not.toMatch(/opacity/);
  });
});
