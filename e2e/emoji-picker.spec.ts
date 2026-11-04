import { test, expect, type Page } from '@playwright/test';

/** 0.5.18 node icon slot + emoji / Map clipart picker (EP-1…EP-30). Fixture: examples/e2e-touch/emoji.md. */
const URL = 'examples/e2e-touch/emoji.html';
const node = (id: string) => `#mapHost .map-node[data-id="${id}"]`;
const PANEL = '.of-ep.of-ep-panel';

async function open(page: Page, q = '') {
  await page.goto(URL + q);
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(150);
}
const text = (page: Page) => page.evaluate(() => (window as any).__serialize() as string);

async function rightClickPill(page: Page, id: string) {
  const b = (await page.locator(`${node(id)} .map-pill`).boundingBox())!;
  await page.mouse.click(b.x + 5, b.y + b.height / 2, { button: 'right' });
}

test('icons parse into the slot: Map label leads with the glyph, Outline slot sits after the task box', async ({ page }) => {
  await open(page);
  await expect(page.locator(`${node('walk')} text`).first()).toContainText('🧭');
  await expect(page.locator(`${node('north')} text`).first()).toContainText('🚩');
  const row = page.locator('#outline [data-id="walk"]').first();
  const icon = row.locator('.of-node-icon').first();
  await expect(icon).toHaveAttribute('role', 'img');
  await expect(icon).toHaveAttribute('aria-label', /compass/);
  // Slot order: task box, then icon, then title text.
  const order = await row.evaluate((el) => {
    const r = el.querySelector(':scope .of-node-icon')!.getBoundingClientRect();
    const task = el.querySelector('[class*="task"]')?.getBoundingClientRect();
    const title = [...el.querySelectorAll('*')].find((n) => n.textContent?.trim() === 'Walk the beds' || /^Walk the beds/.test(n.textContent?.trim() ?? '') && !n.querySelector('.of-node-icon'))?.getBoundingClientRect();
    return { icon: r.left, task: task?.left ?? -1, title: title?.left ?? 1e9 };
  });
  expect(order.task).toBeLessThan(order.icon);
  expect(order.icon).toBeLessThan(order.title);
  // <icon:star> is read as an alias and written back unchanged.
  expect(await text(page)).toContain('- <icon:star> Order mulch');
});

test('node menu Icon… opens the 320px panel on the Map tab; pick sets :name:; Remove icon clears', async ({ page }) => {
  await open(page);
  await rightClickPill(page, 'water');
  await page.locator('.map-node-menu [role="menuitem"]', { hasText: 'Icon…' }).click();
  const panel = page.locator(PANEL);
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(Math.round(box.width)).toBe(320);
  await expect(page.locator('[data-testid="of-ep-search"]')).toHaveAttribute('placeholder', 'Search · node icon');
  await expect(page.locator('[data-testid="of-ep-tab-map"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-testid="of-ep-grid"]')).toHaveAttribute('role', 'grid');
  await page.locator('[data-testid="of-ep-cell-compass"]').first().hover();
  await expect(page.locator('[data-testid="of-ep-name"]')).toContainText(/compass/i);
  await page.screenshot({ path: 'test-results/emoji-panel.png' });
  await page.locator('[data-testid="of-ep-cell-compass"]').first().click();
  await expect(panel).toHaveCount(0);
  // 0.5.22: the icon is stored per id in the layout block; the title line stays as typed.
  expect(await text(page)).toContain('- Water the seedlings <id:water>');
  expect(await text(page)).toMatch(/\n\s*water:\n\s*icon: :compass:/);
  await rightClickPill(page, 'water');
  await page.locator('.map-node-menu [role="menuitem"]', { hasText: 'Remove icon' }).click();
  expect(await text(page)).toContain('- Water the seedlings <id:water>');
  expect(await text(page)).not.toContain('icon: :compass:');
});

test('keyboard: Ctrl+. opens, typing searches, arrows move, Enter picks, Esc steps back then closes', async ({ page }) => {
  await open(page, '?focus=water');
  await page.locator('#mapHost').focus();
  await page.keyboard.press('Control+.');
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator('[data-testid="of-ep-search"]')).toBeFocused();
  await page.keyboard.type('pizza');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-testid="of-ep-name"]')).toContainText(/pizza/i);
  await page.keyboard.press('Enter');
  expect(await text(page)).toMatch(/\n\s*water:\n\s*icon: 🍕/);
  await expect(page.locator('.map-node[data-id="water"]')).toContainText('🍕');
  // Esc: panel → quick row → closed.
  await page.keyboard.press('Control+.');
  await expect(page.locator(PANEL)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="of-ep-row"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.of-ep')).toHaveCount(0);
});

test('`:` typeahead: ≤6 rows, Enter inserts, Esc leaves the text', async ({ page }) => {
  await open(page);
  const ta = page.locator('[data-testid="ta"]');
  await ta.click();
  await page.keyboard.type('go :pi');
  const list = page.locator('[data-testid="of-ta"]');
  await expect(list).toBeVisible();
  const n = await list.locator('[role="option"]').count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThanOrEqual(6);
  await page.keyboard.press('Enter');
  await expect(list).toHaveCount(0);
  expect(await ta.inputValue()).not.toBe('go :pi');
  await page.keyboard.type(' :sta');
  await expect(list).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  expect(await ta.inputValue()).toMatch(/:sta$/);
});

test('toolbar button opens the text panel', async ({ page }) => {
  await open(page);
  await page.locator('[data-testid="of-ep-toolbar"]').click();
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator('[data-testid="of-ep-search"]')).toHaveAttribute('placeholder', 'Search · text');
});

/** 0.5.30 (Colin): the toolbar Icon button is a toggle; the palette stays open across picks. */
test('0.5.30 text toolbar Icon button toggles the palette with aria-pressed', async ({ page }) => {
  await open(page);
  const b = page.locator('[data-testid="of-ep-toolbar"]');
  await expect(b).toHaveAttribute('aria-pressed', 'false');
  await b.click();
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await b.click();
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(b).toHaveAttribute('aria-pressed', 'false');
});

test('0.5.30 map Icon toggle: stays open across picks; press again closes; Esc closes', async ({ page }) => {
  await open(page, '?focus=water');
  const b = page.locator('[data-testid="map-icon-toggle"]');
  await b.click();
  await expect(page.locator(PANEL)).toBeVisible();
  // 0.5.30: package palette at desktop — the tile sizing proposed for Audroam's Style strip.
  if (process.env.SHOT_STRIP) await page.locator(PANEL).screenshot({ path: process.env.SHOT_STRIP });
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(200);
  for (let i = 0; i < 3; i++) {
    await page.locator(`${PANEL} .of-ep-grid .of-ep-cell`).nth(i).click();
    await expect(page.locator(PANEL)).toBeVisible();
  }
  expect(await text(page)).toMatch(/Water the seedlings/);
  await b.click();
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(b).toHaveAttribute('aria-pressed', 'false');
  await b.click();
  await expect(page.locator(PANEL)).toBeVisible();
  await page.locator(`${PANEL} .of-ep-search`).press('Escape');
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(b).toHaveAttribute('aria-pressed', 'false');
});

for (const vp of [{ name: 'tablet', width: 820, height: 1180, sheet: false }, { name: 'phone', width: 390, height: 844, sheet: true }]) {
  test.describe(`0.5.30 icon palette at ${vp.name} width`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: true });
    test(`${vp.name}: ${vp.sheet ? 'full-width bottom sheet' : 'compact popover <= 320px, 40px tiles, anchored under the button'}`, async ({ page }) => {
      await open(page, '?focus=water');
      const b = page.locator('[data-testid="map-icon-toggle"]');
      await b.tap();
      const p = page.locator(PANEL);
      await expect(p).toBeVisible();
      await page.waitForTimeout(250);
      const box = (await p.boundingBox())!;
      const cell = (await p.locator('.of-ep-grid .of-ep-cell').first().boundingBox())!;
      if (vp.sheet) {
        expect(box.width).toBeGreaterThanOrEqual(vp.width - 2);
        await expect(p).toHaveClass(/of-ep-sheet/);
      } else {
        expect(box.width).toBeLessThanOrEqual(320);
        expect(box.width).toBeGreaterThan(260);
        await expect(p).not.toHaveClass(/of-ep-sheet/);
        expect(Math.round(cell.width)).toBe(40);
        const bb = (await b.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(bb.y + bb.height - 1);
        const fs = await p.locator('.of-ep-grid .of-ep-cell').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
        expect(fs).toBeGreaterThanOrEqual(24);
        // No empty stretched area right of the last tile: grid content fills the popover width.
        const row = (await p.locator('.of-ep-grid-row').first().boundingBox())!;
        expect(box.x + box.width - (row.x + row.width)).toBeLessThanOrEqual(12);
        if (process.env.SHOT_TABLET) await page.screenshot({ path: process.env.SHOT_TABLET });
      }
    });
  });
}
