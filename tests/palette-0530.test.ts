import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../src/parse.js';
import {
  contrastRatio, checkboxInk, colourDistance, colourGroups, swatchHex, resolveColour, isNodeColour,
  PALETTE_GROUPS, filledPaint, rolesCss, NODE_COLOURS, BASE_ROLES,
} from '../src/nodeColour.js';

const css = readFileSync(join(__dirname, '../src/outline-fold.css'), 'utf8');

describe('0.5.30 contrast helper', () => {
  it('contrastRatio matches WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
  });
  it('checkboxInk is >= 3:1 on any fill, mid greys included', () => {
    for (const f of ['#ffffff', '#000000', '#777777', '#888888', '#ff0000', '#ffff00', '#0000ff', '#00ff00', '#7f7f7f', '#5e35b1', '#fdd835']) {
      expect(contrastRatio(checkboxInk(f), f)).toBeGreaterThanOrEqual(3);
    }
  });
  it('checkboxInk picks a dark ink on light fills and a light ink on dark fills', () => {
    expect(contrastRatio(checkboxInk('#fff35c'), '#000000')).toBeLessThan(contrastRatio(checkboxInk('#fff35c'), '#ffffff'));
    expect(contrastRatio(checkboxInk('#14532d'), '#ffffff')).toBeLessThan(contrastRatio(checkboxInk('#14532d'), '#000000'));
  });
  it('every role, filled, in both themes, gets a >= 3:1 checkbox ink', () => {
    for (const r of NODE_COLOURS) for (const t of ['dark', 'light'] as const) {
      const f = filledPaint(r, t);
      expect(contrastRatio(checkboxInk(f), f), `${r} ${t}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('CSS paints the task glyph with --task-ink on a filled node', () => {
    expect(css).toMatch(/\.colour-fill \.map-task-glyph[^{]*\{[^}]*stroke: var\(--task-ink/);
  });
});

describe('0.5.30 palettes', () => {
  it('offers Neutral, Bold, Pastel, Deep, Highlighter and Audroam groups', () => {
    const names = colourGroups().map((g) => g.name);
    for (const n of ['Neutral', 'Bold', 'Pastel', 'Deep', 'Highlighter', 'Audroam']) expect(names).toContain(n);
  });
  it('swatches in every palette are clearly distinct (min Lab distance)', () => {
    for (const g of colourGroups()) {
      const min = g.name === 'Audroam' ? 6 : 18; // Audroam colours are exact samples from the app; sky/lavender (6.7) and steel/primary (7.4) are the app's own pairs
      const hexes = g.colours.map((c) => swatchHex(c, 'dark'));
      for (let i = 0; i < hexes.length; i++) for (let j = i + 1; j < hexes.length; j++) {
        expect(colourDistance(hexes[i]!, hexes[j]!), `${g.name}: ${g.colours[i]} vs ${g.colours[j]}`).toBeGreaterThanOrEqual(min);
      }
    }
  });
  it('the palettes differ from each other in lightness (pastel light, deep dark)', () => {
    const L = (role: string) => { const h = swatchHex(role, 'dark'); return contrastRatio(h, '#000000'); };
    const avg = (g: string) => { const c = PALETTE_GROUPS.find((p) => p.label === g)!; const ks = Object.keys(c.roles); return ks.reduce((s, k) => s + L(k), 0) / ks.length; };
    expect(avg('Pastel')).toBeGreaterThan(avg('Bold'));
    expect(avg('Bold')).toBeGreaterThan(avg('Deep'));
  });
  it('white and black are roles, first in the swatches, and parse as border and fill', () => {
    expect(isNodeColour('white')).toBe(true);
    expect(isNodeColour('black')).toBe(true);
    expect(colourGroups()[1]!.colours.slice(0, 2)).toEqual(['white', 'black']);
    expect(parse('- A <color:white:fill>\n').nodes[0]!.colorFill).toBe(true);
    expect(parse('- A <color:black>\n').nodes[0]!.color).toBe('black');
    expect(resolveColour('grey')).toBe('stone');
  });
  it('existing roles still resolve', () => {
    for (const r of [...BASE_ROLES, 'lemon', 'aqua', 'audroam-sky', 'red', 'blue']) expect(resolveColour(r)).toBeTruthy();
  });
  it('white border is outlined in the light theme, black in the dark theme', () => {
    expect(css).toMatch(/\.of-theme-light \.map-node\.colour-white \.map-pill[^{]*\{[^}]*drop-shadow/);
    expect(css).toMatch(/\.map-node\.colour-black \.map-pill[^{]*\{[^}]*drop-shadow/);
  });
  it('the generated role CSS in outline-fold.css is in sync', () => {
    const a = css.indexOf('/* @gen-roles-start */');
    const b = css.indexOf('/* @gen-roles-end */');
    expect(a).toBeGreaterThan(-1);
    expect(css.slice(a + '/* @gen-roles-start */\n'.length, b)).toBe(rolesCss());
  });
});

describe('0.5.30 Audroam rich colours (sampled from the Audroam app CSS)', () => {
  const RICH: Record<string, string> = {
    'audroam-danger': '#d9534f', 'audroam-success': '#5cb85c', 'audroam-focus': '#2a8a2a',
    'audroam-steel': '#4682b4', 'audroam-primary': '#337ab7', 'audroam-white': '#ffffff',
  };
  it('leads the Audroam row with the rich colours, then the soft tints (old names kept)', async () => {
    const m = await import('../src/nodeColour');
    const row = m.colourGroups().find((g) => g.name === 'Audroam')!.colours as readonly string[];
    expect(row.slice(0, 6)).toEqual(Object.keys(RICH));
    for (const old of ['audroam-green', 'audroam-salmon', 'audroam-sky', 'audroam-grey']) expect(row).toContain(old);
    expect(m.resolveColour('audroam-sky')).toBe('audroam-sky');
  });
  it('fills with the exact sampled hex, borders >= 3:1 on both canvases, checkbox >= 3:1 on the fill', async () => {
    const m = await import('../src/nodeColour');
    for (const [r, hex] of Object.entries(RICH)) {
      expect(m.filledPaint(r, 'dark')).toBe(hex);
      expect(m.filledPaint(r, 'light')).toBe(hex);
      expect(m.checkboxInk(hex) && m.contrastRatio(m.checkboxInk(hex), hex)).toBeGreaterThanOrEqual(3);
      if (r !== 'audroam-white') for (const t of ['dark', 'light'] as const) expect(m.contrastRatio(m.swatchHex(r, t), m.MAP_CANVAS[t])).toBeGreaterThanOrEqual(3);
    }
    expect(m.isSolidColour('audroam-danger')).toBe(true);
  });
});
