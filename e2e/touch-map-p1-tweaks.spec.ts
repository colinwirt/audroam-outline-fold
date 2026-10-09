import { test, expect } from '@playwright/test';
import { Touch, box, centre, popSettled } from './touch';

/** Day-map P1 tweaks on touch (0.2.38): K6 count is not a tap target, K3 ↗ on 44 px rows, K4 on a phone. Fiction fixture. */
test.describe('P1 tweaks on touch', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().route('https://notes.example.org/**', (r) =>
      r.fulfill({ contentType: 'text/html', body: '<title>note</title>' }),
    );
    await page.goto('examples/e2e-touch/index.html?doc=day-tweaks.md');
    await page.waitForFunction(() => (window as any).__ready === true);
    await page.waitForTimeout(150);
  });

  test('K6: a tap on the count does not unfold; a tap on the + does', async ({ page }) => {
    const t = await Touch.attach(page);
    const seeds = page.locator('.map-node[data-id="seeds"]');
    await expect(seeds.locator('.map-fold-count')).toHaveAttribute('aria-label', '5 hidden');
    // Fit leaves a phone at ~35 %, where the count is 6 px and the platform's
    // touch adjustment rightly snaps to the handle. Zoom to 100 % on it first.
    const h0 = centre(await box(page, '.map-node[data-id="seeds"] .map-fold-indicator'));
    await page.evaluate(({ x, y }) => {
      const m = (window as any).__map;
      m.zoomAt(x, y, 1 / m.cam.k);
    }, h0);
    await expect.poll(() => page.evaluate(() => (window as any).__map.cam.k)).toBeCloseTo(1, 2);
    await page.waitForTimeout(300);
    const cb = await box(page, '.map-node[data-id="seeds"] .map-fold-count');
    // Tap the count's right half, clear of the 32 px handle target.
    await t.tap(cb.x + cb.w * 0.75, cb.y + cb.h / 2);
    await page.waitForTimeout(250);
    await expect(seeds).toHaveAttribute('aria-expanded', 'false');
    const c = centre(await box(page, '.map-node[data-id="seeds"] .map-fold-indicator'));
    await t.tap(c.x, c.y);
    await expect(seeds).toHaveAttribute('aria-expanded', 'true');
    await expect(seeds.locator('.map-fold-count')).toHaveCount(0);
  });

  test('K3: #N rows on touch end in ↗', async ({ page }) => {
    const t = await Touch.attach(page);
    const c = centre(await box(page, '.map-node[data-id="compost"] .map-note-link-hit[data-note-link="2101"]'));
    await t.tap(c.x, c.y);
    const pop = page.locator('.map-link-pop');
    await expect(pop).toHaveAttribute('data-pointer', 'coarse');
    await popSettled(page);
    const rows = await page.locator('.map-link-item').evaluateAll((els) =>
      els.map((a) => ({
        h: (a as HTMLElement).offsetHeight,
        arrow: a.querySelector('.map-link-ext')?.textContent ?? null,
        name: a.getAttribute('aria-label'),
      })),
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.h).toBeGreaterThanOrEqual(44);
      expect(r.arrow).toBe('↗');
      expect(r.name).toMatch(/opens in new window$/);
    }
  });

  test('K4: open tasks are semibold with a 2 px stroke on a phone too', async ({ page }) => {
    const got = await page.evaluate(() =>
      ['compost', 'beans', 'butt'].map((id) => {
        const g = document.querySelector(`.map-node[data-id="${id}"]`)!;
        return [
          getComputedStyle(g.querySelector('.map-pill')!).strokeWidth,
          getComputedStyle(g.querySelector('.map-label')!).fontWeight,
        ];
      }),
    );
    expect(got).toEqual([
      ['2px', '600'],
      ['2px', '600'],
      ['1px', '400'],
    ]);
  });
});
