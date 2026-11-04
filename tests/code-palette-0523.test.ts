// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, createMapView } from '../src/index.js';
import { serialize } from '../src/serialize.js';
import { parseTinyHtmlRuns, captionToHtml } from '../src/captionRich.js';
import { AUDROAM_COLOURS, AUDROAM, colourGroups, colourLabel, resolveColour, isNodeColour } from '../src/nodeColour.js';
import { openIconPicker } from '../src/emoji/picker.js';

// 0.5.23 (Colin, 4 Nov): code regions in Map nodes get their own background (theme token,
// never the branch wash); the colour picker lists every palette row; an Audroam palette.
const css = readFileSync(join(__dirname, '../src/outline-fold.css'), 'utf8');
const rootBlock = css.match(/:root \{([\s\S]*?)\n\}/)![1]!;
const lightBlock = css.match(/\n\.of-theme-light \{([\s\S]*?)\n\}/)![1]!;
const tok = (b: string, n: string) => b.match(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`))?.[1];

async function paint(text: string) {
  const doc = parse(text);
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 1000 });
  Object.defineProperty(host, 'clientHeight', { value: 800 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
  let focus = doc.nodes[0]!.id!;
  let cur = doc;
  const mv: any = (createMapView as any)(host, {
    getDoc: () => cur, setDoc: (d: any) => { cur = d; }, getLayout: () => layout, getFocusId: () => focus,
    setFocusId: (id: string) => { focus = id; }, nodeColours: true, nodeIcons: true, nodeMenu: true, canPersistWidths: true,
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 20));
  const g = (id: string) => host.querySelector(`.map-node[data-id="${id}"]`) as Element | null;
  return { host, g, mv, doc: () => cur };
}

describe('0.5.23 code regions', () => {
  it('fenced blocks parse to code runs without the fence lines', () => {
    const runs = parseTinyHtmlRuns('Run\n```js\nnpm i\nnpm t\n```\nthen `go`');
    expect(runs.map((r) => r.text).join('')).toBe('Run\nnpm i\nnpm t\nthen go');
    expect(runs.find((r) => r.text.includes('npm i'))!.code).toBe(true);
    expect(runs.find((r) => r.text === 'go')!.code).toBe(true);
  });

  it('the code background token differs from the pill in both themes', () => {
    const pill = tok(rootBlock, 'pill-fill')!;
    const dark = tok(rootBlock, 'map-code-bg')!;
    const light = tok(lightBlock, 'map-code-bg')!;
    expect(dark).toBeTruthy();
    expect(light).toBeTruthy();
    expect(dark.toLowerCase()).not.toBe(pill.toLowerCase());
    expect(light.toLowerCase()).not.toBe((tok(lightBlock, 'pill-fill') ?? pill).toLowerCase());
    // Outline tokens too (dark page and light page).
    expect(tok(rootBlock, 'of-code-bg')).toBeTruthy();
    expect(css).toMatch(/\.of-theme-light \.of-outline,\s*\.of-outline\.of-theme-light \{[^}]*--of-code-bg:\s*#/);
    expect(css).toMatch(/\.map-code-bg \{[^}]*fill: var\(--map-code-bg\)/);
    expect(css).toMatch(/\.of-code \{[^}]*background: var\(--of-code-bg\)[^}]*border-radius: 3px/);
  });

  it('inline and fenced code paint a rounded rect behind the run, the same inside a fill branch', async () => {
    const { g } = await paint('- Use `npm t` now <id:a>\n- Wash <color:ember:fill> <id:b>\n  - Run `npm t` here <id:c>\n- Block<br>```<br>a = 1<br>b = 2<br>``` <id:d>\n');
    const ra = g('a')!.querySelector('rect.map-code-bg')!;
    expect(ra).toBeTruthy();
    expect(ra.getAttribute('rx')).toBe('3');
    expect(g('c')!.getAttribute('class')).toContain('colour-fill');
    const rc = g('c')!.querySelector('rect.map-code-bg')!;
    expect(rc).toBeTruthy();
    // Same paint inside and outside the wash: class + explicit token fill, no colour-mix.
    for (const r of [ra, rc]) {
      expect(r.getAttribute('fill')).toBe('var(--map-code-bg)');
      expect(r.getAttribute('class')).toBe('map-code-bg');
    }
    expect(css).not.toMatch(/\.colour-fill[^{},]*\.map-code-bg/);
    // Code ink outranks the dark-ink label rule of a Highlighter/Audroam fill.
    expect(g('c')!.querySelector('tspan.map-code')).toBeTruthy();
    expect(css).toContain('.map-node.map-node .map-label tspan.map-code { fill: var(--map-code-ink); }');
    const rd = [...g('d')!.querySelectorAll('rect.map-code-bg')];
    expect(rd.length).toBe(1); // two fenced lines join into one block
    expect(Number(rd[0]!.getAttribute('height'))).toBeGreaterThan(20);
    expect(g('d')!.querySelector('.map-label')!.textContent).not.toContain('```');
  });

  it('Outline renders code with the same class (background from the token)', () => {
    expect(captionToHtml('x `y` z')).toContain('<code class="of-code">y</code>');
  });
});

describe('0.5.23 palettes', () => {
  it('Audroam roles are namespaced, distinct from Highlighter and aliases', () => {
    expect(AUDROAM_COLOURS).toEqual(['audroam-green', 'audroam-salmon', 'audroam-peach', 'audroam-sky', 'audroam-aqua', 'audroam-lemon', 'audroam-red', 'audroam-lavender', 'audroam-grey']);
    for (const c of AUDROAM_COLOURS) { expect(isNodeColour(c)).toBe(true); expect(resolveColour(c.toUpperCase())).toBe(c); }
    expect(resolveColour('red')).toBe('ember');
    expect(resolveColour('aqua')).toBe('aqua');
    expect(colourLabel('audroam-sky')).toBe('Sky blue');
    for (const c of AUDROAM_COLOURS) {
      expect(tok(rootBlock, `node-${c}`)).toBe(AUDROAM[c].dark);
      expect(tok(lightBlock, `node-${c}`)).toBe(AUDROAM[c].light);
    }
  });

  it('colour groups list every palette row with labels', () => {
    expect(colourGroups().map((g) => g.name)).toEqual(['Forest', 'Highlighter', 'Audroam']);
  });

  it('node menu shows a labelled row per palette', async () => {
    const { host, mv } = await paint('- Root <id:r>\n');
    void host;
    mv.openNodeMenu('r');
    await new Promise((r) => setTimeout(r, 10));
    const rows = [...document.querySelectorAll('.map-node-menu-swatches')].map((r) => r.getAttribute('aria-label'));
    expect(rows).toEqual(['Colour · Forest', 'Colour · Highlighter', 'Colour · Audroam']);
    const au = document.querySelector('.map-node-menu-swatches[aria-label="Colour · Audroam"]')!;
    expect(au.querySelectorAll('[role="menuitemradio"]').length).toBe(9);
    expect(au.querySelector('[data-item="color:audroam-salmon"]')!.getAttribute('aria-label') ?? au.querySelector('[data-item="color:audroam-salmon"]')!.textContent).toMatch(/Salmon/);
    mv.destroy?.();
  });

  it('icon picker colour rows: one caption per palette, 24 radios', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const p = openIconPicker({ mode: 'node', anchor, onPick: () => {}, expanded: true, colour: { onColour: () => {} } } as any);
    const row = document.querySelector('[data-testid="of-ep-colours"]')!;
    expect([...row.querySelectorAll('.of-ep-colours-cap')].map((c) => c.textContent)).toEqual(['Forest', 'Highlighter', 'Audroam']);
    expect(row.querySelectorAll('[role="radio"]').length).toBe(24);
    expect(row.querySelector('[data-testid="of-ep-swatch-audroam-lavender"]')!.getAttribute('aria-label')).toBe('Lavender');
    p.close(false);
  });

  it('Audroam roles render and round-trip, inline and in layout', async () => {
    const text = '- A <color:audroam-peach> <id:a>\n- B <color:audroam-lavender:fill> <id:b>\n';
    const { g } = await paint(text);
    expect(g('a')!.getAttribute('class')).toContain('has-colour colour-audroam-peach');
    expect(g('b')!.getAttribute('class')).toContain('colour-audroam-lavender colour-fill is-au');
    expect(css).toContain('.map-node.colour-audroam-peach { --nc: var(--node-audroam-peach); }');
    expect(serialize(parse(text))).toBe(text);
    const lay = '- A <id:a>\n\n--- layout ---\nfold-: \ncollapsedMarker: "(+)"\na:\n  colour: audroam-red:fill\n---\n';
    const d = parse(lay);
    expect(d.nodes[0]!.color).toBe('audroam-red');
    expect(d.nodes[0]!.colorFill).toBe(true);
    expect(serialize(d)).toBe(lay);
  });
});
