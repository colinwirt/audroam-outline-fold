import { test, expect, type Page } from '@playwright/test';

/**
 * Fold to level, desktop (Design UX 2026-10-06, L1–L16; L9 amended
 * 2026-10-08 by the node menu M1): mouse hold or right-click on a fold handle
 * only, map.openLevelMenu (a host's Levels…), keyboard in the menu, the
 * handle anchor, the live region, the confirm step and the toolbar.
 * ContextMenu / Shift+F10 and a right-click on the pill are the host's.
 * Host: examples/e2e-touch with levels.md.
 */

const HARNESS = 'examples/e2e-touch/index.html?doc=levels.md';
const MENU = '.map-level-menu';

async function open(page: Page, url = HARNESS) {
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__ready === true);
  // Mouse presses in the first 700 ms after a finger are ignored; settle past Fit.
  await page.waitForTimeout(150);
}

const hit = (page: Page, id: string) => page.locator(`.map-node[data-id="${id}"] .map-fold-hit`);
const expanded = (page: Page, id: string) =>
  page.locator(`.map-node[data-id="${id}"]`).getAttribute('aria-expanded');
const visible = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('.map-node')].map((n) => n.getAttribute('data-id')));
const checked = (page: Page) =>
  page.locator(`${MENU} [aria-checked="true"]`).getAttribute('data-level');

async function holdMouse(page: Page, id: string, ms = 600) {
  const b = (await hit(page, id).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  return b;
}

test.describe('fold to level: mouse and keyboard', () => {
  test('a hold opens the menu and its release never toggles; a click still toggles once', async ({ page }) => {
    await open(page);
    expect(await expanded(page, 'branches')).toBe('true');
    await holdMouse(page, 'branches', 250);
    await expect(page.locator('.map-level-ring')).toHaveCount(1);
    await page.waitForTimeout(350);
    await expect(page.locator(MENU)).toHaveCount(1);
    await expect(page.locator('.map-level-ring')).toHaveCount(0);
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await expanded(page, 'branches')).toBe('true');
    await expect(page.locator(MENU)).toHaveCount(1);
    await expect(page.locator(MENU)).toHaveAttribute('aria-label', 'Fold Branches to level');
    // Esc closes and returns focus to the map host (the treeitem).
    await page.keyboard.press('Escape');
    await expect(page.locator(MENU)).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('mapHost');
    expect(await page.evaluate(() => (window as any).__focus())).toBe('branches');
    // A plain click toggles exactly once.
    await hit(page, 'branches').click();
    await expect.poll(() => expanded(page, 'branches')).toBe('false');
    await page.waitForTimeout(300);
    expect(await expanded(page, 'branches')).toBe('false');
  });

  test('a mouse drag on the handle pans and opens nothing', async ({ page }) => {
    await open(page);
    const b = await holdMouse(page, 'branches', 50);
    await page.mouse.move(b.x + 40, b.y + 30, { steps: 4 });
    await page.waitForTimeout(600);
    await page.mouse.up();
    await page.waitForTimeout(200);
    await expect(page.locator(MENU)).toHaveCount(0);
    expect(await expanded(page, 'branches')).toBe('true');
  });

  test('right-click: items, checked state, disabled levels, counts, key hints', async ({ page }) => {
    await open(page);
    await hit(page, 'riverside').click({ button: 'right' });
    await expect(page.locator(MENU)).toHaveCount(1);
    const items = page.locator(`${MENU} [role="menuitemradio"]`);
    await expect(items).toHaveCount(5);
    expect(await items.evaluateAll((els) => els.map((e) => e.querySelector('.map-level-label')!.textContent))).toEqual([
      'Fold',
      'Level 1',
      'Level 2',
      'Level 3',
      'All',
    ]);
    expect(await items.evaluateAll((els) => els.map((e) => e.querySelector('.map-level-key')!.textContent))).toEqual([
      '0',
      '1',
      '2',
      '3',
      '*',
    ]);
    // Riverside is two levels deep: 3 is deeper than the subtree.
    await expect(page.locator(`${MENU} [data-level="3"]`)).toHaveAttribute('aria-disabled', 'true');
    expect(await checked(page)).toBe('*');
    await expect(page.locator(`${MENU} [data-level="0"] .map-level-count`)).toHaveText('hides 7');
    await expect(page.locator(`${MENU} [data-level="1"] .map-level-count`)).toHaveText('3 shown');
    // Focus starts on the checked item.
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-level'))).toBe('*');
    // The node carries aria-haspopup.
    await expect(page.locator('.map-node[data-id="riverside"]')).toHaveAttribute('aria-haspopup', 'menu');
  });

  test('a pick keeps the pressed handle in place, zoom unchanged, announces, and resets the subtree (L16)', async ({ page }) => {
    await open(page);
    const k0 = await page.evaluate(() => (window as any).__map.cam.k);
    const before = (await hit(page, 'branches').boundingBox())!;
    await hit(page, 'branches').click({ button: 'right' });
    await page.locator(`${MENU} [data-level="1"]`).click();
    await expect(page.locator(MENU)).toHaveCount(0);
    await page.waitForTimeout(450);
    const after = (await hit(page, 'branches').boundingBox())!;
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => (window as any).__map.cam.k)).toBeCloseTo(k0, 6);
    await expect(page.locator('.map-live')).toHaveText('Branches folded to level 1. 11 items hidden.');
    const v = await visible(page);
    expect(v).toContain('riverside');
    expect(v).not.toContain('rhours');
    // L16: + on Riverside shows only its children, not the old 3-deep tree.
    await hit(page, 'riverside').click();
    await page.waitForTimeout(350);
    const v2 = await visible(page);
    expect(v2).toEqual(expect.arrayContaining(['rhours', 'rserv', 'rstaff']));
    expect(v2).not.toContain('rwk');
    // Fold state only: no id written into a caption.
    expect(await page.evaluate(() => (window as any).__doc().nodes[0].children[0].title)).toBe('Branches');
  });

  test('Shift+F10 is left to the host; map.openLevelMenu opens it; arrows, Home/End, Enter apply; digits apply', async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as any).__setFocus('root'));
    await page.locator('#mapHost').focus();
    await page.keyboard.press('Shift+F10');
    await page.waitForTimeout(150);
    await expect(page.locator(MENU)).toHaveCount(0);
    // A host's Levels… item: the picker for the node, anchored at its handle.
    expect(await page.evaluate(() => (window as any).__map.openLevelMenu('root'))).toBe(true);
    await expect(page.locator(MENU)).toHaveCount(1);
    await expect(page.locator(MENU)).toHaveAttribute('aria-label', 'Fold Hillcrest library network to level');
    await page.keyboard.press('Home');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-level'))).toBe('0');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-level'))).toBe('2');
    await page.keyboard.press('End');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-level'))).toBe('*');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(page.locator(MENU)).toHaveCount(0);
    await page.waitForTimeout(350);
    // Level 2 under the root: Branches' children shown, grandchildren folded.
    let v = await visible(page);
    expect(v).toContain('riverside');
    expect(v).not.toContain('rhours');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('mapHost');

    await page.keyboard.press('ContextMenu');
    await page.waitForTimeout(150);
    await expect(page.locator(MENU)).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__map.openLevelMenu())).toBe(true);
    await expect(page.locator(MENU)).toHaveCount(1);
    expect(await checked(page)).toBe('2');
    await page.keyboard.press('1');
    await expect(page.locator(MENU)).toHaveCount(0);
    await page.waitForTimeout(350);
    v = await visible(page);
    expect(v).toEqual(['root', 'branches', 'programs', 'fac']);
    // Space toggles the selected node as before; the menu keys did not leak.
    expect(await expanded(page, 'root')).toBe('true');
  });

  test('toolbar Levels: whole map, current level pressed', async ({ page }) => {
    await open(page, `${HARNESS}&levels=1&seed=level1`);
    const group = page.locator('.of-map-levels');
    await expect(group).toHaveAttribute('aria-label', 'Levels');
    expect(await visible(page)).toEqual(['root', 'branches', 'programs', 'fac']);
    await expect(group.locator('button[data-level="1"]')).toHaveAttribute('aria-pressed', 'true');
    await group.locator('button[data-level="2"]').click();
    await page.waitForTimeout(350);
    await expect(group.locator('button[data-level="2"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(group.locator('button[data-level="1"]')).toHaveAttribute('aria-pressed', 'false');
    expect(await visible(page)).toContain('riverside');
    await expect(page.locator('.map-live')).toHaveText(/^Whole map at level 2\. \d+ of 24 shown\.$/);
    await group.locator('button[data-level="*"]').click();
    await page.waitForTimeout(350);
    expect((await visible(page)).length).toBe(24);
  });

  test('All above 1,500 nodes asks first', async ({ page }) => {
    const lines = ['- Big archive <id:big>'];
    for (let i = 1; i <= 40; i++) {
      lines.push(`  - Shelf ${i} <id:s${i}>`);
      for (let j = 1; j <= 40; j++) lines.push(`    - Box ${i}.${j} <id:b${i}x${j}>`);
    }
    // Served by the test, not a file: 1,641 lines.
    await page.route('**/e2e-touch/big-archive.md', (r) =>
      r.fulfill({ contentType: 'text/markdown', body: lines.join('\n') + '\n' }),
    );
    await open(page, 'examples/e2e-touch/index.html?seed=level1&doc=big-archive.md');
    await hit(page, 'big').click({ button: 'right' });
    await page.locator(`${MENU} [data-level="*"]`).click();
    await expect(page.locator(`${MENU} [role="menuitem"]`)).toHaveText(['Show all 1,640', 'Cancel']);
    await page.locator(`${MENU} [data-level="cancel"]`).click();
    await expect(page.locator(`${MENU} [role="menuitemradio"]`)).toHaveCount(5);
    expect(await visible(page)).toHaveLength(41);
    await page.locator(`${MENU} [data-level="*"]`).click();
    await page.locator(`${MENU} [data-level="confirm"]`).click();
    await expect(page.locator(MENU)).toHaveCount(0);
    await expect.poll(async () => (await visible(page)).length, { timeout: 15_000 }).toBe(1641);
  });
});

/** Records every contextmenu that reaches a host-style bubble listener on #mapHost. */
async function hostRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__hostMenus = [];
    document.getElementById('mapHost')!.addEventListener('contextmenu', (e) => {
      const t = e.target as Element;
      w.__hostMenus.push({
        node: t.closest('.map-node')?.getAttribute('data-id') ?? '',
        prevented: e.defaultPrevented,
        levelOpen: !!document.querySelector('.map-level-menu'),
      });
      // A host opens its own node menu here: no browser menu either.
      e.preventDefault();
    });
  });
}
const hostMenus = (page: Page) => page.evaluate(() => (window as any).__hostMenus as { node: string; prevented: boolean; levelOpen: boolean }[]);

/** A point on the pill well left of the handle and away from the caption text. */
async function pillPoint(page: Page, id: string) {
  const r = (await page.locator(`.map-node[data-id="${id}"] .map-pill`).boundingBox())!;
  return { x: r.x + 6, y: r.y + r.height / 2 };
}

test.describe('fold to level: the handle only, one menu at a time (L9 amended, node menu M1)', () => {
  test('right-click on the handle opens only the picker; the host never sees the event', async ({ page }) => {
    await open(page);
    await hostRecorder(page);
    await hit(page, 'branches').click({ button: 'right' });
    await expect(page.locator(MENU)).toHaveCount(1);
    await expect(page.locator(MENU)).toHaveAttribute('aria-label', 'Fold Branches to level');
    expect(await hostMenus(page)).toEqual([]);
    // A right-click inside the picker stays there too.
    await page.locator(`${MENU} [data-level="1"]`).click({ button: 'right' });
    await expect(page.locator(MENU)).toHaveCount(1);
    expect(await hostMenus(page)).toEqual([]);
  });

  test('right-click on the pill opens no picker and reaches the host untouched', async ({ page }) => {
    await open(page);
    await hostRecorder(page);
    for (const id of ['branches', 'riverside', 'roof']) {
      const p = await pillPoint(page, id);
      await page.mouse.click(p.x, p.y, { button: 'right' });
    }
    await page.waitForTimeout(150);
    await expect(page.locator(MENU)).toHaveCount(0);
    expect(await hostMenus(page)).toEqual([
      { node: 'branches', prevented: false, levelOpen: false },
      { node: 'riverside', prevented: false, levelOpen: false },
      { node: 'roof', prevented: false, levelOpen: false },
    ]);
  });

  test('an open picker closes on a right-click elsewhere, before the host sees it', async ({ page }) => {
    await open(page);
    await hostRecorder(page);
    await hit(page, 'branches').click({ button: 'right' });
    await expect(page.locator(MENU)).toHaveCount(1);
    const p = await pillPoint(page, 'programs');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await expect(page.locator(MENU)).toHaveCount(0);
    expect(await hostMenus(page)).toEqual([{ node: 'programs', prevented: false, levelOpen: false }]);
    // A contextmenu that skips the pointerdown (keyboard, synthetic) closes it too.
    expect(await page.evaluate(() => (window as any).__map.openLevelMenu('branches'))).toBe(true);
    await expect(page.locator(MENU)).toHaveCount(1);
    await page.evaluate(() => {
      const pill = document.querySelector('.map-node[data-id="fac"] .map-pill')!;
      pill.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    });
    await expect(page.locator(MENU)).toHaveCount(0);
    expect((await hostMenus(page)).at(-1)).toEqual({ node: 'fac', prevented: false, levelOpen: false });
  });

  test('map.closeMenus closes the picker; map.openLevelMenu opens it at the handle and not on a leaf', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => (window as any).__map.openLevelMenu('riverside'))).toBe(true);
    await expect(page.locator(MENU)).toHaveCount(1);
    const m = (await page.locator(MENU).boundingBox())!;
    const h = (await hit(page, 'riverside').boundingBox())!;
    expect(Math.abs(m.x + m.width / 2 - (h.x + h.width / 2))).toBeLessThanOrEqual(2);
    await page.evaluate(() => (window as any).__map.closeMenus());
    await expect(page.locator(MENU)).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__map.openLevelMenu('roof'))).toBe(false);
    await expect(page.locator(MENU)).toHaveCount(0);
  });
});
