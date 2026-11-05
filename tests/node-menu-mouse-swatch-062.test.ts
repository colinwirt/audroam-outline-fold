// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, createMapView } from '../src/index.js';
import { renderNodeMenu } from '../src/nodeMenu.js';

/**
 * 0.6.2 follow-up (Colin): hybrid touchscreen+mouse often matches `(pointer: coarse)`,
 * so a mouse-opened node menu must still use data-pointer=fine (22px swatches), not the
 * 36px coarse tiles. Touch/pen opens keep coarse.
 */
const TEXT = ['- Colour me <id:c> <color:ember>', '- Child <id:k>', ''].join('\n');

function stubCoarse(matches: boolean) {
  const real = window.matchMedia?.bind(window);
  window.matchMedia = ((q: string) => {
    if (String(q).includes('pointer: coarse')) {
      return { matches, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } } as MediaQueryList;
    }
    return real ? real(q) : ({ matches: false } as MediaQueryList);
  }) as typeof window.matchMedia;
  return () => { if (real) window.matchMedia = real; };
}

async function mount() {
  const doc = parse(TEXT);
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 1000 });
  Object.defineProperty(host, 'clientHeight', { value: 800 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
  let focus = 'c';
  const mv: any = (createMapView as any)(host, {
    getDoc: () => doc,
    setDoc: () => {},
    getLayout: () => layout,
    getFocusId: () => focus,
    setFocusId: (id: string) => { focus = id; },
    nodeMenu: true,
    nodeColours: true,
    nodeIcons: true,
    nodeClouds: true,
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 20));
  return { host, mv };
}

describe('0.6.2 node menu swatches follow opening pointer, not only matchMedia', () => {
  const restores: Array<() => void> = [];
  afterEach(() => { while (restores.length) restores.pop()!(); document.body.replaceChildren(); });

  it('CSS: fine default 22px; coarse override 36px', () => {
    const css = readFileSync(join(__dirname, '../src/outline-fold.css'), 'utf8');
    expect(css).toMatch(/\.map-node-menu-swatch,\s*\.of-ep-swatch\s*\{[^}]*width:\s*22px/);
    expect(css).toMatch(/\.map-node-menu\[data-pointer="coarse"\]\s*\.map-node-menu-swatch\s*\{[^}]*width:\s*36px/);
  });

  it('renderNodeMenu sets data-pointer from fine', () => {
    const fine = renderNodeMenu({ title: 'x', entries: [], fine: true });
    const coarse = renderNodeMenu({ title: 'x', entries: [], fine: false });
    expect(fine.el.dataset.pointer).toBe('fine');
    expect(coarse.el.dataset.pointer).toBe('coarse');
  });

  it('source: mouse (and empty pointerType) contextmenu open forces fine even when coarse matchMedia', () => {
    const src = readFileSync(join(__dirname, '../src/mapView.ts'), 'utf8');
    const cm = src.slice(src.indexOf('function nodeMenuContext'));
    // Must special-case mouse; must not rely only on !coarsePointer() for the open.
    expect(cm).toMatch(/openNodeMenu\([\s\S]{0,200}fine:\s*pt\s*===\s*'mouse'|fine:\s*pt\s*!==\s*'touch'|pointerType:\s*pt/);
    expect(cm).toMatch(/pt\s*===\s*'mouse'|pt\s*!==\s*'touch'/);
  });

  it('mouse open on a coarse hybrid device uses data-pointer=fine (22px)', async () => {
    restores.push(stubCoarse(true));
    const { host, mv } = await mount();
    expect(mv.openNodeMenu('c', { clientX: 40, clientY: 40 }, { pointerType: 'mouse' })).toBe(true);
    const menu = host.querySelector('.map-node-menu') as HTMLElement;
    expect(menu.dataset.pointer).toBe('fine');
  });

  it('empty pointerType on coarse hybrid falls through to matchMedia (coarse)', async () => {
    // Default API / no pointerType: still respect matchMedia. Contextmenu call site
    // forces fine via fine: pt !== touch/pen (covers empty).
    restores.push(stubCoarse(true));
    const { host, mv } = await mount();
    expect(mv.openNodeMenu('c', { clientX: 40, clientY: 40 })).toBe(true);
    expect((host.querySelector('.map-node-menu') as HTMLElement).dataset.pointer).toBe('coarse');
  });

  it('contextmenu call site forces fine for mouse and empty pointerType', () => {
    const src = readFileSync(join(__dirname, '../src/mapView.ts'), 'utf8');
    const cm = src.slice(src.indexOf('function nodeMenuContext'));
    expect(cm).toMatch(/fine:\s*pt\s*!==\s*'touch'\s*&&\s*pt\s*!==\s*'pen'/);
  });

  it('touch pointerType on coarse hybrid uses data-pointer=coarse (36px)', async () => {
    restores.push(stubCoarse(true));
    const { host, mv } = await mount();
    expect(mv.openNodeMenu('c', { clientX: 40, clientY: 40 }, { pointerType: 'touch' })).toBe(true);
    expect((host.querySelector('.map-node-menu') as HTMLElement).dataset.pointer).toBe('coarse');
  });

  it('explicit fine:true wins over coarse matchMedia', async () => {
    restores.push(stubCoarse(true));
    const { host, mv } = await mount();
    expect(mv.openNodeMenu('c', { clientX: 40, clientY: 40 }, { fine: true })).toBe(true);
    expect((host.querySelector('.map-node-menu') as HTMLElement).dataset.pointer).toBe('fine');
  });

  it('touch/pen hold path still requests coarse (fine: false)', () => {
    const src = readFileSync(join(__dirname, '../src/mapView.ts'), 'utf8');
    expect(src).toMatch(/openNodeMenu\(hold\.key,[\s\S]{0,80}\{ fine: false \}\)/);
  });
});
