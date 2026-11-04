// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../src/parse.js';
import { serialize } from '../src/serialize.js';
import { toHtml } from '../src/toHtml.js';
import { cloudSvg } from '../src/mapRegion.js';
import { mapNodeClassNames } from '../src/mapView.js';
import { renderNodeMenu } from '../src/nodeMenu.js';
import { NODE_COLOURS, BASE_ROLES, HIGHLIGHTER_COLOURS, FOREST_PALETTE, isNodeColour, isHighlighter, colourLabel, colourVar, colourGroups, resolveColour, registerNodePalette, nodePaletteNames, paletteCss, applyNodePalette } from '../src/nodeColour.js';

const one = (line: string) => parse(`${line}\n`).nodes[0]!;

describe('0.5.19 node colour tokens (EP-31, EP-32)', () => {
  it('fourteen roles: Forest then Highlighter', () => {
    expect(NODE_COLOURS.length).toBe(14);
    expect(isNodeColour('creek')).toBe(true);
    expect(isNodeColour('red')).toBe(false);
    expect(isNodeColour('#ff0000')).toBe(false);
    expect(isNodeColour('default')).toBe(false);
    expect(colourLabel('slate')).toBe('Slate');
    expect(colourVar('moss')).toBe('var(--node-moss)');
  });
});

describe('0.5.19 <color:name> tag (Q12)', () => {
  it('parses a trailing colour tag before <id:>', () => {
    const n = one('- Plan <color:ember> <id:p>');
    expect(n.color).toBe('ember');
    expect(n.title).toBe('Plan');
    expect(n.id).toBe('p');
  });
  it('lenient spacing and the colour spelling; spelling kept on write', () => {
    const a = one('- Plan < color : creek > <id:p>');
    expect(a.color).toBe('creek');
    expect(serialize(parse('- Plan < color : creek > <id:p>\n'))).toContain('- Plan < color : creek > <id:p>');
    const b = one('- Plan <colour:lichen> <id:p>');
    expect(b.color).toBe('lichen');
    expect(serialize(parse('- Plan <colour:lichen> <id:p>\n'))).toContain('- Plan <colour:lichen> <id:p>');
  });
  it('hex and unknown names stay caption text (stored token, never hex)', () => {
    expect(one('- Plan <color:#ff0000>').color).toBeUndefined();
    expect(one('- Plan <color:#ff0000>').title).toBe('Plan <color:#ff0000>');
    expect(one('- Plan <color:moose>').color).toBeUndefined();
  });
  it('serializes <color:x> before <cloud:…> and <id:>; round-trips', () => {
    const doc = parse('- Field <cloud:creek> <color:ember> <id:f>\n  - Kid <id:k>\n');
    expect(doc.nodes[0]!.color).toBe('ember');
    expect(doc.nodes[0]!.cloud).toBe('creek');
    const out = serialize(doc);
    expect(out).toContain('- Field <color:ember> <cloud:creek> <id:f>');
    expect(serialize(parse(out))).toBe(out);
  });
  it('a generated colour is written <color:name>', () => {
    const doc = parse('- Plan <id:p>\n');
    doc.nodes[0]!.color = 'fern';
    expect(serialize(doc)).toContain('- Plan <color:fern> <id:p>');
  });
  it('per node only: children do not inherit (Q13)', () => {
    const doc = parse('- A <color:ember> <id:a>\n  - B <id:b>\n');
    expect(doc.nodes[0]!.children![0]!.color).toBeUndefined();
  });
});

describe('0.5.19 Outline (EP-34)', () => {
  it('row gets a colour class, data attr, and ", ember" in the accessible name', () => {
    const h = toHtml(parse('- Plan <color:ember> <id:p>\n'));
    expect(h).toMatch(/class="of-node[^"]*of-colour of-colour-ember/);
    expect(h).toContain('data-color="ember"');
    expect(h).toMatch(/class="of-sr">, ember</);
  });
  it('a named cloud colours its Outline bar', () => {
    const h = toHtml(parse('- Field <cloud:creek> <id:f>\n  - Kid\n'));
    expect(h).toMatch(/of-cloud of-cloud-creek/);
    expect(h).toContain('--of-cloud-bar: var(--node-creek)');
  });
});

describe('0.5.19 Map pill and cloud (EP-33, EP-38)', () => {
  it('mapNodeClassNames adds has-colour colour-<name>', () => {
    expect(mapNodeClassNames({ color: 'pine' })).toContain('has-colour colour-pine');
    expect(mapNodeClassNames({})).not.toContain('has-colour');
    // Time leaves ignore node colour (Q14 / TL7).
    expect(mapNodeClassNames({ color: 'ember', timeLeaf: 'time' })).not.toContain('has-colour');
  });
  it('named cloud uses the token for fill and stroke; default stays neutral', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const s = cloudSvg({ rootId: 'f', color: 'creek', depth: 0 }, pts);
    expect(s).toContain('stroke="var(--node-creek)"');
    expect(s).toMatch(/fill="var\(--node-creek\)" fill-opacity="0.06"/);
    const d = cloudSvg({ rootId: 'f', color: 'default', depth: 0 }, pts);
    expect(d).toContain('var(--of-cloud-stroke');
    const u = cloudSvg({ rootId: 'f', color: 'moose', depth: 0 }, pts);
    expect(u).toContain('var(--of-cloud-stroke');
  });
});

describe('0.5.19 node menu swatch row (EP-31, EP-39)', () => {
  it('swatch entries render as Forest and Highlighter rows, None first', () => {
    const entries = [
      { key: 'color:none', label: 'None', group: 'Edit' as const, swatch: 'none', row: 'Colour · Forest', checked: false },
      ...NODE_COLOURS.map((c) => ({ key: `color:${c}`, label: colourLabel(c), group: 'Edit' as const, swatch: c, row: isHighlighter(c) ? 'Colour · Highlighter' : 'Colour · Forest', checked: c === 'ember' })),
    ];
    const v = renderNodeMenu({ title: 'Plan', entries, fine: true });
    const rows = [...v.el.querySelectorAll('.map-node-menu-swatches')];
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Colour · Forest', 'Colour · Highlighter']);
    expect(rows[0]!.querySelectorAll('[role="menuitemradio"]').length).toBe(10);
    expect(rows[1]!.querySelectorAll('[role="menuitemradio"]').length).toBe(5);
    expect(rows[0]!.querySelector('[data-item="color:ember"]')!.getAttribute('aria-checked')).toBe('true');
    expect(v.items.length).toBe(15);
  });
});

/** WCAG contrast from the shipped CSS tokens (EP-35, EP-37). */
describe('0.5.19 palette contrast (EP-35)', () => {
  const css = readFileSync(join(__dirname, '../src/outline-fold.css'), 'utf8');
  const block = (sel: RegExp) => css.match(sel)![1]!;
  const tokens = (b: string) => Object.fromEntries([...b.matchAll(/--node-([a-z]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
  const lum = (h: string) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const cr = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const mix = (a: string, b: string, t: number) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * t + parseInt(b.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, '0')).join('');
  const dark = tokens(block(/:root\s*\{([^}]*)\}/));
  const light = tokens(block(/\.of-theme-light\s*\{([^}]*)\}/));
  const pill = '#0c222c';
  const hl = Object.fromEntries([...block(/:root\s*\{([^}]*)\}/).matchAll(/--node-([a-z]+)-hl:\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
  it('both themes define every role (Forest + Highlighter edges)', () => {
    expect(Object.keys(dark).sort()).toEqual([...NODE_COLOURS].sort());
    expect(Object.keys(light).sort()).toEqual([...NODE_COLOURS].sort());
  });
  it('>= 3:1 against the pill fill and the canvas; label >= 10:1 on the wash (dark ink on highlighter)', () => {
    for (const [set, canvas] of [[dark, '#0a1f28'], [light, '#f3f6f9']] as const) {
      for (const c of NODE_COLOURS) {
        const v = set[c]!;
        expect(cr(v, pill), `${c} ${v} on pill`).toBeGreaterThanOrEqual(3);
        expect(cr(v, canvas), `${c} ${v} on canvas`).toBeGreaterThanOrEqual(3);
        if (!isHighlighter(c)) expect(cr('#e7ecf1', mix(v, pill, 0.16)), `${c} text on wash`).toBeGreaterThanOrEqual(10);
        else expect(cr('#0b1a21', mix(hl[c]!, pill, 0.92)), `${c} ink on highlighter`).toBeGreaterThanOrEqual(10);
      }
    }
  });
  it('creek (water) is not the selection ring colour (EP-37)', () => {
    expect(dark.creek!.toLowerCase()).not.toBe('#6cb6ff');
    expect(light.creek!.toLowerCase()).not.toBe('#6cb6ff');
  });
  it('CSS Forest tokens match the FOREST_PALETTE table', () => {
    for (const r of BASE_ROLES) {
      expect(dark[r]).toBe(FOREST_PALETTE.roles[r].dark);
      expect(light[r]).toBe(FOREST_PALETTE.roles[r].light);
    }
  });
  it('forced colours fall back to CanvasText borders', () => {
    expect(css).toMatch(/@media \(forced-colors: active\)[\s\S]*has-colour[\s\S]*CanvasText/);
  });
});

describe('0.5.19 palettes and aliases', () => {
  it('Forest (9 roles) + Highlighter (5), all distinct', () => {
    expect(BASE_ROLES).toEqual(['moss', 'fern', 'pine', 'lichen', 'bark', 'creek', 'ember', 'slate', 'stone']);
    expect(HIGHLIGHTER_COLOURS).toEqual(['lemon', 'lime', 'flamingo', 'tangerine', 'aqua']);
    expect(colourGroups().map((g) => g.name)).toEqual(['Forest', 'Highlighter']);
    const hexes = BASE_ROLES.map((r) => FOREST_PALETTE.roles[r].dark);
    expect(new Set(hexes).size).toBe(hexes.length);
  });
  it('old generic names are aliases, written back as the role', () => {
    expect(resolveColour('red')).toBe('ember');
    expect(resolveColour('Teal')).toBe('pine');
    const doc = parse('- Plan <color:red> <cloud:blue> <id:p>\n');
    expect(doc.nodes[0]!.color).toBe('ember');
    expect(serialize(doc)).toContain('- Plan <color:ember> <cloud:blue> <id:p>');
    expect(cloudSvg({ rootId: 'p', color: 'blue', depth: 0 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] as never)).toContain('stroke="var(--node-creek)"');
  });
  it('a registered palette needs only a token table; tags stay the same', () => {
    const roles = Object.fromEntries(BASE_ROLES.map((r, i) => [r, { label: `Star ${i}`, dark: '#aabbcc', light: '#556677' }])) as never;
    registerNodePalette({ name: 'space-test', label: 'Space', roles });
    expect(nodePaletteNames()).toContain('space-test');
    expect(colourGroups('space-test')[0]!.name).toBe('Space');
    expect(colourLabel('moss', 'space-test')).toBe('Star 0');
    expect(paletteCss('space-test')).toMatch(/\.of-palette-space-test \{ --node-moss: #aabbcc;/);
    const el = document.createElement('div');
    expect(applyNodePalette(el, 'space-test')).toBe('space-test');
    expect(el.classList.contains('of-palette-space-test')).toBe(true);
    expect(document.getElementById('of-palette-style-space-test')).toBeTruthy();
    expect(applyNodePalette(el, 'nope')).toBe('forest');
    expect(mapNodeClassNames({ color: 'lemon' })).not.toContain('is-hl'); // 0.5.20: wash is opt-in
    expect(mapNodeClassNames({ color: 'lemon', colorFill: true })).toContain('is-hl');
  });
});
