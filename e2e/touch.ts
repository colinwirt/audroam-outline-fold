import { expect, type CDPSession, type Page } from '@playwright/test';

/**
 * CDP touch helpers for the touch projects (0.2.30). Input.dispatchTouchEvent
 * diffs against the previous event: touchStart / touchMove list the active
 * points (a point left out of a touchMove just stays put), touchEnd with
 * points releases those points, and touchEnd with none releases all.
 */
export type TouchPt = { x: number; y: number; id?: number };

export class Touch {
  private constructor(
    private readonly page: Page,
    private readonly cdp: CDPSession,
  ) {}

  static async attach(page: Page): Promise<Touch> {
    const cdp = await page.context().newCDPSession(page);
    return new Touch(page, cdp);
  }

  private pts(points: TouchPt[]) {
    return points.map((p, i) => ({
      x: p.x,
      y: p.y,
      id: p.id ?? i,
      radiusX: 4,
      radiusY: 4,
      force: 1,
    }));
  }

  async start(points: TouchPt[]): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.pts(points) });
  }

  async move(points: TouchPt[]): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.pts(points) });
  }

  /** Release only these fingers (the rest stay down). */
  async lift(points: TouchPt[]): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: this.pts(points) });
  }

  /** Release every finger. */
  async end(): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  /** Single-finger tap through CDP (same path as the gestures). */
  async tap(x: number, y: number, holdMs = 30): Promise<void> {
    await this.start([{ x, y }]);
    if (holdMs) await this.page.waitForTimeout(holdMs);
    await this.end();
  }

  /** Brief: 20 moves × 2 px at 16 ms, 150 ms hold, release. */
  async slowPan(x: number, y: number, dx = -2, dy = -1): Promise<void> {
    await this.start([{ x, y }]);
    for (let i = 1; i <= 20; i++) {
      await this.move([{ x: x + dx * i, y: y + dy * i }]);
      await this.page.waitForTimeout(16);
    }
    await this.page.waitForTimeout(150);
    await this.end();
  }

  /** Brief: 6 moves × 16 px at 8 ms, release (inertia glide follows). */
  async fling(x: number, y: number, dx = -16, dy = -3): Promise<void> {
    await this.start([{ x, y }]);
    for (let i = 1; i <= 6; i++) {
      await this.move([{ x: x + dx * i, y: y + dy * i }]);
      await this.page.waitForTimeout(8);
    }
    await this.end();
  }
}

export type Box = { x: number; y: number; w: number; h: number };

export async function box(page: Page, sel: string): Promise<Box> {
  const b = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, sel);
  expect(b, `element ${sel} exists`).not.toBeNull();
  return b!;
}

export const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

export async function cam(page: Page): Promise<{ x: number; y: number; k: number }> {
  return page.evaluate(() => {
    const c = (window as any).__map.cam;
    return { x: c.x, y: c.y, k: c.k };
  });
}

export async function waitFrames(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}

/**
 * Wait until the open link popover has stopped moving: the camera pan that fits
 * it inside the map (0.2.33) is animated, so a row measured during it is stale
 * and a tap there lands outside the popover (which closes it).
 */
export async function popSettled(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const pop = document.querySelector('.map-link-pop');
              if (!pop) return resolve(false);
              const key = () => {
                const r = pop.getBoundingClientRect();
                return `${r.left},${r.top}`;
              };
              // Fitted: fully inside the map (the pan stops 8 px inside).
              const host = (pop.closest('.map-wrap') ?? document.body).getBoundingClientRect();
              const r = pop.getBoundingClientRect();
              if (r.left < host.left || r.right > host.right || r.top < host.top || r.bottom > host.bottom) {
                return requestAnimationFrame(() => resolve(false));
              }
              const k0 = key();
              requestAnimationFrame(() =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve(key() === k0))),
              );
            }),
        ),
      { intervals: [0], timeout: 3000 },
    )
    .toBe(true);
}
