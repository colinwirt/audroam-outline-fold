import { test, expect, type Page } from '@playwright/test';
import { Touch, box, centre } from './touch';

/**
 * Fold to level on touch (Design UX 2026-10-06, L1, L4, L5, L6, L7, L10):
 * hold the fold handle, drag-to-level, lift on nothing, slop and second
 * finger cancel, short tap still toggles once, label hold still selects.
 * Runs in the touch-pixel and touch-iphone projects (CDP touch events).
 */

const HARNESS = 'examples/e2e-touch/index.html?doc=levels.md';
const MENU = '.map-level-menu';

async function open(page: Page): Promise<Touch> {
  await page.goto(HARNESS);
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(150);
  // Keep Branches' handle well inside the viewport on the small phone.
  await page.evaluate(() => (window as any).__setFocus(''));
  return Touch.attach(page);
}

const handle = (id: string) => `.map-node[data-id="${id}"] .map-fold-hit`;
const expanded = (page: Page, id: string) =>
  page.locator(`.map-node[data-id="${id}"]`).getAttribute('aria-expanded');
const visible = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('.map-node')].map((n) => n.getAttribute('data-id')));

test.describe('fold to level: touch', () => {
  test('a 450 ms hold opens the picker and the lift never toggles', async ({ page }) => {
    const t = await open(page);
    const p = centre(await box(page, handle('branches')));
    await t.start([p]);
    await page.waitForTimeout(250);
    await expect(page.locator('.map-level-ring')).toHaveCount(1);
    await expect(page.locator(MENU)).toHaveCount(0);
    await page.waitForTimeout(350);
    await expect(page.locator(MENU)).toHaveCount(1);
    await t.end();
    await page.waitForTimeout(400);
    expect(await expanded(page, 'branches')).toBe('true');
    // Lifting on nothing (the handle) keeps the picker open.
    await expect(page.locator(MENU)).toHaveCount(1);
    await expect(page.locator(MENU)).toHaveAttribute('data-pointer', 'coarse');
    // Touch tiles: Fold 1 2 3 All, each at least 44 px.
    const tiles = await page.locator(`${MENU} [role="menuitemradio"]`).evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { label: e.querySelector('.map-level-label')!.textContent, w: r.width, h: r.height };
      }),
    );
    expect(tiles.map((x) => x.label)).toEqual(['Fold', '1', '2', '3', 'All']);
    for (const x of tiles) {
      expect(x.w).toBeGreaterThanOrEqual(44);
      expect(x.h).toBeGreaterThanOrEqual(44);
    }
    // Clamped 8 px inside the panel.
    const m = await box(page, MENU);
    const h = await box(page, '#mapHost');
    expect(m.x).toBeGreaterThanOrEqual(h.x + 8 - 0.5);
    expect(m.y).toBeGreaterThanOrEqual(h.y + 8 - 0.5);
    expect(m.x + m.w).toBeLessThanOrEqual(h.x + h.w - 8 + 0.5);
    // Then a tap on an item applies it.
    const one = centre(await box(page, `${MENU} [data-level="1"]`));
    await t.tap(one.x, one.y);
    await expect(page.locator(MENU)).toHaveCount(0);
    await page.waitForTimeout(400);
    const v = await visible(page);
    expect(v).toContain('riverside');
    expect(v).not.toContain('rhours');
  });

  test('drag-to-level: slide onto an item and lift applies it, handle stays put', async ({ page }) => {
    const t = await open(page);
    const before = await box(page, handle('branches'));
    const p = centre(before);
    await t.start([p]);
    await page.waitForTimeout(600);
    await expect(page.locator(MENU)).toHaveCount(1);
    const target = centre(await box(page, `${MENU} [data-level="0"]`));
    for (let i = 1; i <= 6; i++) {
      await t.move([{ x: p.x + ((target.x - p.x) * i) / 6, y: p.y + ((target.y - p.y) * i) / 6 }]);
      await page.waitForTimeout(16);
    }
    await expect(page.locator(`${MENU} [data-level="0"]`)).toHaveClass(/is-hot/);
    await t.end();
    await expect(page.locator(MENU)).toHaveCount(0);
    await page.waitForTimeout(450);
    expect(await expanded(page, 'branches')).toBe('false');
    const after = await box(page, handle('branches'));
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
    await expect(page.locator('.map-live')).toHaveText('Branches folded. 13 items hidden.');
  });

  test('moving past 10 px before 450 ms cancels: no picker, no toggle', async ({ page }) => {
    const t = await open(page);
    const p = centre(await box(page, handle('branches')));
    await t.start([p]);
    for (let i = 1; i <= 5; i++) {
      await t.move([{ x: p.x + i * 4, y: p.y + i * 2 }]);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(600);
    await expect(page.locator(MENU)).toHaveCount(0);
    await t.end();
    await page.waitForTimeout(300);
    await expect(page.locator(MENU)).toHaveCount(0);
    expect(await expanded(page, 'branches')).toBe('true');
  });

  test('a second finger cancels the hold', async ({ page }) => {
    const t = await open(page);
    const p = centre(await box(page, handle('branches')));
    const h = await box(page, '#mapHost');
    await t.start([{ ...p, id: 0 }]);
    await page.waitForTimeout(150);
    await t.start([{ ...p, id: 0 }, { x: h.x + h.w * 0.8, y: h.y + h.h * 0.8, id: 1 }]);
    await page.waitForTimeout(500);
    await expect(page.locator(MENU)).toHaveCount(0);
    await t.end();
    await page.waitForTimeout(300);
    await expect(page.locator(MENU)).toHaveCount(0);
    expect(await expanded(page, 'branches')).toBe('true');
  });

  test('a short tap still toggles exactly once', async ({ page }) => {
    const t = await open(page);
    const p = centre(await box(page, handle('branches')));
    await t.tap(p.x, p.y);
    await expect.poll(() => expanded(page, 'branches')).toBe('false');
    await page.waitForTimeout(500);
    expect(await expanded(page, 'branches')).toBe('false');
    await expect(page.locator(MENU)).toHaveCount(0);
  });

  test('a label hold still selects the text and opens no picker', async ({ page }) => {
    const t = await open(page);
    const p = centre(await box(page, '.map-node[data-id="programs"] .map-label'));
    await t.start([p]);
    await page.waitForTimeout(800);
    await t.end();
    await page.waitForTimeout(200);
    await expect(page.locator(MENU)).toHaveCount(0);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('Programs');
  });
});

test.describe('fold to level: touch long-press goes to the handle or the host (D4 amended, node menu M1)', () => {
  /** What a touch long-press dispatches: a contextmenu PointerEvent with pointerType touch. */
  async function longPressMenu(page: Page, sel: string, dx = 0) {
    return page.evaluate(
      ({ sel, dx }) => {
        const w = window as any;
        const seen: string[] = [];
        const host = document.getElementById('mapHost')!;
        const rec = (e: Event) => seen.push((e.target as Element).closest('.map-node')?.getAttribute('data-id') ?? '');
        host.addEventListener('contextmenu', rec);
        const el = document.querySelector(sel)!;
        const r = el.getBoundingClientRect();
        const ev = new PointerEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          pointerType: 'touch',
          clientX: r.left + 6 + dx,
          clientY: r.top + r.height / 2,
        });
        el.dispatchEvent(ev);
        host.removeEventListener('contextmenu', rec);
        w.__lastSeen = seen;
        return { prevented: ev.defaultPrevented, host: seen };
      },
      { sel, dx },
    );
  }

  test('a long-press on the pill chrome reaches the host; on the handle the package keeps it', async ({ page }) => {
    await open(page);
    const pill = await longPressMenu(page, '.map-node[data-id="branches"] .map-pill');
    expect(pill).toEqual({ prevented: false, host: ['branches'] });
    await expect(page.locator(MENU)).toHaveCount(0);
    const onHandle = await longPressMenu(page, handle('branches'));
    // The hold opens the picker; its long-press menu is swallowed and the host never sees it.
    expect(onHandle).toEqual({ prevented: true, host: [] });
  });
});
