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

  test('right of the globe, centred on it; follows pan and zoom; outside click closes', async ({ page }) => {
    await open(page);
    const g = await clickGlobe(page, 'ext');
    const pop = page.locator(POP);
    const p = (await pop.boundingBox())!;
    const h = (await page.locator('#mapHost').boundingBox())!;
    expect(Math.abs(p.x - (g.x + g.width) - 8)).toBeLessThanOrEqual(1); // left is whole px
    expect(Math.abs(p.y + p.height / 2 - (g.y + g.height / 2))).toBeLessThanOrEqual(1);
    expect(p.y).toBeGreaterThanOrEqual(h.y + 8 - 0.5);
    expect(p.x + p.width).toBeLessThanOrEqual(h.x + h.width - 8 + 0.5);
    // Never over its own caption.
    const pill = (await page.locator('.map-node[data-id="ext"] .map-pill').boundingBox())!;
    expect(p.x).toBeGreaterThanOrEqual(pill.x + pill.width);
    // Camera moves: it stays beside the globe.
    await page.evaluate(() => {
      const m = (window as any).__map;
      m.cam.x -= 40;
      m.cam.y += 30;
      m.cam.k *= 1.2;
      m.applyCam();
    });
    const g2 = (await page.locator('.map-node[data-id="ext"] .map-link-hit').boundingBox())!;
    const p2 = (await pop.boundingBox())!;
    expect(Math.abs(g2.x - g.x)).toBeGreaterThan(5);
    expect(Math.abs(p2.x - (g2.x + g2.width) - 8)).toBeLessThanOrEqual(1); // left is whole px
    expect(Math.abs(p2.y + p2.height / 2 - (g2.y + g2.height / 2))).toBeLessThanOrEqual(1);
    // A click outside the map closes it.
    await page.mouse.click(5, 5);
    await expect(pop).toHaveCount(0);
    // A click on the canvas closes it too.
    await clickGlobe(page, 'ext');
    await expect(pop).toHaveCount(1);
    await page.mouse.click(h.x + 30, h.y + h.height - 30);
    await expect(pop).toHaveCount(0);
  });

  test('stays open through a drag pan and a wheel zoom, moving with the globe', async ({ page }) => {
    await open(page);
    await clickGlobe(page, 'ext');
    const pop = page.locator(POP);
    const h = (await page.locator('#mapHost').boundingBox())!;
    const k0 = await page.evaluate(() => (window as any).__map.cam.k);
    // Drag the canvas from an empty corner.
    const sx = h.x + 30, sy = h.y + h.height - 30;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(sx + i * 6, sy - i * 4);
    await page.mouse.up();
    await page.waitForTimeout(500);
    await expect(pop).toHaveCount(1);
    await expect(pop).not.toHaveClass(/is-closing/);
    let g = (await page.locator('.map-node[data-id="ext"] .map-link-hit').boundingBox())!;
    let p = (await pop.boundingBox())!;
    expect(Math.abs(p.x - (g.x + g.width) - 8)).toBeLessThanOrEqual(1); // left is whole px
    expect(Math.abs(p.y + p.height / 2 - (g.y + g.height / 2))).toBeLessThanOrEqual(1);
    // Pinch-style wheel zoom (Ctrl + wheel).
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    await page.waitForTimeout(400);
    await expect(pop).toHaveCount(1);
    expect(await page.evaluate(() => (window as any).__map.cam.k)).not.toBeCloseTo(k0, 3);
    g = (await page.locator('.map-node[data-id="ext"] .map-link-hit').boundingBox())!;
    p = (await pop.boundingBox())!;
    expect(Math.abs(p.x - (g.x + g.width) - 8)).toBeLessThanOrEqual(1); // left is whole px
    // A drag that starts outside the map does not close it either.
    await page.mouse.move(5, 5);
    await page.mouse.down();
    await page.mouse.move(60, 40, { steps: 5 });
    await page.mouse.up();
    await expect(pop).toHaveCount(1);
    // Tab closes it and focus goes back to the map.
    await page.locator(`${POP} .map-link-item`).first().focus();
    await page.keyboard.press('Tab');
    await expect(pop).toHaveCount(0);
    await expect(page.locator('#mapHost')).toBeFocused();
  });

  test('globe near the right edge: the camera pans just enough, zoom unchanged', async ({ page }) => {
    await open(page);
    const h = (await page.locator('#mapHost').boundingBox())!;
    // Put the globe 30 px from the map's right edge.
    await page.evaluate((hostRight) => {
      const m = (window as any).__map;
      const r = document.querySelector('.map-node[data-id="ext"] .map-link-hit')!.getBoundingClientRect();
      m.cam.x += hostRight - 30 - (r.left + r.width / 2);
      m.applyCam();
    }, h.x + h.width);
    const cam0 = await page.evaluate(() => ({ ...(window as any).__map.cam }));
    await clickGlobe(page, 'ext');
    const pop = page.locator(POP);
    await page.waitForTimeout(450);
    const cam1 = await page.evaluate(() => ({ ...(window as any).__map.cam }));
    expect(cam1.k).toBe(cam0.k);
    expect(cam1.x).toBeLessThan(cam0.x);
    expect(cam1.y).toBeCloseTo(cam0.y, 3);
    const g = (await page.locator('.map-node[data-id="ext"] .map-link-hit').boundingBox())!;
    const p = (await pop.boundingBox())!;
    // Still right of the globe, now exactly 8 px inside the right edge.
    expect(Math.abs(p.x - (g.x + g.width) - 8)).toBeLessThanOrEqual(1); // left is whole px
    expect(Math.abs(h.x + h.width - (p.x + p.width) - 8)).toBeLessThanOrEqual(1); // left is whole px
    expect(Math.abs(p.y + p.height / 2 - (g.y + g.height / 2))).toBeLessThanOrEqual(1);
  });

  test('reduced motion: the fitting pan is immediate', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    const h = (await page.locator('#mapHost').boundingBox())!;
    await page.evaluate((hostRight) => {
      const m = (window as any).__map;
      const r = document.querySelector('.map-node[data-id="ext"] .map-link-hit')!.getBoundingClientRect();
      m.cam.x += hostRight - 30 - (r.left + r.width / 2);
      m.applyCam();
    }, h.x + h.width);
    await clickGlobe(page, 'ext');
    // No animation frames needed: read straight away.
    const right = await page.evaluate(() => document.querySelector('.map-link-pop')!.getBoundingClientRect().right);
    expect(Math.abs(h.x + h.width - right - 8)).toBeLessThanOrEqual(1); // left is whole px
  });
});
