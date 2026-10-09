import { test, expect, type Page } from '@playwright/test';

/**
 * A leading list number is caption text (0.2.37): `- 1. Rake the leaves`
 * shows `1. Rake the leaves` in the Map pill and the Outline row, never an
 * ordered list and never a swallowed number. Fixture:
 * examples/e2e-touch/list-numbers.md (fiction).
 */

const MAP = 'examples/e2e-touch/index.html?doc=list-numbers.md';
const OUTLINE = `${MAP}&view=outline`;

const CAPTIONS: [string, string][] = [
  ['rake', '1. Rake the leaves'],
  ['roses', '2. Prune the roses'],
  ['gate', '3. [ ] Oil the gate hinge'],
  ['porch', '12. Sweep the porch'],
];

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__ready === true);
}

test.describe('numbered captions keep their number', () => {
  test('Map pills show the number', async ({ page }) => {
    await open(page, MAP);
    for (const [id, caption] of CAPTIONS) {
      const text = await page.evaluate(
        (k) =>
          [...document.querySelectorAll(`#mapHost .map-node[data-id="${k}"] .map-label > tspan`)]
            .map((t) => (t.textContent || '').replace(/\u00a0/g, ' '))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim(),
        id,
      );
      expect(text, id).toBe(caption);
    }
    // `- [ ] 2. …` is a task (box drawn); `- 3. [ ] …` is plain text.
    const tasks = await page.evaluate(() => (window as any).__doc().nodes[0].children.map((n: any) => n.task ?? null));
    expect(tasks).toEqual([null, 'open', null, null]);
    // Round trip from the page keeps every number.
    const out: string = await page.evaluate(() => (window as any).__serialize());
    expect(out).toContain('- 1. Rake the leaves <id:rake>');
    expect(out).toContain('- [ ] 2. Prune the roses <id:roses>');
    expect(out).toContain('- 3. [ ] Oil the gate hinge <id:gate>');
    expect(out).toContain('- 12. Sweep the porch <id:porch>');
  });

  test('Outline rows show the number, not an ordered list', async ({ page }) => {
    await open(page, OUTLINE);
    for (const [id, caption] of CAPTIONS) {
      const title = page.locator(`#outlineHost [data-id="${id}"] .of-title`).first();
      await expect(title, id).toHaveText(caption);
    }
    expect(await page.locator('#outlineHost ol, #outlineHost li:not([role])').count()).toBe(0);
  });
});
