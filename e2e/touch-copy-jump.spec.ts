import { test, expect, type Page } from '@playwright/test';
import { Touch } from './touch';

/**
 * Node menu Copy jump / Copy link on a phone (0.2.39, node menu M7): a 450 ms
 * hold on the pill chrome opens it, 44 px rows, tap an item. Fixture:
 * examples/e2e-touch/copy-jump.md (fiction). Kiln corner has no id (key 5).
 */

const MAP = 'examples/e2e-touch/index.html?doc=copy-jump.md&nodemenu=1';
const MENU = '#mapHost .map-node-menu';
const node = (id: string) => `#mapHost .map-node[data-id="${id}"]`;

async function open(page: Page, url = MAP) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(200);
}

const clip = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

/** A point on the pill chrome: inside the pill, not on the label or any handle. */
async function chromePoint(page: Page, id: string) {
  const pt = await page.evaluate((sel) => {
    const g = document.querySelector(sel)!;
    const r = g.querySelector('.map-pill')!.getBoundingClientRect();
    for (let y = r.top + 3; y < r.bottom - 2; y += 2) {
      for (let x = r.left + 3; x < r.right - 2; x += 2) {
        const el = document.elementFromPoint(x, y);
        if (!el || el.closest('.map-node') !== g) continue;
        if (el.closest('.map-label, .map-fold-hit, .map-fold-indicator, .map-task-hit, .map-jump-hit, .map-link-hit, .map-width-hit')) continue;
        return { x, y };
      }
    }
    return null;
  }, node(id));
  expect(pt, `pill chrome of ${id}`).not.toBeNull();
  return pt!;
}

async function hold(page: Page, t: Touch, p: { x: number; y: number }, ms = 650) {
  await t.start([p]);
  await page.waitForTimeout(ms);
  await t.end();
  await page.waitForTimeout(150);
}

async function tapItem(page: Page, t: Touch, item: string) {
  const b = (await page.locator(`${MENU} [data-item="${item}"]`).boundingBox())!;
  await t.tap(b.x + b.width / 2, b.y + b.height / 2);
}

test.describe('node menu on touch: hold the pill, tap Copy jump / Copy link', () => {
  test('hold on the pill chrome opens the menu (44 px rows); Copy jump mints an id and copies <r:id>', async ({ page }) => {
    await open(page);
    const t = await Touch.attach(page);
    const setsBefore = await page.evaluate(() => (window as any).__sets);
    await hold(page, t, await chromePoint(page, '5'));
    const menu = page.locator(MENU);
    await expect(menu).toHaveCount(1);
    await expect(menu).toHaveAttribute('data-pointer', 'coarse');
    expect(await page.locator(`${MENU} [role="menuitem"]`).allTextContents()).toEqual(['Copy jump', 'Copy link']);
    for (const b of await page.locator(`${MENU} [role="menuitem"]`).all()) {
      expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    // The lift neither closed it nor toggled anything; the held node is selected.
    expect(await page.evaluate(() => (window as any).__focus())).toBe('5');
    await tapItem(page, t, 'copy-jump');
    await expect(menu).toHaveCount(0);
    await expect.poll(() => clip(page)).toBe('<r:5>');
    await expect(page.locator('#mapHost .map-copied')).toHaveText('Copied jump');
    expect(await page.evaluate(() => (window as any).__sets)).toBe(setsBefore + 1);
    const text: string = await page.evaluate(() => (window as any).__serialize());
    expect(text).toContain('  - Kiln corner <id:5>\n');
    expect(text).toContain('    - Check the cones  < r : glaze >  before firing\n');
  });

  test('Copy link on a line with an id copies the focus URL and writes nothing', async ({ page }) => {
    await open(page);
    const t = await Touch.attach(page);
    const before: string = await page.evaluate(() => (window as any).__serialize());
    await hold(page, t, await chromePoint(page, 'desk'));
    await tapItem(page, t, 'copy-link');
    const expected = new URL(page.url());
    expected.searchParams.set('focus', 'desk');
    await expect.poll(() => clip(page)).toBe(expected.href);
    await expect(page.locator('#mapHost .map-copied')).toHaveText('Copied link');
    expect(await page.evaluate(() => (window as any).__serialize())).toBe(before);
  });

  test('a short tap only selects; a hold that moves pans instead', async ({ page }) => {
    await open(page);
    const t = await Touch.attach(page);
    const p = await chromePoint(page, 'desk');
    await t.tap(p.x, p.y);
    await page.waitForTimeout(600);
    await expect(page.locator(MENU)).toHaveCount(0);
    await t.start([p]);
    for (let i = 1; i <= 6; i++) {
      await t.move([{ x: p.x - 4 * i, y: p.y }]);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(600);
    await t.end();
    await page.waitForTimeout(150);
    await expect(page.locator(MENU)).toHaveCount(0);
  });

  test('read-only: a hold on a line without an id opens nothing and mints nothing', async ({ page }) => {
    await open(page, `${MAP}&readonly=1`);
    const t = await Touch.attach(page);
    const before: string = await page.evaluate(() => (window as any).__serialize());
    await hold(page, t, await chromePoint(page, '5'));
    await expect(page.locator(MENU)).toHaveCount(0);
    await hold(page, t, await chromePoint(page, 'desk'));
    expect(await page.locator(`${MENU} [role="menuitem"]`).allTextContents()).toEqual(['Copy jump', 'Copy link']);
    expect(await page.evaluate(() => (window as any).__serialize())).toBe(before);
    expect(await page.evaluate(() => (window as any).__sets)).toBe(0);
  });
});
