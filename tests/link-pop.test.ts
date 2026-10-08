import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { captionLinks, linkPopWhere, placeLinkPop } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const mapSrc = readFileSync(join(here, '../src/mapView.ts'), 'utf8');
const popSrc = readFileSync(join(here, '../src/linkPop.ts'), 'utf8');
const css = readFileSync(join(here, '../src/outline-fold.css'), 'utf8');
const BASE = 'https://audroam.github.io/audroam-outline-fold/examples/viewer/index.html?doc=../demos-index/demos-index.md';

const link = (label: string, href: string, hopId: string | null = null) => ({ label, href, hopId });

function block(name: string): string {
  const i = mapSrc.indexOf(`function ${name}(`);
  expect(i).toBeGreaterThan(-1);
  const next = mapSrc.indexOf('\n  function ', i + 10);
  return mapSrc.slice(i, next);
}

function rule(selector: string): string {
  const re = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  const all = [...css.matchAll(re)].map((m) => m[2]!);
  expect(all.length, selector).toBeGreaterThan(0);
  return all.join('\n');
}

describe('linkPopWhere', () => {
  it('external URL: host without www', () => {
    expect(linkPopWhere(link('Open', 'https://www.garden-club.example/shed-rota'), BASE)).toBe('garden-club.example');
    expect(linkPopWhere(link('Agenda', 'http://agenda.example.org/june?x=1'), BASE)).toBe('agenda.example.org');
    expect(linkPopWhere(link('Open', 'https://example.com'))).toBe('example.com');
  });

  it('same-site link: the file or folder it opens; a path in the query wins', () => {
    expect(linkPopWhere(link('Open', '?doc=../potholes/potholes.md'), BASE)).toBe('potholes.md');
    expect(
      linkPopWhere(link('Open', '?doc=../solar-system/solar-system.md&layout=../solar-system/solar-system.layout.json'), BASE),
    ).toBe('solar-system.md');
    expect(linkPopWhere(link('Open', '../../react-live/'), BASE)).toBe('react-live');
    expect(linkPopWhere(link('Open', '../canvas-2d/index.html'), BASE)).toBe('canvas-2d');
    expect(linkPopWhere(link('Minutes', 'levels.md'))).toBe('levels.md');
    expect(linkPopWhere(link('Open', 'https://audroam.github.io/audroam-outline-fold/examples/3d/'), BASE)).toBe('3d');
  });

  it('hop link, or a label that already says it: nothing', () => {
    expect(linkPopWhere(link('Plants', '#id:plants', 'plants'), BASE)).toBe('');
    expect(linkPopWhere(link('https://example.com/a', 'https://example.com/a'), BASE)).toBe('');
    expect(linkPopWhere(link('Example.com docs', 'https://example.com/docs'), BASE)).toBe('');
  });

  it('works on captionLinks output', () => {
    const got = captionLinks('Shed rota · [Open](https://www.garden-club.example/shed-rota) · [Plants](#id:plants)').map(
      (l) => [l.label, linkPopWhere(l, BASE)],
    );
    expect(got).toEqual([
      ['Open', 'garden-club.example'],
      ['Plants', ''],
    ]);
  });
});

describe('placeLinkPop', () => {
  const panel = { w: 800, h: 500 };
  const menu = { w: 160, h: 46 };
  const anchor = { x: 400, y: 200, w: 20, h: 20 };

  it('right of the globe, 8 px gap, centred on it; no pan when it fits', () => {
    expect(placeLinkPop({ anchor, panel, menu })).toEqual({ left: 428, top: 187, shift: { x: 0, y: 0 } });
  });

  it('past the right edge: pans left just enough for an 8 px margin, never flips', () => {
    const r = placeLinkPop({ anchor: { ...anchor, x: 700 }, panel, menu });
    expect(r.left).toBe(728);
    expect(r.shift).toEqual({ x: 800 - 8 - (728 + 160), y: 0 });
  });

  it('past the top or bottom: pans vertically, 8 px margin', () => {
    expect(placeLinkPop({ anchor: { ...anchor, y: -5 }, panel, menu }).shift).toEqual({ x: 0, y: 8 - (-5 + 10 - 23) });
    expect(placeLinkPop({ anchor: { ...anchor, y: 480 }, panel, menu }).shift).toEqual({ x: 0, y: 500 - 8 - (480 + 10 + 23) });
  });

  it('a globe left of the map pans right; a popover bigger than the map keeps its left edge in', () => {
    expect(placeLinkPop({ anchor: { ...anchor, x: -40 }, panel, menu }).shift.x).toBe(8 - (-40 + 28));
    expect(placeLinkPop({ anchor: { ...anchor, x: 100 }, panel: { w: 150, h: 500 }, menu }).shift.x).toBe(8 - 128);
  });
});

describe('link popover source', () => {
  it('no inline paint: classes from outline-fold.css, only left/top set', () => {
    const show = block('showLinkPop');
    const dismiss = block('dismissLinkPop');
    for (const b of [show, dismiss, popSrc]) {
      expect(b).not.toMatch(/cssText/);
      expect(b).not.toMatch(/monospace/);
      expect(b).not.toMatch(/style\.(opacity|transition|background|color|font)/);
    }
    expect(block('positionLinkPop')).toMatch(/placeLinkPop\(/);
    expect(dismiss).toMatch(/is-closing/);
    expect(dismiss).toMatch(/setTimeout\(\(\) => m\.el\.remove\(\), 180\)/);
    // Off the edge: pan the camera (zoom unchanged), smooth unless reduced motion.
    expect(show).toMatch(/animateCamTo\(\{ x: cam\.x \+ shift\.x, y: cam\.y \+ shift\.y, k: cam\.k \}/);
  });

  it('a pan keeps it open: no dismiss on pan start or map pointerdown; taps without a drag close it', () => {
    expect(block('startPan')).not.toMatch(/dismissLinkPop/);
    expect(mapSrc).not.toMatch(/closest\?\.\('\.map-link-hit, \.map-link-pop'\)\) dismissLinkPop/);
    const show = block('showLinkPop');
    expect(show).toMatch(/'pointerup'[\s\S]*d\.moved[\s\S]*dismissLinkPop\(false\)/);
  });

  it('menu pattern: role=menu, menuitem rows, external links in a new tab with noopener', () => {
    expect(popSrc).toMatch(/setAttribute\('role', 'menu'\)/);
    expect(popSrc).toMatch(/setAttribute\('role', 'menuitem'\)/);
    expect(popSrc).toMatch(/a\.target = '_blank';\s*a\.rel = 'noopener noreferrer';/);
    const show = block('showLinkPop');
    expect(show).toMatch(/levelMenuKeyAction\(/);
    expect(show).toMatch(/dismissLinkPop\(true\)/);
    expect(show).toMatch(/focusLinkItem\(0\)/);
  });

  it('CSS: one surface with the level menu, rows without underline, gold focus ring', () => {
    expect(css).toMatch(/\.map-level-menu,\s*\n\.map-link-pop\s*\{[^}]*background: var\(--map-menu-bg\)[^}]*font: 14px\/1\.2 var\(--of-font\)/);
    const item = rule('.map-link-item');
    expect(item).toMatch(/text-decoration: none/);
    expect(item).toMatch(/min-height: 32px/);
    expect(rule('.map-link-item:focus-visible')).toMatch(/outline: 2px solid var\(--gold\)/);
    expect(rule('.map-link-where')).toMatch(/color: var\(--muted, var\(--of-muted\)\)/);
    expect(rule('.map-link-pop.is-closing')).toMatch(/opacity: 0/);
    expect(rule('.map-link-pop')).toMatch(/transition: opacity 180ms ease/);
  });
});
