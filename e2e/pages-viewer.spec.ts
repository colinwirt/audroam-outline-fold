import { test, expect, type Page } from '@playwright/test';
import {
  PKG_VERSION,
  expectedSha,
  mapState,
  expectSelected,
  clickNode,
  press,
  settle,
  selectViaKeys,
} from './harness';

const HOST = '#mapHost';
const CAFE = 'examples/viewer/?doc=../outline-demo.md';

async function openMap(page: Page) {
  await page.goto(CAFE);
  await page.locator('#btnMap').click();
  const host = page.locator(HOST);
  await expect(host).toBeVisible();
  await expect(host.locator('.map-node[data-id="root"]')).toHaveCount(1);
  await settle(page);
  return host;
}

test.describe('Pages viewer Map keyboard focus (0.2.16 gate)', () => {
  test('click node → host focus + activedescendant + ring; arrows move it', async ({ page }) => {
    const host = await openMap(page);
    await expect(host).toHaveAttribute('tabindex', '0');
    expect(await host.locator('.map-node[tabindex]').count()).toBe(0);

    await clickNode(page, host, 'root');
    await expectSelected(page, HOST, 'root');
    await press(page, '2');
    await selectViaKeys(page, HOST, ['ArrowRight'], 'menu');
    await clickNode(page, host, 'menu');
    await expectSelected(page, HOST, 'menu');
    const steps: [string, string][] = [
      ['ArrowDown', 'suppliers'],
      ['ArrowUp', 'menu'],
      ['ArrowUp', 'menu'], // edge no-op
      ['ArrowRight', 'menu-coldbrew'],
      ['ArrowDown', 'menu-pie'],
      ['ArrowLeft', 'menu'],
      ['ArrowLeft', 'root'],
      ['ArrowLeft', 'root'], // edge no-op
    ];
    for (const [key, want] of steps) {
      await press(page, key);
      await expectSelected(page, HOST, want);
    }
  });

  test('digits expand under selection; Space/Enter/. toggle fold', async ({ page }) => {
    const host = await openMap(page);
    await clickNode(page, host, 'root');
    await press(page, '1');
    let s = await expectSelected(page, HOST, 'root');
    expect(s.visible).not.toContain('menu-coldbrew');
    expect(s.expanded.menu).toBe('false');
    await press(page, '2');
    s = await expectSelected(page, HOST, 'root');
    expect(s.visible).toContain('menu-coldbrew');
    expect(s.visible).not.toContain('bid-a');
    await press(page, '3');
    s = await expectSelected(page, HOST, 'root');
    expect(s.visible).toContain('bid-a');

    await press(page, '1');
    await selectViaKeys(page, HOST, ['ArrowRight'], 'menu');
    await clickNode(page, host, 'menu');
    const menu = host.locator('.map-node[data-id="menu"]');
    let expanded = false;
    for (const key of ['.', 'Space', 'Enter', '.']) {
      await press(page, key);
      expanded = !expanded;
      await expect(menu, `${key} toggles menu`).toHaveAttribute(
        'aria-expanded',
        expanded ? 'true' : 'false',
      );
      await expect(host.locator('.map-node[data-id="menu-coldbrew"]')).toHaveCount(
        expanded ? 1 : 0,
      );
      await expectSelected(page, HOST, 'menu');
    }
    // click again (same node) → keys still work
    await clickNode(page, host, 'menu');
    await press(page, 'ArrowDown');
    await expectSelected(page, HOST, 'suppliers');
  });

  test('9: build stamp shows expected package version (+ git sha)', async ({ page }) => {
    await page.goto(CAFE);
    const meta = page.locator('#buildMeta');
    await expect(meta).toContainText(`@audroam/outline-fold@${PKG_VERSION}`);
    const sha = expectedSha();
    if (sha) await expect(meta).toContainText(sha);
  });
});

test.describe('Pages viewer demo unlock', () => {
  test('shows the demo password and Unlock opens every locked row', async ({ page }) => {
    await page.goto('examples/viewer/?doc=../student-study/student-study.md');
    const bar = page.locator('#demoUnlock');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('Demo password: 123');
    await page.locator('#btnUnlockAll').click();
    const reveals = page.locator('#outlineHost .of-reveal');
    await expect(reveals).toHaveCount(3);
    await expect(page.locator('#outlineHost .of-node[data-id="assessment-pack"] .of-reveal')).toHaveText(
      'Bio quiz access code BQ-7731 · opens Mon 8:55',
    );
  });

  test('no Unlock control on an outline without locked rows', async ({ page }) => {
    await page.goto('examples/viewer/?doc=../aust-gov-cyber/aust-gov-cyber.md');
    await expect(page.locator('#outlineHost .of-node[data-id="root"]')).toHaveCount(1);
    await expect(page.locator('#demoUnlock')).toBeHidden();
  });
});

test.describe('Pages viewer outline without ids', () => {
  const LIGHTHOUSE = 'examples/viewer/?doc=../lighthouse/lighthouse.md';

  test('lighthouse: every row gets a session id, task box and fold handle', async ({ page }) => {
    await page.goto(LIGHTHOUSE);
    const outline = page.locator('#outlineHost');
    await expect(outline.locator('[role="treeitem"]')).toHaveCount(24);
    await expect(outline.locator('[role="treeitem"]:not([data-id])')).toHaveCount(0);
    await expect(outline.locator('[data-testid^="of-task-"]')).toHaveCount(11);
    await expect(outline.locator('[data-testid^="of-task-"][aria-checked="true"]')).toHaveCount(2);
    await expect(page.locator('#validation')).toBeHidden();

    const tuesday = outline.locator('[role="treeitem"]', { hasText: 'Tuesday' }).first();
    const id = await tuesday.getAttribute('data-id');
    const before = await tuesday.getAttribute('aria-expanded');
    await page.locator(`[data-testid="of-fold-${id}"]`).click();
    await expect(tuesday).toHaveAttribute('aria-expanded', before === 'true' ? 'false' : 'true');
    await expect(page.locator('#foldOut')).toContainText('Tuesday');
    await expect(page.locator('#foldOut')).not.toContainText('<id:');

    await page.locator('#btnMap').click();
    await expect(page.locator(`#mapHost .map-node[data-id="${id}"]`)).toHaveCount(1);
  });

  test('a Map click made while the outline loads is kept', async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route((url) => url.pathname.endsWith('/lighthouse/lighthouse.md'), async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(LIGHTHOUSE, { waitUntil: 'domcontentloaded' });
    await page.locator('#btnMap').click();
    release();
    await expect(page.locator('#mapHost .map-node').first()).toBeVisible();
    await expect(page.locator('#btnMap')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#outlineHost')).toBeHidden();
  });
});

test.describe('Map fold handle and connectors (0.2.31)', () => {
  const LIGHTHOUSE = 'examples/viewer/?doc=../lighthouse/lighthouse.md';

  test('connectors start past the handle, one stub per handle, see-through −, no opacity', async ({ page }) => {
    await page.goto(LIGHTHOUSE);
    await page.locator('#btnMap').click();
    await expect(page.locator('#mapHost .map-node').first()).toBeVisible();
    await settle(page);

    const r = await page.evaluate(() => {
      const num = (s: string | null, re: RegExp) => {
        const m = re.exec(s || '');
        return m ? m.slice(1).map(Number) : [];
      };
      const handle = (g: Element) => {
        const ind = g.querySelector(':scope > .map-fold-indicator')!;
        const [cx, cy] = num(ind.getAttribute('transform'), /translate\(([-\d.]+) ([-\d.]+)\)/);
        const [sx, sy, ex] = num(
          g.querySelector(':scope > .map-fold-stem')!.getAttribute('d'),
          /^M ([-\d.]+) ([-\d.]+) H ([-\d.]+)$/,
        );
        const hit = g.querySelector(':scope > .map-fold-hit')!;
        return {
          cx,
          cy,
          stem: { sx, sy, ex },
          hit: {
            w: Number(hit.getAttribute('width')),
            h: Number(hit.getAttribute('height')),
            cx: Number(hit.getAttribute('x')) + 16,
          },
          circleFill: getComputedStyle(ind.querySelector('circle')!).fill,
          expanded: ind.classList.contains('is-expanded'),
        };
      };
      const root = document.querySelector('#mapHost .map-node')!;
      const rootExpanded = root.getAttribute('aria-expanded');
      const folded = document.querySelector('#mapHost .map-node.collapsed')!;
      const rh = handle(root);
      const edges = [...document.querySelectorAll('#mapHost .map-edge')];
      const fromRoot = edges
        .map((e) => num(e.getAttribute('d'), /^M ([-\d.]+) ([-\d.]+)/))
        .filter(([, y]) => Math.abs(y - rh.cy) < 0.01);
      return {
        rootExpanded,
        root: rh,
        folded: handle(folded),
        fromRoot,
        edgeOpacity: [...new Set(edges.map((e) => getComputedStyle(e).opacity))],
        stemOpacity: [
          ...new Set(
            [...document.querySelectorAll('#mapHost .map-fold-stem')].map((e) => getComputedStyle(e).opacity),
          ),
        ],
      };
    });

    expect(r.rootExpanded).toBe('true');
    expect(r.root.expanded).toBe(true);
    expect(r.fromRoot.length).toBe(7);
    for (const [x] of r.fromRoot) {
      expect(x).toBeCloseTo(r.root.cx + 9.8, 5);
      expect(x).toBeGreaterThanOrEqual(r.root.cx + 9);
    }
    // Same 8 px stub, pill edge to inner rim, on the − and the +.
    for (const h of [r.root, r.folded]) {
      expect(h.stem.sy).toBe(h.cy);
      expect(h.stem.ex).toBeCloseTo(h.cx - 9, 5);
      expect(h.stem.ex - h.stem.sx).toBeCloseTo(8, 5);
      expect(h.hit).toEqual({ w: 32, h: 32, cx: h.cx });
    }
    expect(r.folded.expanded).toBe(false);
    expect(r.root.circleFill).toBe('none');
    expect(r.edgeOpacity).toEqual(['1']);
    expect(r.stemOpacity).toEqual(['1']);
  });
});
