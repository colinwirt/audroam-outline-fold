// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  renderNodeMenu,
  COMPACT_SWATCH_SLOTS,
  isCompactSwatchMenu,
  orderSwatchesByRecent,
  swatchFamily,
  type NodeMenuEntry,
} from '../src/nodeMenu.js';
import { colourMenuEntries, openColourPalette, createColourToolbarButton } from '../src/colourPalette.js';
import { recentColours, rememberColour, clearRecentColours } from '../src/colourRecent.js';
import { colourMatchesQuery, matchingColourGroups } from '../src/nodeColour.js';
import { openIconPicker } from '../src/emoji/picker.js';
import { loadEmojiData } from '../src/emoji/icons.js';
import { parse, createMapView } from '../src/index.js';

const css = readFileSync(join(__dirname, '../src/outline-fold.css'), 'utf8');

function swatchEntries(): NodeMenuEntry[] {
  return colourMenuEntries({ current: 'ember' });
}

describe('compact swatch helpers', () => {
  it('isCompactSwatchMenu: coarse or ≤600px; fine wide is full; zero width does not force compact', () => {
    expect(isCompactSwatchMenu({ fine: false })).toBe(true);
    expect(isCompactSwatchMenu({ fine: true, width: 390 })).toBe(true);
    expect(isCompactSwatchMenu({ fine: true, width: 1280 })).toBe(false);
    expect(isCompactSwatchMenu({ fine: true, width: 0 })).toBe(false);
    expect(isCompactSwatchMenu({ fine: true, compact: true, width: 1280 })).toBe(true);
    expect(isCompactSwatchMenu({ fine: false, compact: false })).toBe(false);
  });

  it('swatchFamily strips the group suffix', () => {
    expect(swatchFamily('Colour · Forest')).toBe('Colour');
    expect(swatchFamily('Cloud colour · Pastel')).toBe('Cloud colour');
    expect(swatchFamily('Colour')).toBe('Colour');
  });

  it('orderSwatchesByRecent puts recent first, keeps the rest', () => {
    const batch = swatchEntries();
    const ordered = orderSwatchesByRecent(batch, ['fern', 'lemon']);
    expect(ordered[0]?.swatch).toBe('fern');
    expect(ordered[1]?.swatch).toBe('lemon');
    expect(ordered.filter((e) => e.swatch === 'fern').length).toBe(1);
    expect(ordered.length).toBe(batch.length);
  });
});

describe('recent colours store', () => {
  beforeEach(() => clearRecentColours());
  afterEach(() => clearRecentColours());

  it('remembers most-recent-first and ignores none', () => {
    rememberColour('fern');
    rememberColour('ember');
    rememberColour('fern');
    rememberColour('none');
    rememberColour(undefined);
    expect(recentColours()[0]).toBe('fern');
    expect(recentColours()[1]).toBe('ember');
    expect(recentColours()).not.toContain('none');
  });
});

describe('renderNodeMenu compact strip', () => {
  it('CSS: 2×6 grid, 36px tiles, close 44px, max-height scroll, backdrop', () => {
    expect(css).toMatch(/\.map-node-menu-swatches\.is-compact\s*\{[^}]*grid-template-columns:\s*repeat\(6,\s*36px\)/);
    expect(css).toMatch(/\.map-node-menu\[data-compact="true"\]\s*\.map-node-menu-swatch\s*\{[^}]*width:\s*36px/);
    expect(css).toMatch(/\.map-node-menu-close\s*\{[^}]*width:\s*44px/);
    expect(css).toMatch(/\.map-node-menu\s*\{[^}]*max-height:/);
    expect(css).toMatch(/\.map-node-menu\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.map-node-menu-backdrop\s*\{[^}]*position:\s*fixed/);
  });

  it('fine desktop keeps every palette row and has no close/backdrop', () => {
    const v = renderNodeMenu({ title: 'n', entries: swatchEntries(), fine: true, compact: false });
    const rows = [...v.el.querySelectorAll('.map-node-menu-swatches')].map((r) => r.getAttribute('aria-label'));
    expect(rows).toEqual([
      'Colour · Forest',
      'Colour · Neutral',
      'Colour · Bold',
      'Colour · Pastel',
      'Colour · Deep',
      'Colour · Highlighter',
      'Colour · Audroam',
    ]);
    expect(v.closeBtn).toBeNull();
    expect(v.backdrop).toBeNull();
    expect(v.el.dataset.compact).toBeUndefined();
  });

  it('compact: at most 11 swatches + …, recent first, close × and backdrop', () => {
    rememberColour('lemon');
    rememberColour('fern');
    const v = renderNodeMenu({
      title: 'Loose note',
      entries: swatchEntries(),
      fine: false,
      compact: true,
      recent: recentColours(),
    });
    expect(v.el.dataset.compact).toBe('true');
    expect(v.el.dataset.pointer).toBe('coarse');
    const strip = v.el.querySelector('[data-testid="map-node-menu-swatches-compact"]') as HTMLElement;
    expect(strip).toBeTruthy();
    expect(strip.classList.contains('is-compact')).toBe(true);
    const radios = strip.querySelectorAll('[role="menuitemradio"]');
    expect(radios.length).toBe(COMPACT_SWATCH_SLOTS - 1); // 11 + more
    expect(radios.length).toBeLessThanOrEqual(11);
    const more = strip.querySelector('[data-testid="map-node-menu-swatch-more"]') as HTMLElement;
    expect(more).toBeTruthy();
    expect(more.textContent).toBe('…');
    // recent first
    expect((radios[0] as HTMLElement).dataset.swatch).toBe('fern');
    expect((radios[1] as HTMLElement).dataset.swatch).toBe('lemon');
    expect(v.closeBtn).toBeTruthy();
    expect(v.closeBtn!.getAttribute('aria-label')).toBe('Close');
    expect(v.backdrop).toBeTruthy();
    clearRecentColours();
  });

  it('… expands to the full labelled palette; Fill (if present) stays after the rows', () => {
    const entries: NodeMenuEntry[] = [
      ...swatchEntries(),
      { key: 'colour-fill', label: 'Fill', group: 'Edit', checked: false },
    ];
    const v = renderNodeMenu({ title: 'n', entries, fine: false, compact: true, recent: [] });
    const fillBefore = v.el.querySelector('[data-item="colour-fill"]');
    expect(fillBefore).toBeTruthy();
    const more = v.el.querySelector('[data-testid="map-node-menu-swatch-more"]') as HTMLButtonElement;
    more.click();
    expect(v.el.querySelector('[data-testid="map-node-menu-swatches-compact"]')).toBeNull();
    const rows = [...v.el.querySelectorAll('.map-node-menu-swatches')].map((r) => r.getAttribute('aria-label'));
    expect(rows).toEqual([
      'Colour · Forest',
      'Colour · Neutral',
      'Colour · Bold',
      'Colour · Pastel',
      'Colour · Deep',
      'Colour · Highlighter',
      'Colour · Audroam',
    ]);
    const fill = v.el.querySelector('[data-item="colour-fill"]') as HTMLElement;
    const lastRow = v.el.querySelector('.map-node-menu-swatches[aria-label="Colour · Audroam"]') as HTMLElement;
    expect(fill).toBeTruthy();
    // Fill still follows the colour rows.
    expect(!!(lastRow.compareDocumentPosition(fill) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    // items includes the newly revealed swatches
    expect(v.items.some((b) => b.dataset.item === 'color:audroam-red')).toBe(true);
    expect(v.items.some((b) => b.dataset.item === 'colour-fill')).toBe(true);
  });
});

describe('colour search matching', () => {
  it('matches group names, role ids, labels, and aliases like red → ember', () => {
    expect(colourMatchesQuery('red', 'Forest', 'ember', 'Ember')).toBe(true);
    expect(colourMatchesQuery('forest', 'Forest', 'moss', 'Moss')).toBe(true);
    expect(colourMatchesQuery('pastel', 'Pastel', 'pastel-red', 'Pastel red')).toBe(true);
    expect(colourMatchesQuery('highlighter', 'Highlighter', 'lemon', 'Lemon')).toBe(true);
    expect(colourMatchesQuery('hour', 'Forest', 'ember', 'Ember')).toBe(false);
    const red = matchingColourGroups('red');
    const names = red.flatMap((g) => g.colours);
    expect(names).toContain('ember');
    expect(names).toContain('bold-red');
    expect(names).toContain('pastel-red');
    expect(matchingColourGroups('')).toEqual([]);
    expect(matchingColourGroups('forest').map((g) => g.name)).toEqual(['Forest']);
  });
});

describe('icon picker: hide colours in browse, show on search', () => {
  beforeAll(async () => {
    await loadEmojiData();
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('opens without colour sections; forest / red / highlighter queries reveal matching swatches', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const p = openIconPicker({
      mode: 'node',
      anchor,
      onPick: () => {},
      expanded: true,
      colour: { onColour: () => {}, value: undefined },
    } as any);
    expect(document.querySelector('[data-testid="of-ep-colours"]')).toBeNull();
    const search = document.querySelector('[data-testid="of-ep-search"]') as HTMLInputElement;
    const type = (q: string) => {
      search.value = q;
      search.dispatchEvent(new Event('input', { bubbles: true }));
    };
    type('forest');
    expect([...document.querySelectorAll('.of-ep-colours-cap')].map((c) => c.textContent)).toEqual(['Forest']);
    expect(document.querySelector('[data-testid="of-ep-swatch-moss"]')).toBeTruthy();
    type('red');
    const caps = [...document.querySelectorAll('.of-ep-colours-cap')].map((c) => c.textContent);
    expect(caps.length).toBeGreaterThan(0);
    expect(document.querySelector('[data-testid="of-ep-swatch-ember"]')).toBeTruthy();
    type('highlighter');
    expect([...document.querySelectorAll('.of-ep-colours-cap')].map((c) => c.textContent)).toEqual(['Highlighter']);
    type('zzzz-no-such');
    expect(document.querySelector('[data-testid="of-ep-empty"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="of-ep-colours"]')?.hasAttribute('hidden') || !document.querySelector('.of-ep-colours-cap')).toBeTruthy();
    p.close(false);
  });
});

describe('openColourPalette + toolbar button', () => {
  afterEach(() => {
    document.body.replaceChildren();
    clearRecentColours();
  });

  it('opens a palette, applies a colour, stays open, closes on × and outside', () => {
    const picks: Array<string | undefined> = [];
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const h = openColourPalette({
      anchor,
      onColour: (c) => picks.push(c),
      compact: true,
      fine: false,
    });
    const pal = document.querySelector('[data-testid="of-colour-palette"]') as HTMLElement;
    expect(pal).toBeTruthy();
    expect(pal.querySelector('[data-testid="map-node-menu-swatches-compact"]')).toBeTruthy();
    const fern = pal.querySelector('[data-swatch="fern"]') as HTMLButtonElement;
    expect(fern).toBeTruthy();
    fern.click();
    expect(picks).toEqual(['fern']);
    expect(recentColours()[0]).toBe('fern');
    expect(document.querySelector('[data-testid="of-colour-palette"]')).toBeTruthy(); // stay-open
    const close = pal.querySelector('[data-testid="map-node-menu-close"]') as HTMLButtonElement;
    close.click();
    expect(document.querySelector('[data-testid="of-colour-palette"]')).toBeNull();
    void h;
  });

  it('createColourToolbarButton toggles a standalone palette', () => {
    const picks: Array<string | undefined> = [];
    const b = createColourToolbarButton({ onColour: (c) => picks.push(c), compact: undefined });
    document.body.appendChild(b);
    expect(b.getAttribute('data-testid')).toBe('of-colour-toolbar');
    b.click();
    expect(document.querySelector('[data-testid="of-colour-palette"]')).toBeTruthy();
    expect(b.getAttribute('aria-pressed')).toBe('true');
    b.click(); // toggle closed
    expect(document.querySelector('[data-testid="of-colour-palette"]')).toBeNull();
    expect(b.getAttribute('aria-pressed')).toBe('false');
    void picks;
  });
});

describe('map handle: openColourPalette colours the focused node', () => {
  afterEach(() => {
    document.body.replaceChildren();
    clearRecentColours();
  });

  it('toggleColourPalette applies fern via stay-open pick', async () => {
    const TEXT = ['- Loose note <id:loose>', ''].join('\n');
    const doc = parse(TEXT);
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 1000, configurable: true });
    Object.defineProperty(host, 'clientHeight', { value: 800, configurable: true });
    document.body.appendChild(host);
    let cur: any = doc;
    let focus = 'loose';
    const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
    const mv: any = (createMapView as any)(host, {
      getDoc: () => cur,
      setDoc: (d: any) => { cur = d; },
      getLayout: () => layout,
      getFocusId: () => focus,
      setFocusId: (id: string) => { focus = id; },
      nodeMenu: true,
      nodeColours: true,
      nodeIcons: true,
      nodeClouds: true,
      isActive: () => true,
    });
    try { mv.ensurePositions?.(); mv.paint(); } catch { /* viewBox can be unready in happy-dom; palette does not need a painted map */ }
    await new Promise((r) => setTimeout(r, 20));
    expect(mv.toggleColourPalette('loose')).toBe(true);
    expect(mv.isColourPaletteOpen()).toBe(true);
    const fern = document.querySelector('[data-testid="of-colour-palette"] [data-swatch="fern"]') as HTMLButtonElement;
    expect(fern).toBeTruthy();
    fern.click();
    expect(cur.nodes[0].color).toBe('fern');
    expect(mv.isColourPaletteOpen()).toBe(true);
    mv.closeColourPalette();
    expect(mv.isColourPaletteOpen()).toBe(false);
    mv.destroy?.();
  });
});
