// @vitest-environment happy-dom
/**
 * Colin phone repro (note 42107 / Map icon picker):
 * Map tab selected → type "Clo" → all colour palettes still show unfiltered
 * (Forest…Audroam) and no emoji/icon Results appear.
 * Expected: matching emoji/icons (☁️ cloud, 🕐 clock, 🤡 clown…) first,
 * colours filtered by name, Results at the top of the scrollport.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { openIconPicker, currentIconPicker } from '../src/emoji/picker.js';
import { loadEmojiData, searchIcons } from '../src/emoji/icons.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '../src/outline-fold.css'), 'utf8');

beforeAll(async () => {
  await loadEmojiData();
});

afterEach(() => {
  currentIconPicker()?.close(false);
  document.body.replaceChildren();
});

const ALL_PALETTES = ['Forest', 'Neutral', 'Bold', 'Pastel', 'Deep', 'Highlighter', 'Audroam'];

function openPhoneNodePicker() {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  return openIconPicker({
    mode: 'node',
    anchor,
    onPick: () => {},
    expanded: true,
    sheet: true, // phone bottom sheet
    colour: { onColour: () => {}, value: 'blue' },
  } as any);
}

describe('0.6.2 Clo search with Map tab selected (Colin phone repro)', () => {

  it('CSS: filtered colour row [hidden] beats display:flex (empty strip must not paint)', () => {
    expect(css).toMatch(/\.of-ep-colours\[hidden\]\s*\{[^}]*display:\s*none/);
  });

  it("searchIcons('Clo') includes cloud, clock face, clown", () => {
    const hits = searchIcons('Clo');
    const names = hits.map((h) => h.name.toLowerCase());
    const inserts = hits.map((h) => h.insert);
    expect(names.some((n) => n.includes('cloud'))).toBe(true);
    expect(inserts.some((i) => i === '☁️' || i === '☁' || i.includes('☁'))).toBe(true);
    expect(names.some((n) => /clock|o'?clock/.test(n)) || inserts.includes(':clock:')).toBe(true);
    expect(inserts.includes('🕐') || names.some((n) => n.includes('oclock') || n.includes("o'clock"))).toBe(true);
    expect(names.some((n) => n.includes('clown')) || inserts.includes('🤡')).toBe(true);
  });

  it('Map tab selected + type Clo → Results (cloud/clock/clown) first; palettes not left unfiltered', () => {
    const p = openPhoneNodePicker();

    const mapTab = document.querySelector('[data-testid="of-ep-tab-map"]') as HTMLElement;
    expect(mapTab?.getAttribute('aria-selected')).toBe('true');

    const body = document.querySelector('[data-testid="of-ep-body"]') as HTMLElement;
    expect(body).toBeTruthy();
    // Pretend we scrolled to the colour palettes under Map (phone: short Map section, colours below).
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 2400 });
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 320 });
    body.scrollTop = 900;
    expect(body.scrollTop).toBe(900);

    // Before search: all palettes visible (the broken screenshot state for colours).
    const capsBefore = [...document.querySelectorAll('.of-ep-colours-cap')].map((c) => c.textContent);
    for (const name of ALL_PALETTES) expect(capsBefore).toContain(name);

    const search = document.querySelector('[data-testid="of-ep-search"]') as HTMLInputElement;
    search.value = 'Clo';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    const grid = document.querySelector('[data-testid="of-ep-grid"]')!;
    const results = grid.querySelector('[data-section="results"]');
    expect(results, 'Results section must appear for Clo').toBeTruthy();

    // Results at the top of the scrollport — not left scrolled into the colour region.
    expect(body.scrollTop, 'search must reset scroll so Results are not above the fold').toBe(0);

    const labels = [...grid.querySelectorAll('.of-ep-cell')].map(
      (c) => `${c.getAttribute('aria-label') || ''} ${c.getAttribute('data-insert') || ''}`,
    );
    expect(labels.some((l) => /cloud|☁/i.test(l))).toBe(true);
    expect(labels.some((l) => /clock|o'?clock|🕐|:clock:/i.test(l))).toBe(true);
    expect(labels.some((l) => /clown|🤡/i.test(l))).toBe(true);

    // Colours filtered by name: "Clo" matches no palette/swatch → not the full unfiltered list.
    const caps = [...document.querySelectorAll('.of-ep-colours-cap')].map((c) => c.textContent);
    expect(caps).not.toContain('Forest');
    expect(caps).not.toContain('Neutral');
    expect(caps).not.toContain('Bold');
    expect(caps).not.toContain('Pastel');
    expect(caps).not.toContain('Deep');
    expect(caps).not.toContain('Highlighter');
    expect(caps).not.toContain('Audroam');
    const colours = document.querySelector('[data-testid="of-ep-colours"]') as HTMLElement | null;
    expect(colours?.hidden || caps.length === 0).toBe(true);

    // Strip dims while searching; Map may remain aria-selected (syncTab skips when q set).
    expect(document.querySelector('.of-ep-strip')?.classList.contains('of-ep-strip-dim')).toBe(true);

    p.close(false);
  });
});
