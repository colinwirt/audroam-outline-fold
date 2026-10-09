import { test, expect, type Page } from '@playwright/test';
import { Touch } from './touch';

/**
 * Map time leaves on a phone (0.2.40, TL1, TL6). Fixture:
 * examples/e2e-touch/time-leaves.md (fiction): t1–t4 `<kind:time>`, s1 / s2
 * `<kind:session>` leaves; t5 is a time record with a child (a note pill).
 */

const MAP = 'examples/e2e-touch/index.html?doc=time-leaves.md';
const HOST = '#mapHost';
const node = (id: string) => `${HOST} .map-node[data-id="${id}"]`;
const LEAVES = ['t1', 't2', 't3', 't4', 's1', 's2'];

async function open(page: Page, query = '') {
  await page.goto(MAP + query);
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(200);
}

/** Zoom in and bring `id` into view, so a finger can hit it. */
async function show(page: Page, id: string) {
  await page.evaluate((k) => {
    const m = (window as any).__map;
    m.zoomBy(2);
    m.focusNode(k);
  }, id);
  await page.waitForTimeout(450);
}

/** A point on the pill chrome: inside the pill, off the label. */
async function chromePoint(page: Page, id: string) {
  const pt = await page.evaluate((sel) => {
    const g = document.querySelector(sel)!;
    const r = g.querySelector('.map-pill')!.getBoundingClientRect();
    for (let y = r.top + 3; y < r.bottom - 2; y += 2) {
      for (let x = r.left + 3; x < r.right - 2; x += 2) {
        const el = document.elementFromPoint(x, y);
        if (!el || el.closest('.map-node') !== g) continue;
        if (el.closest('.map-label')) continue;
        return { x, y };
      }
    }
    return null;
  }, node(id));
  expect(pt, `pill chrome of ${id}`).not.toBeNull();
  return pt!;
}

test.describe('time leaves on touch', () => {
  test('classes, one line, no fold handle, no width grip', async ({ page }) => {
    await open(page);
    for (const id of LEAVES) {
      const cls = (await page.locator(node(id)).getAttribute('class'))!.split(/\s+/);
      expect(cls, id).toEqual(expect.arrayContaining(['time-leaf', id.startsWith('s') ? 'kind-session' : 'kind-time']));
      expect(await page.locator(`${node(id)} .map-label > tspan`).count(), id).toBe(1);
      await expect(page.locator(`${node(id)} .map-fold-hit, ${node(id)} .map-fold-indicator`)).toHaveCount(0);
      await expect(page.locator(`${node(id)} .map-width-grip, ${node(id)} .map-width-hit`)).toHaveCount(0);
    }
    expect(await page.locator(node('t5')).getAttribute('class')).not.toContain('time-leaf');
  });

  test('a tap selects the time leaf and opens nothing; the corner opens no width popover', async ({ page }) => {
    await open(page);
    await show(page, 't1');
    const t = await Touch.attach(page);
    const p = await chromePoint(page, 't1');
    await t.tap(p.x, p.y);
    await page.waitForTimeout(400);
    await expect.poll(() => page.evaluate(() => (window as any).__focus())).toBe('t1');
    await expect(page.locator(node('t1'))).toHaveClass(/is-focused/);
    await expect(page.locator(`${node('t1')} .map-width-grip`)).toHaveCount(0);
    const b = (await page.locator(`${node('t1')} .map-pill`).boundingBox())!;
    await t.tap(b.x + b.width - 2, b.y + b.height - 2);
    await page.waitForTimeout(400);
    await expect(page.locator('.map-width-pop')).toHaveCount(0);
    await expect(page.locator('.map-link-pop, .map-level-menu')).toHaveCount(0);
  });

  test('excluded from fit: no width menu and no pick on a time leaf', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => (window as any).__map.openWidthMenu('s2'))).toBe(false);
    expect(await page.evaluate(() => (window as any).__map.applyWidthPick('s2', 'line'))).toBe(false);
    await expect(page.locator('.map-width-pop')).toHaveCount(0);
  });

  test('a hold on a time leaf opens the node menu', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, '&nodemenu=1');
    await show(page, 's2');
    const t = await Touch.attach(page);
    const p = await chromePoint(page, 's2');
    await t.start([p]);
    await page.waitForTimeout(650);
    await t.end();
    await page.waitForTimeout(150);
    const menu = page.locator(`${HOST} .map-node-menu`);
    await expect(menu).toHaveCount(1);
    expect(await page.locator(`${HOST} .map-node-menu [role="menuitem"]`).allTextContents()).toEqual(['Copy jump', 'Copy link']);
    expect(await page.evaluate(() => (window as any).__focus())).toBe('s2');
  });
});
