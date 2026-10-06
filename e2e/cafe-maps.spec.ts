import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

/** Cafe 2D and 3D maps: node labels, locked rows, demo Unlock. */
const plaintexts = JSON.parse(readFileSync('scripts/demo-plaintexts.json', 'utf8')) as {
  examples: Record<string, { id: string; plaintext: string }[]>;
};
const sealed = Object.fromEntries(
  plaintexts.examples['examples/cafe-map.md']!.map((r) => [r.id, r.plaintext]),
);

const LOCKED = [
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

  test('locked rows show caption and lock state; Unlock opens them with the demo password', async ({ page }) => {
    for (const [id, caption] of LOCKED) {
      const label = page.locator(`.label[data-id="${id}"]`);
      await expect(label).toBeVisible();
      await expect(label).toHaveAttribute('data-state', 'locked');
      await expect(label).toHaveText(`${caption}🔒 locked`);
    }
    await expect(page.locator('#demoUnlock')).toContainText('Demo password: 123');
    await page.locator('#btnUnlockAll').click();
    for (const [id, caption] of LOCKED) {
      const label = page.locator(`.label[data-id="${id}"]`);
      await expect(label).toHaveAttribute('data-state', 'unlocked');
      await expect(label).toHaveText(caption + sealed[id]);
    }
    await expectNoOverlap(page);
  });

  test('clicking a folded sphere adds its children; labels still fit at 1024 × 700', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.locator('#btnUnlockAll').click();
    await expect(page.locator('.label[data-id="alarm"]')).toHaveAttribute('data-state', 'unlocked');
    const box = (await page.locator('.label[data-id="courtyard-quotes"]').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y - 12); // sphere sits just above its label
    await expect(page.locator('.label[data-id="bid-a"]')).toHaveText('Bid A · local mason · ballpark only');
    await expect(page.locator('.label[data-id="bid-b"]')).toBeVisible();
    await expectNoOverlap(page);
  });
});

test.describe('cafe 2D map', () => {
  test('locked rows show caption and lock state; Unlock opens them with the demo password', async ({ page }) => {
    await page.goto('examples/canvas-2d/');
    const labels = page.locator('#c li');
    await expect(labels.filter({ hasText: 'Remodel the courtyard' })).toHaveCount(1);
    for (const [id, caption] of LOCKED) {
      const li = page.locator(`#c li[data-id="${id}"]`);
      await expect(li).toHaveAttribute('data-state', 'locked');
      await expect(li).toHaveText(`${caption} · 🔒 locked`);
    }
    await expect(page.locator('#demoUnlock')).toContainText('Demo password: 123');
    await page.locator('#btnUnlockAll').click();
    for (const [id, caption] of LOCKED) {
      const li = page.locator(`#c li[data-id="${id}"]`);
      await expect(li).toHaveAttribute('data-state', 'unlocked');
      await expect(li).toHaveText(`${caption} · ${sealed[id]}`);
    }
  });
});
