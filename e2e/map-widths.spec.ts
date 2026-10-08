import { test, expect, type Page } from '@playwright/test';

/**
 * Hold-to-fit P1 (Design UX 2026-10-08, F14 P1): the width popover's Fit row
 * on tap, the `w` key with mnemonics, batched persistence as ordinary `w`
 * entries (+ `w-auto: single-line`, F5a), undo steps with the toast (F7),
 * lazy ids (F8) and the pill-left camera anchor (F9). Desktop Chrome, mouse
 * and keyboard. Fixture: examples/e2e-touch/widths.md (fictional).
 */

const HARNESS = 'examples/e2e-touch/index.html?doc=widths.md';

const GLOVES = 'Bring gloves';
const COMPOST = 'Compost bays';
const SEEDS = 'Seeds';
const PLOT = 'Plot seven';
const BEANS = 'Runner beans';
const PUMPKINS = 'Pumpkins';
const MOWER = 'The ride-on mower';

async function open(page: Page, query = '') {
  await page.goto(HARNESS + query);
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(150);
}

/** data-id of the pill whose caption starts with `text`. */
function keyOf(page: Page, text: string): Promise<string> {
  return page.evaluate((t) => {
    const g = [...document.querySelectorAll('#mapHost .map-node')].find((n) =>
      (n.querySelector('.map-label')?.textContent || '').trim().startsWith(t),
    );
    if (!g) throw new Error(`no pill for ${t}`);
    return g.getAttribute('data-id')!;
  }, text);
}

const sel = (key: string) => `#mapHost .map-node[data-id="${key}"]`;
const textW = (page: Page, key: string) =>
  page.evaluate((s) => Number(document.querySelector(s)!.getAttribute('data-text-w')), sel(key));
const lineCount = (page: Page, key: string) =>
  page.evaluate((s) => document.querySelectorAll(`${s} .map-label > tspan`).length, sel(key));
const stored = (page: Page, key: string) =>
  page.evaluate((k) => {
    const e = (window as any).__layout().nodes?.[k];
    return { w: e?.w ?? null, wAuto: e?.wAuto ?? null };
  }, key);
const text = (page: Page) => page.evaluate(() => (window as any).__serialize() as string);
const live = (page: Page) => page.locator('#mapHost .map-live');
const toast = (page: Page) => page.locator('#mapHost .map-toast');

/** Lines of the layout block entry for `id` (`w: N`, `w-auto: …`). */
function layoutEntry(doc: string, id: string): string[] {
  const block = doc.split('--- layout ---\n')[1] || '';
  const lines = block.split('\n');
  const at = lines.indexOf(`${id}:`);
  if (at < 0) return [];
  const out: string[] = [];
  for (let i = at + 1; i < lines.length && /^\s+/.test(lines[i]!); i++) out.push(lines[i]!.trim());
  return out;
}

/** Id written on the line that starts with `caption` (null when none). */
function writtenId(doc: string, caption: string): string | null {
  const line = doc.split('\n').find((l) => l.trim().startsWith(`- ${caption}`));
  return line?.match(/<id:([^>]+)>/)?.[1] ?? null;
}

async function openPop(page: Page, key: string) {
  const pill = (await page.locator(`${sel(key)} .map-pill`).boundingBox())!;
  await page.mouse.click(pill.x + pill.width - 2, pill.y + pill.height - 2);
  await expect(page.locator('.map-width-pop')).toHaveCount(1);
}

/** Open the popover through the API (the pill's corner may be off-screen once it is wide). */
async function openMenu(page: Page, key: string) {
  expect(await page.evaluate((k) => (window as any).__map.openWidthMenu(k), key)).toBe(true);
  await expect(page.locator('.map-width-pop')).toHaveCount(1);
}

async function pick(page: Page, choice: string) {
  await page.locator(`.map-width-pop button[data-choice="${choice}"]`).click();
  await expect(page.locator('.map-width-pop')).toHaveCount(0);
  await page.waitForTimeout(350);
}

/** Full captions (fixture text) for the package's own measures. */
const CAPTIONS: Record<string, string> = {
  [GLOVES]: 'Bring gloves, a trowel and a flask of tea; the shed key is under the blue pot by the gate',
  [BEANS]: 'Runner beans did well along the south fence after the extra mulch in late October',
  [MOWER]: 'The ride-on mower needs a new drive belt before the summer cutting season starts again',
};

/** Natural one-line, Fit text and Auto px for a caption, measured by the package. */
function natural(page: Page, caption: string) {
  return page.evaluate(async (label) => {
    const m = await import('/audroam-outline-fold/dist/index.js' as string);
    return { nat: m.naturalLineWidth(label), fit: m.fitTextWidth(label), auto: m.autoTextWidth(label) };
  }, CAPTIONS[caption]!);
}

test.describe('hold-to-fit P1: the width popover gains a Fit row', () => {
  test('two groups, six items, roles and ✓ state', async ({ page }) => {
    await open(page);
    const k = await keyOf(page, GLOVES);
    await openPop(page, k);
    const groups = await page.evaluate(() =>
      [...document.querySelectorAll('.map-width-pop [role="group"]')].map((g) => ({
        label: g.getAttribute('aria-label'),
        items: [...g.querySelectorAll('button')].map((b) => ({
          choice: (b as HTMLElement).dataset.choice,
          role: b.getAttribute('role'),
          checked: b.getAttribute('aria-checked'),
          text: b.textContent,
          keys: b.getAttribute('aria-keyshortcuts'),
          h: b.getBoundingClientRect().height,
        })),
      })),
    );
    expect(groups.map((g) => g.label)).toEqual(['Fit', 'Width']);
    const items = groups.flatMap((g) => g.items);
    expect(items.map((i) => i.choice)).toEqual(['fit-text', 'line', 'siblings', 'slim', 'wider', 'auto']);
    expect(items.map((i) => i.role)).toEqual([
      'menuitemradio',
      'menuitemradio',
      'menuitem',
      'menuitemradio',
      'menuitemradio',
      'menuitemradio',
    ]);
    expect(items[2]!.checked).toBeNull();
    expect(items.filter((i) => i.checked === 'true').map((i) => i.text)).toEqual(['✓ Auto']);
    expect(items.map((i) => i.keys)).toEqual(['t', 'l', 's', null, null, 'a']);
    // Fine pointer: 32 px rows; no key hints on a pointer open (F13).
    for (const i of items) expect(i.h).toBeGreaterThanOrEqual(32);
    await expect(page.locator('.map-width-pop kbd')).toHaveCount(0);
  });

  test('1 line: natural width with w-auto, one id minted, one step with a toast', async ({ page }) => {
    await open(page);
    const k = await keyOf(page, GLOVES);
    const before = await text(page);
    expect(writtenId(before, GLOVES)).toBeNull();
    expect(await lineCount(page, k)).toBeGreaterThan(1);
    const { nat } = await natural(page, GLOVES);
    await openPop(page, k);
    const c0 = await page.evaluate(() => (window as any).__changes);
    await pick(page, 'line');
    // One batched write: one onChange.
    expect(await page.evaluate(() => (window as any).__changes)).toBe(c0 + 1);
    expect(await lineCount(page, k)).toBe(1);
    expect(await textW(page, k)).toBe(Math.max(120, nat));
    expect(await stored(page, k)).toEqual({ w: Math.max(120, nat), wAuto: 'single-line' });
    const after = await text(page);
    const id = writtenId(after, GLOVES);
    expect(id).toBe(k);
    expect(layoutEntry(after, id!)).toEqual([`w: ${Math.max(120, nat)}`, 'w-auto: single-line']);
    // Only the written pill got an id.
    for (const other of [SEEDS, PLOT, BEANS, PUMPKINS]) expect(writtenId(after, other)).toBeNull();
    await expect(live(page)).toHaveText(/^Bring gloves.* on 1 line\.$/);
    await expect(toast(page)).toHaveAttribute('role', 'status');
    await expect(toast(page).locator('.map-toast-text')).toHaveText('1 width changed');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.map-toast'))).toBe(false);
    // ✓ moves to 1 line.
    await openMenu(page, k);
    expect(
      await page.locator('.map-width-pop [aria-checked="true"] .map-width-label').evaluateAll((b) => b.map((x) => x.textContent)),
    ).toEqual(['✓ 1 line']);
  });

  test('1 line keeps authored line breaks on their own rows (never "…")', async ({ page }) => {
    await open(page);
    const k = await keyOf(page, PLOT);
    await openPop(page, k);
    await pick(page, 'line');
    expect(await lineCount(page, k)).toBe(2);
    const label = await page.locator(`${sel(k)} .map-label`).textContent();
    expect(label).not.toContain('…');
  });

  test('1 line siblings: same parent only, each its own width; Undo restores exactly', async ({ page }) => {
    await open(page);
    const before = await text(page);
    const keys = {
      gloves: await keyOf(page, GLOVES),
      compost: await keyOf(page, COMPOST),
      seeds: await keyOf(page, SEEDS),
      plot: await keyOf(page, PLOT),
      beans: await keyOf(page, BEANS),
    };
    expect(await stored(page, keys.compost)).toEqual({ w: 180, wAuto: null });
    await openPop(page, keys.gloves);
    await pick(page, 'siblings');
    const ws = {
      gloves: await textW(page, keys.gloves),
      compost: await textW(page, keys.compost),
      plot: await textW(page, keys.plot),
    };
    for (const k of [keys.gloves, keys.compost, keys.plot]) {
      expect((await stored(page, k)).wAuto).toBe('single-line');
      expect(await lineCount(page, k)).toBe(k === keys.plot ? 2 : 1);
    }
    // Each its own width, not a shared one.
    expect(new Set(Object.values(ws)).size).toBe(3);
    // Seeds already fits on one line at Auto: nothing written, no id (F4/F8).
    expect(await stored(page, keys.seeds)).toEqual({ w: null, wAuto: null });
    // Other parent's children are untouched.
    expect(await stored(page, keys.beans)).toEqual({ w: null, wAuto: null });
    const after = await text(page);
    expect(writtenId(after, SEEDS)).toBeNull();
    expect(writtenId(after, BEANS)).toBeNull();
    expect(writtenId(after, 'Spring work days')).toBeNull();
    expect(writtenId(after, GLOVES)).not.toBeNull();
    expect(writtenId(after, PLOT)).not.toBeNull();
    expect(layoutEntry(after, 'compost')).toEqual([`w: ${ws.compost}`, 'w-auto: single-line']);
    await expect(live(page)).toHaveText(/^Bring gloves.* and 3 siblings on 1 line\.$/);
    await expect(toast(page).locator('.map-toast-text')).toHaveText('3 widths changed');
    await toast(page).locator('.map-toast-undo').click();
    await page.waitForTimeout(350);
    await expect(toast(page)).toHaveCount(0);
    await expect(live(page)).toHaveText('Widths restored.');
    expect(await stored(page, keys.compost)).toEqual({ w: 180, wAuto: null });
    // The ids this step minted are taken back: the text is as it was.
    expect(await text(page)).toBe(before);
  });

  test('Fit text: widest line at 60ch; within 4 px of Auto deletes (no id, no step)', async ({ page }) => {
    await open(page);
    const k = await keyOf(page, BEANS);
    const m = await natural(page, BEANS);
    await openPop(page, k);
    await pick(page, 'fit-text');
    expect(await stored(page, k)).toEqual({ w: m.fit, wAuto: null });
    expect(m.fit).toBeLessThan(m.nat);
    await expect(live(page)).toHaveText(/^Runner beans.* wraps at 60 characters\.$/);
    const p = await keyOf(page, PUMPKINS);
    await toast(page).locator('.map-toast-close').click();
    await openPop(page, p);
    const c0 = await page.evaluate(() => (window as any).__changes);
    await pick(page, 'fit-text');
    expect(await stored(page, p)).toEqual({ w: null, wAuto: null });
    expect(writtenId(await text(page), PUMPKINS)).toBeNull();
    await expect(live(page)).toHaveText('Pumpkins at default width.');
    expect(await page.evaluate(() => (window as any).__changes)).toBe(c0);
    await expect(toast(page)).toHaveCount(0);
  });

  test('Slim, Wider and Fit text drop w-auto; Auto drops both keys', async ({ page }) => {
    await open(page);
    const k = await keyOf(page, GLOVES);
    await openPop(page, k);
    await pick(page, 'line');
    await openMenu(page, k);
    await pick(page, 'slim');
    expect((await stored(page, k)).wAuto).toBeNull();
    expect(layoutEntry(await text(page), k)).toHaveLength(1);
    await openMenu(page, k);
    await pick(page, 'fit-text');
    expect((await stored(page, k)).wAuto).toBeNull();
    await openMenu(page, k);
    await pick(page, 'line');
    expect((await stored(page, k)).wAuto).toBe('single-line');
    await openMenu(page, k);
    await pick(page, 'auto');
    expect(await stored(page, k)).toEqual({ w: null, wAuto: null });
    expect(layoutEntry(await text(page), k)).toEqual([]);
  });
});

test.describe('hold-to-fit P1: keyboard', () => {
  test('w opens the menu on its current item; mnemonics pick; Esc closes', async ({ page }) => {
    await open(page);
    const k = await keyOf(page, GLOVES);
    await page.evaluate((id) => (window as any).__setFocus(id), k);
    await page.locator('#mapHost').focus();
    await page.keyboard.press('w');
    await expect(page.locator('.map-width-pop')).toHaveCount(1);
    expect(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.choice)).toBe('auto');
    // Key hints show when the keyboard opened it.
    await expect(page.locator('.map-width-pop kbd')).toHaveText(['t', 'l', 's', 'a']);
    await page.keyboard.press('l');
    await expect(page.locator('.map-width-pop')).toHaveCount(0);
    await page.waitForTimeout(300);
    expect((await stored(page, k)).wAuto).toBe('single-line');
    // Focus goes back to the map, so `w` works again.
    await page.keyboard.press('w');
    expect(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.choice)).toBe('line');
    await page.keyboard.press('Escape');
    await expect(page.locator('.map-width-pop')).toHaveCount(0);
    await page.keyboard.press('w');
    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.choice)).toBe('siblings');
    await page.keyboard.press('a');
    await page.waitForTimeout(300);
    expect(await stored(page, k)).toEqual({ w: null, wAuto: null });
  });

  test('Ctrl+Z undoes a width step in view mode, Shift+Ctrl+Z redoes it', async ({ page }) => {
    await open(page);
    const k = await keyOf(page, COMPOST);
    await page.evaluate((id) => (window as any).__setFocus(id), k);
    await page.locator('#mapHost').focus();
    await page.keyboard.press('w');
    await page.keyboard.press('l');
    await page.waitForTimeout(300);
    const w1 = (await stored(page, k)).w;
    expect(w1).toBeGreaterThan(180);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect(await stored(page, k)).toEqual({ w: 180, wAuto: null });
    await expect(live(page)).toHaveText('Widths restored.');
    await page.keyboard.press('Control+Shift+Z');
    await page.waitForTimeout(300);
    expect(await stored(page, k)).toEqual({ w: w1, wAuto: 'single-line' });
  });

  test('a drag is an undo step too (no toast)', async ({ page }) => {
    await open(page);
    const k = await keyOf(page, COMPOST);
    await page.evaluate((id) => (window as any).__setFocus(id), k);
    const pill = (await page.locator(`${sel(k)} .map-pill`).boundingBox())!;
    const x = pill.x + pill.width - 2;
    const y = pill.y + pill.height - 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x + i * 10, y);
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect((await stored(page, k)).w).toBeGreaterThan(200);
    await expect(toast(page)).toHaveCount(0);
    await page.locator('#mapHost').focus();
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect(await stored(page, k)).toEqual({ w: 180, wAuto: null });
  });
});

test.describe('hold-to-fit P1: persistence, camera, w-auto', () => {
  test('read-only viewer: session-only widths, no ids, no onChange', async ({ page }) => {
    await open(page, '&readonly=1');
    const before = await text(page);
    const k = await keyOf(page, GLOVES);
    const compost = await keyOf(page, COMPOST);
    await openPop(page, k);
    const c0 = await page.evaluate(() => (window as any).__changes);
    await pick(page, 'siblings');
    expect(await page.evaluate(() => (window as any).__changes)).toBe(c0);
    expect(await lineCount(page, k)).toBe(1);
    expect((await stored(page, compost)).wAuto).toBe('single-line');
    expect(await text(page)).toBe(before);
    // Auto over an authored width is a session override (w: 0), still no write.
    await openMenu(page, compost);
    await pick(page, 'auto');
    expect(await stored(page, compost)).toEqual({ w: 0, wAuto: null });
    expect(await text(page)).toBe(before);
    await page.locator('#mapHost').focus();
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect(await stored(page, compost)).toEqual({ w: 180, wAuto: null });
  });

  test('a host stack takes the steps (onWidthStep → true): no toast, no package undo', async ({ page }) => {
    await open(page, '&hoststack=1');
    const k = await keyOf(page, GLOVES);
    await openPop(page, k);
    await pick(page, 'line');
    await expect(toast(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__widthSteps)).toEqual([
      { kind: 'line', keys: [k], label: '1 width changed' },
    ]);
    await page.locator('#mapHost').focus();
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    expect((await stored(page, k)).wAuto).toBe('single-line');
    await page.evaluate(() => (window as any).__lastStep.undo());
    await page.waitForTimeout(300);
    expect(await stored(page, k)).toEqual({ w: null, wAuto: null });
  });

  test('the pressed pill keeps its left edge and vertical centre; zoom unchanged (F9)', async ({ page }) => {
    await open(page);
    const k = await keyOf(page, BEANS);
    const k0 = await page.evaluate(() => (window as any).__map.cam.k);
    const b0 = (await page.locator(`${sel(k)} .map-pill`).boundingBox())!;
    await openPop(page, k);
    await pick(page, 'line');
    await page.waitForTimeout(300);
    const b1 = (await page.locator(`${sel(k)} .map-pill`).boundingBox())!;
    expect(b1.width).toBeGreaterThan(b0.width + 40);
    expect(Math.abs(b1.x - b0.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(b1.y + b1.height / 2 - (b0.y + b0.height / 2))).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => (window as any).__map.cam.k)).toBe(k0);
  });

  test('w-auto: single-line re-measures on render, capped at the map width − 48 (F5a)', async ({ page }) => {
    await open(page);
    const k = await keyOf(page, MOWER);
    const { nat } = await natural(page, MOWER);
    // The authored w is 150; the render uses the natural one-line width.
    expect(await textW(page, k)).toBe(nat);
    expect(await lineCount(page, k)).toBe(1);
    expect(layoutEntry(await text(page), 'mower')).toEqual([`w: ${nat}`, 'w-auto: single-line']);
    // A narrow map: capped at its width − 48, and the caption wraps there.
    await page.setViewportSize({ width: 520, height: 800 });
    await page.evaluate(() => (window as any).__map.paint());
    const hostW = await page.evaluate(() => document.getElementById('mapHost')!.clientWidth);
    expect(await textW(page, k)).toBe(Math.floor(hostW - 48));
    expect(await lineCount(page, k)).toBeGreaterThan(1);
  });
});

test.describe('hold-to-fit P1: the undo toast (D5 pattern)', () => {
  test('stays about 8 s, pauses while hovered, ✕ dismisses', async ({ page }) => {
    test.setTimeout(60_000);
    await open(page);
    const k = await keyOf(page, BEANS);
    await openPop(page, k);
    await pick(page, 'fit-text');
    await expect(toast(page)).toHaveCount(1);
    await toast(page).hover();
    await page.waitForTimeout(9000);
    await expect(toast(page)).toHaveCount(1);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(8600);
    await expect(toast(page)).toHaveCount(0);
    await openMenu(page, k);
    await pick(page, 'auto');
    await toast(page).locator('.map-toast-close').click();
    await expect(toast(page)).toHaveCount(0);
    // Dismissed is not undone.
    expect(await stored(page, k)).toEqual({ w: null, wAuto: null });
  });
});
