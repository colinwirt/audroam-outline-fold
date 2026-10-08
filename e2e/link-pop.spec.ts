import { test, expect, type Page } from '@playwright/test';

/**
 * Map link popover (globe badge), 0.2.33: class-based styling in the
 * fold-level menu's language, menu rows with the destination muted, keys,
 * Esc, hop links, outside click, placement inside the panel.
 * Host: examples/e2e-touch with links.md.
 */

const HARNESS = 'examples/e2e-touch/index.html?doc=links.md';
const POP = '.map-link-pop';

async function open(page: Page) {
  await page.goto(HARNESS);
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(150);
}

async function clickGlobe(page: Page, id: string) {
  const b = (await page.locator(`.map-node[data-id="${id}"] .map-link-hit`).boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  return b;
}

const rows = (page: Page) =>
  page.locator(`${POP} .map-link-item`).evaluateAll((els) =>
    els.map((a) => ({
      label: a.querySelector('.map-link-label')?.textContent,
      where: a.querySelector('.map-link-where')?.textContent ?? null,
      role: a.getAttribute('role'),
      target: a.getAttribute('target'),
      rel: a.getAttribute('rel'),
    })),
  );

test.describe('link popover', () => {
  test('styled by classes like the level menu: surface, font, rows, no underline', async ({ page }) => {
    await open(page);
    await clickGlobe(page, 'ext');
    const pop = page.locator(POP);
    await expect(pop).toHaveCount(1);
    await expect(pop).toHaveAttribute('role', 'menu');
    // No inline paint: only left/top are set on the element.
    const inline = await pop.evaluate((el) => (el as HTMLElement).style.cssText);
    expect(inline.replace(/\s/g, '')).toMatch(/^(left:\d+px;top:\d+px;|top:\d+px;left:\d+px;)$/);
    const item = page.locator(`${POP} .map-link-item`).first();
    expect(await item.getAttribute('style')).toBeNull();
    // Same surface as .map-level-menu, read from the stylesheet.
    const look = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'map-level-menu';
      document.querySelector('#mapHost')!.appendChild(probe);
      const keys = ['backgroundColor', 'borderTopColor', 'borderTopLeftRadius', 'boxShadow', 'fontFamily', 'fontSize', 'paddingTop'] as const;
      const pick = (el: Element) => {
        const cs = getComputedStyle(el);
        return Object.fromEntries(keys.map((k) => [k, cs[k]]));
      };
      const menu = pick(probe);
      probe.remove();
      const pop = pick(document.querySelector('.map-link-pop')!);
      const a = getComputedStyle(document.querySelector('.map-link-item')!);
      return { menu, pop, item: { decoration: a.textDecorationLine, family: a.fontFamily, color: a.color, h: (document.querySelector('.map-link-item') as HTMLElement).offsetHeight } };
    });
    expect(look.pop).toEqual(look.menu);
    expect(look.pop.fontFamily).not.toMatch(/mono/i);
    expect(look.item.decoration).toBe('none');
    expect(look.item.family).not.toMatch(/mono/i);
    expect(look.item.h).toBeGreaterThanOrEqual(32);
  });

  test('rows: label, then the host for external links; hop link shows only its label', async ({ page }) => {
    await open(page);
    await clickGlobe(page, 'ext');
    expect(await rows(page)).toEqual([
      { label: 'Open', where: 'example.org', role: 'menuitem', target: '_blank', rel: 'noopener noreferrer' },
    ]);
    await page.keyboard.press('Escape');
    await expect(page.locator(POP)).toHaveCount(0);
    await clickGlobe(page, 'multi');
    expect(await rows(page)).toEqual([
      { label: 'Agenda', where: 'agenda.example.org', role: 'menuitem', target: '_blank', rel: 'noopener noreferrer' },
      { label: 'Minutes', where: 'levels.md', role: 'menuitem', target: '_blank', rel: 'noopener noreferrer' },
      { label: 'Plants', where: null, role: 'menuitem', target: null, rel: null },
    ]);
  });

  test('keys: first link focused, arrows move, Esc closes with a fade and focus returns to the map', async ({ page }) => {
    await open(page);
    await clickGlobe(page, 'multi');
    const items = page.locator(`${POP} .map-link-item`);
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(items.nth(2)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(items.nth(2)).toBeFocused();
    await page.keyboard.press('Escape');
    // Fading (180 ms), then gone.
    await expect(page.locator(`${POP}.is-closing`)).toHaveCount(1);
    await expect(page.locator(POP)).toHaveCount(0);
    await expect(page.locator('#mapHost')).toBeFocused();
  });

  test('hop link selects its node and closes; Enter follows it', async ({ page }) => {
    await open(page);
    await clickGlobe(page, 'multi');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(page.locator(POP)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).__focus())).toBe('plants');
    await expect(page.locator('#mapHost')).toBeFocused();
  });

  test('outside click closes; placed like the level menu, inside the panel', async ({ page }) => {
    await open(page);
    const g = await clickGlobe(page, 'ext');
    const p = (await page.locator(POP).boundingBox())!;
    const h = (await page.locator('#mapHost').boundingBox())!;
    // Centred on the globe (unless clamped), 10 px above it, or flipped below.
    const below = (await page.locator(POP).getAttribute('data-below')) === 'true';
    if (below) expect(p.y).toBeCloseTo(g.y + g.height + 10, 0);
    else expect(p.y + p.height).toBeCloseTo(g.y - 10, 0);
    const cx = Math.min(Math.max(g.x + g.width / 2, h.x + 8 + p.width / 2), h.x + h.width - 8 - p.width / 2);
    expect(Math.abs(p.x + p.width / 2 - cx)).toBeLessThanOrEqual(1);
    expect(p.x).toBeGreaterThanOrEqual(h.x + 8 - 0.5);
    expect(p.x + p.width).toBeLessThanOrEqual(h.x + h.width - 8 + 0.5);
    // A click outside the map closes it.
    await page.mouse.click(5, 5);
    await expect(page.locator(POP)).toHaveCount(0);
    // A click on the canvas closes it too.
    await clickGlobe(page, 'ext');
    await expect(page.locator(POP)).toHaveCount(1);
    await page.mouse.click(h.x + h.width - 30, h.y + h.height - 30);
    await expect(page.locator(POP)).toHaveCount(0);
  });
});
