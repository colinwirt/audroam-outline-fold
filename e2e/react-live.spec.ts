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

const HOST = '.map-wrap';

async function openMap(page: Page) {
  await page.goto('react-live/');
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const host = page.locator(HOST);
  await expect(host).toBeVisible();
  await expect(host.locator('.map-node[data-id="root"]')).toHaveCount(1);
  await settle(page);
  return host;
}

test.describe('react-live Map keyboard focus (0.2.16 gate)', () => {
  test('host is the single focus owner: tabindex=0, nodes not tabbable', async ({ page }) => {
    const host = await openMap(page);
    await expect(host).toHaveAttribute('tabindex', '0');
    const tabbableNodes = await host.locator('.map-node[tabindex]').count();
    expect(tabbableNodes).toBe(0);
  });

  test('1+7+8: click node → selected, host focused, activedescendant, ring', async ({ page }) => {
    const host = await openMap(page);
    for (const id of ['menu', 'suppliers', 'root', 'staff']) {
      await clickNode(page, host, id);
      await expectSelected(page, HOST, id);
    }
  });

  test('2+7: arrows move selection/ring; edges are asserted no-ops', async ({ page }) => {
    const host = await openMap(page);
    await clickNode(page, host, 'root');
    await press(page, '2'); // root kids expanded → grandchildren visible
    await clickNode(page, host, 'suppliers');
    await expectSelected(page, HOST, 'suppliers');

    const steps: [string, string][] = [
      ['ArrowUp', 'menu'],
      ['ArrowUp', 'menu'], // first sibling: edge no-op
      ['ArrowDown', 'suppliers'],
      ['ArrowRight', 'sup-berries'],
      ['ArrowRight', 'sup-berries'], // leaf: edge no-op
      ['ArrowDown', 'sup-milk'],
      ['End', 'sup-private'],
      ['Home', 'sup-berries'],
      ['ArrowLeft', 'suppliers'],
      ['ArrowLeft', 'root'],
      ['ArrowLeft', 'root'], // root has no parent: edge no-op
      ['ArrowRight', 'menu'],
    ];
    for (const [key, want] of steps) {
      await press(page, key);
      await expectSelected(page, HOST, want);
    }
  });

  test('3+7: Space, Enter and . each toggle fold on a parent', async ({ page }) => {
    const host = await openMap(page);
    await clickNode(page, host, 'root');
    await press(page, '1'); // root open, its kids collapsed
    await clickNode(page, host, 'menu');
    await expectSelected(page, HOST, 'menu');
    const kid = host.locator('.map-node[data-id="menu-coldbrew"]');
    const menu = host.locator('.map-node[data-id="menu"]');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(kid).toHaveCount(0);

    let expanded = false;
    for (const key of ['Space', 'Enter', '.', 'Space', 'Enter', '.']) {
      const before = (await mapState(page, HOST)).visible.length;
      await press(page, key);
      expanded = !expanded;
      await expect(menu, `${key} toggles menu`).toHaveAttribute(
        'aria-expanded',
        expanded ? 'true' : 'false',
      );
      await expect(kid).toHaveCount(expanded ? 1 : 0);
      const after = (await mapState(page, HOST)).visible.length;
      expect(after - before, `${key} changes child count`).toBe(expanded ? 6 : -6);
      await expectSelected(page, HOST, 'menu');
    }
  });

  test('4+7: digits expand relative to selection (1 kids, 2, 3 depth)', async ({ page }) => {
    const host = await openMap(page);
    await clickNode(page, host, 'root');
    await press(page, '1');
    let s = await expectSelected(page, HOST, 'root');
    expect(s.visible).toEqual(
      expect.arrayContaining(['root', 'menu', 'suppliers', 'courtyard', 'staff', 'secrets']),
    );
    expect(s.visible).not.toContain('menu-coldbrew');
    expect(s.expanded.menu).toBe('false');

    await press(page, '2');
    s = await expectSelected(page, HOST, 'root');
    expect(s.visible).toEqual(
      expect.arrayContaining(['menu-coldbrew', 'sup-berries', 'courtyard-quotes', 'staff-handbook']),
    );
    expect(s.expanded['courtyard-quotes']).toBe('false');
    expect(s.visible).not.toContain('bid-a');

    await press(page, '3');
    s = await expectSelected(page, HOST, 'root');
    expect(s.expanded['courtyard-quotes']).toBe('true');
    expect(s.visible).toEqual(expect.arrayContaining(['bid-a', 'bid-b']));

    // `1` under a non-root selection only touches that subtree
    await selectViaKeys(page, HOST, ['ArrowRight', 'ArrowDown', 'ArrowDown'], 'courtyard');
    await clickNode(page, host, 'courtyard');
    await press(page, '0');
    s = await expectSelected(page, HOST, 'courtyard');
    expect(s.expanded.courtyard).toBe('false');
    expect(s.visible).toContain('menu-coldbrew');
    await press(page, '1');
    s = await expectSelected(page, HOST, 'courtyard');
    expect(s.expanded.courtyard).toBe('true');
    expect(s.expanded['courtyard-quotes']).toBe('false');
  });

  test('5+6: textarea typing never drives Map; click node re-arms keys', async ({ page }) => {
    const host = await openMap(page);
    const ta = page.locator('textarea.source');
    await clickNode(page, host, 'suppliers');
    await expectSelected(page, HOST, 'suppliers');
    const mapBefore = await mapState(page, HOST);

    // Caret inside the menu caption (keeps ids + structure stable).
    await ta.click();
    await ta.evaluate((el: HTMLTextAreaElement) => {
      const i = el.value.indexOf(' <id:menu>');
      el.setSelectionRange(i, i);
    });
    const valueBefore = await ta.inputValue();
    for (const key of ['1', 'Space', '.', '2', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      await page.keyboard.press(key);
    }
    await settle(page);
    await settle(page);
    const valueAfter = await ta.inputValue();
    expect(valueAfter).not.toBe(valueBefore);
    expect(valueAfter).toContain('1 .2 <id:menu>');
    await expect(ta, 'paint never steals focus from textarea').toBeFocused();
    const mapAfter = await mapState(page, HOST);
    expect(mapAfter.ad, 'Map selection unchanged while typing').toBe('suppliers');
    expect(mapAfter.ring).toEqual(['suppliers']);
    expect(mapAfter.visible).toEqual(mapBefore.visible);
    expect(mapAfter.expanded).toEqual(mapBefore.expanded);
    expect(mapAfter.hostFocused).toBe(false);

    // textarea → click node → keys work again
    await clickNode(page, host, 'suppliers'); // same node again
    await expectSelected(page, HOST, 'suppliers');
    await press(page, 'ArrowDown');
    await expectSelected(page, HOST, 'courtyard');
    await clickNode(page, host, 'menu'); // different node
    await press(page, 'ArrowDown');
    await expectSelected(page, HOST, 'suppliers');

    // back to textarea → Map ignores again
    const before2 = await mapState(page, HOST);
    await ta.click();
    const v2 = await ta.inputValue();
    await page.keyboard.press('End');
    await page.keyboard.press('3');
    await page.keyboard.press('ArrowUp');
    await settle(page);
    await expect(ta).toBeFocused();
    expect(await ta.inputValue()).not.toBe(v2);
    const after2 = await mapState(page, HOST);
    expect(after2.ad).toBe('suppliers');
    expect(after2.visible).toEqual(before2.visible);
    expect(after2.expanded).toEqual(before2.expanded);
  });

  test('clicking the already-selected node keeps keys working across paints', async ({ page }) => {
    const host = await openMap(page);
    await clickNode(page, host, 'root');
    await press(page, '2');
    await selectViaKeys(page, HOST, ['ArrowRight'], 'menu');
    await clickNode(page, host, 'menu');
    for (let i = 0; i < 3; i++) {
      await clickNode(page, host, 'menu');
      await press(page, 'ArrowRight');
      await expectSelected(page, HOST, 'menu-coldbrew');
      await press(page, 'ArrowLeft');
      await expectSelected(page, HOST, 'menu');
    }
  });

  test('fixture: multiline caption + 30+ line body (more/less) are clickable', async ({ page }) => {
    const host = await openMap(page);
    await clickNode(page, host, 'root');
    await press(page, '2');
    // Keys bring nodes into view via camera follow (no manual pan needed).
    await selectViaKeys(page, HOST, ['ArrowRight', 'ArrowRight', 'End'], 'menu-multiline');
    await clickNode(page, host, 'menu-multiline');
    await expectSelected(page, HOST, 'menu-multiline');
    const tspans = await host.locator('.map-node[data-id="menu-multiline"] tspan').count();
    expect(tspans, 'literal \\n caption paints on 2+ lines').toBeGreaterThanOrEqual(2);

    await selectViaKeys(page, HOST, ['ArrowLeft', 'ArrowLeft', 'ArrowRight', 'End', 'ArrowUp'], 'staff');
    await clickNode(page, host, 'staff');
    await selectViaKeys(page, HOST, ['ArrowRight', 'Home'], 'staff-mon');
    // walk down to the multiline close-down row, then the long body node
    for (let i = 0; i < 8; i++) {
      if ((await mapState(page, HOST)).ad === 'staff-close') break;
      await press(page, 'ArrowDown');
    }
    await expectSelected(page, HOST, 'staff-close');
    expect(
      await host.locator('.map-node[data-id="staff-close"] tspan').count(),
    ).toBeGreaterThanOrEqual(3);
    await clickNode(page, host, 'staff-close');
    await selectViaKeys(page, HOST, ['ArrowDown'], 'staff-handbook');
    await clickNode(page, host, 'staff-handbook');
    await expectSelected(page, HOST, 'staff-handbook');

    const more = host.locator('.map-node[data-id="staff-handbook"] .map-body-more-hit');
    await expect(more).toHaveAttribute('data-body-action', 'more');
    // Playwright's locator.click treats this transformed SVG <g> as outside
    // the viewport. Hit the inner rect's screen box instead.
    const moreBox = await more.locator('rect').boundingBox();
    expect(moreBox, 'more control has a box').not.toBeNull();
    await page.mouse.click(
      moreBox!.x + moreBox!.width / 2,
      moreBox!.y + moreBox!.height / 2,
    );
    await settle(page);
    await expect(
      host.locator('.map-node[data-id="staff-handbook"] .map-body-more-hit'),
    ).toHaveAttribute('data-body-action', 'less');
    await expectSelected(page, HOST, 'staff-handbook');
    await press(page, 'ArrowUp');
    await expectSelected(page, HOST, 'staff-close');
  });

  test('label drag-select copies text; background pan clears it without moving selection', async ({ page }) => {
    const host = await openMap(page);
    await clickNode(page, host, 'suppliers');
    const labelSel = `${HOST} .map-node[data-id="suppliers"] .map-label`;
    const labelText = ((await page.locator(labelSel).textContent()) || '').replace(/\s+/g, ' ');
    // First line only: CI fonts can wrap the caption to 2 lines, and the text
    // bbox centre would then fall between lines (on the pill, not a glyph).
    const lb = (await page.locator(`${labelSel} tspan`).first().boundingBox())!;
    const cy = lb.y + lb.height / 2;
    // Real mouse drag across the label. Chromium's SVG text hit-testing has
    // dead spots at some sub-glyph x positions (varies with CI fonts), so try a
    // few nearby start points; any real drag selection proves the label is
    // selectable and not swallowed by pan/preventDefault/user-select.
    let selected = '';
    for (const dx of [2, 1, 3, 5, 0.5, 7, 10, 13]) {
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      await page.mouse.move(lb.x + dx, cy);
      await page.mouse.down();
      await page.mouse.move(lb.x + lb.width * 0.6, cy, { steps: 10 });
      await page.mouse.up();
      selected = await page.evaluate(() => window.getSelection()?.toString() || '');
      if (selected.trim().length > 2) break;
      await page.waitForTimeout(600); // avoid double-click counting between tries
    }
    expect(selected.trim().length, 'label text drag produces a selection').toBeGreaterThan(2);
    expect(labelText, 'selection is label text (copyable)').toContain(
      selected.replace(/\s+/g, ' ').trim().slice(0, 6),
    );
    await expectSelected(page, HOST, 'suppliers');
    // keys still work after drag-select
    await press(page, 'ArrowUp');
    await expectSelected(page, HOST, 'menu');

    // Pan on empty canvas: clears text selection, selection id unchanged.
    const hb = (await host.boundingBox())!;
    await page.mouse.move(hb.x + 8, hb.y + hb.height - 8);
    await page.mouse.down();
    await page.mouse.move(hb.x + 120, hb.y + hb.height - 60, { steps: 6 });
    await page.mouse.up();
    const after = await page.evaluate(() => window.getSelection()?.toString() || '');
    expect(after).toBe('');
    await expectSelected(page, HOST, 'menu');
    await press(page, 'ArrowDown');
    await expectSelected(page, HOST, 'suppliers');
  });

  test('unknown caption tags are visible text and not elements', async ({ page }) => {
    await page.goto('react-live/');
    await page.getByLabel('Outline source').fill(
      '- hi <script>nope</script> <b onclick="x">no</b> <b>ok</b> <id:t1>\n',
    );
    const tree = page.locator('.tree');
    await expect(tree.locator('script')).toHaveCount(0);
    await expect(tree.locator('[onclick]')).toHaveCount(0);
    await expect(tree).toContainText('<script>nope</script>');
    await expect(tree).toContainText('<b onclick="x">');
    await expect(tree.locator('b')).toHaveText('ok');

    const host = page.locator(HOST);
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(host).toBeVisible();
    await expect(host.locator('script')).toHaveCount(0);
    await expect(host.locator('[onclick]')).toHaveCount(0);
    await expect(host.locator('.map-label')).toContainText('<script>nope</script>');
    await expect(host.locator('tspan[font-weight="700"]')).toContainText('ok');
  });

  test('9: build stamp shows expected package version (+ git sha)', async ({ page }) => {
    await page.goto('react-live/');
    const stamp = page.getByTestId('pkg-stamp');
    await expect(stamp).toContainText(`@audroam/outline-fold@${PKG_VERSION}`);
    const sha = expectedSha();
    if (sha) await expect(page.getByTestId('pkg-git')).toHaveText(sha);
  });
});
