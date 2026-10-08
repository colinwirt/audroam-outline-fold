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

/** Globe, popover, pill and map rects read in one frame (no camera move in between). */
function geo(page: Page, id = 'ext') {
  return page.evaluate((nid) => {
    const r = (sel: string) => {
      const b = document.querySelector(sel)?.getBoundingClientRect();
      return b ? { l: b.left, t: b.top, r: b.right, b: b.bottom, cy: b.top + b.height / 2 } : null;
    };
    return {
      g: r(`.map-node[data-id="${nid}"] .map-link-hit`)!,
      p: r('.map-link-pop'),
      pill: r(`.map-node[data-id="${nid}"] .map-pill`)!,
      h: r('#mapHost')!,
      cam: { ...(window as any).__map.cam } as { x: number; y: number; k: number },
    };
  }, id);
}

/** Camera unchanged across 3 animation frames (glide and eases done). */
async function camSettled(page: Page) {
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
}

/** Right of the globe with an exact 8 px gap, centred on it. */
function besideGlobe(x: Awaited<ReturnType<typeof geo>>) {
  expect(x.p).not.toBeNull();
  expect(x.p!.l - x.g.r).toBeCloseTo(8, 1);
  expect(x.p!.cy - x.g.cy).toBeCloseTo(0, 1);
}

test.describe('link popover', () => {
  test('styled by classes like the level menu: surface, font, rows, no underline', async ({ page }) => {
    await open(page);
    await clickGlobe(page, 'ext');
    const pop = page.locator(POP);
    await expect(pop).toHaveCount(1);
    await expect(pop).toHaveAttribute('role', 'menu');
    // No inline paint: only left/top are set on the element (exact px, so CI fonts
    // can give a half pixel).
    const inline = await pop.evaluate((el) => (el as HTMLElement).style.cssText);
    const px = '-?\\d+(?:\\.\\d+)?px';
    expect(inline.replace(/\s/g, '')).toMatch(new RegExp(`^(left:${px};top:${px};|top:${px};left:${px};)$`));
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
    await clickGlobe(page, 'ext');
    const pop = page.locator(POP);
    await expect(pop).toHaveCount(1);
    const x = await geo(page);
    besideGlobe(x);
    expect(x.p!.t).toBeGreaterThanOrEqual(x.h.t + 8 - 0.01);
    expect(x.p!.r).toBeLessThanOrEqual(x.h.r - 8 + 0.01);
    // Never over its own caption.
    expect(x.p!.l).toBeGreaterThanOrEqual(x.pill.r);
    // Camera moves: it stays beside the globe.
    await page.evaluate(() => {
      const m = (window as any).__map;
      m.cam.x -= 40;
      m.cam.y += 30;
      m.cam.k *= 1.2;
      m.applyCam();
    });
    const y = await geo(page);
    expect(Math.abs(y.g.l - x.g.l)).toBeGreaterThan(5);
    besideGlobe(y);
    // A click outside the map closes it.
    await page.mouse.click(5, 5);
    await expect(pop).toHaveCount(0);
    // A click on the canvas closes it too.
    await clickGlobe(page, 'ext');
    await expect(pop).toHaveCount(1);
    await page.mouse.click(x.h.l + 30, x.h.b - 30);
    await expect(pop).toHaveCount(0);
  });

  test('gap stays exactly 8 px at fractional camera positions', async ({ page }) => {
    await open(page);
    await clickGlobe(page, 'ext');
    await expect(page.locator(POP)).toHaveCount(1);
    for (const f of [0, 0.25, 0.5, 0.75]) {
      await page.evaluate((frac) => {
        const m = (window as any).__map;
        m.cam.x = Math.floor(m.cam.x) + frac;
        m.cam.y = Math.floor(m.cam.y) + frac;
        m.applyCam();
      }, f);
      besideGlobe(await geo(page));
    }
  });

  test('stays open through a drag pan and a wheel zoom, moving with the globe', async ({ page }) => {
    await open(page);
    await clickGlobe(page, 'ext');
    const pop = page.locator(POP);
    await expect(pop).toHaveCount(1);
    const x0 = await geo(page);
    // Drag the canvas from an empty corner.
    const sx = x0.h.l + 30, sy = x0.h.b - 30;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(sx + i * 6, sy - i * 4);
    await page.mouse.up();
    await camSettled(page);
    await expect(pop).toHaveCount(1);
    await expect(pop).not.toHaveClass(/is-closing/);
    const x1 = await geo(page);
    expect(Math.abs(x1.cam.x - x0.cam.x)).toBeGreaterThan(20);
    besideGlobe(x1);
    // Pinch-style wheel zoom (Ctrl + wheel).
    await page.mouse.move((x0.h.l + x0.h.r) / 2, (x0.h.t + x0.h.b) / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await geo(page)).cam.k).not.toBeCloseTo(x1.cam.k, 3);
    await camSettled(page);
    await expect(pop).toHaveCount(1);
    besideGlobe(await geo(page));
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
    await expect(page.locator(POP)).toHaveCount(1);
    // The fitting pan has run once the popover is inside the right edge.
    await expect.poll(async () => { const g = await geo(page); return g.h.r - g.p!.r; }).toBeGreaterThan(7.9);
    await camSettled(page);
    const x = await geo(page);
    expect(x.cam.k).toBe(cam0.k);
    expect(x.cam.y).toBeCloseTo(cam0.y, 3);
    // Still right of the globe, now exactly 8 px inside the right edge.
    besideGlobe(x);
    expect(x.h.r - x.p!.r).toBeCloseTo(8, 1);
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
    const x = await geo(page);
    expect(x.h.r - x.p!.r).toBeCloseTo(8, 1);
    besideGlobe(x);
  });
});
