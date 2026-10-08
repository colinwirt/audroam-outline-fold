import { test, expect, type Page } from '@playwright/test';

/**
 * Jumps (0.2.34): `<r:x>` chips and `[label](#id:x)` hops select and pan to the
 * node in the Map and focus it in the Outline, without a hash change. A jump
 * to an id that is not here is muted and inert. The thread pill sits inside
 * its node. Host: examples/e2e-touch with jumps.md (Plant list folded).
 */

const MAP = 'examples/e2e-touch/index.html?doc=jumps.md';
const OUTLINE = `${MAP}&view=outline`;

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(150);
}

async function clickSel(page: Page, sel: string) {
  const b = (await page.locator(sel).boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

/** Node pill rect and a part's rect, read in one frame. */
const inside = (page: Page, id: string, part: string) =>
  page.evaluate(
    ([id, part]) => {
      const g = document.querySelector(`.map-node[data-id="${id}"]`)!;
      const pill = g.querySelector('.map-pill')!.getBoundingClientRect();
      const p = g.querySelector(part)!.getBoundingClientRect();
      return {
        left: p.left - pill.left,
        right: pill.right - p.right,
        top: p.top - pill.top,
        bottom: pill.bottom - p.bottom,
      };
    },
    [id, part] as const,
  );

test.describe('Map', () => {
  test('<r:x> chip selects the node, unfolding its parent; onHop; no hash', async ({ page }) => {
    await open(page, MAP);
    await expect(page.locator('.map-node[data-id="tom"]')).toHaveCount(0);
    const chip = '.map-node[data-id="jump"] .map-jump-hit[data-jump="tom"]';
    await expect(page.locator(`${chip} .map-jump-link`)).toHaveText('→ Tomatoes');
    await clickSel(page, chip);
    await expect.poll(() => page.evaluate(() => (window as any).__focus())).toBe('tom');
    await expect(page.locator('.map-node[data-id="tom"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#mapHost')).toBeFocused();
    expect(await page.evaluate(() => (window as any).__hops)).toEqual([{ id: 'tom', from: 'jump' }]);
    expect(await page.evaluate(() => location.hash)).toBe('');
    // The camera brings it into view.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const r = document.querySelector('.map-node[data-id="tom"] .map-pill')!.getBoundingClientRect();
          const h = document.querySelector('#mapHost')!.getBoundingClientRect();
          return r.left >= h.left && r.right <= h.right && r.top >= h.top && r.bottom <= h.bottom;
        }),
      )
      .toBe(true);
  });

  test('Enter on the focused jump chip follows it', async ({ page }) => {
    await open(page, MAP);
    await page.locator('.map-node[data-id="jump"] a[href="#id:tom"]').focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => (window as any).__focus())).toBe('tom');
    expect(await page.evaluate(() => location.hash)).toBe('');
  });

  test('a jump to an id not in the map is shown muted and does nothing', async ({ page }) => {
    await open(page, MAP);
    const chip = page.locator('.map-node[data-id="jump"] .map-jump-hit[data-jump="gone"]');
    await expect(chip).toHaveClass(/is-broken/);
    await expect(chip).toHaveAttribute('aria-disabled', 'true');
    await expect(chip.locator('.map-jump-link')).toHaveText('→ gone');
    const fill = await chip.locator('.map-jump-link').evaluate((el) => getComputedStyle(el).fill);
    expect(fill).toBe('rgb(139, 155, 171)');
    const before = await page.evaluate(() => (window as any).__focus());
    await clickSel(page, '.map-node[data-id="jump"] .map-jump-hit[data-jump="gone"]');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as any).__focus())).toBe(before);
    expect(await page.evaluate(() => (window as any).__hops)).toEqual([]);
  });

  test('globe: a hop row selects the node; a hop to a missing id is muted and inert', async ({ page }) => {
    await open(page, MAP);
    await clickSel(page, '.map-node[data-id="hops"] .map-link-hit');
    const rows = page.locator('.map-link-pop .map-link-item');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toHaveAttribute('data-broken', 'true');
    // aria-disabled: Playwright would wait for it to be enabled, so click at its centre.
    await rows.nth(1).click({ force: true });
    await expect(page.locator('.map-link-pop:not(.is-closing)')).toHaveCount(1);
    await rows.nth(0).click();
    await expect(page.locator('.map-link-pop')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).__focus())).toBe('plants');
    expect(await page.evaluate(() => (window as any).__hops)).toEqual([{ id: 'plants', from: 'hops' }]);
  });

  test('[label](#pnid:N) keeps its label and gets a #N chip with the note rows', async ({ page }) => {
    await open(page, MAP);
    await expect(page.locator('.map-node[data-id="seeds"] .map-label')).toContainText('swap list');
    await expect(page.locator('.map-node[data-id="seeds"] .map-link-hit')).toHaveCount(0);
    await clickSel(page, '.map-node[data-id="seeds"] .map-note-link-hit[data-note-link="1006"]');
    const rows = page.locator('.map-link-pop .map-link-item');
    // No noteUri in this document; the map and details rows use the built-in defaults.
    expect(await rows.evaluateAll((els) => els.map((e) => [e.getAttribute('data-row'), e.getAttribute('href')]))).toEqual([
      ['note-open', null],
      ['note-map', '/notes/1006/map'],
      ['note-details', '/notes/1006/details'],
    ]);
  });

  test('thread pill sits inside its node, clear of the border', async ({ page }) => {
    await open(page, MAP);
    const r = await inside(page, 'disc', '.map-thread-pill');
    for (const side of ['left', 'right', 'top', 'bottom'] as const) expect(r[side]).toBeGreaterThanOrEqual(4);
    // And the #N / jump chips in the same row.
    const c = await inside(page, 'jump', '.map-jump-hit[data-jump="gone"] .map-jump-link');
    expect(c.right).toBeGreaterThanOrEqual(4);
  });
});

test.describe('Outline', () => {
  test('<r:x> chip focuses the row, unfolding its parent; onHop; no hash', async ({ page }) => {
    await open(page, OUTLINE);
    await expect(page.locator('li[data-id="tom"]')).toBeHidden();
    await page.locator('[data-testid="of-jump-tom"]').click();
    await expect(page.locator('li[data-id="tom"]')).toBeFocused();
    await expect(page.locator('li[data-id="plants"]')).toHaveAttribute('aria-expanded', 'true');
    expect(await page.evaluate(() => (window as any).__hops)).toEqual([{ id: 'tom', from: 'jump' }]);
    expect(await page.evaluate(() => location.hash)).toBe('');
  });

  test('[label](#id:x) hop in a caption focuses that row', async ({ page }) => {
    await open(page, OUTLINE);
    await page.locator('li[data-id="hops"] a.of-hop[data-hop-id="plants"]').click();
    await expect(page.locator('li[data-id="plants"]')).toBeFocused();
    expect(await page.evaluate(() => location.hash)).toBe('');
  });

  test('Enter on a focused jump follows it without folding the row', async ({ page }) => {
    await open(page, OUTLINE);
    await page.locator('[data-testid="of-jump-tom"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('li[data-id="tom"]')).toBeFocused();
  });

  test('[label](#pnid:N) is a note link: onNoteLinkClick', async ({ page }) => {
    await open(page, OUTLINE);
    await page.locator('li[data-id="seeds"] a.of-note-link[data-note-link="1006"]').click();
    expect(await page.evaluate(() => (window as any).__notes)).toEqual([{ id: 'seeds', pnid: '1006' }]);
    expect(await page.evaluate(() => location.hash)).toBe('');
  });

  test('broken jump and hop: muted, still shown, inert', async ({ page }) => {
    await open(page, OUTLINE);
    const jump = page.locator('[data-testid="of-jump-gone"]');
    const hop = page.locator('li[data-id="hops"] a.of-hop[data-hop-id="old"]');
    for (const l of [jump, hop]) {
      await expect(l).toBeVisible();
      await expect(l).toHaveClass(/of-link-broken/);
      await l.click({ force: true });
    }
    expect(await page.evaluate(() => location.hash)).toBe('');
    expect(await page.evaluate(() => (window as any).__hops)).toEqual([]);
  });
});
