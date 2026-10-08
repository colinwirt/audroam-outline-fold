import { test, expect } from '@playwright/test';
import { Touch, box, centre } from './touch';

/** Jumps and the thread pill on touch (0.2.34). Fixture: examples/e2e-touch/jumps.md. */
const MAP = 'examples/e2e-touch/index.html?doc=jumps.md';

test.describe('jumps on touch', () => {
  test('tap on a <r:x> chip selects that node (its parent unfolds)', async ({ page }) => {
    await page.goto(MAP);
    await page.waitForFunction(() => (window as any).__ready === true);
    await page.waitForTimeout(150);
    const t = await Touch.attach(page);
    const c = centre(await box(page, '.map-node[data-id="jump"] .map-jump-hit[data-jump="tom"]'));
    await t.tap(c.x, c.y);
    await expect.poll(() => page.evaluate(() => (window as any).__focus())).toBe('tom');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as any).__hops)).toEqual([{ id: 'tom', from: 'jump' }]);
    expect(await page.evaluate(() => location.hash)).toBe('');
  });

  test('tap on a broken jump does nothing', async ({ page }) => {
    await page.goto(MAP);
    await page.waitForFunction(() => (window as any).__ready === true);
    await page.waitForTimeout(150);
    const t = await Touch.attach(page);
    const c = centre(await box(page, '.map-node[data-id="jump"] .map-jump-hit[data-jump="gone"]'));
    await t.tap(c.x, c.y);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as any).__hops)).toEqual([]);
    expect(await page.evaluate(() => location.hash)).toBe('');
  });

  test('thread pill sits inside its node', async ({ page }) => {
    await page.goto(MAP);
    await page.waitForFunction(() => (window as any).__ready === true);
    const pill = await box(page, '.map-node[data-id="disc"] .map-pill');
    const thread = await box(page, '.map-node[data-id="disc"] .map-thread-pill');
    expect(thread.x).toBeGreaterThan(pill.x);
    expect(thread.y).toBeGreaterThan(pill.y);
    expect(thread.x + thread.w).toBeLessThan(pill.x + pill.w);
    expect(thread.y + thread.h).toBeLessThan(pill.y + pill.h);
  });

  test('Outline: tap on a <r:x> chip focuses that row', async ({ page }) => {
    await page.goto(`${MAP}&view=outline`);
    await page.waitForFunction(() => (window as any).__ready === true);
    const t = await Touch.attach(page);
    const c = centre(await box(page, '[data-testid="of-jump-tom"]'));
    await t.tap(c.x, c.y);
    await expect(page.locator('li[data-id="tom"]')).toBeFocused();
    expect(await page.evaluate(() => location.hash)).toBe('');
  });
});
