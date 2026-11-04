// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, createMapView } from '../src/index.js';

// 0.5.25 (Colin, 5 Nov): wireframe by default. Map nodes have no background (border + text);
// only `:fill` (own or inherited) paints one. Text and code chips follow the theme.
const css = readFileSync(join(__dirname, '../src/outline-fold.css'), 'utf8');
const rootBlock = css.match(/:root \{([\s\S]*?)\n\}/)![1]!;
const lightBlock = css.match(/\n\.of-theme-light \{([\s\S]*?)\n\}/)![1]!;
const tok = (b: string, n: string) => b.match(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6}|transparent)`))?.[1]?.toLowerCase();
const lum = (h: string) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const rule = (sel: string) => css.match(new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))?.[2] ?? '';

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
    setFocusId: (id: string) => { focus = id; }, nodeColours: true, nodeIcons: true, nodeMenu: true,
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 20));
  return (id: string) => host.querySelector(`.map-node[data-id="${id}"]`) as Element;
}

describe('0.5.25 wireframe default', () => {
  it('pills have no background by default, in both themes', () => {
    expect(rule('.map-pill')).toMatch(/fill: var\(--map-node-bg\)/);
    expect(tok(rootBlock, 'map-node-bg')).toBe('transparent');
    expect(lightBlock).not.toMatch(/--map-node-bg:\s*#/);
    // Time leaves and region/anchor bodies follow the same rule; no dark pill fills left.
    expect(rule('.map-node.time-leaf.time-leaf .map-pill')).toMatch(/fill: var\(--map-node-bg\)/);
    expect(css).not.toMatch(/(map-pill|map-region-body)[^{}\n]*\{[^}]*fill: var\(--pill-fill/);
  });
  it('a background only with :fill (own or inherited), wash mixed into the canvas', async () => {
    expect(rule('.map-node.colour-fill .map-pill')).toMatch(/color-mix\(in srgb, var\(--nc\) 16%, var\(--map-bg\)\)/);
    expect(rule('.map-node.is-hl .map-pill')).toMatch(/var\(--map-bg\)/);
    expect(rule('.map-node.is-au .map-pill')).toMatch(/fill: var\(--nh\)/);
    const g = await paint('- Plain <id:a>\n- Edge <color:ember> <id:b>\n- Wash <color:ember:fill> <id:c>\n  - Kid <id:d>\n');
    expect(g('a').getAttribute('class')).not.toContain('colour-fill');
    expect(g('b').getAttribute('class')).not.toContain('colour-fill');
    expect(g('c').getAttribute('class')).toContain('colour-fill');
    expect(g('d').getAttribute('class')).toContain('colour-fill');
  });
  it('uncoloured nodes: neutral thin border >= 3:1 on the canvas in both themes; time leaves stay green', () => {
    expect(rule('.map-pill')).toMatch(/stroke: var\(--pill-stroke\);\s*stroke-width: var\(--map-border-w, 1\.5px\);/);
    expect(ratio(tok(rootBlock, 'pill-stroke')!, tok(rootBlock, 'map-bg')!)).toBeGreaterThanOrEqual(3);
    expect(ratio(tok(lightBlock, 'pill-stroke')!, tok(lightBlock, 'map-bg')!)).toBeGreaterThanOrEqual(3);
    expect(rule('.map-node.time-leaf.time-leaf .map-pill')).toMatch(/stroke: var\(--time-stroke\)/);
    expect(ratio(tok(lightBlock, 'time-letter')!, tok(lightBlock, 'map-bg')!)).toBeGreaterThanOrEqual(4.5);
  });
  it('label text follows the theme: >= 4.5:1 on the canvas and on a 16% wash, both themes', () => {
    for (const b of [rootBlock, lightBlock]) {
      const ink = tok(b, 'map-node-text')!; const bg = tok(b, 'map-bg')!;
      expect(ratio(ink, bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(tok(b, 'map-node-muted')!, bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(tok(b, 'time-text')!, bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(tok(lightBlock, 'map-node-text')!, '#e9dcd6')).toBeGreaterThanOrEqual(4.5); // ember 16% on light canvas, approx
    expect(rule('.map-label')).toMatch(/fill: var\(--map-node-text\)/);
    expect(rule('.map-node.time-leaf .map-label')).toMatch(/fill: var\(--time-text\)/);
    expect(css).toMatch(/\.map-node\.has-colour \.map-label \{ fill: var\(--map-node-text\); \}/);
  });
  it('code chip follows the theme: pale chip in light theme', () => {
    const chip = tok(lightBlock, 'map-code-bg')!;
    expect(lum(chip)).toBeGreaterThan(0.85);
    expect(ratio(tok(lightBlock, 'map-code-ink')!, chip)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(tok(rootBlock, 'map-code-ink')!, tok(rootBlock, 'map-code-bg')!)).toBeGreaterThanOrEqual(4.5);
  });
  it('focus stays clear without a fill: thicker accent border plus a halo', () => {
    const f = css.match(/\.map-node\.is-focused \.map-pill,\s*\.map-node:focus-visible \.map-pill \{([^}]*)\}/)![1]!;
    expect(f).toMatch(/stroke-width: 2\.5/);
    expect(f).toMatch(/filter: drop-shadow/);
  });
});
