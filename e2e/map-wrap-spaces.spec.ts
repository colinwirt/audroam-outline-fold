import { test, expect, type Page } from '@playwright/test';

/**
 * Spaces between words survive every pill width (0.2.35: at some widths
 * `ip addr # interface names` painted `ip addr #` / `interfacenames`).
 * Real Chromium font measurement. Fixture: examples/e2e-touch/wrap-spaces.md
 * (Colin's repro: inline-code caption, `textWidth: 75`, `19:` w 200).
 */

const HARNESS = 'examples/e2e-touch/index.html?doc=wrap-spaces.md';

async function open(page: Page) {
  await page.goto(HARNESS);
  await page.waitForFunction(() => (window as any).__ready === true);
}

/** Painted lines (one `<tspan>` per line) of the pill with data-id `key`. */
const linesOf = (page: Page, key: string) =>
  page.evaluate(
    (k) =>
      [...document.querySelectorAll(`#mapHost .map-node[data-id="${k}"] .map-label > tspan`)].map(
        (t) => t.textContent || '',
      ),
    key,
  );

/**
 * Sweep the pill's `w` in the page and return every width whose painted lines
 * are not consecutive slices of `visible` (only spaces may fall at a break).
 */
function sweep(page: Page, key: string, visible: string, from: number, to: number) {
  return page.evaluate(
    ({ k, src, from, to }) => {
      const map = (window as any).__map;
      const bad: { w: number; lines: string[] }[] = [];
      const seen = new Set<string>();
      for (let w = from; w <= to; w++) {
        // paint() rebuilds layout.nodes, so look the entry up every step.
        (window as any).__layout().nodes[k].w = w;
        map.paint();
        const lines = [
          ...document.querySelectorAll(`#mapHost .map-node[data-id="${k}"] .map-label > tspan`),
        ].map((t) => (t.textContent || '').replace(/\u00a0/g, ' '));
        seen.add(lines.join(' / '));
        let at = 0;
        let ok = true;
        for (const line of lines) {
          while (src[at] === ' ') at++;
          if (src.slice(at, at + line.length) !== line) ok = false;
          at += line.length;
        }
        if (src.slice(at).trim()) ok = false;
        if (!ok) bad.push({ w, lines });
      }
      return { bad, layouts: [...seen] };
    },
    { k: key, src: visible, from, to },
  );
}

test.describe('map pill wrap keeps spaces', () => {
  test('inline-code caption at the authored w 200 keeps `interface names`', async ({ page }) => {
    await open(page);
    const lines = await linesOf(page, '19');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(' ')).toBe('ip addr # interface names');
    for (const line of lines) expect(line).not.toContain('interfacenames');
  });

  const CASES = [
    { key: '19', visible: 'ip addr # interface names' },
    { key: 'plain', visible: 'ip addr # interface names' },
    { key: 'greek', visible: 'alpha beta gamma delta' },
    { key: 'rich', visible: 'ip addr # interface names' },
  ];
  for (const c of CASES) {
    test(`sweep w 96–420: ${c.key}`, async ({ page }) => {
      await open(page);
      const { bad, layouts } = await sweep(page, c.key, c.visible, 96, 420);
      expect(bad, JSON.stringify(bad.slice(0, 5))).toEqual([]);
      // The sweep really crossed wrap points.
      expect(layouts.length).toBeGreaterThan(2);
    });
  }
});
