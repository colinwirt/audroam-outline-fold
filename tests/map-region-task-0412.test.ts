// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse, createMapView } from '../src/index.js';

// Invented data. 0.4.12 bug 1: region task rows must render the main Map's task lead exactly
// (one renderer), and the zone CSS must paint only the pill body, never the task hit rect.
async function mount() {
  const doc = parse(`- [ ] main open <id:1>\n- [x] main done <id:2>\n- Box <id:3>\n`);
  const sub = parse(`- header <id:3>\n  - [ ] zone open <id:6>\n  - [x] zone done <id:7>\n`);
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 800 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' }; let focus = '1';
  const toggled: string[] = [];
  const mv: any = (createMapView as any)(host, {
    getDoc: () => doc, setDoc: () => {}, getLayout: () => layout, getFocusId: () => focus, setFocusId: (id: string) => { focus = id; },
    getRegionHosts: () => [{ id: 's:3', kind: 'sealed', anchor: '3', doc: sub, folded: false, kid: 'k1' }],
    onRegionTaskToggle: (id: string) => { toggled.push(id); return true; },
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 20));
  return { host, mv, toggled };
}
/** Task lead markup with geometry normalised away: element, class and every non-numeric attribute. */
function shape(g: Element): string {
  const els = [...g.querySelectorAll('.map-task-hit, .map-task-glyph, .map-task-glyph *')];
  return els.map((e) => `${e.tagName}:${[...e.attributes].filter((a) => !/^(x|y|width|height|transform|d)$/.test(a.name)).map((a) => `${a.name}=${a.value}`).sort().join(',')}`).join('|');
}
const find = (host: HTMLElement, sel: string, s: string) => [...host.querySelectorAll(sel)].find((g) => (g.textContent || '').includes(s))!;

it('region and main-Map task nodes share identical task-lead markup (open and done)', async () => {
  const { host, mv } = await mount();
  for (const [m, z] of [['main open', 'zone open'], ['main done', 'zone done']]) {
    const main = find(host, '.map-node', m), zone = find(host, '.map-region-node', z);
    expect(shape(zone)).toBe(shape(main));
    expect(shape(zone)).toContain('rect:'); // hit + glyph box present
    const box = zone.querySelector('.map-task-glyph rect')!;
    expect(box.getAttribute('width')).toBe('14');
  }
  expect(find(host, '.map-region-node', 'zone done').querySelector('.map-task-glyph path')).not.toBeNull();
  mv.destroy?.();
});

it('region task hit is transparent and the pill body is the only classed body rect', async () => {
  const { host, mv, toggled } = await mount();
  const zone = find(host, '.map-region-node', 'zone open');
  const rects = [...zone.children].filter((e) => e.tagName.toLowerCase() === 'rect');
  expect(rects[0]!.getAttribute('class')).toBe('map-region-body');
  expect(zone.querySelector('.map-task-hit')!.getAttribute('fill')).toBe('transparent');
  zone.querySelector('.map-task-hit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(toggled).toEqual([zone.getAttribute('data-scoped-id')]);
  mv.destroy?.();
});

it('zone CSS paints only .map-region-body (no catch-all rect rule that fills the task hit)', () => {
  const css = readFileSync('src/outline-fold.css', 'utf8');
  expect(css).not.toMatch(/map-region-(node|pill)(\.is-focused)?\s*>\s*rect:not/);
  expect(css).toMatch(/\.map-region-node \.map-task-hit \{ fill: transparent; stroke: none; \}/);
});
