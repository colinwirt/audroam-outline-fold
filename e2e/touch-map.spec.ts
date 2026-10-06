import { test, expect, type Page } from '@playwright/test';
import { Touch, box, centre, cam, type Box } from './touch';

/**
 * 0.2.30 single-tap activation on touch (brief item 1) + the pinch amendment
 * regression. Runs in the touch-pixel and touch-iphone projects (Chromium,
 * hasTouch, CDP touch events). Host: examples/e2e-touch (package
 * mountMapControls inside the map host, onChange repaints).
 */

const HARNESS = 'examples/e2e-touch/index.html';
const ZOOM_IN = '.of-map-controls button[aria-label="Zoom in"]';
const ZOOM_OUT = '.of-map-controls button[aria-label="Zoom out"]';
const FIT = '.of-map-controls button[aria-label="Fit"]';

type Ctx = { page: Page; t: Touch; host: Box; bg: { x: number; y: number }; fitCam: { x: number; y: number; k: number } };

async function open(page: Page): Promise<Ctx> {
  await page.goto(HARNESS);
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(150);
  const t = await Touch.attach(page);
  const host = await box(page, '#mapHost');
  const fitCam = await cam(page);
  // A background point clear of pills and controls, with room to pan left/up.
  const bg = await page.evaluate((h) => {
    for (const [fx, fy] of [[0.9, 0.92], [0.85, 0.85], [0.92, 0.7], [0.7, 0.95], [0.5, 0.95]]) {
      const x = h.x + h.w * fx;
      const y = h.y + h.h * fy;
      const el = document.elementFromPoint(x, y);
      if (el && !el.closest('.map-node, .of-map-controls, .map-width-pop')) return { x, y };
    }
    return null;
  }, host);
  expect(bg, 'found an empty background point').not.toBeNull();
  return { page, t, host, bg: bg!, fitCam };
}

async function tapSel(c: Ctx, sel: string): Promise<{ x: number; y: number }> {
  const p = centre(await box(c.page, sel));
  await c.t.tap(p.x, p.y);
  return p;
}

type Zoom = { f: number; before: number; after: number };
const zooms = (page: Page): Promise<Zoom[]> => page.evaluate(() => (window as any).__zooms);

/** n activations, each ×f on the camera shown at that moment, and nothing overwrote the last one. */
async function expectZoomSteps(page: Page, n: number, f: number): Promise<void> {
  await page.waitForTimeout(450);
  const z = await zooms(page);
  expect(z.length, `−/+ activations (${JSON.stringify(z)})`).toBe(n);
  for (const s of z) expect(s.after / s.before, 'each tap is one ×1.2 step').toBeCloseTo(f, 4);
  const c = await cam(page);
  expect(c.k, 'no animation frame overwrote the zoom').toBeCloseTo(z[z.length - 1].after, 6);
}

/** Zoom in programmatically first so − has room above the content floor. */
async function roomToZoomOut(c: Ctx): Promise<void> {
  await c.page.evaluate((h) => {
    (window as any).__map.zoomAt(h.x + h.w / 2, h.y + h.h / 2, 2.5);
  }, c.host);
  await c.page.waitForTimeout(50);
}

const BUTTONS: [string, string, number][] = [
  ['+', ZOOM_IN, 1.2],
  ['−', ZOOM_OUT, 1 / 1.2],
];

for (const [name, sel, f] of BUTTONS) {
  test.describe(`${name} single tap`, () => {
    test(`(a) fresh tap → one ×1.2 step`, async ({ page }) => {
      const c = await open(page);
      if (f < 1) await roomToZoomOut(c);
      await tapSel(c, sel);
      await expectZoomSteps(page, 1, f);
    });

    test(`(b) 60 ms after a slow pan (spring-back running) → one step`, async ({ page }) => {
      const c = await open(page);
      if (f < 1) await roomToZoomOut(c);
      await c.t.slowPan(c.bg.x, c.bg.y);
      await page.waitForTimeout(60);
      await tapSel(c, sel);
      await expectZoomSteps(page, 1, f);
    });

    for (const delay of [60, 200]) {
      test(`(c) ${delay} ms after a fling → one step`, async ({ page }) => {
        const c = await open(page);
        if (f < 1) await roomToZoomOut(c);
        await c.t.fling(c.bg.x, c.bg.y);
        await page.waitForTimeout(delay);
        await tapSel(c, sel);
        await expectZoomSteps(page, 1, f);
      });
    }

    test(`(d) straight after Fit (during its animation) → one step`, async ({ page }) => {
      const c = await open(page);
      await roomToZoomOut(c);
      await tapSel(c, FIT);
      await page.waitForTimeout(40);
      await tapSel(c, sel);
      await expectZoomSteps(page, 1, f);
      expect(await page.evaluate(() => (window as any).__fits)).toBe(1);
    });

    test(`(e) 4 taps 150 ms apart → 4 steps`, async ({ page }) => {
      const c = await open(page);
      if (f < 1) await roomToZoomOut(c);
      const k0 = (await cam(page)).k;
      for (let i = 0; i < 4; i++) {
        await tapSel(c, sel);
        await page.waitForTimeout(150);
      }
      await expectZoomSteps(page, 4, f);
      expect((await cam(page)).k).toBeCloseTo(k0 * Math.pow(f, 4), 4);
    });

    test(`(f) fast double-tap → exactly 2 steps, no page zoom`, async ({ page }) => {
      const c = await open(page);
      if (f < 1) await roomToZoomOut(c);
      const p = centre(await box(page, sel));
      await c.t.tap(p.x, p.y, 20);
      await page.waitForTimeout(60);
      await c.t.tap(p.x, p.y, 20);
      await expectZoomSteps(page, 2, f);
      expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
    });
  });
}

test.describe('Fit single tap', () => {
  for (const pre of ['fresh', 'after a slow pan', 'after a fling'] as const) {
    test(`one tap starts the fit (${pre})`, async ({ page }) => {
      const c = await open(page);
      await roomToZoomOut(c);
      if (pre === 'after a slow pan') {
        await c.t.slowPan(c.bg.x, c.bg.y);
        await page.waitForTimeout(60);
      } else if (pre === 'after a fling') {
        await c.t.fling(c.bg.x, c.bg.y);
        await page.waitForTimeout(60);
      }
      await tapSel(c, FIT);
      await page.waitForTimeout(450);
      expect(await page.evaluate(() => (window as any).__fits)).toBe(1);
      const now = await cam(page);
      expect(now.k).toBeCloseTo(c.fitCam.k, 4);
      expect(Math.abs(now.x - c.fitCam.x)).toBeLessThan(1);
      expect(Math.abs(now.y - c.fitCam.y)).toBeLessThan(1);
    });
  }
});

test.describe('controls inside the host', () => {
  test('a tap on a control is not a map gesture (no capture, no double-tap zoom of the map)', async ({ page }) => {
    const c = await open(page);
    const k0 = (await cam(page)).k;
    // Two quick taps on Fit: if the host treated them as background taps it
    // would double-tap zoom ×2. Fit keeps the fit camera.
    const p = centre(await box(page, FIT));
    await c.t.tap(p.x, p.y, 20);
    await page.waitForTimeout(80);
    await c.t.tap(p.x, p.y, 20);
    await page.waitForTimeout(450);
    expect(await page.evaluate(() => (window as any).__fits)).toBe(2);
    expect((await cam(page)).k).toBeCloseTo(k0, 4);
  });

  test('controls survive a repaint', async ({ page }) => {
    const c = await open(page);
    await page.evaluate(() => (window as any).__map.paint());
    await expect(page.locator('#mapHost .of-map-controls')).toHaveCount(1);
    await tapSel(c, ZOOM_IN);
    await expectZoomSteps(page, 1, 1.2);
  });
});

// ── Map taps after pan / pinch (C1) ────────────────────────────────────────

const expanded = (page: Page, id: string) =>
  page.evaluate((i) => document.querySelector(`.map-node[data-id="${i}"]`)?.getAttribute('aria-expanded'), id);

async function pinchIn(c: Ctx): Promise<void> {
  const m = { x: c.host.x + c.host.w / 2, y: c.host.y + c.host.h * 0.7 };
  await c.t.start([{ x: m.x - 30, y: m.y, id: 0 }, { x: m.x + 30, y: m.y, id: 1 }]);
  for (let i = 1; i <= 8; i++) {
    await c.t.move([{ x: m.x - 30 - i * 2, y: m.y, id: 0 }, { x: m.x + 30 + i * 2, y: m.y, id: 1 }]);
    await c.page.waitForTimeout(16);
  }
  await c.t.end();
}

type Pre = 'fresh' | 'slow pan' | 'fling' | 'pinch';

async function pre(c: Ctx, kind: Pre): Promise<void> {
  if (kind === 'slow pan') await c.t.slowPan(c.bg.x, c.bg.y);
  if (kind === 'fling') await c.t.fling(c.bg.x, c.bg.y);
  if (kind === 'pinch') await pinchIn(c);
  // Let spring-back / glide finish so the target is where we read it.
  if (kind !== 'fresh') {
    await c.page.waitForTimeout(kind === 'slow pan' ? 1000 : 400);
    await waitStill(c.page);
  }
  if (kind === 'fling') {
    // On a phone-width panel the glide can carry the target off screen. Put
    // the camera back without a gesture (no pointer events, swallow state
    // untouched) so the tap can reach it.
    await c.page.evaluate((f) => {
      const m = (window as any).__map;
      m.panBy(0, 0); // public API: stops any glide / spring-back still running
      Object.assign(m.cam, f);
      m.applyCam();
    }, c.fitCam);
    await c.page.waitForTimeout(50);
  }
}

/** Wait until the camera stops moving (a fling glide can run > 1 s). */
async function waitStill(page: Page): Promise<void> {
  let prev = await cam(page);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(100);
    const now = await cam(page);
    if (now.x === prev.x && now.y === prev.y && now.k === prev.k) return;
    prev = now;
  }
}

test.describe('next single tap after a pan or pinch activates', () => {
  for (const kind of ['fresh', 'slow pan', 'fling', 'pinch'] as Pre[]) {
    test(`fold handle (${kind})`, async ({ page }) => {
      const c = await open(page);
      await pre(c, kind);
      expect(await expanded(page, 'tasks')).toBe('true');
      await tapSel(c, '.map-node[data-id="tasks"] .map-fold-hit');
      await expect.poll(() => expanded(page, 'tasks')).toBe('false');
    });
  }

  test('fold handle inside the 400 ms swallow window after a slow pan', async ({ page }) => {
    const c = await open(page);
    await c.t.slowPan(c.bg.x, c.bg.y);
    await page.waitForTimeout(250);
    // The tap's own pointerdown ends the pan's swallow.
    await tapSel(c, '.map-node[data-id="tasks"] .map-fold-hit');
    await expect.poll(() => expanded(page, 'tasks')).toBe('false');
  });

  for (const kind of ['slow pan', 'fling', 'pinch'] as Pre[]) {
    test(`task box (${kind})`, async ({ page }) => {
      const c = await open(page);
      await pre(c, kind);
      await tapSel(c, '.map-node[data-id="t2"] .map-task-hit');
      await expect.poll(() => page.evaluate(() => (window as any).__tasks.length)).toBe(1);
    });

    test(`globe (${kind})`, async ({ page }) => {
      const c = await open(page);
      await pre(c, kind);
      await tapSel(c, '.map-node[data-id="view"] .map-link-hit');
      await expect(page.locator('.map-link-pop')).toHaveCount(1);
    });

    test(`#N chip (${kind})`, async ({ page }) => {
      const c = await open(page);
      await pre(c, kind);
      await tapSel(c, '.map-node[data-id="note"] .map-note-link-hit');
      await expect.poll(() => page.evaluate(() => (window as any).__notes.map((n: any) => n.pnid))).toEqual(['1004']);
    });
  }
});

// ── In-map handles on touch pointerup (C3 on the map) ──────────────────────
// After a fling Chromium drops the click on the next tap for a few hundred
// ms. Handles activate on pointerup, so the tap still lands, exactly once.

type Handle = { name: string; sel: string; count: (page: Page) => Promise<number> };

const HANDLES: Handle[] = [
  {
    name: 'fold handle',
    sel: '.map-node[data-id="tasks"] .map-fold-hit',
    // Toggled an odd number of times → collapsed. Two activations would reopen it.
    count: async (page) => ((await expanded(page, 'tasks')) === 'false' ? 1 : 0),
  },
  {
    name: 'task box',
    sel: '.map-node[data-id="t2"] .map-task-hit',
    count: (page) => page.evaluate(() => (window as any).__tasks.length),
  },
  {
    name: 'globe',
    sel: '.map-node[data-id="view"] .map-link-hit',
    count: (page) => page.locator('.map-link-pop').count(),
  },
  {
    name: '#N chip',
    sel: '.map-node[data-id="note"] .map-note-link-hit',
    count: (page) => page.evaluate(() => (window as any).__notes.length),
  },
  {
    name: 'thread chip',
    sel: '.map-node[data-id="disc"] .map-thread-hit',
    count: (page) => page.evaluate(() => (window as any).__threads.length),
  },
];

/** Stop the glide and put the camera back at Fit without a gesture (swallow state untouched). */
async function recentre(c: Ctx): Promise<void> {
  await c.page.evaluate((f) => {
    const m = (window as any).__map;
    m.panBy(0, 0);
    Object.assign(m.cam, f);
    m.applyCam();
  }, c.fitCam);
}

test.describe('in-map handle: one tap shortly after a fling', () => {
  for (const h of HANDLES) {
    for (const delay of [60, 200]) {
      test(`${h.name} ${delay} ms after a fling → activates once`, async ({ page }) => {
        const c = await open(page);
        expect(await h.count(page)).toBe(0);
        await c.t.fling(c.bg.x, c.bg.y);
        const lifted = Date.now();
        await recentre(c);
        const p = centre(await box(page, h.sel));
        const wait = lifted + delay - Date.now();
        if (wait > 0) await page.waitForTimeout(wait);
        await c.t.tap(p.x, p.y, 20);
        await expect.poll(() => h.count(page), { timeout: 2000 }).toBe(1);
        // The click that may follow must not activate it a second time.
        await page.waitForTimeout(900);
        expect(await h.count(page)).toBe(1);
      });
    }
  }

  test('a drag that starts on a handle pans and does not activate it', async ({ page }) => {
    const c = await open(page);
    const p = centre(await box(page, '.map-node[data-id="tasks"] .map-fold-hit'));
    await c.t.start([{ x: p.x, y: p.y }]);
    for (let i = 1; i <= 8; i++) {
      await c.t.move([{ x: p.x - i * 4, y: p.y }]);
      await page.waitForTimeout(16);
    }
    await c.t.end();
    await page.waitForTimeout(500);
    expect(await expanded(page, 'tasks')).toBe('true');
  });
});

test.describe('only the gesture’s own click is swallowed', () => {
  /** Dispatch a click that did not come with a pointerdown (like the one a pan can produce). */
  async function bareClickOnFold(page: Page, x: number, y: number): Promise<void> {
    await page.evaluate(({ x, y }) => {
      const el = document.querySelector('.map-node[data-id="tasks"] .map-fold-hit')!;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1 }));
    }, { x, y });
  }

  async function panAndRelease(c: Ctx): Promise<{ x: number; y: number }> {
    await c.t.slowPan(c.bg.x, c.bg.y);
    return { x: c.bg.x - 40, y: c.bg.y - 20 };
  }

  test('a click at the release point within 400 ms is swallowed', async ({ page }) => {
    const c = await open(page);
    const rel = await panAndRelease(c);
    await bareClickOnFold(page, rel.x, rel.y);
    await page.waitForTimeout(100);
    expect(await expanded(page, 'tasks')).toBe('true');
    // One-shot: the next bare click is delivered.
    await bareClickOnFold(page, rel.x, rel.y);
    await expect.poll(() => expanded(page, 'tasks')).toBe('false');
  });

  test('a click more than 400 ms later is delivered', async ({ page }) => {
    const c = await open(page);
    const rel = await panAndRelease(c);
    await page.waitForTimeout(450);
    await bareClickOnFold(page, rel.x, rel.y);
    await expect.poll(() => expanded(page, 'tasks')).toBe('false');
  });

  test('a click more than 30 px away is delivered', async ({ page }) => {
    const c = await open(page);
    const rel = await panAndRelease(c);
    await bareClickOnFold(page, rel.x - 60, rel.y);
    await expect.poll(() => expanded(page, 'tasks')).toBe('false');
  });

  test('a click after a new pointerdown is delivered', async ({ page }) => {
    const c = await open(page);
    const rel = await panAndRelease(c);
    await page.evaluate(() => {
      const host = document.getElementById('mapHost')!;
      host.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerType: 'mouse', button: 3 }));
    });
    await bareClickOnFold(page, rel.x, rel.y);
    await expect.poll(() => expanded(page, 'tasks')).toBe('false');
  });

  test('blur does not leave the swallow armed', async ({ page }) => {
    const c = await open(page);
    const rel = await panAndRelease(c);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await bareClickOnFold(page, rel.x, rel.y);
    await expect.poll(() => expanded(page, 'tasks')).toBe('false');
  });
});

// ── Resize popover (C4/C5) ─────────────────────────────────────────────────

async function tapToFocus(c: Ctx, id: string): Promise<void> {
  const pill = await box(c.page, `.map-node[data-id="${id}"] .map-pill`);
  await c.t.tap(pill.x + Math.min(24, pill.w / 3), pill.y + pill.h / 2);
  await expect.poll(() => c.page.evaluate(() => (window as any).__focus())).toBe(id);
  await c.page.waitForTimeout(450);
}

/** Tap the bottom-right corner of the focused pill. Returns the touch point. */
async function openPop(c: Ctx, id: string): Promise<{ x: number; y: number }> {
  const pill = await box(c.page, `.map-node[data-id="${id}"] .map-pill`);
  const pt = { x: pill.x + pill.w - 3, y: pill.y + pill.h - 3 };
  await c.t.tap(pt.x, pt.y);
  await expect(c.page.locator('.map-width-pop')).toHaveCount(1);
  return pt;
}

async function expectPopInside(c: Ctx, touch: { x: number; y: number }): Promise<void> {
  const host = await box(c.page, '#mapHost');
  const pop = await box(c.page, '.map-width-pop');
  expect(pop.x, 'popover left inset').toBeGreaterThanOrEqual(host.x + 7.5);
  expect(pop.y, 'popover top inset').toBeGreaterThanOrEqual(host.y + 7.5);
  expect(pop.x + pop.w, 'popover right inset').toBeLessThanOrEqual(host.x + host.w - 7.5);
  expect(pop.y + pop.h, 'popover bottom inset').toBeLessThanOrEqual(host.y + host.h - 7.5);
  const under =
    touch.x >= pop.x && touch.x <= pop.x + pop.w && touch.y >= pop.y && touch.y <= pop.y + pop.h;
  expect(under, 'popover is not under the touch point').toBe(false);
  const sizes = await c.page.evaluate(() =>
    [...document.querySelectorAll('.map-width-pop button')].map((b) => {
      const r = b.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }),
  );
  expect(sizes).toHaveLength(3);
  for (const s of sizes) {
    expect(s.h).toBeGreaterThanOrEqual(44);
    expect(s.w).toBeGreaterThanOrEqual(44);
  }
}

const textW = (page: Page, id: string) =>
  page.evaluate((i) => Number(document.querySelector(`.map-node[data-id="${i}"]`)!.getAttribute('data-text-w')), id);
const storedW = (page: Page, id: string) =>
  page.evaluate((i) => (window as any).__layout().nodes?.[i]?.w ?? null, id);
const checked = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.map-width-pop [role="menuitemradio"]')]
      .filter((b) => b.getAttribute('aria-checked') === 'true')
      .map((b) => b.textContent),
  );

async function choose(c: Ctx, label: 'slim' | 'wider' | 'auto'): Promise<void> {
  // Find the item by its text (works with or without the ✓ mark).
  const b = await c.page.evaluate((l) => {
    const btn = [...document.querySelectorAll('.map-width-pop button')].find((x) =>
      (x.textContent || '').toLowerCase().includes(l),
    );
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label);
  expect(b, `popover item ${label}`).not.toBeNull();
  await c.t.tap(b!.x, b!.y);
  await expect(c.page.locator('.map-width-pop')).toHaveCount(0);
}

test.describe('resize popover: each choice applies on the first tap', () => {
  for (const kind of ['fresh', 'slow pan', 'fling'] as const) {
    test(`Slim, Wider, Auto (${kind})`, async ({ page }) => {
      const c = await open(page);
      await tapToFocus(c, 'view');
      for (const label of ['slim', 'wider', 'auto'] as const) {
        const w0 = await textW(page, 'view');
        if (kind === 'slow pan') {
          await c.t.slowPan(c.bg.x, c.bg.y);
          await page.waitForTimeout(400);
        } else if (kind === 'fling') {
          await c.t.fling(c.bg.x, c.bg.y);
          await page.waitForTimeout(60);
        }
        const t0 = Date.now();
        const touch = await openPop(c, 'view');
        await expectPopInside(c, touch);
        await choose(c, label);
        if (kind === 'fling') expect(Date.now() - t0, 'choice tapped soon after the fling').toBeLessThan(1500);
        const w = await storedW(page, 'view');
        if (label === 'auto') expect(w).toBeNull();
        else expect(w).toBe(Math.max(120, Math.round(w0 + (label === 'slim' ? -56 : 56))));
      }
    });
  }

  test('marks the current choice (Auto when no stored width)', async ({ page }) => {
    const c = await open(page);
    await tapToFocus(c, 'view');
    await openPop(c, 'view');
    expect(await checked(page)).toEqual(['✓ Auto']);
    await choose(c, 'slim');
    await openPop(c, 'view');
    expect(await checked(page)).toEqual(['✓ Slim']);
  });

  test('stays open and inside the panel across map.paint()', async ({ page }) => {
    const c = await open(page);
    await tapToFocus(c, 'view');
    const touch = await openPop(c, 'view');
    await page.evaluate(() => (window as any).__map.paint());
    await page.evaluate(() => (window as any).__map.paint());
    await expect(page.locator('.map-width-pop')).toHaveCount(1);
    await expectPopInside(c, touch);
    const w0 = await textW(page, 'view');
    await choose(c, 'wider');
    expect(await storedW(page, 'view')).toBe(Math.min(1400, Math.round(w0 + 56)));
  });

  for (const edge of ['right', 'bottom'] as const) {
    test(`pill at the ${edge} edge: popover fully inside the panel, not under the finger`, async ({ page }) => {
      const c = await open(page);
      await tapToFocus(c, 'view');
      // Move the camera so the pill's corner sits ~6 px from that panel edge.
      const pill = await box(page, '.map-node[data-id="view"] .map-pill');
      const host = c.host;
      const dx = edge === 'right' ? host.x + host.w - 6 - (pill.x + pill.w) : 0;
      const dy = edge === 'bottom' ? host.y + host.h - 6 - (pill.y + pill.h) : 0;
      await page.evaluate(({ dx, dy }) => {
        const m = (window as any).__map;
        m.cam.x += dx;
        m.cam.y += dy;
        m.applyCam();
      }, { dx, dy });
      const touch = await openPop(c, 'view');
      await expectPopInside(c, touch);
      await choose(c, 'slim');
      expect(await storedW(page, 'view')).not.toBeNull();
    });
  }
});

// ── Pinch amendment regression (gesture spec 2026-10-05, Colin) ────────────

test.describe('pinch amendment unchanged', () => {
  test('lift one finger: no jump, survivor does not pan; last lift: zero camera motion', async ({ page }) => {
    const c = await open(page);
    const m = { x: c.host.x + c.host.w / 2, y: c.host.y + c.host.h / 2 };
    const A = { x: m.x - 40, y: m.y, id: 0 };
    const B = { x: m.x + 40, y: m.y, id: 1 };
    await c.t.start([A, B]);
    for (let i = 1; i <= 8; i++) {
      await c.t.move([{ ...A, x: A.x - i * 2 }, { ...B, x: B.x + i * 2 }]);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(50);
    const pinched = await cam(page);
    expect(pinched.k, 'the pinch zoomed').toBeGreaterThan(c.fitCam.k * 1.05);
    // Lift B: A stays down.
    const a = { ...A, x: A.x - 16 };
    await c.t.lift([{ ...B, x: B.x + 16 }]);
    await page.waitForTimeout(50);
    const afterLift = await cam(page);
    expect(afterLift.k).toBeCloseTo(pinched.k, 6);
    expect(Math.abs(afterLift.x - pinched.x), 'no jump on lift').toBeLessThan(1);
    expect(Math.abs(afterLift.y - pinched.y), 'no jump on lift').toBeLessThan(1);
    // The survivor moves fast, like a fling: the map must not pan.
    for (let i = 1; i <= 6; i++) {
      await c.t.move([{ ...a, x: a.x - i * 16, y: a.y - i * 3 }]);
      await page.waitForTimeout(8);
    }
    await page.waitForTimeout(30);
    const survivor = await cam(page);
    expect(Math.abs(survivor.x - afterLift.x), 'survivor does not pan').toBeLessThan(0.5);
    expect(Math.abs(survivor.y - afterLift.y), 'survivor does not pan').toBeLessThan(0.5);
    await c.t.end();
    const atLift = await cam(page);
    await page.waitForTimeout(700);
    const later = await cam(page);
    expect(later.x, 'zero camera motion after the last finger lifts').toBe(atLift.x);
    expect(later.y, 'zero camera motion after the last finger lifts').toBe(atLift.y);
    expect(later.k).toBe(atLift.k);

    // A fresh one-finger drag pans again.
    const before = await cam(page);
    const s = { x: m.x, y: m.y + 60 };
    await c.t.start([s]);
    for (let i = 1; i <= 10; i++) {
      await c.t.move([{ x: s.x + i * 4, y: s.y + i * 2 }]);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(30);
    const panned = await cam(page);
    await c.t.end();
    expect(Math.hypot(panned.x - before.x, panned.y - before.y), 'fresh drag pans').toBeGreaterThan(5);
  });

  test('second finger mid-pan → pinch with no jump, no glide after', async ({ page }) => {
    const c = await open(page);
    await roomToZoomOut(c);
    const s = { x: c.host.x + c.host.w * 0.4, y: c.host.y + c.host.h * 0.6, id: 0 };
    await c.t.start([s]);
    let a = s;
    for (let i = 1; i <= 8; i++) {
      a = { ...s, x: s.x + i * 4 };
      await c.t.move([a]);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(40);
    const panned = await cam(page);
    const b = { x: a.x + 80, y: a.y, id: 1 };
    await c.t.start([a, b]);
    await page.waitForTimeout(16);
    await c.t.move([a, { ...b, x: b.x + 1 }]);
    await page.waitForTimeout(40);
    const landed = await cam(page);
    expect(landed.k).toBeCloseTo(panned.k, 6);
    expect(Math.abs(landed.x - panned.x), 'no jump when the second finger lands').toBeLessThan(1.5);
    expect(Math.abs(landed.y - panned.y), 'no jump when the second finger lands').toBeLessThan(1.5);
    // Pinch with both, then fast-move both and lift together: no glide.
    for (let i = 1; i <= 6; i++) {
      await c.t.move([{ ...a, x: a.x - i * 16 }, { ...b, x: b.x - i * 16 + i * 3 }]);
      await page.waitForTimeout(8);
    }
    await c.t.end();
    await page.waitForTimeout(80);
    const atLift = await cam(page);
    await page.waitForTimeout(700);
    const later = await cam(page);
    expect(Math.abs(later.x - atLift.x), 'no glide from a two-finger gesture').toBeLessThan(0.5);
    expect(Math.abs(later.y - atLift.y), 'no glide from a two-finger gesture').toBeLessThan(0.5);
  });
});
