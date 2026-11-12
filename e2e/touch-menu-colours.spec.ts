import { test, expect, type Page } from '@playwright/test';

/** Mobile node-menu colour strip: 2-row cap, dismiss tap-outside / ×, more → full palette. */
const URL = 'examples/e2e-touch/colour.html';

async function open(page: Page) {
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(150);
}

async function openMenu(page: Page, id = 'loose') {
  await page.evaluate((nodeId) => {
    (window as any).__setFocus(nodeId);
    (window as any).__map.openNodeMenu(nodeId, { clientX: 80, clientY: 120 }, { fine: false, pointerType: 'touch' });
  }, id);
}

test.describe('mobile node menu colours', () => {
  test('swatches cap at 2 rows (~6 each, finger-size) with a more button; close × and backdrop', async ({ page }) => {
    await open(page);
    await openMenu(page);
    const menu = page.locator('.map-node-menu');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('data-compact', 'true');
    await expect(menu).toHaveAttribute('data-pointer', 'coarse');
    const compact = page.locator('.map-node-menu-swatches.is-compact[data-family="Colour"]');
    await expect(compact).toHaveCount(1);
    const swatches = compact.locator('[role="menuitemradio"]');
    const more = compact.getByTestId('map-node-menu-swatch-more');
    await expect(more).toBeVisible();
    expect(await swatches.count()).toBeLessThanOrEqual(11);
    const tops = await swatches.evaluateAll((els) => {
      const ys = [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))];
      return ys.length;
    });
    expect(tops, 'at most two visual rows').toBeLessThanOrEqual(2);
    const size = await swatches.first().evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    expect(size.w).toBeGreaterThanOrEqual(36);
    expect(size.h).toBeGreaterThanOrEqual(36);
    await expect(more).toHaveAttribute('aria-label', /More colours/i);
    const moreSize = await more.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { w: r.width, h: r.height, radius: getComputedStyle(e).borderRadius };
    });
    const swatchRadius = await swatches.first().evaluate((e) => getComputedStyle(e).borderRadius);
    expect(moreSize.w).toBeCloseTo(size.w, 1);
    expect(moreSize.h).toBeCloseTo(size.h, 1);
    expect(moreSize.w).toBeCloseTo(moreSize.h, 1);
    expect(moreSize.radius).toBe(swatchRadius);
    await expect(page.getByTestId('map-node-menu-close')).toBeVisible();
    await expect(page.getByTestId('map-node-menu-backdrop')).toBeVisible();
    // Menu taller-than-viewport would scroll inside: max-height is set.
    const overflow = await menu.evaluate((el) => getComputedStyle(el).overflowY);
    expect(overflow).toMatch(/auto|scroll/);
    await page.screenshot({ path: 'test-results/mobile-menu-colours.png', fullPage: true });
  });

  test('tap outside (backdrop) dismisses the menu', async ({ page }) => {
    await open(page);
    await openMenu(page);
    await expect(page.locator('.map-node-menu')).toHaveCount(1);
    await page.touchscreen.tap(8, 8);
    await expect(page.locator('.map-node-menu')).toHaveCount(0);
    await expect(page.getByTestId('map-node-menu-backdrop')).toHaveCount(0);
  });

  test('close × dismisses the menu', async ({ page }) => {
    await open(page);
    await openMenu(page);
    await expect(page.locator('.map-node-menu')).toHaveCount(1);
    await page.getByTestId('map-node-menu-close').tap();
    await expect(page.locator('.map-node-menu')).toHaveCount(0);
  });

  test('… opens the full labelled palette', async ({ page }) => {
    await open(page);
    await openMenu(page);
    await page.getByTestId('map-node-menu-swatch-more').tap();
    await expect(page.locator('.map-node-menu-swatches[aria-label="Colour · Forest"]')).toBeVisible();
    await expect(page.locator('.map-node-menu-swatches[aria-label="Colour · Audroam"]')).toBeVisible();
    await expect(page.locator('.map-node-menu-swatches.is-compact')).toHaveCount(0);
  });
});

test.describe('toolbar Colour button (touch)', () => {
  test('opens the compact palette and colours the focused node', async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as any).__setFocus('loose'));
    await page.getByTestId('of-colour-toolbar').tap();
    const pal = page.getByTestId('of-colour-palette');
    await expect(pal).toBeVisible();
    const palMore = pal.getByTestId('map-node-menu-swatch-more');
    const palSwatch = pal.locator('.map-node-menu-swatch:not(.map-node-menu-swatch-more)').first();
    if (await palMore.count()) {
      await expect(palMore).toHaveAttribute('aria-label', /More colours/i);
      const a = await palSwatch.evaluate((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, radius: getComputedStyle(e).borderRadius }; });
      const b = await palMore.evaluate((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, radius: getComputedStyle(e).borderRadius }; });
      expect(b.w).toBeCloseTo(a.w, 1);
      expect(b.h).toBeCloseTo(a.h, 1);
      expect(b.w).toBeCloseTo(b.h, 1);
      expect(b.radius).toBe(a.radius);
    }
    const fern = pal.locator('[data-swatch="fern"]');
    await expect(fern).toBeVisible();
    await fern.tap();
    const src = await page.evaluate(() => (window as any).__serialize() as string);
    expect(src).toMatch(/\nloose:\n  colou?r: fern\n/);
    // stay-open
    await expect(pal).toBeVisible();
    await page.getByTestId('map-node-menu-close').tap();
    await expect(pal).toHaveCount(0);
  });
});
