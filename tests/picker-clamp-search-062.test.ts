// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { openIconPicker, currentIconPicker, clampPopoverPlace } from '../src/emoji/picker.js';
import { loadEmojiData } from '../src/emoji/icons.js';

beforeAll(async () => {
  await loadEmojiData();
});

afterEach(() => {
  currentIconPicker()?.close(false);
  document.body.replaceChildren();
});

describe('0.6.2 icon search keeps Results in view after Map scroll', () => {
  it('resets of-ep-body scrollTop when search shows Results (node mode starts on Map)', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const p = openIconPicker({
      mode: 'node',
      anchor,
      onPick: () => {},
      expanded: true,
      sheet: false,
      colour: { onColour: () => {}, value: undefined },
    } as any);

    const body = document.querySelector('[data-testid="of-ep-body"]') as HTMLElement;
    expect(body).toBeTruthy();
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 4000 });
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 280 });
    body.scrollTop = 3200;
    expect(body.scrollTop).toBeGreaterThan(0);

    const search = document.querySelector('[data-testid="of-ep-search"]') as HTMLInputElement;
    search.value = 'hour';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    const grid = document.querySelector('[data-testid="of-ep-grid"]')!;
    expect(grid.querySelector('[data-section="results"]')).toBeTruthy();
    expect(body.scrollTop).toBe(0);
    p.close(false);
  });
});

describe('0.6.2 clampPopoverPlace (viewport + map bounds)', () => {
  it('shifts a wide recent-icons row left so it stays inside a narrow phone viewport', () => {
    const placed = clampPopoverPlace({
      anchor: { left: 350, top: 12, bottom: 44 },
      size: { w: 300, h: 48 },
      viewport: { w: 390, h: 700 },
    });
    expect(placed.left).toBeGreaterThanOrEqual(4);
    expect(placed.left + 300).toBeLessThanOrEqual(390 - 4);
  });

  it('clamps a panel to the map container when the map is a right-hand pane', () => {
    const placed = clampPopoverPlace({
      anchor: { left: 1160, top: 8, bottom: 40 },
      size: { w: 320, h: 360 },
      viewport: { w: 1200, h: 800 },
      bounds: { left: 600, top: 0, right: 1200, bottom: 800 },
    });
    expect(placed.left).toBeGreaterThanOrEqual(600 + 4);
    expect(placed.left + 320).toBeLessThanOrEqual(1200 - 4);
    expect(placed.top).toBeGreaterThanOrEqual(4);
    expect(placed.top + 360).toBeLessThanOrEqual(800 - 4);
  });

  it('without bounds, still never past the viewport right edge', () => {
    const placed = clampPopoverPlace({
      anchor: { left: 1100, top: 10, bottom: 42 },
      size: { w: 320, h: 360 },
      viewport: { w: 1200, h: 800 },
    });
    expect(placed.left + 320).toBeLessThanOrEqual(1200 - 4);
    expect(placed.left).toBeGreaterThanOrEqual(4);
  });
});
