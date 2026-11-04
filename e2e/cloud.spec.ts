import { test, expect, type Page } from '@playwright/test';

/** 0.5.18 user clouds (EP-38…EP-43). Fixture: examples/e2e-touch/cloud.md. */
const URL = 'examples/e2e-touch/cloud.html';
const node = (id: string) => `#mapHost .map-node[data-id="${id}"]`;
const cloud = (id: string) => `#mapHost .map-cloud[data-cloud="${id}"]`;

async function open(page: Page) {
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(150);
}
const text = (page: Page) => page.evaluate(() => (window as any).__serialize() as string);
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;
const inside = (o: { x: number; y: number; width: number; height: number }, i: { x: number; y: number; width: number; height: number }) =>
  i.x >= o.x - 0.5 && i.y >= o.y - 0.5 && i.x + i.width <= o.x + o.width + 0.5 && i.y + i.height <= o.y + o.height + 0.5;

test('angled cloud hull wraps the subtree; inner cloud nests above; screenshot', async ({ page }) => {
  await open(page);
  const path = page.locator(`${cloud('fn')} path`);
  await expect(path).toHaveCount(1);
  const d = (await path.getAttribute('d'))!;
  expect(d).toMatch(/^M.*Q.*Z$/);
  // Polygon, not a rect: several vertices.
  expect((d.match(/Q/g) ?? []).length).toBeGreaterThan(5);
  const outer = await box(page, cloud('fn'));
  for (const id of ['fn', 'sv', 'sm', 'so', 'wa', 'ph']) expect(inside(outer, await box(page, `${node(id)} .map-pill`))).toBe(true);
  expect(inside(outer, await box(page, `${node('loose')} .map-pill`))).toBe(false);
  // EP-41: inner cloud is inside the outer one and painted after it.
  const inner = await box(page, cloud('sm'));
  expect(inside(outer, inner)).toBe(true);
  expect(await page.locator(cloud('sm')).getAttribute('data-cloud-depth')).toBe('1');
  const order = await page.evaluate(() => Array.from(document.querySelectorAll('#mapHost .map-cloud')).map((e) => e.getAttribute('data-cloud')));
  expect(order.indexOf('fn')).toBeLessThan(order.indexOf('sm'));
  await page.locator('#panel').screenshot({ path: 'test-results/cloud.png' });
});

test('sealed region stays distinct and paints above a user cloud on the same branch', async ({ page }) => {
  await open(page);
  await expect(page.locator(cloud('vault'))).toHaveCount(1);
  await expect(page.locator('#mapHost .map-region[data-region="vault"]')).toHaveCount(1);
  const after = await page.evaluate(() => {
    const c = document.querySelector('#mapHost .map-cloud[data-cloud="vault"]')!;
    const r = document.querySelector('#mapHost .map-region[data-region="vault"]')!;
    return !!(c.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(after).toBe(true);
  // Cloud: no dash, no lock/doc icon.
  await expect(page.locator(`${cloud('vault')} [stroke-dasharray]`)).toHaveCount(0);
  await expect(page.locator(`${cloud('vault')} text, ${cloud('vault')} use`)).toHaveCount(0);
});

test('fold shrinks the cloud to the pill (EP-40)', async ({ page }) => {
  await open(page);
  const before = await box(page, cloud('sm'));
  await page.locator(`${node('sm')} .map-fold-hit`).click();
  await page.waitForTimeout(250);
  await expect(page.locator(node('so'))).toHaveCount(0);
  const after = await box(page, cloud('sm'));
  expect(after.height).toBeLessThan(before.height);
  expect(inside(after, await box(page, `${node('sm')} .map-pill`))).toBe(true);
});

test('node menu Cloud toggles <cloud> on the line and the Outline bar (EP-39, EP-42)', async ({ page }) => {
  await open(page);
  await expect(page.locator('#outline [data-id="fn"]').first()).toHaveClass(/of-cloud/);
  const b = (await page.locator(`${node('loose')} .map-pill`).boundingBox())!;
  await page.mouse.click(b.x + 5, b.y + b.height / 2, { button: 'right' });
  const item = page.locator('.map-node-menu [role="menuitemcheckbox"]', { hasText: 'Cloud' });
  await expect(item).toHaveAttribute('aria-checked', 'false');
  await item.click();
  expect(await text(page)).toContain('- Loose idea <cloud> <id:loose>');
  await expect(page.locator(cloud('loose'))).toHaveCount(1);
  await expect(page.locator('#outline [data-id="loose"]').first()).toHaveClass(/of-cloud/);
  await page.mouse.click(b.x + 5, b.y + b.height / 2, { button: 'right' });
  await page.locator('.map-node-menu [role="menuitemcheckbox"]', { hasText: 'Cloud' }).click();
  expect(await text(page)).toContain('- Loose idea <id:loose>');
  await expect(page.locator(cloud('loose'))).toHaveCount(0);
});
