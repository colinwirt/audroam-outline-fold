import { test, expect, type Page } from '@playwright/test';

/**
 * Day-map P1 tweaks (0.2.38, Design UX 2026-10-09 K9 P1):
 * K4 open-task emphasis, K6 folded count, K3 ↗ on popover rows, and the
 * authored (+) on an id-less line (validateDocument sessionIds).
 * Fixture: examples/e2e-touch/day-tweaks.md (fiction).
 */

const MAP = 'examples/e2e-touch/index.html?doc=day-tweaks.md';
const node = (id: string) => `#mapHost .map-node[data-id="${id}"]`;

async function open(page: Page, url = MAP) {
  await page.context().route('https://notes.example.org/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<title>note</title>' }),
  );
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(150);
}

async function clickSel(page: Page, sel: string) {
  const b = (await page.locator(sel).first().boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

const paint = (page: Page, id: string) =>
  page.evaluate((sel) => {
    const g = document.querySelector(sel)!;
    const pill = g.querySelector('.map-pill')!;
    const label = g.querySelector('.map-label')!;
    const pr = pill.getBoundingClientRect();
    const lr = label.getBoundingClientRect();
    return {
      cls: g.getAttribute('class'),
      stroke: getComputedStyle(pill).strokeWidth,
      weight: getComputedStyle(label).fontWeight,
      fill: getComputedStyle(label).fill,
      box: !!g.querySelector('.map-task-glyph'),
      hit: g.querySelector('.map-task-hit')?.getAttribute('aria-checked') ?? null,
      textRight: lr.right,
      pillRight: pr.right,
    };
  }, node(id));

test.describe('K4: the open tasks stand out', () => {
  test('open and in-progress: 2 px, semibold; done: 1 px, muted; box chrome intact', async ({ page }) => {
    await open(page);
    const compost = await paint(page, 'compost');
    expect(compost.stroke).toBe('2px');
    expect(compost.weight).toBe('600');
    expect(compost.box).toBe(true);
    expect(compost.hit).toBe('false');
    const beans = await paint(page, 'beans');
    expect(beans.stroke).toBe('2px');
    expect(beans.weight).toBe('600');
    expect(beans.hit).toBe('mixed');
    const butt = await paint(page, 'butt');
    expect(butt.stroke).toBe('1px');
    expect(butt.weight).toBe('400');
    expect(butt.fill).toBe('rgb(139, 155, 171)');
    expect(butt.hit).toBe('true');
    // Plain pills keep 1.5 px.
    expect((await paint(page, 'three')).stroke).toBe('1.5px');
    // Semibold text stays inside its pill (measured at 600).
    for (const p of [compost, beans]) expect(p.textRight).toBeLessThan(p.pillRight - 4);
  });

  test('the box still cycles open → in progress → done; done drops to 1 px muted', async ({ page }) => {
    await open(page);
    await clickSel(page, `${node('compost')} .map-task-hit`);
    await expect.poll(() => page.evaluate(() => (window as any).__tasks.length)).toBe(1);
    expect(await page.evaluate(() => (window as any).__tasks[0])).toEqual({ id: 'compost', from: 'open', to: 'pending' });
    // The tap selects the pill (focus ring 2.5 px); look at it unselected.
    await page.evaluate(() => (window as any).__setFocus('three'));
    const mid = await paint(page, 'compost');
    expect(mid.cls).toContain('task-pending');
    expect(mid.stroke).toBe('2px');
    expect(mid.weight).toBe('600');
    await clickSel(page, `${node('compost')} .map-task-hit`);
    await expect.poll(() => page.evaluate(() => (window as any).__tasks.length)).toBe(2);
    expect(await page.evaluate(() => (window as any).__tasks[1])).toEqual({ id: 'compost', from: 'pending', to: 'done' });
    await page.evaluate(() => (window as any).__setFocus('three'));
    const after = await paint(page, 'compost');
    expect(after.cls).toContain('task-done');
    expect(after.stroke).toBe('1px');
    expect(after.weight).toBe('400');
  });

  test('a focused open task shows the focus ring, not the 2 px task stroke', async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as any).__setFocus('compost'));
    const p = await paint(page, 'compost');
    expect(p.stroke).toBe('2.5px');
    expect(p.weight).toBe('600');
  });
});

test.describe('K6: a folded node shows its hidden-child count', () => {
  test('count 5 beside the + with "5 hidden"; outside the handle hit; gone when open', async ({ page }) => {
    await open(page);
    const seeds = page.locator(node('seeds'));
    await expect(seeds).toHaveAttribute('aria-expanded', 'false');
    await expect(seeds).toHaveAttribute('aria-label', /collapsed, 5 hidden/);
    const count = seeds.locator('.map-fold-count');
    await expect(count).toHaveCount(1);
    await expect(count).toHaveAttribute('aria-label', '5 hidden');
    await expect(count.locator('text')).toHaveText('5');
    const geo = await page.evaluate((sel) => {
      const g = document.querySelector(sel)!;
      const c = g.querySelector('.map-fold-count')!.getBoundingClientRect();
      const h = g.querySelector('.map-fold-hit')!.getBoundingClientRect();
      const ind = g.querySelector('.map-fold-indicator')!.getBoundingClientRect();
      const t = getComputedStyle(g.querySelector('.map-fold-count text')!);
      const at = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
      return {
        gapFromHit: c.left - h.right,
        gapFromHandle: c.left - ind.right,
        dy: c.top + c.height / 2 - (ind.top + ind.height / 2),
        fontSize: t.fontSize,
        underCount: at?.closest('.map-fold-hit, .map-fold-indicator') ? 'handle' : 'other',
      };
    }, node('seeds'));
    expect(geo.gapFromHit).toBeGreaterThanOrEqual(0);
    expect(geo.gapFromHandle).toBeLessThan(12);
    expect(Math.abs(geo.dy)).toBeLessThanOrEqual(1);
    expect(geo.fontSize).toBe('11px');
    expect(geo.underCount).toBe('other');
    // The + still folds; open, the count is gone; fold again, it is back.
    await clickSel(page, `${node('seeds')} .map-fold-hit`);
    await expect(seeds).toHaveAttribute('aria-expanded', 'true');
    await expect(seeds.locator('.map-fold-count')).toHaveCount(0);
    await clickSel(page, `${node('seeds')} .map-fold-hit`);
    await expect(seeds).toHaveAttribute('aria-expanded', 'false');
    await expect(seeds.locator('.map-fold-count')).toHaveAttribute('aria-label', '5 hidden');
    // The folded handle keeps its gold disc.
    const gold = await seeds.locator('.map-fold-indicator circle').evaluate((c) => getComputedStyle(c).fill);
    expect(gold).toBe('rgb(201, 162, 39)');
  });
});

test.describe('K3: ↗ on #N popover rows, never on jumps', () => {
  test('Open #N, Open map, Open details each end in ↗; names say new window', async ({ page }) => {
    await open(page);
    await clickSel(page, `${node('compost')} .map-note-link-hit[data-note-link="2101"]`);
    const pop = page.locator('.map-link-pop:not(.is-closing)');
    await expect(pop).toHaveAttribute('data-kind', 'note');
    const rows = await pop.locator('.map-link-item').evaluateAll((els) =>
      els.map((a) => ({
        row: a.getAttribute('data-row'),
        last: a.lastElementChild?.className,
        arrow: a.querySelector('.map-link-ext')?.textContent,
        hidden: a.querySelector('.map-link-ext')?.getAttribute('aria-hidden'),
        target: a.getAttribute('target'),
      })),
    );
    expect(rows.map((r) => r.row)).toEqual(['note-open', 'note-map', 'note-details']);
    for (const r of rows) {
      expect(r).toMatchObject({ last: 'map-link-ext', arrow: '↗', hidden: 'true', target: '_blank' });
    }
    await expect(page.getByRole('menuitem', { name: 'Open #2101, notes.example.org, opens in new window' })).toHaveCount(1);
    // The arrow sits at the row's right end, after the destination.
    const ends = await pop.locator('.map-link-item').first().evaluate((a) => {
      const r = a.getBoundingClientRect();
      const x = a.querySelector('.map-link-ext')!.getBoundingClientRect();
      const w = a.querySelector('.map-link-where')!.getBoundingClientRect();
      return { pad: r.right - x.right, after: x.left - w.right };
    });
    expect(ends.pad).toBeLessThanOrEqual(10);
    expect(ends.after).toBeGreaterThanOrEqual(4);
  });

  test('the in-map jump chip has no ↗', async ({ page }) => {
    await open(page);
    const text = await page.locator(`${node('hop')} .map-jump-link`).textContent();
    expect(text).toContain('Today');
    expect(text).not.toContain('↗');
  });
});

test.describe('authored (+) on a line with no id', () => {
  const shelf = (page: Page) => page.locator('#mapHost .map-node[aria-label^="Reference shelf"]');

  test('validateDocument(md).doc: the line has no id, so it draws open (unchanged)', async ({ page }) => {
    await open(page, `${MAP}&parse=validate`);
    await expect(shelf(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#mapHost .map-node[aria-label^="Frost dates"]')).toHaveCount(1);
  });

  test('validateDocument(md, { sessionIds: true }).doc: loads folded with its count, and unfolds', async ({ page }) => {
    await open(page, `${MAP}&parse=validate&ids=session`);
    await expect(shelf(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(shelf(page).locator('.map-fold-count')).toHaveAttribute('aria-label', '2 hidden');
    await expect(page.locator('#mapHost .map-node[aria-label^="Frost dates"]')).toHaveCount(0);
    const b = (await shelf(page).locator('.map-fold-hit').boundingBox())!;
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await expect(shelf(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#mapHost .map-node[aria-label^="Frost dates"]')).toHaveCount(1);
    // Session ids are never written: the line round-trips with its marker gone only because it is open.
    const out: string = await page.evaluate(() => (window as any).__serialize());
    expect(out).toContain('  - Reference shelf\n');
    expect(out).not.toMatch(/Reference shelf.*<id:/);
  });
});
