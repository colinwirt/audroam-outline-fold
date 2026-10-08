import { test, expect, type Page } from '@playwright/test';
import { Touch, box, type Box } from './touch';

/**
 * Hold-to-fit P1 on touch (Design UX 2026-10-08, F3 tap / F7 / F12): the
 * grip tap opens the popover with the Fit row, coarse items are ≥ 46×52,
 * a pick applies on the first tap without tapping through, and the toast's
 * Undo works by touch. Fixture: examples/e2e-touch/widths.md (fictional).
 */

const HARNESS = 'examples/e2e-touch/index.html?doc=widths.md';
const GLOVES = 'Bring gloves';
const COMPOST = 'Compost bays';

type Ctx = { page: Page; t: Touch; host: Box };

async function open(page: Page): Promise<Ctx> {
  await page.goto(HARNESS);
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(150);
  return { page, t: await Touch.attach(page), host: await box(page, '#mapHost') };
}

function keyOf(page: Page, text: string): Promise<string> {
  return page.evaluate((t) => {
    const g = [...document.querySelectorAll('#mapHost .map-node')].find((n) =>
      (n.querySelector('.map-label')?.textContent || '').trim().startsWith(t),
    );
    return g!.getAttribute('data-id')!;
  }, text);
}

const sel = (key: string) => `#mapHost .map-node[data-id="${key}"]`;
const stored = (page: Page, key: string) =>
  page.evaluate((k) => {
    const e = (window as any).__layout().nodes?.[k];
    return { w: e?.w ?? null, wAuto: e?.wAuto ?? null };
  }, key);

async function focusPill(c: Ctx, key: string): Promise<void> {
  const pill = await box(c.page, `${sel(key)} .map-pill`);
  await c.t.tap(pill.x + Math.min(24, pill.w / 3), pill.y + pill.h / 2);
  await expect.poll(() => c.page.evaluate(() => (window as any).__focus())).toBe(key);
  await c.page.waitForTimeout(450);
}

async function openPop(c: Ctx, key: string): Promise<{ x: number; y: number }> {
  const pill = await box(c.page, `${sel(key)} .map-pill`);
  const pt = { x: pill.x + pill.w - 3, y: pill.y + pill.h - 3 };
  await c.t.tap(pt.x, pt.y);
  await expect(c.page.locator('.map-width-pop')).toHaveCount(1);
  return pt;
}

async function tapIn(c: Ctx, selector: string): Promise<void> {
  const b = await box(c.page, selector);
  await c.t.tap(b.x + b.w / 2, b.y + b.h / 2);
}

test.describe('hold-to-fit P1 on touch: the Fit row on a grip tap', () => {
  test('coarse items, inside the panel, not under the finger', async ({ page }) => {
    const c = await open(page);
    const k = await keyOf(page, GLOVES);
    await focusPill(c, k);
    const touch = await openPop(c, k);
    const pop = await box(page, '.map-width-pop');
    expect(pop.x).toBeGreaterThanOrEqual(c.host.x + 7.5);
    expect(pop.y).toBeGreaterThanOrEqual(c.host.y + 7.5);
    expect(pop.x + pop.w).toBeLessThanOrEqual(c.host.x + c.host.w - 7.5);
    expect(pop.y + pop.h).toBeLessThanOrEqual(c.host.y + c.host.h - 7.5);
    const under = touch.x >= pop.x && touch.x <= pop.x + pop.w && touch.y >= pop.y && touch.y <= pop.y + pop.h;
    expect(under).toBe(false);
    const items = await page.evaluate(() =>
      [...document.querySelectorAll('.map-width-pop button')].map((b) => {
        const r = b.getBoundingClientRect();
        return { choice: (b as HTMLElement).dataset.choice, w: r.width, h: r.height };
      }),
    );
    expect(items.map((i) => i.choice)).toEqual(['fit-text', 'line', 'siblings', 'slim', 'wider', 'auto']);
    for (const i of items) {
      expect(i.h).toBeGreaterThanOrEqual(52);
      expect(i.w).toBeGreaterThanOrEqual(46);
    }
  });

  test('1 line siblings applies on the first tap; the toast Undo restores by touch', async ({ page }) => {
    const c = await open(page);
    const k = await keyOf(page, GLOVES);
    const compost = await keyOf(page, COMPOST);
    const before = await page.evaluate(() => (window as any).__serialize());
    await focusPill(c, k);
    await openPop(c, k);
    await tapIn(c, '.map-width-pop button[data-choice="siblings"]');
    await expect(page.locator('.map-width-pop')).toHaveCount(0);
    await page.waitForTimeout(400);
    expect((await stored(page, k)).wAuto).toBe('single-line');
    expect((await stored(page, compost)).wAuto).toBe('single-line');
    // The tap did not land on whatever was drawn under the finger next.
    expect(await page.evaluate(() => (window as any).__focus())).toBe(k);
    await expect(page.locator('#mapHost .map-toast .map-toast-text')).toHaveText('3 widths changed');
    await tapIn(c, '#mapHost .map-toast .map-toast-undo');
    await expect(page.locator('#mapHost .map-toast')).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(await stored(page, compost)).toEqual({ w: 180, wAuto: null });
    expect(await page.evaluate(() => (window as any).__serialize())).toBe(before);
  });
});
