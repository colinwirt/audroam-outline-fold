import { test, expect, type Page } from '@playwright/test';

/**
 * #N note chips and thread chips open the shared link popover (0.2.34):
 * rows (Open #N, Open map, Open details; never Go to), destination, new tab +
 * onNoteLink, onThread, placement right of the chip, open through pan,
 * modifier-click fallback, keyboard.
 * Host: examples/e2e-touch with notes.md (noteUri and noteMapUri on
 * notes.example.org; noteDetailsUri left to the built-in /notes/{id}/details).
 */

const HARNESS = 'examples/e2e-touch/index.html?doc=notes.md';
const POP = '.map-link-pop';
const chip = (pnid: string) => `.map-node[data-id="rota"] .map-note-link-hit[data-note-link="${pnid}"]`;

async function open(page: Page) {
  // The noteUri host is fictional: serve a stub so the new tab keeps its URL.
  await page.context().route('https://notes.example.org/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<title>note</title>' }),
  );
  await page.goto(HARNESS);
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(150);
}

async function clickSel(page: Page, sel: string, mods: ('Control' | 'Meta' | 'Shift')[] = []) {
  const b = (await page.locator(sel).boundingBox())!;
  for (const k of mods) await page.keyboard.down(k);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  for (const k of mods) await page.keyboard.up(k);
}

const rows = (page: Page) =>
  page.locator(`${POP} .map-link-item`).evaluateAll((els) =>
    els.map((a) => ({
      row: a.getAttribute('data-row'),
      label: a.querySelector('.map-link-label')?.textContent,
      where: a.querySelector('.map-link-where')?.textContent ?? null,
      href: a.getAttribute('href'),
      target: a.getAttribute('target'),
      rel: a.getAttribute('rel'),
    })),
  );

/** Popover and anchor rects read in one frame. */
const geo = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const g = document.querySelector(s)!.getBoundingClientRect();
    const p = document.querySelector('.map-link-pop')!.getBoundingClientRect();
    return { gap: p.left - g.right, dy: p.top + p.height / 2 - (g.top + g.height / 2) };
  }, sel);

test.describe('#N and thread chips open the link popover', () => {
  test('#N chip: Open #N, Open map (layout template), Open details (built-in default)', async ({ page }) => {
    await open(page);
    await clickSel(page, chip('1004'));
    await expect(page.locator(POP)).toHaveAttribute('data-kind', 'note');
    const tab = { target: '_blank', rel: 'noopener noreferrer' };
    expect(await rows(page)).toEqual([
      { row: 'note-open', label: 'Open #1004', where: 'notes.example.org', href: 'https://notes.example.org/n/1004', ...tab },
      { row: 'note-map', label: 'Open map', where: 'notes.example.org', href: 'https://notes.example.org/map?id=1004', ...tab },
      { row: 'note-details', label: 'Open details', where: '/notes/1004/details', href: '/notes/1004/details', ...tab },
    ]);
    expect(await page.evaluate(() => (window as any).__notes.length)).toBe(0);
    // Each chip opens its own popover. (The open one sits right of #1004,
    // over #1005, so close it first.)
    await page.keyboard.press('Escape');
    await expect(page.locator(POP)).toHaveCount(0);
    await clickSel(page, chip('1005'));
    await expect(page.locator(`${POP}:not(.is-closing)`)).toHaveCount(1);
    // A node with id 1005 is in this map, but <t:1005> is a note number: no Go to.
    expect((await rows(page)).map((r) => [r.row, r.label])).toEqual([
      ['note-open', 'Open #1005'],
      ['note-map', 'Open map'],
      ['note-details', 'Open details'],
    ]);
    expect(await page.locator(`${POP} :text("Go to")`).count()).toBe(0);
    const x = await geo(page, chip('1005'));
    expect(Math.abs(x.gap - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(x.dy)).toBeLessThanOrEqual(1);
  });

  test('Open #N and Open map open a new tab and fire onNoteLink; the selection stays', async ({ page, context }) => {
    await open(page);
    await clickSel(page, chip('1004'));
    const req = context.waitForEvent('request', (r) => r.url() === 'https://notes.example.org/n/1004');
    const popup = context.waitForEvent('page');
    await page.locator(`${POP} [data-row="note-open"]`).click();
    await req;
    expect((await popup) !== page).toBe(true);
    await expect(page.locator(POP)).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__notes)).toEqual([{ id: 'rota', pnid: '1004', open: 'note' }]);
    await clickSel(page, chip('1005'));
    const req2 = context.waitForEvent('request', (r) => r.url() === 'https://notes.example.org/map?id=1005');
    const popup2 = context.waitForEvent('page');
    await page.locator(`${POP} [data-row="note-map"]`).click();
    await req2;
    expect((await popup2) !== page).toBe(true);
    await expect(page.locator(POP)).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__notes.at(-1))).toEqual({ id: 'rota', pnid: '1005', open: 'map' });
    expect(await page.evaluate(() => (window as any).__focus())).toBe('rota');
  });

  test('Ctrl/Cmd-click keeps the SVG anchor: new tab straight away, no popover', async ({ page, context }) => {
    await open(page);
    expect(await page.locator(`.map-node[data-id="rota"] a[href="https://notes.example.org/n/1004"]`).count()).toBe(1);
    const req = context.waitForEvent('request', (r) => r.url() === 'https://notes.example.org/n/1004');
    const popup = context.waitForEvent('page');
    await clickSel(page, chip('1004'), [process.platform === 'darwin' ? 'Meta' : 'Control']);
    await req;
    expect((await popup) !== page).toBe(true);
    await expect(page.locator(POP)).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__notes.length)).toBe(1);
  });

  test('thread chip: one row, Open thread fires onThread', async ({ page }) => {
    await open(page);
    await clickSel(page, '.map-node[data-id="disc"] .map-thread-hit');
    await expect(page.locator(POP)).toHaveAttribute('data-kind', 'thread');
    expect((await rows(page)).map((r) => [r.row, r.label, r.where, r.href])).toEqual([['thread', 'Open thread', null, null]]);
    const x = await geo(page, '.map-node[data-id="disc"] .map-thread-hit');
    expect(Math.abs(x.gap - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(x.dy)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => (window as any).__threads.length)).toBe(0);
    // Keyboard: focused on open; Enter picks a row without an href.
    await expect(page.locator(`${POP} [data-row="thread"]`)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator(POP)).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__threads)).toEqual([{ id: 'disc', thread: 'pnid:900' }]);
  });

  test('stays open through a drag pan, moving with the chip; Esc closes to the map', async ({ page }) => {
    await open(page);
    await clickSel(page, chip('1004'));
    const h = (await page.locator('#mapHost').boundingBox())!;
    const before = (await page.locator(POP).boundingBox())!;
    await page.mouse.move(h.x + 30, h.y + h.height - 30);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(h.x + 30 + i * 6, h.y + h.height - 30 - i * 4);
    await page.mouse.up();
    await expect(page.locator(POP)).toHaveCount(1);
    await expect.poll(async () => (await geo(page, chip('1004'))).gap).toBeGreaterThan(7);
    const after = (await page.locator(POP).boundingBox())!;
    expect(Math.abs(after.x - before.x)).toBeGreaterThan(10);
    const x = await geo(page, chip('1004'));
    expect(Math.abs(x.gap - 8)).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await expect(page.locator(POP)).toHaveCount(0);
    await expect(page.locator('#mapHost')).toBeFocused();
  });

  test('Enter or Space on the focused #N anchor opens the popover', async ({ page }) => {
    await open(page);
    const a = page.locator('.map-node[data-id="rota"] a[href="https://notes.example.org/n/1004"]');
    await a.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(POP)).toHaveAttribute('data-kind', 'note');
    await page.keyboard.press('Escape');
    await expect(page.locator(POP)).toHaveCount(0);
    await a.focus();
    await page.keyboard.press(' ');
    await expect(page.locator(POP)).toHaveAttribute('data-kind', 'note');
  });
});
