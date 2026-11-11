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

test.describe('0.7.0: no demo password, real seals only', () => {
  test('example outlines show no password, no Unlock-all, and no locked rows', async ({ page }) => {
    await page.goto('examples/viewer/?doc=../student-study/student-study.md');
    await expect(page.locator('#outlineHost .of-node[data-id="portal-pack"]')).toHaveCount(1);
    await expect(page.locator('#outlineHost .of-locked-chrome')).toHaveCount(0);
    await expect(page.locator('#sealBar')).toBeHidden();
    await expect(page.locator('body')).not.toContainText(/demo password/i);
    await expect(page.locator('#btnUnlockAll')).toHaveCount(0);
  });

  test('secure quick start: create key -> seal -> lock -> unlock with an empty autofill card', async ({ page }) => {
    test.setTimeout(60_000);
    const pass = 'quiet harbour lantern orbit maple';
    await page.goto('examples/secure-quickstart/');
    await page.locator('#btnCreate').click();
    const pw = page.locator('#createSlot input.of-newkey-pass');
    await expect(pw).toHaveAttribute('autocomplete', 'new-password');
    await expect(pw).toHaveValue('');
    await expect(page.locator('#createSlot .of-unlock-ok')).toBeDisabled();
    await pw.fill(pass);
    await expect(page.locator('#createSlot .of-newkey-strength')).toHaveText('Strength: OK');
    await page.locator('#createSlot .of-unlock-ok').click();
    await expect(page.locator('#status')).toContainText('$argon2id$v=19$m=65536,t=3,p=1', { timeout: 20_000 });

    await page.locator('#btnSeal').click();
    const portable = page.locator('#portable');
    await expect(portable).toContainText('-----BEGIN OUTLINE-FOLD SEAL-----');
    await expect(portable).toContainText('--- keyring ---');
    await expect(portable).not.toContainText('Write the private part');
    await expect(portable).not.toContainText(pass);
    await expect(page.locator('#clean')).not.toContainText('keyring');

    await page.locator('#btnLock').click();
    await page.locator('#btnUnlock').click();
    const unlock = page.locator('#unlockSlot input.of-unlock-pass');
    await expect(unlock).toHaveValue('');
    await expect(unlock).toHaveAttribute('autocomplete', 'current-password');
    await unlock.fill('not the right passphrase');
    await page.locator('#unlockSlot .of-unlock-ok').click();
    await expect(page.locator('#unlockSlot .of-unlock-msg')).toContainText('Wrong passphrase', { timeout: 20_000 });
    await expect(page.locator('#unlockSlot .of-unlock-damaged-q')).toBeHidden();
    await page.waitForTimeout(1_100); // back-off after one failure
    await unlock.fill(pass);
    await page.locator('#unlockSlot .of-unlock-ok').click();
    await expect(page.locator('#opened')).toContainText('Write the private part of your own note here', { timeout: 20_000 });
  });

  test('no Lock-all bar on an outline without locked rows', async ({ page }) => {
    await page.goto('examples/viewer/?doc=../aust-gov-cyber/aust-gov-cyber.md');
    await expect(page.locator('#outlineHost .of-node[data-id="root"]')).toHaveCount(1);
    await expect(page.locator('#sealBar')).toBeHidden();
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
    // 0.2.32: the − fill is --map-handle-bg, transparent by default.
    expect(['none', 'transparent', 'rgba(0, 0, 0, 0)']).toContain(r.root.circleFill);
    expect(r.edgeOpacity).toEqual(['1']);
    expect(r.stemOpacity).toEqual(['1']);
  });
});

test.describe('Map handle hooks, halo, casing and light tokens (0.2.32)', () => {
  const LIGHTHOUSE = 'examples/viewer/?doc=../lighthouse/lighthouse.md';

  test('halo under the − only, casing only when the host sets it, light tokens opt-in', async ({ page }) => {
    await page.goto(LIGHTHOUSE);
    await page.locator('#btnMap').click();
    await expect(page.locator('#mapHost .map-node').first()).toBeVisible();
    await settle(page);

    const before = await page.evaluate(() => {
      const host = document.querySelector('#mapHost')!;
      const root = host.querySelector('.map-node')!;
      const kids = [...root.children].map((e) => e.getAttribute('class') || e.tagName);
      return {
        halos: host.querySelectorAll('.map-fold-halo').length,
        expanded: host.querySelectorAll('.map-fold-indicator.is-expanded').length,
        haloOnFolded: host.querySelectorAll('.map-node.collapsed > .map-fold-halo').length,
        order: kids.filter((c) => /map-fold-(halo|stem|indicator)/.test(c)),
        casings: host.querySelectorAll('.map-edge-casing, .map-fold-stem-casing').length,
        plusGlyph: getComputedStyle(host.querySelector('.map-fold-indicator:not(.is-expanded) path')!).stroke,
      };
    });
    expect(before.halos).toBe(before.expanded);
    expect(before.haloOnFolded).toBe(0);
    expect(before.order).toEqual(['map-fold-halo', 'map-fold-stem', 'map-fold-indicator is-expanded']);
    expect(before.casings).toBe(0);
    expect(before.plusGlyph).toBe('rgb(10, 31, 40)');

    // A host that sets --connector-casing gets one casing per edge and stem, under the lines.
    await page.evaluate(() => {
      (document.querySelector('#mapHost') as HTMLElement).style.setProperty('--connector-casing', 'rgba(6, 18, 24, 0.85)');
    });
    await page.locator('#mapHost .map-node.collapsed .map-fold-hit').first().click();
    await settle(page);
    const cased = await page.evaluate(() => {
      const host = document.querySelector('#mapHost')!;
      const vp = host.querySelector('#mapViewport')!;
      const cls = [...vp.children].map((e) => e.getAttribute('class'));
      return {
        edges: host.querySelectorAll('.map-edge').length,
        edgeCasings: host.querySelectorAll('.map-edge-casing').length,
        stems: host.querySelectorAll('.map-fold-stem').length,
        stemCasings: host.querySelectorAll('.map-fold-stem-casing').length,
        casingsFirst: cls.lastIndexOf('map-edge-casing') < cls.indexOf('map-edge'),
        casingStroke: getComputedStyle(host.querySelector('.map-edge-casing')!).stroke,
        casingWidth: getComputedStyle(host.querySelector('.map-edge-casing')!).strokeWidth,
      };
    });
    expect(cased.edgeCasings).toBe(cased.edges);
    expect(cased.stemCasings).toBe(cased.stems);
    expect(cased.casingsFirst).toBe(true);
    expect(cased.casingStroke).toBe('rgba(6, 18, 24, 0.85)');
    expect(cased.casingWidth).toBe('3.2px');

    const light = await page.evaluate(() => {
      const host = document.querySelector('#mapHost') as HTMLElement;
      host.classList.add('of-theme-light');
      const cs = getComputedStyle(host);
      return {
        bg: cs.getPropertyValue('--map-bg').trim(),
        gold: cs.getPropertyValue('--gold').trim(),
        glyph: getComputedStyle(host.querySelector('.map-fold-indicator:not(.is-expanded) path')!).stroke,
      };
    });
    expect(light).toEqual({ bg: '#f3f6f9', gold: '#9a7400', glyph: 'rgb(255, 255, 255)' });
  });
});

test.describe('Pages viewer: Shift+F10 opens the package node menu (0.2.39, node menu M1)', () => {
  test('Shift+F10 / ContextMenu open the node menu; Levels… reaches the level picker; Esc closes', async ({ page }) => {
    const host = await openMap(page);
    await clickNode(page, host, 'root');
    await expectSelected(page, HOST, 'root');
    await page.keyboard.press('Shift+F10');
    const menu = page.locator('.map-node-menu');
    await expect(menu).toHaveCount(1);
    await expect(menu.locator('[role="menuitem"]')).toHaveText(['Levels…', 'Copy jump', 'Copy link']);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await page.keyboard.press('ContextMenu');
    await expect(menu).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(page.locator('.map-level-menu')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.map-level-menu')).toHaveCount(0);
  });

  test('Copy link copies the viewer URL with focus=<id>, and that URL opens with the node selected', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const host = await openMap(page);
    await clickNode(page, host, 'root');
    await press(page, '2');
    await selectViaKeys(page, HOST, ['ArrowRight'], 'menu');
    await page.keyboard.press('Shift+F10');
    await page.locator('.map-node-menu [data-item="copy-link"]').click();
    const expected = new URL(page.url());
    expected.searchParams.set('focus', 'menu');
    expected.hash = '';
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected.href);
    await expect(page.locator('.map-copied')).toHaveText('Copied link');
    // Opened fresh (no saved map state), the copied link selects that node.
    await page.addInitScript(() => localStorage.clear());
    await page.goto(expected.href);
    await page.locator('#btnMap').click();
    await expect(page.locator(`${HOST} .map-node[data-id="menu"]`)).toHaveCount(1);
    await expectSelected(page, HOST, 'menu', { hostFocused: false });
  });
});

test.describe('Map t cycles task checks (0.7.0)', () => {
  test('t on a node that started with a checkbox loops states and does not remove it', async ({ page }) => {
    const host = await openMap(page);
    await clickNode(page, host, 'menu-coldbrew');
    await expectSelected(page, HOST, 'menu-coldbrew');
    const box = host.locator('.map-node[data-id="menu-coldbrew"] .map-task-hit');
    await expect(box).toHaveAttribute('aria-checked', 'false');
    await press(page, 't');
    await expect(box).toHaveAttribute('aria-checked', 'mixed');
    await press(page, 't');
    await expect(box).toHaveAttribute('aria-checked', 'true');
    await press(page, 't');
    await expect(box).toHaveAttribute('aria-checked', 'false');
    await expect(box).toHaveCount(1);
  });

  test('t on a node that started with no checkbox adds one and can return to none', async ({ page }) => {
    const host = await openMap(page);
    await clickNode(page, host, 'root');
    await expectSelected(page, HOST, 'root');
    const node = host.locator('.map-node[data-id="root"]');
    await expect(node.locator('.map-task-hit')).toHaveCount(0);
    await press(page, 't');
    await expect(node.locator('.map-task-hit')).toHaveAttribute('aria-checked', 'false');
    await press(page, 't');
    await expect(node.locator('.map-task-hit')).toHaveAttribute('aria-checked', 'mixed');
    await press(page, 't');
    await expect(node.locator('.map-task-hit')).toHaveAttribute('aria-checked', 'true');
    await press(page, 't');
    await expect(node.locator('.map-task-hit')).toHaveCount(0);
  });
});
