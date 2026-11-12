// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openIconPicker } from '../src/emoji/picker.js';
import { loadEmojiData, searchIcons } from '../src/emoji/icons.js';
import { parse, createMapView } from '../src/index.js';

const css = readFileSync(join(__dirname, '../src/outline-fold.css'), 'utf8');

beforeAll(async () => {
  await loadEmojiData();
});

function openNodePicker() {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  return openIconPicker({
    mode: 'node',
    anchor,
    onPick: () => {},
    expanded: true,
    colour: { onColour: () => {}, value: undefined },
  } as any);
}

describe('0.6.1 icon picker layout (scroll + Audroam reachable)', () => {
  it('CSS: panel uses a scroll body with min-height 0 and no horizontal overflow', () => {
    expect(css).toMatch(/\.of-ep-body\s*\{[^}]*min-height:\s*0/);
    expect(css).toMatch(/\.of-ep-body\s*\{[^}]*overflow-x:\s*hidden/);
    expect(css).toMatch(/\.of-ep-body\s*\{[^}]*overflow-y:\s*auto/);
    // Grid is no longer the sole flex-grow scrollport that crushes under the colour row.
    expect(css).toMatch(/\.of-ep\.of-ep-panel\s*\{[^}]*overflow:\s*hidden/);
  });

  it('DOM: colour host sits inside of-ep-body; browse hides palettes; search reveals them there', () => {
    const p = openNodePicker();
    const body = document.querySelector('[data-testid="of-ep-body"]') as HTMLElement;
    const grid = document.querySelector('[data-testid="of-ep-grid"]') as HTMLElement;
    const host = document.querySelector('[data-testid="of-ep-colours-host"]') as HTMLElement;
    expect(body).toBeTruthy();
    expect(body.contains(grid)).toBe(true);
    expect(host).toBeTruthy();
    expect(body.contains(host)).toBe(true);
    // Default / browse: colour sections are hidden.
    expect(host.hidden || !host.querySelector('[data-testid="of-ep-colours"]')).toBe(true);
    expect(document.querySelectorAll('.of-ep-colours-cap').length).toBe(0);
    // Search that matches a group name shows those swatches inside the same scroll body.
    const search = document.querySelector('[data-testid="of-ep-search"]') as HTMLInputElement;
    search.value = 'audroam';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const colours = document.querySelector('[data-testid="of-ep-colours"]') as HTMLElement;
    expect(colours).toBeTruthy();
    expect(body.contains(colours)).toBe(true);
    const caps = [...colours.querySelectorAll('.of-ep-colours-cap')].map((c) => c.textContent);
    expect(caps).toContain('Audroam');
    p.close(false);
  });
});

describe('0.6.1 icon picker search (icons + colour filter)', () => {
  it("searchIcons('hour') returns hourglasses and clock faces (incl. 🕐)", () => {
    const hits = searchIcons('hour');
    const inserts = hits.map((h) => h.insert);
    expect(inserts).toContain('⏳');
    expect(inserts).toContain('⌛');
    expect(inserts).toContain('🕐');
  });

  it('typing in search shows Results cells and filters colour palettes', () => {
    const p = openNodePicker();
    const search = document.querySelector('[data-testid="of-ep-search"]') as HTMLInputElement;
    search.value = 'hour';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const grid = document.querySelector('[data-testid="of-ep-grid"]')!;
    expect(grid.querySelector('[data-section="results"]')).toBeTruthy();
    expect(grid.querySelectorAll('.of-ep-cell').length).toBeGreaterThan(0);
    const labels = [...grid.querySelectorAll('.of-ep-cell')].map((c) => c.getAttribute('aria-label') || '');
    expect(labels.some((l) => /hourglass|clock|o'?clock/i.test(l))).toBe(true);
    expect(labels.some((l) => l.includes('🕐') || /one o'?clock/i.test(l) || (grid.querySelector('[data-insert="🕐"]') != null))).toBe(true);
    expect(grid.querySelector('[data-insert="⏳"], [data-insert="⌛"]')).toBeTruthy();
    // No colour group named "hour" — palettes hide when nothing matches.
    const colours = document.querySelector('[data-testid="of-ep-colours"]') as HTMLElement | null;
    if (colours) {
      const caps = [...colours.querySelectorAll('.of-ep-colours-cap')].map((c) => c.textContent);
      expect(caps).not.toContain('Forest');
      expect(caps).not.toContain('Pastel');
    }
    // Colour name / palette filter: pastel keeps Pastel; audroam-danger keeps Audroam.
    search.value = 'pastel';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const capsPastel = [...document.querySelectorAll('.of-ep-colours-cap')].map((c) => c.textContent);
    expect(capsPastel).toEqual(['Pastel']);
    search.value = 'audroam-danger';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const capsAu = [...document.querySelectorAll('.of-ep-colours-cap')].map((c) => c.textContent);
    expect(capsAu).toEqual(['Audroam']);
    expect(document.querySelector('[data-testid="of-ep-swatch-audroam-danger"]')).toBeTruthy();
    search.value = 'green';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const capsGreen = [...document.querySelectorAll('.of-ep-colours-cap')].map((c) => c.textContent);
    expect(capsGreen.length).toBeGreaterThan(0);
    p.close(false);
  });
});

describe('0.6.1 Fill on any node (promote colour when needed)', () => {
  async function paint(text: string) {
    const doc = parse(text);
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 1000 });
    Object.defineProperty(host, 'clientHeight', { value: 800 });
    document.body.appendChild(host);
    const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
    let focus = 'child';
    let cur = doc;
    const mv: any = (createMapView as any)(host, {
      getDoc: () => cur,
      setDoc: (d: any) => { cur = d; },
      getLayout: () => layout,
      getFocusId: () => focus,
      setFocusId: (id: string) => { focus = id; },
      nodeColours: true,
      nodeIcons: true,
      nodeMenu: true,
      nodeClouds: true,
    });
    mv.paint();
    await new Promise((r) => setTimeout(r, 20));
    return { mv, doc: () => cur };
  }

  it('node menu lists Fill even when the node has no own colour', async () => {
    const { mv } = await paint('- Notes <color:moss> <id:notes>\n  - Child <id:child>\n');
    mv.openNodeMenu('child');
    await new Promise((r) => setTimeout(r, 10));
    const fill = document.querySelector('[data-item="colour-fill"]') as HTMLElement | null;
    expect(fill).toBeTruthy();
    expect(fill!.getAttribute('aria-checked')).toBe('false');
    mv.destroy?.();
  });

  it('setNodeColourFill(true) on a colourless child promotes branch colour then fills', async () => {
    const { mv, doc } = await paint('- Notes <color:moss> <id:notes>\n  - Child <id:child>\n');
    expect(doc().nodes[0]!.children![0]!.color).toBeUndefined();
    expect(mv.setNodeColourFill('child', true)).toBe(true);
    const child = doc().nodes[0]!.children![0]!;
    expect(child.color).toBe('moss');
    expect(child.colorFill).toBe(true);
    expect(mv.setNodeColourFill('child', false)).toBe(true);
    expect(child.colorFill).toBeUndefined();
    expect(child.color).toBe('moss');
    mv.destroy?.();
  });

  it('setNodeColourFill(true) with no ancestor colour falls back to white', async () => {
    const { mv, doc } = await paint('- Root <id:r>\n  - Child <id:child>\n');
    expect(mv.setNodeColourFill('child', true)).toBe(true);
    const child = doc().nodes[0]!.children![0]!;
    expect(child.color).toBe('white');
    expect(child.colorFill).toBe(true);
    mv.destroy?.();
  });
});
