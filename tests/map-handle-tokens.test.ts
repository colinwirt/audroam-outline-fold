import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_CASING_W,
  FOLD_HALO_DASH_W,
  FOLD_HALO_RING_W,
  FOLD_RING_W,
  foldChromeSvg,
  foldHaloSvg,
  foldHandleGeometry,
  isConnectorCasingSet,
  mapEdgeCasingSvg,
} from '../src/mapView.js';

// Map fold handle and connector polish, phases 2 and 3 (Design UX 2026-10-07, H3, H4, H8, H9).

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../src/outline-fold.css'), 'utf8');
const mapSrc = readFileSync(join(here, '../src/mapView.ts'), 'utf8');

function block(selector: string): string {
  // The rule whose selector list is exactly `selector` (not a later item of a list).
  const at = css.lastIndexOf('\n' + selector + ' {');
  const start = at >= 0 ? at + 1 : css.indexOf(selector + ' {');
  expect(start, `css rule ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start) + 1);
}

function decl(rule: string, prop: string): string {
  const m = new RegExp(`(?:^|[\\s;{])${prop.replace(/[-]/g, '\\-')}:\\s*([^;]+);`).exec(rule);
  expect(m, `${prop} in ${rule}`).not.toBeNull();
  return m![1]!.trim();
}

function hex(c: string): [number, number, number] {
  const h = c.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = hex(c).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const root = block(':root');
const light = block('.of-theme-light');

describe('H3 handle hooks', () => {
  it('defaults --map-handle-bg to transparent and fills the − with it', () => {
    expect(decl(root, '--map-handle-bg')).toBe('transparent');
    expect(decl(block('.map-fold-indicator.is-expanded circle'), 'fill')).toBe('var(--map-handle-bg, transparent)');
  });

  it('draws the + glyph in --map-handle-glyph-on-gold, not the canvas colour', () => {
    expect(decl(root, '--map-handle-glyph-on-gold')).toBe('#0a1f28');
    const glyph = decl(block('.map-fold-indicator path'), 'stroke');
    expect(glyph).toBe('var(--map-handle-glyph-on-gold, #0a1f28)');
    expect(glyph).not.toContain('--map-bg');
  });

  it('keeps the + glyph opaque when --map-bg has alpha', () => {
    // The glyph token is its own opaque colour; nothing on the + reads --map-bg.
    for (const sel of ['.map-fold-indicator circle', '.map-fold-indicator path']) {
      expect(block(sel)).not.toContain('--map-bg');
    }
  });
});

describe('H4 halo under the − ring and dash', () => {
  it('draws a ring and a dash casing for the expanded handle only', () => {
    const halo = foldHaloSvg(100, 40);
    const { cx, r } = foldHandleGeometry(100);
    expect(halo).toContain(`class="map-fold-halo" transform="translate(${cx} 40)"`);
    expect(halo).toContain(`<circle r="${r}" fill="none" stroke-width="${FOLD_HALO_RING_W}"/>`);
    expect(halo).toContain(`<path d="M -4 0 H 4" fill="none" stroke-width="${FOLD_HALO_DASH_W}"/>`);
    expect(foldChromeSvg(100, 40, false)).toContain('map-fold-halo');
    expect(foldChromeSvg(100, 40, true)).not.toContain('map-fold-halo');
  });

  it('reaches 1.5 px past each side of the gold ring', () => {
    expect((FOLD_HALO_RING_W - FOLD_RING_W) / 2).toBeCloseTo(1.5, 9);
    expect(decl(block('.map-fold-halo circle'), 'stroke-width')).toBe(String(FOLD_HALO_RING_W));
    expect(decl(block('.map-fold-halo path'), 'stroke-width')).toBe(String(FOLD_HALO_DASH_W));
  });

  it('paints the halo before the stem and the handle, so the stub stays 8 px', () => {
    const svg = foldChromeSvg(317, 40, false);
    const halo = svg.indexOf('map-fold-halo');
    expect(halo).toBeGreaterThan(-1);
    expect(halo).toBeLessThan(svg.indexOf('class="map-fold-stem"'));
    expect(svg.indexOf('class="map-fold-stem"')).toBeLessThan(svg.indexOf('map-fold-indicator'));
  });

  it('defaults --map-halo to the nearest canvas colour at 85%', () => {
    const stroke = decl(block('.map-fold-halo circle,\n.map-fold-halo path'), 'stroke');
    expect(stroke).toBe('var(--map-halo, color-mix(in srgb, var(--map-bg) 85%, transparent))');
    // Not fixed at :root, so a host that sets --map-bg on the map host gets a matching halo.
    expect(root).not.toMatch(/--map-halo\s*:/);
  });

  it('is not a filled disc and uses no SVG filter', () => {
    expect(foldHaloSvg(100, 40)).not.toMatch(/fill="(?!none)/);
    expect(css).not.toMatch(/\.map-fold[^{]*\{[^}]*filter:/);
  });
});

describe('H8 optional connector casing', () => {
  it('defaults --connector-casing to transparent, which draws nothing extra', () => {
    expect(decl(root, '--connector-casing')).toBe('transparent');
    expect(isConnectorCasingSet('transparent')).toBe(false);
    expect(foldChromeSvg(100, 40, false)).not.toContain('casing');
  });

  it('reads only a visible colour as set', () => {
    for (const off of ['', '  ', 'transparent', 'none', 'rgba(6,18,24,0)', 'rgb(0 0 0 / 0)', 'hsla(0, 0%, 0%, 0.0)', '#0000', '#00000000', null, undefined]) {
      expect(isConnectorCasingSet(off as string), JSON.stringify(off)).toBe(false);
    }
    for (const on of ['rgba(6,18,24,.85)', ' #061218 ', '#000', 'black', 'rgb(6 18 24 / 0.5)']) {
      expect(isConnectorCasingSet(on), on).toBe(true);
    }
  });

  it('draws the stem casing before the stem when asked', () => {
    const svg = foldChromeSvg(317, 40, true, undefined, { casing: true });
    const { innerRim } = foldHandleGeometry(317);
    expect(svg).toContain(`<path class="map-fold-stem-casing" d="M 317 40 H ${innerRim}" fill="none" stroke-width="${CONNECTOR_CASING_W}" pointer-events="none"/>`);
    expect(svg.indexOf('map-fold-stem-casing')).toBeLessThan(svg.indexOf('class="map-fold-stem"'));
  });

  it('casing paths use the same d as the line and the casing token', () => {
    expect(mapEdgeCasingSvg('M 1 2 C 3 2, 3 4, 5 4')).toBe('<path class="map-edge-casing" d="M 1 2 C 3 2, 3 4, 5 4"/>');
    const rule = block('.map-edge-casing,\n.map-fold-stem-casing');
    expect(decl(rule, 'stroke')).toBe('var(--connector-casing, transparent)');
    expect(decl(rule, 'stroke-width')).toBe(String(CONNECTOR_CASING_W));
  });

  it('paints all casings before any edge line, and fades them with the edges', () => {
    expect(mapSrc).toMatch(/casing \? edges\.map\(\(e\) => mapEdgeCasingSvg\(e\.d\)\)\.join\(''\) : ''\) \+\s+edges\.map\(\(e\) => mapEdgeSvg\(e\.d, \{ timeLeaf: e\.timeLeaf \}\)\)/);
    expect(mapSrc.match(/querySelectorAll<SVGElement>\('\.map-edge, \.map-edge-casing'\)/g)?.length).toBe(3);
    expect(mapSrc).not.toMatch(/querySelectorAll<SVGElement>\('\.map-edge'\)/);
  });
});

describe('H9 theme tokens', () => {
  it('ships the dark defaults in :root', () => {
    expect(decl(root, '--map-bg')).toBe('#0a1f28');
    expect(decl(root, '--connector')).toBe('#9bb0d0');
    expect(decl(root, '--gold')).toBe('#c9a227');
  });

  it('ships the light tokens behind .of-theme-light', () => {
    expect(decl(light, '--map-bg')).toBe('#f3f6f9');
    expect(decl(light, '--connector')).toBe('#62778f');
    expect(decl(light, '--gold')).toBe('#9a7400');
    expect(decl(light, '--map-handle-glyph-on-gold')).toBe('#ffffff');
    expect(decl(light, '--map-handle-bg')).toBe('transparent');
    expect(decl(light, '--connector-casing')).toBe('transparent');
  });

  it('meets 3:1 for connector and gold on the canvas in each theme (WCAG 1.4.11)', () => {
    for (const t of [root, light]) {
      const bg = decl(t, '--map-bg');
      expect(contrast(decl(t, '--connector'), bg)).toBeGreaterThanOrEqual(3);
      expect(contrast(decl(t, '--gold'), bg)).toBeGreaterThanOrEqual(3);
      expect(contrast(decl(t, '--map-handle-glyph-on-gold'), decl(t, '--gold'))).toBeGreaterThanOrEqual(3);
    }
  });
});
