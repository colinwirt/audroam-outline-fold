import { test, expect } from '@playwright/test';
import { Touch, box, centre } from './touch';

/** Link popover on touch (0.2.33): 44 px rows, a tap on a row follows it. */
test('touch: rows are 44 px and a tap on the hop row selects its node', async ({ page }) => {
  await page.goto('examples/e2e-touch/index.html?doc=links.md');
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(150);
  const t = await Touch.attach(page);
  const g = centre(await box(page, '.map-node[data-id="multi"] .map-link-hit'));
  await t.tap(g.x, g.y);
  await expect(page.locator('.map-link-pop')).toHaveAttribute('data-pointer', 'coarse');
  const hs = await page.locator('.map-link-item').evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetHeight));
  expect(hs).toHaveLength(3);
  for (const h of hs) expect(h).toBeGreaterThanOrEqual(44);
  // A one-finger pan keeps it open and it moves with the globe.
  const h = await box(page, '#mapHost');
  const before = await box(page, '.map-link-pop');
  await t.start([{ x: h.x + 30, y: h.y + h.h - 40 }]);
  for (let i = 1; i <= 8; i++) {
    await t.move([{ x: h.x + 30 + i * 5, y: h.y + h.h - 40 - i * 4 }]);
    await page.waitForTimeout(16);
  }
  await t.end();
  // Wait for the glide to stop: same camera across 3 frames.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const m = (window as any).__map;
              const key = () => `${m.cam.x},${m.cam.y},${m.cam.k}`;
              const k0 = key();
              requestAnimationFrame(() =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve(key() === k0))),
              );
            }),
        ),
      { intervals: [0] },
    )
    .toBe(true);
  await expect(page.locator('.map-link-pop')).toHaveCount(1);
  const x = await page.evaluate(() => {
    const p = document.querySelector('.map-link-pop')!.getBoundingClientRect();
    const g = document.querySelector('.map-node[data-id="multi"] .map-link-hit')!.getBoundingClientRect();
    return { px: p.left, py: p.top, gap: p.left - g.right, dy: p.top + p.height / 2 - (g.top + g.height / 2) };
  });
  expect(Math.abs(x.px - before.x) + Math.abs(x.py - before.y)).toBeGreaterThan(10);
  expect(x.gap).toBeCloseTo(8, 1);
  expect(x.dy).toBeCloseTo(0, 1);
  const row = centre(await box(page, '.map-link-item[data-hop-id="plants"]'));
  await t.tap(row.x, row.y);
  await expect(page.locator('.map-link-pop')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__focus())).toBe('plants');
});
