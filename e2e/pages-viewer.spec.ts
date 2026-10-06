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
