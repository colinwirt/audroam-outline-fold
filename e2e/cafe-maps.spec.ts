import { test, expect, type Page } from '@playwright/test';

/** Cafe 2D and 3D maps: node labels. 0.7.0: no locked rows, no demo password. */
const FORMERLY_LOCKED = [
  ['supplier-accounts', 'Supplier accounts'],
  ['alarm', 'Alarm monitoring contact'],
] as const;

async function expectNoOverlap(page: Page) {
  const boxes = await page.locator('.label').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { id: (el as HTMLElement).dataset.id, l: r.left, t: r.top, r: r.right, b: r.bottom };
    }),
  );
  const vw = page.viewportSize()!;
  for (const [i, a] of boxes.entries()) {
    expect(a.l >= 0 && a.t >= 0 && a.r <= vw.width && a.b <= vw.height, `${a.id} in view`).toBe(true);
    for (const b of boxes.slice(i + 1)) {
      const hit = a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      expect(hit, `${a.id} overlaps ${b.id}`).toBe(false);
    }
  }
}

test.describe('cafe 3D map', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('examples/3d/');
    await expect(page.locator('canvas')).toHaveCount(1);
  });

  test('every visible node has a readable caption label', async ({ page }) => {
    await expect(page.locator('.label[data-id="root"]')).toHaveText('☕ Northside Corner Cafe — ops handoff');
    await expect(page.locator('.label[data-id="menu"]')).toHaveText('Menu update ideas · spring · P2 · 👍');
    await expect(page.locator('.label[data-id="courtyard-permit"]')).toHaveText('Permit lodged · approved:Sam');
    await expect(page.locator('.label[data-id="courtyard-quotes"]')).toContainText('(+)');
    await expect(page.locator('.label')).toHaveCount(11);
    for (const el of await page.locator('.label').all()) await expect(el).toBeVisible();
    await expectNoOverlap(page);
  });

  test('former locked rows are plain labels; no password or Unlock control', async ({ page }) => {
    for (const [id, caption] of FORMERLY_LOCKED) {
      const label = page.locator(`.label[data-id="${id}"]`);
      await expect(label).toBeVisible();
      await expect(label).not.toHaveAttribute('data-state', 'locked');
      await expect(label).toHaveText(caption);
    }
    await expect(page.locator('body')).not.toContainText(/password/i);
    await expect(page.locator('#btnUnlockAll')).toHaveCount(0);
    await expectNoOverlap(page);
  });

  test('clicking a folded sphere adds its children; labels still fit at 1024 × 700', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    const box = (await page.locator('.label[data-id="courtyard-quotes"]').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y - 12); // sphere sits just above its label
    await expect(page.locator('.label[data-id="bid-a"]')).toHaveText('Bid A · local mason · ballpark only');
    await expect(page.locator('.label[data-id="bid-b"]')).toBeVisible();
    await expectNoOverlap(page);
  });
});

test.describe('cafe 2D map', () => {
  test('former locked rows are plain labels; no password or Unlock control', async ({ page }) => {
    await page.goto('examples/canvas-2d/');
    const labels = page.locator('#c li');
    await expect(labels.filter({ hasText: 'Remodel the courtyard' })).toHaveCount(1);
    for (const [id, caption] of FORMERLY_LOCKED) {
      const li = page.locator(`#c li[data-id="${id}"]`);
      await expect(li).not.toHaveAttribute('data-state', 'locked');
      await expect(li).toHaveText(caption);
    }
    await expect(page.locator('body')).not.toContainText(/password/i);
    await expect(page.locator('#btnUnlockAll')).toHaveCount(0);
  });
});
