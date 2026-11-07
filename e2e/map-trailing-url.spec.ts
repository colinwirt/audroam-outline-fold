import { test, expect } from '@playwright/test';

/** Colin, 7 Nov 2026: `setup https://…?id=..&map=1&focus=3` must keep its globe on the Map. */
test('trailing URL with a query string keeps the globe on the Map pill (example host; same query shape as t2552u)', async ({ page }) => {
  await page.goto('examples/e2e-touch/index.html?doc=trailing-url.md');
  await page.waitForFunction(() => (window as any).__ready === true);
  const node = page.locator('.map-node').filter({ hasText: 'setup' }).first();
  await expect(node).toBeVisible();
  await page.screenshot({ path: 'test-results/trailing-url.png' });
  const globe = node.locator('.map-link-hit');
  await expect(globe).toHaveCount(1);
  await expect(globe).toBeVisible();
});
