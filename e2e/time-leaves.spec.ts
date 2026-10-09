import { test, expect, type Page } from '@playwright/test';
import { expectSelected } from './harness';

/**
 * Map time leaves (0.2.40, Design UX 2026-10-09, TL1–TL8), desktop. Fixture:
 * examples/e2e-touch/time-leaves.md (fiction). t1–t4 are `<kind:time>` leaves
 * (t2 spelled `<kind : time>`), s1 / s2 `<kind:session>` leaves; t5 is a time
 * record with a child, so it stays a normal note pill.
 */

const MAP = 'examples/e2e-touch/index.html?doc=time-leaves.md';
const HOST = '#mapHost';
const node = (id: string) => `${HOST} .map-node[data-id="${id}"]`;
const LEAVES = ['t1', 't2', 't3', 't4', 's1', 's2'];

async function open(page: Page, query = '') {
  await page.goto(MAP + query);
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(150);
}

/** Pill rect in SVG user units (layout space). */
const pillBox = (page: Page, id: string) =>
  page.evaluate((s) => {
    const r = document.querySelector(`${s} .map-pill`)!;
    const n = (a: string) => Number(r.getAttribute(a));
    return { x: n('x'), y: n('y'), w: n('width'), h: n('height') };
  }, node(id));

const pillStyle = (page: Page, id: string) =>
  page.evaluate((s) => {
    const cs = getComputedStyle(document.querySelector(`${s} .map-pill`)!);
    return { fill: cs.fill, stroke: cs.stroke, width: cs.strokeWidth };
  }, node(id));

/** The connector that ends at a pill's left edge (centre line). */
const edgeInto = (page: Page, id: string) =>
  page.evaluate((s) => {
    const r = document.querySelector(`${s} .map-pill`)!;
    const x = Number(r.getAttribute('x'));
    const y = Number(r.getAttribute('y')) + Number(r.getAttribute('height')) / 2;
    const e = [...document.querySelectorAll<SVGPathElement>('#mapHost path.map-edge')].find((p) =>
      (p.getAttribute('d') || '').trim().endsWith(`${x} ${y}`),
    );
    if (!e) return null;
    const cs = getComputedStyle(e);
    return { cls: e.getAttribute('class'), stroke: cs.stroke, width: cs.strokeWidth, opacity: cs.opacity };
  }, node(id));

test.describe('time leaves (desktop)', () => {
  test('kind-time / kind-session classes on leaves; a record with children stays a note pill', async ({ page }) => {
    await open(page);
    for (const id of LEAVES) {
      const cls = (await page.locator(node(id)).getAttribute('class'))!.split(/\s+/);
      expect(cls, id).toEqual(expect.arrayContaining(['map-node', 'leaf', 'time-leaf', id.startsWith('s') ? 'kind-session' : 'kind-time']));
    }
    const t5 = (await page.locator(node('t5')).getAttribute('class'))!;
    expect(t5).not.toContain('time-leaf');
    expect(t5).not.toContain('kind-time');
    await expect(page.locator(`${node('t5')} .map-fold-hit`)).toHaveCount(1);
    for (const id of ['glaze', 'check', 'wipe']) {
      expect(await page.locator(node(id)).getAttribute('class')).not.toContain('time-leaf');
    }
    // The spaced spelling survives a save.
    const text: string = await page.evaluate(() => (window as any).__serialize());
    expect(text).toContain('    - Mon 5 Oct · 1:10 <kind : time> <id:t2>\n');
    expect(text).toContain('    - Thu 8 Oct · 1:25 <kind:time> <id:t1>\n');
  });

  test('kind letter T / S with an accessible name; node name says the record kind', async ({ page }) => {
    await open(page);
    const t1 = page.locator(`${node('t1')} .map-kind-letter`);
    await expect(t1).toHaveText('T');
    await expect(t1).toHaveAttribute('role', 'img');
    await expect(t1).toHaveAttribute('aria-label', 'Time record');
    await expect(page.locator(`${node('s1')} .map-kind-letter`)).toHaveText('S');
    await expect(page.locator(`${node('s1')} .map-kind-letter`)).toHaveAttribute('aria-label', 'Session record');
    await expect(page.locator(node('t1'))).toHaveAttribute('aria-label', 'Time record, Thu 8 Oct · 1:25');
    await expect(page.locator(node('s2'))).toHaveAttribute('aria-label', 'Session record, Fri 9 Oct · 3:05');
    // Caption is the host's text; the package adds only the letter (no "T T").
    expect((await page.locator(`${node('t1')} .map-label`).textContent())!.trim()).toBe('Thu 8 Oct · 1:25');
    // The running record's dot is green.
    const dot = await page.evaluate((s) => getComputedStyle(document.querySelector(`${s} .map-time-dot`)!).fill, node('t3'));
    expect(dot).toBe('rgb(63, 185, 80)');
    // The letter sits left of the caption, inside the pill.
    const [lb, cb, pb] = await Promise.all([
      t1.boundingBox(),
      page.locator(`${node('t1')} .map-label`).boundingBox(),
      page.locator(`${node('t1')} .map-pill`).boundingBox(),
    ]);
    expect(lb!.x).toBeGreaterThan(pb!.x);
    expect(lb!.x + lb!.width).toBeLessThanOrEqual(cb!.x + 0.5);
  });

  test('single line at 13.5 px, compact height; a long caption is cut with … (full text in the tooltip)', async ({ page }) => {
    await open(page);
    for (const id of LEAVES) {
      expect(await page.locator(`${node(id)} .map-label > tspan`).count(), id).toBe(1);
      await expect(page.locator(`${node(id)} .map-label`)).toHaveAttribute('font-size', '13.5');
    }
    await expect(page.locator(`${node('check')} .map-label`)).toHaveAttribute('font-size', '16');
    const note = await pillBox(page, 'check');
    const leaf = await pillBox(page, 't1');
    expect(leaf.h).toBeLessThan(note.h);
    expect(leaf.w).toBeGreaterThan(100);
    expect(leaf.w).toBeLessThan(170);
    const t4 = (await page.locator(`${node('t4')} .map-label`).textContent())!;
    expect(t4.trim().endsWith('…')).toBe(true);
    await expect(page.locator(`${node('t4')} > title`)).toHaveText(
      'Thu 8 Oct · 0:55 · notes for the cone 6 firing and the shelf wash',
    );
    await expect(page.locator(`${node('t4')} .map-body-more-hit`)).toHaveCount(0);
  });

  test('6 px between stacked time leaves; the default gap next to a note', async ({ page }) => {
    await open(page);
    const [t3, s2, t4] = await Promise.all(['t3', 's2', 't4'].map((id) => pillBox(page, id)));
    expect(s2.y - (t3.y + t3.h)).toBeCloseTo(6, 1);
    expect(t4.y - (s2.y + s2.h)).toBeCloseTo(6, 1);
    const [s1, check] = await Promise.all(['s1', 'check'].map((id) => pillBox(page, id)));
    expect(check.y - (s1.y + s1.h)).toBeCloseTo(14, 1);
  });

  test('green fill and border, hover brightens, 1 px green connector; focus keeps the ring', async ({ page }) => {
    await open(page);
    expect(await pillStyle(page, 't1')).toEqual({ fill: 'rgb(14, 42, 34)', stroke: 'rgb(46, 160, 67)', width: '1.25px' });
    const letter = await page.evaluate((s) => getComputedStyle(document.querySelector(`${s} .map-kind-letter`)!).fill, node('t1'));
    expect(letter).toBe('rgb(63, 185, 80)');
    expect(await edgeInto(page, 't1')).toEqual({ cls: 'map-edge edge-time', stroke: 'rgb(43, 138, 62)', width: '1px', opacity: '1' });
    expect((await edgeInto(page, 'check'))!.cls).toBe('map-edge');
    // Hover.
    const b = (await page.locator(`${node('s2')} .map-pill`).boundingBox())!;
    await page.mouse.move(b.x + 4, b.y + b.height / 2);
    await expect.poll(async () => (await pillStyle(page, 's2')).stroke).toBe('rgb(63, 185, 80)');
    // Focus ring.
    await page.evaluate(() => (window as any).__setFocus('t1'));
    await expect.poll(async () => (await pillStyle(page, 't1')).stroke).toBe('rgb(108, 182, 255)');
  });

  test('stays green under a branch colour rule', async ({ page }) => {
    await open(page);
    await page.addStyleTag({
      content: '.map-node.has-branch .map-pill { stroke: rgb(255, 0, 0); } .map-edge.has-branch { stroke: rgb(255, 0, 0); }',
    });
    await page.evaluate(() => {
      document.querySelectorAll('#mapHost .map-node, #mapHost .map-edge').forEach((e) => e.classList.add('has-branch'));
    });
    expect((await pillStyle(page, 't1')).stroke).toBe('rgb(46, 160, 67)');
    expect((await pillStyle(page, 'check')).stroke).toBe('rgb(255, 0, 0)');
    expect((await edgeInto(page, 't1'))!.stroke).toBe('rgb(43, 138, 62)');
  });

  test('light theme: #2b8a3e border, same dark fill', async ({ page }) => {
    await open(page, '&theme=light');
    expect(await pillStyle(page, 't1')).toEqual({ fill: 'rgb(14, 42, 34)', stroke: 'rgb(43, 138, 62)', width: '1.25px' });
  });

  test('no fold handle and no width grip on a time leaf', async ({ page }) => {
    await open(page);
    for (const id of LEAVES) {
      await expect(page.locator(`${node(id)} .map-fold-hit, ${node(id)} .map-fold-indicator`)).toHaveCount(0);
      await expect(page.locator(`${node(id)} .map-width-grip, ${node(id)} .map-width-hit`)).toHaveCount(0);
    }
    await expect(page.locator(`${node('check')} .map-width-hit`)).toHaveCount(1);
    // Selected: still no grip.
    await page.evaluate(() => (window as any).__setFocus('t1'));
    await expect(page.locator(`${node('t1')} .map-width-grip`)).toHaveCount(0);
    // A click on the corner opens no width popover (a note's corner does).
    const b = (await page.locator(`${node('t1')} .map-pill`).boundingBox())!;
    await page.mouse.click(b.x + b.width - 2, b.y + b.height - 2);
    await page.waitForTimeout(200);
    await expect(page.locator('.map-width-pop')).toHaveCount(0);
  });

  test('excluded from hold-to-fit: w does nothing, picks refuse it, 1 line siblings skips it', async ({ page }) => {
    await open(page);
    const before: string = await page.evaluate(() => (window as any).__serialize());
    expect(await page.evaluate(() => (window as any).__map.openWidthMenu('t2'))).toBe(false);
    for (const kind of ['fit', 'line', 'siblings', 'slim', 'wider', 'auto']) {
      expect(await page.evaluate((k) => (window as any).__map.applyWidthPick('t2', k), kind), kind).toBe(false);
    }
    await page.locator(node('t2')).click();
    await expectSelected(page, HOST, 't2');
    await page.keyboard.press('w');
    await page.waitForTimeout(150);
    await expect(page.locator('.map-width-pop')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__serialize())).toBe(before);
    // 1 line siblings from the note under Glaze lab: s1 and t2 are skipped.
    expect(await page.evaluate(() => (window as any).__map.openWidthMenu('check'))).toBe(true);
    await page.locator('.map-width-pop button[data-choice="siblings"]').click();
    await page.waitForTimeout(350);
    const steps = await page.evaluate(() => (window as any).__widthSteps);
    expect(steps.at(-1).kind).toBe('siblings');
    expect(steps.at(-1).keys).toEqual(['check']);
    const after: string = await page.evaluate(() => (window as any).__serialize());
    expect(after).toContain('<kind:session> <id:s1>\n');
    expect(after).not.toMatch(/^s1:|^t2:/m);
    // Still one line after the step.
    expect(await page.locator(`${node('t2')} .map-label > tspan`).count()).toBe(1);
  });

  test('keyboard navigation reaches and leaves time leaves', async ({ page }) => {
    await open(page);
    await page.locator(node('glaze')).click();
    await expectSelected(page, HOST, 'glaze');
    await page.keyboard.press('ArrowRight');
    await expectSelected(page, HOST, 's1');
    await page.keyboard.press('ArrowDown');
    await expectSelected(page, HOST, 'check');
    await page.keyboard.press('ArrowDown');
    await expectSelected(page, HOST, 't2');
    await page.keyboard.press('ArrowLeft');
    await expectSelected(page, HOST, 'glaze');
  });

  test('node menu opens on a time leaf (right-click and Shift+F10); the host contextmenu still sees it', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, '&nodemenu=1');
    const b = (await page.locator(`${node('t1')} .map-pill`).boundingBox())!;
    await page.mouse.click(b.x + 4, b.y + b.height / 2, { button: 'right' });
    const menu = page.locator(`${HOST} .map-node-menu`);
    await expect(menu).toHaveCount(1);
    expect(await page.locator(`${HOST} .map-node-menu [role="menuitem"]`).allTextContents()).toEqual(['Copy jump', 'Copy link']);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expectSelected(page, HOST, 't1');
    await page.keyboard.press('Shift+F10');
    await expect(menu).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('<r:t1>');
  });

  test('without the package menu, a right-click on a time leaf reaches the host (Open note)', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      (window as any).__ctx = [];
      document.getElementById('mapHost')!.addEventListener('contextmenu', (e) => {
        (window as any).__ctx.push((e.target as Element).closest('.map-node')?.getAttribute('data-id'));
        e.preventDefault();
      });
    });
    const b = (await page.locator(`${node('s2')} .map-pill`).boundingBox())!;
    await page.mouse.click(b.x + 4, b.y + b.height / 2, { button: 'right' });
    expect(await page.evaluate(() => (window as any).__ctx)).toEqual(['s2']);
  });
});
