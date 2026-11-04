import { test, expect, type Page } from '@playwright/test';

/** 0.5.19 node colours (EP-31…EP-37) and coloured clouds (EP-38). Fixture: examples/e2e-touch/colour.md. */
const URL = 'examples/e2e-touch/colour.html';
const node = (id: string) => `#mapHost .map-node[data-id="${id}"]`;
const cloud = (id: string) => `#mapHost .map-cloud[data-cloud="${id}"]`;

async function open(page: Page, q = '') {
  await page.goto(URL + q);
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(150);
}
const text = (page: Page) => page.evaluate(() => (window as any).__serialize() as string);
const pillStroke = (page: Page, id: string) =>
  page.locator(`${node(id)} .map-pill`).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { stroke: cs.stroke, width: cs.strokeWidth, fill: cs.fill };
  });
const cssVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.querySelector('#mapHost')!).getPropertyValue(n).trim(), name);
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

test('coloured pills: 2px token border, wash, accessible name; coloured cloud; screenshot', async ({ page }) => {
  await open(page);
  const red = await cssVar(page, '--node-ember');
  const s = await pillStroke(page, 'fl');
  expect(s.stroke).toBe(rgb(red));
  expect(s.width).toBe('2px');
  // Uncoloured node keeps the default pill.
  expect((await pillStroke(page, 'loose')).stroke).not.toBe(rgb(red));
  await expect(page.locator(node('fl'))).toHaveAttribute('aria-label', /Flights, ember/);
  // Named cloud paints in its token, not the neutral cloud colour.
  const cp = page.locator(`${cloud('trip')} path`);
  await expect(cp).toHaveAttribute('stroke', 'var(--node-pine)');
  const cs = await cp.evaluate((el) => getComputedStyle(el).stroke);
  expect(cs).toBe(rgb(await cssVar(page, '--node-pine')));
  await expect(page.locator(`${cloud('ideas')} path`)).toHaveAttribute('stroke', 'var(--node-ember)');
  // Outline: bar class + hidden ", ember".
  await expect(page.locator('#outline [data-id="fl"]').first()).toHaveClass(/of-colour-ember/);
  await expect(page.locator('#outline [data-id="fl"] .of-sr').first()).toHaveText(', ember');
  // Highlighter: strong fluoro wash, dark ink label.
  await expect(page.locator(node('mu'))).toHaveClass(/is-hl/);
  expect(await page.locator(`${node('mu')} .map-label`).evaluate((el) => getComputedStyle(el).fill)).toBe(rgb('#0b1a21'));
  await page.locator('#panel').screenshot({ path: 'test-results/colour.png' });
  if (process.env.COLOUR_SHOT) await page.locator('#panel').screenshot({ path: process.env.COLOUR_SHOT });
});

test('selection keeps the separate offset ring on a coloured node (EP-33, EP-37)', async ({ page }) => {
  await open(page, '?focus=fl');
  const ring = page.locator(`${node('fl')} .map-colour-ring`);
  await expect(ring).toHaveCount(1);
  const r = await ring.evaluate((el) => getComputedStyle(el).stroke);
  expect(r).toBe(rgb('#6cb6ff'));
  // The pill border keeps the colour, not the ring blue.
  expect((await pillStroke(page, 'fl')).stroke).toBe(rgb(await cssVar(page, '--node-ember')));
  expect(await cssVar(page, '--node-creek')).not.toBe('#6cb6ff');
});

test('node menu Colour row writes the layout entry (0.5.22); None clears; cloud colour row', async ({ page }) => {
  await open(page);
  const b = (await page.locator(`${node('loose')} .map-pill`).boundingBox())!;
  const menu = async () => page.mouse.click(b.x + 5, b.y + b.height / 2, { button: 'right' });
  await menu();
  const row = page.locator('.map-node-menu .map-node-menu-swatches[aria-label="Colour · Forest"]');
  const hlRow = page.locator('.map-node-menu .map-node-menu-swatches[aria-label="Colour · Highlighter"]');
  await expect(row.locator('[role="menuitemradio"]')).toHaveCount(10);
  await expect(hlRow.locator('[role="menuitemradio"]')).toHaveCount(5);
  await expect(row.locator('[data-item="color:none"]')).toHaveAttribute('aria-checked', 'true');
  // Right arrow runs from the last Forest swatch into the Highlighter row, and back.
  await row.locator('[data-item="color:stone"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(hlRow.locator('[data-item="color:lemon"]')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(row.locator('[data-item="color:stone"]')).toBeFocused();
  await row.locator('[data-item="color:slate"]').click();
  expect(await text(page)).toContain('- Loose note <id:loose>');
  expect(await text(page)).toMatch(/\nloose:\n  color: slate\n/);
  await expect(page.locator(node('loose'))).toHaveClass(/colour-slate/);
  // Add a cloud, then colour it from the Cloud colour row.
  await menu();
  await page.locator('.map-node-menu [role="menuitemcheckbox"]', { hasText: 'Cloud' }).click();
  await menu();
  await page.locator('.map-node-menu-swatches[aria-label="Cloud colour · Forest"] [data-item="cloud-color:lichen"]').click();
  expect(await text(page)).toContain('- Loose note <cloud:lichen> <id:loose>');
  expect(await text(page)).toMatch(/\nloose:\n  color: slate\n/);
  await expect(page.locator(`${cloud('loose')} path`)).toHaveAttribute('stroke', 'var(--node-lichen)');
  // Keyboard: Enter on None clears.
  await menu();
  await page.locator('.map-node-menu-swatches[aria-label="Colour · Forest"] [data-item="color:none"]').focus();
  await page.keyboard.press('Enter');
  expect(await text(page)).toContain('- Loose note <cloud:lichen> <id:loose>');
  expect(await text(page)).not.toMatch(/\nloose:\n  colou?r:/);
});

test('icon picker Colours row sets the colour (EP-31)', async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window as any).__map.openIconPicker('mu'));
  const row = page.getByTestId('of-ep-colours');
  await expect(row.locator('[role="radio"]')).toHaveCount(24); // 0.5.23: + Audroam row
  expect(await row.locator('.of-ep-colours-cap').allTextContents()).toEqual(['Forest', 'Highlighter', 'Audroam']);
  await row.getByTestId('of-ep-swatch-fern').click();
  // 0.5.22: migrated from the inline tag to the layout entry; fill kept on recolour (0.5.20).
  expect(await text(page)).toContain('- Museums <id:mu>');
  expect(await text(page)).toMatch(/\nmu:\n  color: fern:fill\n/);
  await expect(row.getByTestId('of-ep-swatch-fern')).toHaveAttribute('aria-checked', 'true');
});

test('light theme: tokens retune, pills keep coloured borders', async ({ page }) => {
  await open(page, '?theme=light');
  expect(await cssVar(page, '--node-ember')).toBe('#c8501f');
  expect((await pillStroke(page, 'fl')).stroke).toBe(rgb('#c8501f'));
  // Highlighter keeps dark ink on the fluoro wash.
  expect(await page.locator(`${node('mu')} .map-label`).evaluate((el) => getComputedStyle(el).fill)).toBe(rgb('#0b1a21'));
  await page.locator('#panel').screenshot({ path: 'test-results/colour-light.png' });
});

test('0.5.20 branch colour: grandchild border, no wash by default, :fill inherited, cloud tint', async ({ page }) => {
  await open(page);
  const moss = rgb(await cssVar(page, '--node-moss'));
  const tm = await pillStroke(page, 'tm');
  expect(tm.stroke).toBe(moss);
  expect(tm.fill).toBe((await pillStroke(page, 'loose')).fill);
  expect((await pillStroke(page, 'dr')).fill).not.toBe((await pillStroke(page, 'loose')).fill);
  await expect(page.locator(`${cloud('sh')} path`)).toHaveAttribute('stroke', 'var(--node-moss)');
  await page.locator('#panel').screenshot({ path: 'test-results/colour-inherit.png' });
});

/** 0.5.23 code regions and palettes. Fixture: examples/e2e-touch/code.md via ?md=code.md. */
const codeFill = (page: Page, id: string) =>
  page.locator(`${node(id)} rect.map-code-bg`).first().evaluate((el) => getComputedStyle(el).fill);
for (const theme of ['dark', 'light'] as const) {
  test(`0.5.23 code regions (${theme}): own background, unchanged inside a fill branch`, async ({ page }) => {
    await open(page, `?md=code.md${theme === 'light' ? '&theme=light' : ''}`);
    const plain = await codeFill(page, 'b');
    expect(plain).toBe(rgb(await cssVar(page, '--map-code-bg')));
    expect(plain).not.toBe((await pillStroke(page, 'b')).fill);
    // Inside an ember:fill branch and a Highlighter fill: the same code background.
    expect(await codeFill(page, 'wc')).toBe(plain);
    expect(await codeFill(page, 'hl')).toBe(plain);
    expect((await pillStroke(page, 'wc')).fill).not.toBe((await pillStroke(page, 'b')).fill);
    // Fenced block: one rect for the two lines, no fence glyphs painted.
    await expect(page.locator(`${node('blk')} rect.map-code-bg`)).toHaveCount(1);
    await expect(page.locator(`${node('blk')} .map-label`)).not.toContainText('```');
    // Code ink stays light on the dark code background inside a dark-ink fill.
    const ink = await page.locator(`${node('hl')} tspan.map-code`).evaluate((el) => getComputedStyle(el).fill);
    expect(ink).toBe(rgb(await cssVar(page, '--map-code-ink')));
    // Outline code: same token family.
    const oc = await page.locator('#outline code.of-code').first().evaluate((el) => {
      const c = getComputedStyle(el); return [c.borderRadius, c.borderTopWidth, c.paddingTop, c.paddingLeft, c.color];
    });
    expect(oc.slice(0, 4)).toEqual(['3px', '1px', '2px', '4px']);
    // 0.5.24 Slack style: orange ink, same chip and ink in every fill (incl. Audroam solid).
    const inkHex = theme === 'dark' ? '#e8912d' : '#b5410f';
    expect(oc[4]).toBe(rgb(inkHex));
    for (const id of ['b', 'wc', 'hl', 'ag']) {
      expect(await codeFill(page, id)).toBe(plain);
      expect(await page.locator(`${node(id)} tspan.map-code`).first().evaluate((el) => getComputedStyle(el).fill)).toBe(rgb(inkHex));
    }
    const ocs = await page.locator('#outline code.of-code').evaluateAll((els) => els.map((e) => getComputedStyle(e).color + getComputedStyle(e).backgroundColor));
    expect(new Set(ocs).size).toBe(1);
    const shot = theme === 'dark' ? process.env.CODE_SHOT_DARK : process.env.CODE_SHOT_LIGHT;
    await page.locator('#panel').screenshot({ path: shot || `test-results/code-region-${theme}.png` });
  });
}

test('0.5.23 picker lists every palette row; Audroam roles render and round-trip', async ({ page }) => {
  await open(page, '?md=code.md&focus=ap');
  // Audroam fill paints the sampled colour solid.
  expect((await pillStroke(page, 'ag')).fill).toBe(rgb(await cssVar(page, '--node-audroam-green-hl')));
  expect((await pillStroke(page, 'ap')).stroke).toBe(rgb(await cssVar(page, '--node-audroam-peach')));
  await page.evaluate(() => (window as any).__map.openNodeMenu('ap'));
  const rows = page.locator('.map-node-menu-swatches');
  await expect(rows).toHaveCount(3);
  expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['Colour · Forest', 'Colour · Highlighter', 'Colour · Audroam']);
  await expect(page.locator('.map-node-menu-swatches[aria-label="Colour · Audroam"] [role="menuitemradio"]')).toHaveCount(9);
  if (process.env.PALETTE_SHOT) await page.screenshot({ path: process.env.PALETTE_SHOT });
  await page.locator('[data-item="color:audroam-sky"]').click();
  await expect(page.locator(node('ap'))).toHaveClass(/colour-audroam-sky/);
  expect(await text(page)).toMatch(/ap:\n\s+colou?r: audroam-sky/);
});
