import { test, expect } from '@playwright/test';

/** 0.5.30: task checkbox on a filled node reads at >= 3:1 against the fill (rich Audroam, Neutral, Bold, Deep). */
const URL = 'examples/e2e-touch/colour.html?md=rich-0530.md';
const lum = (c: string) => {
  const [r, g, b] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
    const s = Number(v) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

for (const dpr of [1, 2]) {
  for (const theme of ['dark', 'light'] as const) {
    test.describe(`rich fills dpr ${dpr} ${theme}`, () => {
      test.use({ deviceScaleFactor: dpr });
      test(`checkbox >= 3:1 on every filled task (dpr ${dpr}, ${theme})`, async ({ page }) => {
        await page.goto(URL + (theme === 'light' ? '&theme=light' : ''));
        await page.waitForFunction(() => (window as any).__ready === true);
        await page.waitForTimeout(150);
        for (const id of ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9']) {
          const g = page.locator(`#mapHost .map-node[data-id="${id}"]`);
          const fill = await g.locator('.map-pill').evaluate((e) => getComputedStyle(e).fill);
          const box = await g.locator('.map-task-box').first().evaluate((e) => getComputedStyle(e).stroke);
          expect(ratio(fill, box), `${id} ${fill} vs ${box}`).toBeGreaterThanOrEqual(3);
        }
        const env = dpr === 2 ? process.env[`SHOT_RICH_${theme.toUpperCase()}`] : undefined;
        if (env) await page.locator('#panel').screenshot({ path: env });
      });
    });
  }
}

/** 0.5.30: base border is whole device pixels on screen at DPR 2; strong stays heavier. */
test.describe('wireframe borders at dpr 2', () => {
  test.use({ deviceScaleFactor: 2 });
  for (const theme of ['dark', 'light'] as const) {
    test(`device-pixel borders (${theme})`, async ({ page }) => {
      await page.goto(`examples/e2e-touch/colour.html?focus=fl${theme === 'light' ? '&theme=light' : ''}`);
      await page.waitForFunction(() => (window as any).__ready === true);
      await page.waitForTimeout(150);
      const dp = (id: string) =>
        page.locator(`#mapHost .map-node[data-id="${id}"] .map-pill`).evaluate((el) => parseFloat(getComputedStyle(el).strokeWidth) * (el as SVGGraphicsElement).getScreenCTM()!.a * devicePixelRatio);
      const base = await dp('loose');
      expect(Math.abs(base - Math.round(base))).toBeLessThan(0.01);
      expect(Math.round(base)).toBe(3);
      const env = process.env[`WIRE2_${theme.toUpperCase()}`];
      if (env) await page.locator('#panel').screenshot({ path: env });
    });
  }
});
