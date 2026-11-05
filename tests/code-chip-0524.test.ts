// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, createMapView } from '../src/index.js';

// 0.5.24 (Colin, 5 Nov): code regions styled like Slack inline code: orange mono ink on a
// chip a touch lighter than the node, faint 1px border, ~3px radius, ~2px/4px padding.
// Light theme: darker orange on a pale grey chip. Fill-independent in Map and Outline.
const css = readFileSync(join(__dirname, '../src/outline-fold.css'), 'utf8');
const rootBlock = css.match(/:root \{([\s\S]*?)\n\}/)![1]!;
const lightBlock = css.match(/\n\.of-theme-light \{([\s\S]*?)\n\}/)![1]!;
const olLight = css.match(/\.of-theme-light \.of-outline,\s*\.of-outline\.of-theme-light \{([\s\S]*?)\n\}/)![1]!;
const tok = (b: string, n: string) => b.match(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase();
const lum = (h: string) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const PILL = '#0c222c';

async function paint(text: string) {
  const doc = parse(text);
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 1000 });
  Object.defineProperty(host, 'clientHeight', { value: 800 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
  let cur = doc; let focus = doc.nodes[0]!.id!;
  const mv: any = (createMapView as any)(host, {
    getDoc: () => cur, setDoc: (d: any) => { cur = d; }, getLayout: () => layout, getFocusId: () => focus,
    setFocusId: (id: string) => { focus = id; }, nodeColours: true, nodeIcons: true, nodeMenu: true, canPersistWidths: true,
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 20));
  return (id: string) => host.querySelector(`.map-node[data-id="${id}"]`) as Element;
}

describe('0.5.24 Slack-style code chips', () => {
  it('dark: orange ink #e8912d, chip a touch lighter than the pill, faint border, >=4.5:1', () => {
    for (const [ink, bg, st] of [['map-code-ink', 'map-code-bg', 'map-code-stroke'], ['of-code-ink', 'of-code-bg', 'of-code-stroke']]) {
      expect(tok(rootBlock, ink!)).toBe('#e8912d');
      const chip = tok(rootBlock, bg!)!;
      expect(lum(chip)).toBeGreaterThan(lum(PILL));
      expect(ratio(chip, PILL)).toBeLessThan(1.4);
      expect(ratio(tok(rootBlock, st!)!, chip)).toBeLessThan(1.6);
      expect(ratio('#e8912d', chip)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('light: darker orange on a pale grey chip, >=4.5:1, Map and Outline alike', () => {
    for (const b of [lightBlock, olLight]) {
      const pre = b === lightBlock ? 'map' : 'of';
      const ink = tok(b, `${pre}-code-ink`)!; const chip = tok(b, `${pre}-code-bg`)!;
      expect(lum(chip)).toBeGreaterThan(0.85);
      expect(ratio(ink, chip)).toBeGreaterThanOrEqual(4.5);
      const [r, g, bl] = [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16));
      expect(r!).toBeGreaterThan(g! * 1.5); expect(g!).toBeGreaterThan(bl!); // orange-red
      expect(tok(b, `${pre}-code-stroke`)).toBeTruthy();
    }
  });
  it('Map rect: line-token border, rx 3, 4px horizontal pad; ink rule outranks fill label inks', async () => {
    expect(css).toMatch(/\.map-code-bg \{[^}]*fill: var\(--map-code-bg\)[^}]*stroke: var\(--map-code-stroke\)[^}]*stroke-width: var\(--map-stroke-line\);/);
    const g = await paint('- Use `npm t` now <id:a>\n');
    const r = g('a').querySelector('rect.map-code-bg')!;
    expect(r.getAttribute('rx')).toBe('3');
    const tx = Number(g('a').querySelector('.map-label')!.getAttribute('x'));
    expect(Number(r.getAttribute('x'))).toBeLessThan(tx + 60);
    expect(css).toMatch(/\.map-node\.map-node \.map-label tspan\.map-code[^{]*\{ fill: var\(--map-code-ink\)/);
  });
  it('fill-independent: same rect token inside ember, Highlighter and Audroam solid fills', async () => {
    const g = await paint('- Plain `x` <id:a>\n- W <color:ember:fill> <id:w>\n  - In `y` <id:b>\n- H `z` <color:lemon:fill> <id:h>\n- A `q` <color:audroam-red:fill> <id:au>\n');
    for (const id of ['a', 'b', 'h', 'au']) {
      const r = g(id).querySelector('rect.map-code-bg')!;
      expect(r, id).toBeTruthy();
      expect(r.getAttribute('fill')).toBe('var(--map-code-bg)');
      expect(g(id).querySelector('tspan.map-code')).toBeTruthy();
    }
    expect(g('au').getAttribute('class')).toContain('is-au');
    expect(g('h').getAttribute('class')).toContain('colour-fill');
    expect(css).not.toMatch(/(colour-fill|is-au|is-hl)[^{},\n]*(map-code|of-code)/);
  });
  it('Outline chip: own colour, 1px border, 3px radius, 2px 4px padding', () => {
    const m = css.match(/\.of-code \{([^}]*)\}/)![1]!;
    expect(m).toContain('background: var(--of-code-bg)');
    expect(m).toContain('color: var(--of-code-ink)');
    expect(m).toContain('border: 1px solid var(--of-code-stroke)');
    expect(m).toContain('border-radius: 3px');
    expect(m).toContain('padding: 2px 4px');
  });
});
