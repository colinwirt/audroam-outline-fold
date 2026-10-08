import { test, expect } from '@playwright/test';
import { Touch, box, centre } from './touch';

/** Link popover on touch (0.2.33): 44 px rows, a tap on a row follows it. */
test('touch: rows are 44 px and a tap on the hop row selects its node', async ({ page }) => {
  await page.goto('examples/e2e-touch/index.html?doc=links.md');
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(150);
  const t = await Touch.attach(page);
  const g = centre(await box(page, '.map-node[data-id="multi"] .map-link-hit'));
  await t.tap(g.x, g.y);
  await expect(page.locator('.map-link-pop')).toHaveAttribute('data-pointer', 'coarse');
  const hs = await page.locator('.map-link-item').evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetHeight));
  expect(hs).toHaveLength(3);
  for (const h of hs) expect(h).toBeGreaterThanOrEqual(44);
  const row = centre(await box(page, '.map-link-item[data-hop-id="plants"]'));
  await t.tap(row.x, row.y);
  await expect(page.locator('.map-link-pop')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__focus())).toBe('plants');
});
