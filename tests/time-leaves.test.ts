/**
 * Map time leaves (0.2.40, Design UX 2026-10-09 "map time leaf", TL1–TL8):
 * `<kind:time>` / `<kind:session>` parse as kinds (spacing read leniently,
 * written without spaces, typed spelling kept), and the Map sizes and classes
 * those leaves as compact green pills. Fiction only.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  autoPackPositions,
  mapEdgeSvg,
  mapNodeClassNames,
  parse,
  pillSize,
  serialize,
  timeKindOf,
  timeLeafAriaLabel,
  timeLeafCaption,
  timeLeafFontPx,
  timeLeafKind,
  timeLeafNodeFontPx,
  timeLeafPadLeft,
  TIME_LEAF_GAP_Y,
  TIME_LEAF_LETTER,
  TIME_LEAF_MAX_CH,
  TIME_LEAF_NAME,
  toggleFold,
  validateDocument,
} from '../src/index.js';
import { nodeMapKey, indexOutline } from '../src/nodeAddress.js';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../src/outline-fold.css'), 'utf8');
const mapSrc = readFileSync(join(here, '../src/mapView.ts'), 'utf8');

const first = (body: string) => parse(body).nodes[0]!;

const block = (sel: string) => {
  const at = css.indexOf(`${sel} {`);
  expect(at, sel).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
};
const decl = (rule: string, prop: string) =>
  rule.match(new RegExp(`(?:^|[\\s;{])${prop.replace(/[-]/g, '\\-')}:\\s*([^;]+);`))?.[1]?.trim();

describe('parse: time and session are kinds (TL8)', () => {
  for (const [tag, kind] of [
    ['<kind:time>', 'time'],
    ['<kind:session>', 'session'],
    ['<kind : time>', 'time'],
    ['<kind: session >', 'session'],
    ['< kind:time >', 'time'],
    ['<Kind:Time>', 'time'],
  ] as const) {
    it(`${tag} trailing is kind ${kind}, not caption text`, () => {
      const n = first(`- Thu 8 Oct · 1:25 ${tag}\n`);
      expect(n.kind).toBe(kind);
      expect(n.title).toBe('Thu 8 Oct · 1:25');
    });
    it(`${tag} leading is kind ${kind}`, () => {
      const n = first(`- ${tag} Thu 8 Oct · 1:25\n`);
      expect(n.kind).toBe(kind);
      expect(n.title).toBe('Thu 8 Oct · 1:25');
    });
  }

  it('sits with the other trailing tags (note link, id) in any order the parser reads', () => {
    const n = first('- Fri 9 Oct · 3:05 <t:7> <kind:session> <id:s2>\n');
    expect(n.kind).toBe('session');
    expect(n.id).toBe('s2');
    expect(n.title).toBe('Fri 9 Oct · 3:05');
    expect(serialize(parse('- Fri 9 Oct · 3:05 <t:7> <kind:session> <id:s2>\n'))).toBe(
      '- Fri 9 Oct · 3:05 <t:7> <kind:session> <id:s2>\n',
    );
  });

  it('bare <time> / <session> stay caption text (colon form only)', () => {
    expect(first('- Lunch <time>\n').kind).toBeUndefined();
    expect(first('- Lunch <time>\n').title).toBe('Lunch <time>');
    expect(first('- Jam <session>\n').kind).toBeUndefined();
    expect(serialize(parse('- Jam <session>\n'))).toBe('- Jam <session>\n');
  });

  it('other words after kind: stay literal, as before', () => {
    expect(first('- Row <kind:times>\n').kind).toBeUndefined();
    expect(first('- Row <kind:timer>\n').title).toBe('Row <kind:timer>');
  });

  it('existing kinds still parse', () => {
    expect(first('- Plan <kind:doc>\n').kind).toBe('doc');
    expect(first('- Plan <doc>\n').kind).toBe('doc');
  });

  it('validateDocument keeps the kind', () => {
    const { doc } = validateDocument('- Glaze class <id:g>\n  - Thu 8 Oct · 1:25 <kind:time>\n');
    expect(doc.nodes[0]!.children![0]!.kind).toBe('time');
  });
});

describe('round trip and spacing (TL8)', () => {
  it('a written tag round-trips byte for byte', () => {
    const md = '- Glaze class <id:g>\n  - Thu 8 Oct · 1:25 <kind:time> <id:t1>\n  - Sat 3 Oct · 2:40 <kind:session>\n';
    expect(serialize(parse(md))).toBe(md);
  });

  it('a spaced tag keeps its spelling while the kind is unchanged', () => {
    const md = '- Thu 8 Oct · 1:25 <kind : time> <id : t1>\n';
    expect(serialize(parse(md))).toBe(md);
    const folded = '- Glaze class <id:g>\n  - Thu 8 Oct · 1:25 < kind: session > <id:t1>\n';
    const doc = toggleFold(parse(folded), 'g');
    expect(serialize(doc)).toContain('Thu 8 Oct · 1:25 < kind: session > <id:t1>');
  });

  it('writers emit no spaces: a new or changed kind is <kind:x>', () => {
    const doc = parse('- Thu 8 Oct · 1:25 <kind : time>\n');
    doc.nodes[0]!.kind = 'session';
    expect(serialize(doc)).toBe('- Thu 8 Oct · 1:25 <kind:session>\n');
    const fresh = parse('- Mon 5 Oct · 0:40\n');
    fresh.nodes[0]!.kind = 'time';
    expect(serialize(fresh)).toBe('- Mon 5 Oct · 0:40 <kind:time>\n');
  });
});

describe('time leaf helpers', () => {
  it('timeKindOf / timeLeafKind: leaves only', () => {
    expect(timeKindOf('time')).toBe('time');
    expect(timeKindOf('SESSION')).toBe('session');
    expect(timeKindOf('doc')).toBeNull();
    expect(timeKindOf(undefined)).toBeNull();
    const doc = parse('- Thu 8 Oct <kind:time>\n  - A child\n- Fri 9 Oct <kind:time>\n');
    expect(timeLeafKind(doc.nodes[0])).toBeNull();
    expect(timeLeafKind(doc.nodes[1])).toBe('time');
  });

  it('TL1 font: 0.85× rounded to 0.5 px; a per-node fontSize is used as written', () => {
    expect(timeLeafFontPx(16)).toBe(13.5);
    expect(timeLeafFontPx(20)).toBe(17);
    expect(timeLeafNodeFontPx(undefined, undefined, undefined)).toBe(13.5);
    expect(timeLeafNodeFontPx(undefined, 20, undefined)).toBe(17);
    expect(timeLeafNodeFontPx(undefined, undefined, 18)).toBe(15.5);
    expect(timeLeafNodeFontPx(14, 20, 18)).toBe(14);
  });

  it('TL3 caption: one line, cut with … past the max; dates are not reformatted', () => {
    expect(timeLeafCaption('Thu 8 Oct · 1:25')).toBe('Thu 8 Oct · 1:25');
    expect(timeLeafCaption('Fri 9 Oct · ● open')).toBe('Fri 9 Oct · ● open');
    expect(timeLeafCaption('Thu 8 Oct\nkiln  notes<br>more')).toBe('Thu 8 Oct kiln notes more');
    const long = 'Thu 8 Oct · 1:25 · ' + 'glaze test tiles '.repeat(6);
    const cut = timeLeafCaption(long);
    expect(Array.from(cut).length).toBeLessThanOrEqual(TIME_LEAF_MAX_CH);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.startsWith('Thu 8 Oct · 1:25')).toBe(true);
  });

  it('letter and accessible names', () => {
    expect(TIME_LEAF_LETTER).toEqual({ time: 'T', session: 'S' });
    expect(TIME_LEAF_NAME).toEqual({ time: 'Time record', session: 'Session record' });
    expect(timeLeafAriaLabel('time', 'Thu 8 Oct · 1:25')).toBe('Time record, Thu 8 Oct · 1:25');
    expect(timeLeafAriaLabel('session', '')).toBe('Session record');
  });
});

describe('Map classes, size and layout (TL1, TL4, TL5)', () => {
  it('mapNodeClassNames adds time-leaf kind-time / kind-session on leaves only', () => {
    expect(mapNodeClassNames({ timeLeaf: 'time' })).toBe('map-node leaf time-leaf kind-time');
    expect(mapNodeClassNames({ timeLeaf: 'session', focused: true })).toBe(
      'map-node leaf time-leaf kind-session is-focused',
    );
    expect(mapNodeClassNames({ timeLeaf: 'time', foldable: true })).toBe('map-node');
    expect(mapNodeClassNames({})).toBe('map-node leaf');
  });

  it('pillSize: one line that hugs the text, compact height, no fold slot', () => {
    const note = pillSize('Thu 8 Oct · 1:25', { fontSize: 16 });
    const tl = pillSize('Thu 8 Oct · 1:25', { timeLeaf: 'time', fontSize: 13.5 });
    expect(tl.lines).toEqual(['Thu 8 Oct · 1:25']);
    expect(tl.fontPx).toBe(13.5);
    expect(tl.foldSlot).toBe(0);
    expect(tl.taskLead).toBe(0);
    expect(tl.showMore).toBe(false);
    expect(tl.h).toBeLessThan(note.h);
    expect(tl.h).toBeLessThan(44);
    expect(tl.w).toBeGreaterThan(90);
    expect(tl.w).toBeLessThan(170);
    expect(tl.textW).toBeGreaterThan(timeLeafPadLeft(13.5));
  });

  it('pillSize: a long caption never wraps, a stored width is ignored', () => {
    const long = 'Thu 8 Oct · 1:25 · kiln notes and the glaze test tiles for Saturday';
    const tl = pillSize(long, { timeLeaf: 'time', fontSize: 13.5, widthPx: 140, maxLines: 30, wrapCh: 10 });
    expect(tl.lines.length).toBe(1);
    expect(tl.lines[0]!.endsWith('…')).toBe(true);
  });

  it('autoPack: time leaves are compact and 6 px apart; other siblings keep gapY', () => {
    const md = [
      '- Glaze class <id:g>',
      '  - Thu 8 Oct · 1:25 <kind:time> <id:t1>',
      '  - Mon 5 Oct · 0:40 <kind:time> <id:t2>',
      '  - Sat 3 Oct · 2:40 <kind:session> <id:s1>',
      '  - Glaze checklist <id:c>',
      '  - Fri 9 Oct · ● open <kind:time> <id:t3>',
      '',
    ].join('\n');
    const doc = parse(md);
    const { nodes } = autoPackPositions(doc, { fontSize: 16 });
    const order = indexOutline(doc.nodes);
    const kids = doc.nodes[0]!.children!;
    const pos = kids.map((k) => nodes[nodeMapKey(k, order.get(k) || 0)]!);
    const tlH = pillSize('Thu 8 Oct · 1:25', { timeLeaf: 'time', fontSize: 13.5 }).h;
    const gap = (i: number, hA: number, hB: number) => pos[i + 1]!.y - hB / 2 - (pos[i]!.y + hA / 2);
    expect(gap(0, tlH, tlH)).toBeCloseTo(TIME_LEAF_GAP_Y, 5);
    expect(gap(1, tlH, tlH)).toBeCloseTo(TIME_LEAF_GAP_Y, 5);
    // Session then a note: the default 14 px.
    expect(gap(2, tlH, 44)).toBeCloseTo(14, 5);
    expect(gap(3, 44, tlH)).toBeCloseTo(14, 5);
  });

  it('autoPack: a record with children stays a normal pill', () => {
    const doc = parse('- Thu 8 Oct · 1:25 <kind:time> <id:t1>\n  - Kiln notes <id:k>\n');
    const { nodes } = autoPackPositions(doc, { fontSize: 16 });
    expect(nodes['k']!.x - nodes['t1']!.x).toBeGreaterThan(0);
    expect(timeLeafKind(doc.nodes[0])).toBeNull();
  });

  it('mapEdgeSvg: the edge into a time leaf is edge-time', () => {
    expect(mapEdgeSvg('M 0 0')).toBe('<path class="map-edge" d="M 0 0"/>');
    expect(mapEdgeSvg('M 0 0', { timeLeaf: true })).toBe('<path class="map-edge edge-time" d="M 0 0"/>');
  });
});

describe('paint wiring (source)', () => {
  it('no width grip, no width popover, no fit pick, no auto width on a time leaf', () => {
    expect(mapSrc).toMatch(/\$\{timeLeaf \? '' : widthGripSvg\(/);
    expect(mapSrc).toMatch(/if \(!n \|\| timeLeafKind\(n\)\) return false;/);
    expect(mapSrc).toMatch(/getDoc\(\)\.nodes\)\.filter\(\(s\) => !timeLeafKind\(s\)\)/);
    expect(mapSrc).toMatch(/if \(timeLeafKind\(nodeByKey\(key\)\)\) return false;/);
    expect(mapSrc).toMatch(/'\.map-node:not\(\.time-leaf\)'/);
    expect(mapSrc).toMatch(/key === resizingWidthKey \|\| timeLeafKind\(n\)\) continue;/);
  });

  it('kind letter has an accessible name; the node name starts with the record kind', () => {
    expect(mapSrc).toMatch(/class="map-kind-letter"[^`]*role="img" aria-label="\$\{TIME_LEAF_NAME\[timeLeaf\]\}"/);
    expect(mapSrc).toMatch(/aria-label="\$\{esc\(timeLeaf \? timeLeafAriaLabel\(timeLeaf, label\) : label\)\}/);
  });
});

describe('CSS tokens (TL2, TL4, TL6, TL7)', () => {
  const root = block(':root');
  const light = block('.of-theme-light');

  it('dark tokens', () => {
    expect(decl(root, '--time-fill')).toBe('#0e2a22');
    expect(decl(root, '--time-stroke')).toBe('#2ea043');
    expect(decl(root, '--time-stroke-hover')).toBe('#3fb950');
    expect(decl(root, '--time-letter')).toBe('#3fb950');
    expect(decl(root, '--time-text')).toBe('#e7ecf1');
    expect(decl(root, '--time-edge')).toBe('#2b8a3e');
  });

  it('light tokens: same dark fill, #2b8a3e border', () => {
    expect(decl(light, '--time-stroke')).toBe('#2b8a3e');
    expect(decl(light, '--time-edge')).toBe('#2b8a3e');
    expect(decl(light, '--time-fill')).toBeUndefined();
  });

  it('pill, hover, focus, letter and edge rules', () => {
    const pill = block('.map-node.time-leaf.time-leaf .map-pill');
    expect(decl(pill, 'fill')).toBe('var(--time-fill)');
    expect(decl(pill, 'stroke')).toBe('var(--time-stroke)');
    expect(decl(pill, 'stroke-width')).toBe('1.25');
    expect(decl(block('.map-node.time-leaf.time-leaf:hover .map-pill'), 'stroke')).toBe('var(--time-stroke-hover)');
    expect(css).toContain('.map-node.time-leaf.time-leaf.is-focused .map-pill');
    const letter = block('.map-kind-letter');
    expect(decl(letter, 'font-weight')).toBe('700');
    const edge = block('.map-edge.edge-time.edge-time');
    expect(decl(edge, 'stroke')).toBe('var(--time-edge)');
    expect(decl(edge, 'stroke-width')).toBe('1');
    expect(decl(edge, 'opacity')).toBe('1');
  });

  it('contrast as stated in TL2 / TL4 (WCAG relative luminance)', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!;
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x! + 0.05) / (y! + 0.05);
    };
    expect(ratio('#2ea043', '#0a1f28')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#3fb950', '#0e2a22')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#e7ecf1', '#0e2a22')).toBeGreaterThanOrEqual(7);
    expect(ratio('#2b8a3e', '#0a1f28')).toBeGreaterThanOrEqual(3);
    expect(ratio('#2b8a3e', '#f3f6f9')).toBeGreaterThanOrEqual(3);
    expect(ratio('#6cb6ff', '#0e2a22')).toBeGreaterThanOrEqual(3);
  });
});
