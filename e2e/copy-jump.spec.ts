import { test, expect, type Page } from '@playwright/test';

/**
 * Node menu Open group: Copy jump and Copy link (0.2.39, node menu M2–M4, M8,
 * M9, M11), desktop. Fixture: examples/e2e-touch/copy-jump.md (fiction).
 * Ids: openday, glaze, desk; the id-less lines are keyed by position
 * (Kiln corner = 5, Check the cones = 6, Sweep the kiln shelves = 7).
 */

const MAP = 'examples/e2e-touch/index.html?doc=copy-jump.md&nodemenu=1';
const MENU = '#mapHost .map-node-menu';
const node = (id: string) => `#mapHost .map-node[data-id="${id}"]`;

async function open(page: Page, url = MAP) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(150);
}

const clip = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
const sets = (page: Page) => page.evaluate(() => (window as any).__sets as number);
const text = (page: Page) => page.evaluate(() => (window as any).__serialize() as string);

/** Right-click the pill chrome (left padding, clear of the label and handle). */
async function rightClickPill(page: Page, id: string) {
  const b = (await page.locator(`${node(id)} .map-pill`).boundingBox())!;
  await page.mouse.click(b.x + 5, b.y + b.height / 2, { button: 'right' });
}

async function menuItems(page: Page) {
  return page.locator(`${MENU} [role="menuitem"]`).allTextContents();
}

test.describe('node menu: Copy jump / Copy link (desktop)', () => {
  test('right-click opens one menu with labelled groups; labels only, no ↗', async ({ page }) => {
    await open(page);
    await rightClickPill(page, 'glaze');
    const menu = page.locator(MENU);
    await expect(menu).toHaveCount(1);
    await expect(menu).toHaveAttribute('role', 'menu');
    await expect(menu).toHaveAttribute('aria-label', 'Glaze table');
    expect(await menuItems(page)).toEqual(['Levels…', 'Copy jump', 'Copy link']);
    const groups = await page.$$eval(`${MENU} [role="group"]`, (gs) =>
      gs.map((g) => document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent),
    );
    expect(groups).toEqual(['View', 'Open']);
    await expect(page.locator(`${MENU} [role="separator"]`)).toHaveCount(1);
    await expect(page.locator(`${MENU} .map-link-ext, ${MENU} a, ${MENU} svg, ${MENU} img`)).toHaveCount(0);
    expect((await page.locator(MENU).textContent()) ?? '').not.toContain('↗');
    // One menu at a time: no level picker, link or width popover.
    await expect(page.locator('#mapHost .map-level-menu, #mapHost .map-link-pop, #mapHost .map-width-pop')).toHaveCount(0);
    // Focus is on the first item.
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Levels…');
  });

  test('Copy jump on a line with an id copies <r:id>, writes nothing, confirms Copied', async ({ page }) => {
    await open(page);
    const before = await text(page);
    const setsBefore = await sets(page);
    await rightClickPill(page, 'desk');
    expect(await menuItems(page)).toEqual(['Copy jump', 'Copy link']);
    await page.locator(`${MENU} [data-item="copy-jump"]`).click();
    await expect(page.locator(MENU)).toHaveCount(0);
    await expect.poll(() => clip(page)).toBe('<r:desk>');
    const toast = page.locator('#mapHost .map-copied');
    await expect(toast).toHaveText('Copied jump');
    await expect(toast).toHaveAttribute('role', 'status');
    await expect(toast).toHaveAttribute('aria-live', 'polite');
    await expect(toast).toHaveCount(0, { timeout: 4000 });
    expect(await sets(page)).toBe(setsBefore);
    expect(await text(page)).toBe(before);
    // Focus is back on the map.
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('mapHost');
  });

  test('clipboard fallback: a refused Clipboard API still copies (execCommand)', async ({ page }) => {
    await page.addInitScript(() => {
      const clip = navigator.clipboard;
      (window as any).__writeTextCalls = 0;
      clip.writeText = () => {
        (window as any).__writeTextCalls++;
        return Promise.reject(new DOMException('denied', 'NotAllowedError'));
      };
    });
    await open(page);
    await rightClickPill(page, 'desk');
    await page.locator(`${MENU} [data-item="copy-jump"]`).click();
    await expect(page.locator('#mapHost .map-copied')).toHaveText('Copied jump');
    expect(await page.evaluate(() => (window as any).__writeTextCalls)).toBe(1);
    await expect.poll(() => clip(page)).toBe('<r:desk>');
    expect(await page.evaluate(() => (window as any).__copies.at(-1))).toMatchObject({ ok: true, text: '<r:desk>' });
  });

  test('Copy link copies this page with focus=<id>', async ({ page }) => {
    await open(page);
    await rightClickPill(page, 'glaze');
    await page.locator(`${MENU} [data-item="copy-link"]`).click();
    const expected = new URL(page.url());
    expected.searchParams.set('focus', 'glaze');
    expected.hash = '';
    await expect.poll(() => clip(page)).toBe(expected.href);
    await expect(page.locator('#mapHost .map-copied')).toHaveText('Copied link');
    // The copied link opens the map with that node selected.
    await page.goto(expected.href);
    await page.waitForFunction(() => (window as any).__ready === true);
    expect(await page.evaluate(() => (window as any).__focus())).toBe('glaze');
  });

  test('a line without an id gets a short id on first copy: dirty, saved, spacing kept', async ({ page }) => {
    await open(page);
    const before = await text(page);
    expect(before).toContain('  - Kiln corner\n');
    const setsBefore = await sets(page);
    await rightClickPill(page, '5');
    await page.locator(`${MENU} [data-item="copy-jump"]`).click();
    await expect.poll(() => clip(page)).toBe('<r:5>');
    // Written through setDoc (the host's dirty mark) and in the saved text.
    expect(await sets(page)).toBe(setsBefore + 1);
    const after = await text(page);
    expect(after).toContain('  - Kiln corner <id:5>\n');
    expect(after).toContain('    - Check the cones  < r : glaze >  before firing\n');
    expect(after.replace(' <id:5>', '')).toBe(before);
    // A second copy is a no-op for the document.
    await rightClickPill(page, '5');
    await page.locator(`${MENU} [data-item="copy-link"]`).click();
    await expect.poll(() => clip(page)).toContain('focus=5');
    expect(await sets(page)).toBe(setsBefore + 1);
    // Pasted into another caption, the jump is a chip that selects Kiln corner.
    await page.evaluate((t) => (window as any).__loadText(`${t}- Ask at the desk <r:5>\n`), after);
    const chip = page.locator(`#mapHost .map-jump-hit[data-jump="5"]:not(.is-broken)`);
    await expect(chip).toHaveCount(1);
  });

  test('the spaced jump line keeps its typed tag when it gets an id', async ({ page }) => {
    await open(page);
    await rightClickPill(page, '6');
    await page.locator(`${MENU} [data-item="copy-jump"]`).click();
    await expect.poll(() => clip(page)).toBe('<r:6>');
    expect(await text(page)).toContain('    - Check the cones  < r : glaze >  before firing <id:6>\n');
  });

  test('keyboard: Shift+F10 / ContextMenu open it for the selected node; arrows, type-ahead, Enter, Esc', async ({ page }) => {
    await open(page);
    await page.locator(node('desk')).click();
    await page.keyboard.press('Shift+F10');
    await expect(page.locator(MENU)).toHaveCount(1);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Copy jump');
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Copy link');
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Copy jump');
    await page.keyboard.press('Escape');
    await expect(page.locator(MENU)).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('mapHost');
    await page.keyboard.press('ContextMenu');
    await expect(page.locator(MENU)).toHaveCount(1);
    // Type-ahead cycles the items starting with C: Copy jump → Copy link → Copy jump.
    await page.keyboard.press('c');
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Copy link');
    await page.keyboard.press('c');
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Copy jump');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect.poll(() => clip(page)).toContain('focus=desk');
    await expect(page.locator(MENU)).toHaveCount(0);
  });

  test('keyboard reaches the level picker through Levels…', async ({ page }) => {
    await open(page);
    await page.locator(node('glaze')).click();
    await page.keyboard.press('Shift+F10');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator(MENU)).toHaveCount(0);
    await expect(page.locator('#mapHost .map-level-menu')).toHaveCount(1);
  });

  test('read-only: nothing is minted; the items are hidden on lines without an id', async ({ page }) => {
    await open(page, `${MAP}&readonly=1`);
    const setsBefore = await sets(page);
    const before = await text(page);
    // A line without an id: nothing applies (no id to fold or copy), so no package menu.
    await rightClickPill(page, '5');
    await expect(page.locator(MENU)).toHaveCount(0);
    await rightClickPill(page, '7');
    await expect(page.locator(MENU)).toHaveCount(0);
    // A line with an id still copies, and nothing is written.
    await rightClickPill(page, 'desk');
    expect(await menuItems(page)).toEqual(['Copy jump', 'Copy link']);
    await page.locator(`${MENU} [data-item="copy-jump"]`).click();
    await expect.poll(() => clip(page)).toBe('<r:desk>');
    // The API refuses a mint too.
    const r = await page.evaluate(() => (window as any).__map.copyJump('5'));
    expect(r).toMatchObject({ ok: false, minted: false, id: null, reason: 'read-only' });
    expect(await sets(page)).toBe(setsBefore);
    expect(await text(page)).toBe(before);
  });

  test('host nodeUri template; none hides Copy link', async ({ page }) => {
    await open(page, `${MAP}&nodeuri=${encodeURIComponent('/maps/pottery/view?focus={id}')}`);
    await rightClickPill(page, 'desk');
    await page.locator(`${MENU} [data-item="copy-link"]`).click();
    const origin = new URL(page.url()).origin;
    await expect.poll(() => clip(page)).toBe(`${origin}/maps/pottery/view?focus=desk`);
    await open(page, `${MAP}&nodeuri=none`);
    await rightClickPill(page, 'desk');
    expect(await menuItems(page)).toEqual(['Copy jump']);
  });

  test('handle right-click still opens only the level picker; a pill right-click then swaps to the node menu', async ({ page }) => {
    await open(page);
    const h = (await page.locator(`${node('glaze')} .map-fold-hit`).boundingBox())!;
    await page.mouse.click(h.x + h.width / 2, h.y + h.height / 2, { button: 'right' });
    await expect(page.locator('#mapHost .map-level-menu')).toHaveCount(1);
    await expect(page.locator(MENU)).toHaveCount(0);
    await rightClickPill(page, 'desk');
    await expect(page.locator('#mapHost .map-level-menu')).toHaveCount(0);
    await expect(page.locator(MENU)).toHaveCount(1);
  });

  test('without nodeMenu the pill right-click is left to the host, as before', async ({ page }) => {
    await open(page, 'examples/e2e-touch/index.html?doc=copy-jump.md');
    await rightClickPill(page, 'desk');
    await expect(page.locator(MENU)).toHaveCount(0);
  });
});
