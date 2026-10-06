import { test, expect, type Page } from '@playwright/test';
import { Touch, box, centre } from './touch';

/**
 * 0.2.30: the React live demo's own − / + / Fit (outside the map host) are
 * wired through bindTap. Touch projects only.
 */

const ZI = '.map-tools button[aria-label="Zoom in"]';
const ZO = '.map-tools button[aria-label="Zoom out"]';
const FIT = '.map-tools button[aria-label="Fit"]';

async function camOf(page: Page) {
  const t = await page.locator('#mapViewport').getAttribute('transform');
  const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(t || '');
  expect(m, `camera transform (${t})`).not.toBeNull();
  return { x: Number(m![1]), y: Number(m![2]), k: Number(m![3]) };
}

async function openMap(page: Page) {
  await page.goto('react-live/');
  await page.getByRole('button', { name: 'Map', exact: true }).tap();
  await expect(page.locator('.map-wrap .map-node[data-id="root"]')).toHaveCount(1);
  await page.waitForTimeout(500);
  const t = await Touch.attach(page);
  const host = await box(page, '.map-wrap');
  // Lower-left of the map: clear of the toolbar (top-right).
  const bg = { x: host.x + host.w * 0.55, y: host.y + host.h - 12 };
  return { t, host, bg };
}

async function tap(t: Touch, page: Page, sel: string) {
  const p = centre(await box(page, sel));
  await t.tap(p.x, p.y);
}

test.describe('react-live toolbar on touch', () => {
  test('+ fresh: one tap → one ×1.2 step', async ({ page }) => {
    const { t } = await openMap(page);
    const k0 = (await camOf(page)).k;
    await tap(t, page, ZI);
    await page.waitForTimeout(400);
    expect((await camOf(page)).k / k0).toBeCloseTo(1.2, 4);
  });

  for (const delay of [60, 200]) {
    test(`+ ${delay} ms after a fling: one tap → one step`, async ({ page }) => {
      const { t, bg } = await openMap(page);
      await tap(t, page, ZI); // room to pan
      await page.waitForTimeout(300);
      await t.fling(bg.x, bg.y, -16, 0);
      await page.waitForTimeout(delay);
      const k0 = (await camOf(page)).k;
      await tap(t, page, ZI);
      await page.waitForTimeout(450);
      expect((await camOf(page)).k / k0).toBeCloseTo(1.2, 4);
    });
  }

  test('fast double-tap on + → exactly 2 steps, no page zoom', async ({ page }) => {
    const { t } = await openMap(page);
    const k0 = (await camOf(page)).k;
    const p = centre(await box(page, ZI));
    await t.tap(p.x, p.y, 20);
    await page.waitForTimeout(60);
    await t.tap(p.x, p.y, 20);
    await page.waitForTimeout(450);
    expect((await camOf(page)).k / k0).toBeCloseTo(1.44, 4);
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  });

  test('− and Fit: one tap each, after a slow pan', async ({ page }) => {
    const { t, bg } = await openMap(page);
    const start = await camOf(page);
    await tap(t, page, ZI);
    await page.waitForTimeout(200);
    await tap(t, page, ZI);
    await page.waitForTimeout(200);
    await t.slowPan(bg.x, bg.y, -2, 0);
    await page.waitForTimeout(60);
    const k1 = (await camOf(page)).k;
    await tap(t, page, ZO);
    await page.waitForTimeout(450);
    expect((await camOf(page)).k / k1).toBeCloseTo(1 / 1.2, 4);
    await t.slowPan(bg.x, bg.y, -2, 0);
    await page.waitForTimeout(60);
    await tap(t, page, FIT);
    await page.waitForTimeout(450);
    const fit = await camOf(page);
    expect(fit.k).toBeCloseTo(start.k, 4);
    expect(Math.abs(fit.x - start.x)).toBeLessThan(1);
  });
});
