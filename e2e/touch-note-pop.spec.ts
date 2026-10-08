import { test, expect } from '@playwright/test';
import { Touch, box, centre } from './touch';

/** #N and thread chips on touch (0.2.34): a tap opens the popover, 44 px rows, a tap on a row picks it. */
test.describe('chips open the link popover on touch', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('examples/e2e-touch/index.html?doc=notes.md');
    await page.waitForFunction(() => (window as any).__ready === true);
    await page.waitForTimeout(150);
  });

  test('#N chip: tap opens, rows are 44 px: Open #N, Open map, Open details, no Go to', async ({ page }) => {
    const t = await Touch.attach(page);
    const sel = '.map-node[data-id="rota"] .map-note-link-hit[data-note-link="1005"]';
    const c = centre(await box(page, sel));
    await t.tap(c.x, c.y);
    const pop = page.locator('.map-link-pop');
    await expect(pop).toHaveAttribute('data-kind', 'note');
    await expect(pop).toHaveAttribute('data-pointer', 'coarse');
    const hs = await page.locator('.map-link-item').evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetHeight));
    expect(hs).toHaveLength(3);
    expect(await page.locator('.map-link-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-row')))).toEqual([
      'note-open',
      'note-map',
      'note-details',
    ]);
    for (const h of hs) expect(h).toBeGreaterThanOrEqual(44);
    const geo = () =>
      page.evaluate((s) => {
        const g = document.querySelector(s)!.getBoundingClientRect();
        const p = document.querySelector('.map-link-pop')!.getBoundingClientRect();
        const hr = document.querySelector('#mapHost')!.getBoundingClientRect();
        return { gap: p.left - g.right, dy: p.top + p.height / 2 - (g.top + g.height / 2), inside: hr.right - p.right };
      }, sel);
    // Past the phone's right edge: the camera pans it 8 px inside.
    await expect.poll(async () => (await geo()).inside, { timeout: 3000 }).toBeGreaterThanOrEqual(7);
    const x = await geo();
    expect(Math.abs(x.inside - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(x.gap - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(x.dy)).toBeLessThanOrEqual(1);
    // The fictional notes host: keep the new tab on a stub.
    await page.context().route('https://notes.example.org/**', (r) =>
      r.fulfill({ contentType: 'text/html', body: '<title>note</title>' }),
    );
    const popup = page.context().waitForEvent('page');
    const row = centre(await box(page, '.map-link-item[data-row="note-map"]'));
    await t.tap(row.x, row.y);
    expect((await popup).url()).toBe('https://notes.example.org/map?id=1005');
    await expect(pop).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).__notes.length)).toBe(1);
    expect(await page.evaluate(() => (window as any).__notes[0].open)).toBe('map');
    expect(await page.evaluate(() => (window as any).__focus())).not.toBe('1005');
  });

  test('thread chip: tap opens, Open thread fires onThread once', async ({ page }) => {
    const t = await Touch.attach(page);
    const c = centre(await box(page, '.map-node[data-id="disc"] .map-thread-hit'));
    await t.tap(c.x, c.y);
    await expect(page.locator('.map-link-pop')).toHaveAttribute('data-kind', 'thread');
    expect(await page.evaluate(() => (window as any).__threads.length)).toBe(0);
    const row = centre(await box(page, '.map-link-item[data-row="thread"]'));
    await t.tap(row.x, row.y);
    await expect(page.locator('.map-link-pop')).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__threads.length)).toBe(1);
  });
});
