import { test, expect, type Page } from '@playwright/test';

/**
 * 0.2.30: mouse and keyboard on − / + / Fit and on the resize popover items
 * activate exactly once (bindTap keeps click for them). Desktop Chrome.
 */

const HARNESS = 'examples/e2e-touch/index.html';
const ZI = '.of-map-controls button[aria-label="Zoom in"]';
const FIT = '.of-map-controls button[aria-label="Fit"]';

async function open(page: Page) {
  await page.goto(HARNESS);
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(150);
}

const zooms = (page: Page) => page.evaluate(() => (window as any).__zooms.length);
const fits = (page: Page) => page.evaluate(() => (window as any).__fits);
const paints = (page: Page) => page.evaluate(() => (window as any).__paints);

async function openPopWithMouse(page: Page, id: string) {
  const pill = (await page.locator(`.map-node[data-id="${id}"] .map-pill`).boundingBox())!;
  await page.mouse.click(pill.x + pill.width - 2, pill.y + pill.height - 2);
  await expect(page.locator('.map-width-pop')).toHaveCount(1);
}

test.describe('controls: mouse and keyboard activate exactly once', () => {
  test('mouse click on + and Fit', async ({ page }) => {
    await open(page);
    await page.locator(ZI).click();
    await page.waitForTimeout(200);
    expect(await zooms(page)).toBe(1);
    await page.locator(FIT).click();
    await page.waitForTimeout(200);
    expect(await fits(page)).toBe(1);
  });

  test('keyboard Enter and Space on +', async ({ page }) => {
    await open(page);
    await page.locator(ZI).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    expect(await zooms(page)).toBe(1);
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    expect(await zooms(page)).toBe(2);
  });

  test('popover: mouse click applies once and does not select through', async ({ page }) => {
    await open(page);
    await openPopWithMouse(page, 'view');
    const w0 = Number(await page.locator('.map-node[data-id="view"]').getAttribute('data-text-w'));
    const p0 = await paints(page);
    await page.locator('.map-width-pop button[data-choice="slim"]').click();
    await expect(page.locator('.map-width-pop')).toHaveCount(0);
    await page.waitForTimeout(150);
    expect(await paints(page)).toBe(p0 + 1);
    expect(await page.evaluate(() => (window as any).__layout().nodes.view.w)).toBe(Math.max(120, Math.round(w0 - 56)));
  });

  test('popover: keyboard Enter / Space apply once; Enter does not fold the selected node; Esc closes', async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as any).__setFocus('tasks'));
    await openPopWithMouse(page, 'tasks');
    const expanded = () =>
      page.locator('.map-node[data-id="tasks"]').getAttribute('aria-expanded');
    expect(await expanded()).toBe('true');
    // Esc closes.
    await page.locator('.map-width-pop button[data-choice="auto"]').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('.map-width-pop')).toHaveCount(0);

    await openPopWithMouse(page, 'tasks');
    const p0 = await paints(page);
    await page.locator('.map-width-pop button[data-choice="wider"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.map-width-pop')).toHaveCount(0);
    await page.waitForTimeout(150);
    expect(await paints(page)).toBe(p0 + 1);
    expect(await expanded()).toBe('true');
    expect(await page.evaluate(() => (window as any).__layout().nodes.tasks.w)).toBeGreaterThan(0);

    await openPopWithMouse(page, 'tasks');
    // ArrowRight moves through the items; Space activates.
    await page.locator('.map-width-pop button[data-choice="slim"]').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const p1 = await paints(page);
    await page.keyboard.press('Space');
    await expect(page.locator('.map-width-pop')).toHaveCount(0);
    await page.waitForTimeout(150);
    expect(await paints(page)).toBe(p1 + 1);
    expect(await page.evaluate(() => (window as any).__layout().nodes.tasks?.w ?? null)).toBeNull();
    expect(await expanded()).toBe('true');
  });
});
