import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FOLD_SLOT,
  foldCountLabel,
  isTaskEmphasis,
  mapNodeClassNames,
  noteLinkRows,
  captionLinkRows,
  opensNewWindow,
  parse,
  pillSize,
  renderLinkPopRows,
  validateDocument,
  LINK_EXT_ARROW,
} from '../src/index.js';
import { foldChromeSvg, foldCountSvg, foldHandleGeometry } from '../src/mapView.js';
import { fitTextWidth, naturalLineWidth } from '../src/mapLabel.js';
import { setRunMeasurer } from '../src/svgTextMeasure.js';
import type { OutlineNode } from '../src/types.js';

// Day-map P1 tweaks (Design UX 2026-10-09, K9 P1: K4, K6, K3) and the
// authored (+) on an id-less line (findings). Fiction only.

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../src/outline-fold.css'), 'utf8');
const mapSrc = readFileSync(join(here, '../src/mapView.ts'), 'utf8');

function cssBlock(selectorStart: string): string {
  const start = css.indexOf(selectorStart);
  expect(start, `css ${selectorStart}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start) + 1);
}

function byTitle(nodes: OutlineNode[], title: string): OutlineNode {
  for (const n of nodes) {
    if (n.title === title) return n;
    if (n.children) {
      try {
        return byTitle(n.children, title);
      } catch {
        /* keep looking */
      }
    }
  }
  throw new Error(title);
}

describe('K4: open tasks stand out', () => {
  afterEach(() => setRunMeasurer(null));

  it('open and in-progress tasks are emphasised; done and plain nodes are not', () => {
    expect(isTaskEmphasis('open')).toBe(true);
    expect(isTaskEmphasis('pending')).toBe(true);
    expect(isTaskEmphasis('done')).toBe(false);
    expect(isTaskEmphasis(null)).toBe(false);
    expect(isTaskEmphasis(undefined)).toBe(false);
  });

  it('CSS: 2 px stroke and 600 label for open / pending, 1 px and muted text for done', () => {
    const stroke = cssBlock('.map-node.task-open .map-pill,');
    expect(stroke).toContain('.map-node.task-pending .map-pill');
    expect(stroke).toContain('stroke-width: 2;');
    expect(cssBlock('.map-node.task-done .map-pill {')).toContain('stroke-width: 1;');
    const label = cssBlock('.map-node.task-open .map-label,');
    expect(label).toContain('.map-node.task-pending .map-label');
    expect(label).toContain('font-weight: 600;');
    expect(cssBlock('.map-node.task-done .map-label {')).toContain('fill: var(--muted, var(--of-muted));');
  });

  it('CSS: the folded gold stroke, focus ring and cue text still win (later, same or higher specificity)', () => {
    const task = css.indexOf('.map-node.task-open .map-pill,');
    expect(css.indexOf('.map-node.collapsed .map-pill {')).toBeGreaterThan(task);
    expect(css.indexOf('.map-node.is-focused .map-pill,')).toBeGreaterThan(task);
    expect(css.indexOf('.map-node.cue .map-label {')).toBeGreaterThan(css.indexOf('.map-node.task-done .map-label {'));
    expect(cssBlock('.map-node.collapsed .map-pill {')).toContain('stroke: var(--gold);');
  });

  it('class names carry the task state the CSS keys on', () => {
    expect(mapNodeClassNames({ task: 'open' })).toContain('task-open');
    expect(mapNodeClassNames({ task: 'pending' })).toContain('task-pending');
    expect(mapNodeClassNames({ task: 'done' })).toContain('task-done');
  });

  it('paint writes font-weight 600 on an open task label and measures chips at that weight', () => {
    expect(mapSrc).toMatch(/multiLineText\([^)]*isTaskEmphasis\(task\) \? 600 : 400\)/);
    expect(mapSrc).toMatch(/lineWidth\(line, fontPx, isTaskEmphasis\(task\)\)/);
  });

  it('a semibold caption is measured at 600, so its pill fits the painted text', () => {
    const seen: string[] = [];
    // 8 px per char at 400, 9 px at 600, 10 px at 700.
    setRunMeasurer((run, px) => {
      seen.push(run.bold ? '700' : run.semibold ? '600' : '400');
      const per = run.bold ? 10 : run.semibold ? 9 : 8;
      return (run.text.length * per * px) / 16;
    });
    const label = 'Turn the compost heap';
    const plain = pillSize(label, { reserveTask: true });
    const semi = pillSize(label, { reserveTask: true, semibold: true });
    expect(seen).toContain('600');
    expect(semi.textW).toBeGreaterThan(plain.textW);
    expect(semi.textW - plain.textW).toBe(label.length);
    // Hold-to-fit widths agree with paint.
    expect(naturalLineWidth(label, { reserveTask: true, semibold: true })).toBeGreaterThan(
      naturalLineWidth(label, { reserveTask: true }),
    );
    expect(fitTextWidth(label, { semibold: true })).toBeGreaterThan(fitTextWidth(label, {}));
    // Bold runs stay 700 inside a semibold caption.
    seen.length = 0;
    pillSize('Stake <b>runner</b> beans', { reserveTask: true, semibold: true });
    expect(seen).toContain('700');
    expect(seen).toContain('600');
  });

  it('the scope does not leak: a plain pill after a semibold one measures at 400', () => {
    const seen: string[] = [];
    setRunMeasurer((run, px) => {
      seen.push(run.semibold ? '600' : '400');
      return (run.text.length * 8 * px) / 16;
    });
    pillSize('Fill the water butt', { reserveTask: true, semibold: true });
    seen.length = 0;
    pillSize('Fill the water butt soon', { reserveTask: true });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((w) => w === '400')).toBe(true);
  });
});

describe('K6: folded count beside the + handle', () => {
  it('label is "N hidden"', () => {
    expect(foldCountLabel(5)).toBe('5 hidden');
    expect(foldCountLabel(1)).toBe('1 hidden');
  });

  it('draws 11 px text with aria-label, no pointer events, outside the 32 px handle hit', () => {
    const boxRight = 200;
    const svg = foldCountSvg(boxRight, 50, 5);
    expect(svg).toContain('class="map-fold-count"');
    expect(svg).toContain('aria-label="5 hidden"');
    expect(svg).toContain('role="img"');
    expect(svg).toContain('pointer-events="none"');
    expect(svg).toContain('font-size="11"');
    expect(svg).toMatch(/>5<\/text>/);
    const x = Number(/translate\(([\d.]+) /.exec(svg)![1]);
    const { cx } = foldHandleGeometry(boxRight, FOLD_SLOT);
    // .map-fold-hit spans cx - 16 … cx + 16.
    expect(x).toBeGreaterThan(cx + 16);
    expect(x - (cx + 16)).toBeLessThanOrEqual(2);
  });

  it('nothing for 0; wider for two digits', () => {
    expect(foldCountSvg(200, 50, 0)).toBe('');
    const w = (svg: string) => Number(/width="([\d.]+)"/.exec(svg)![1]);
    expect(w(foldCountSvg(200, 50, 12))).toBeGreaterThan(w(foldCountSvg(200, 50, 5)));
  });

  it('fold chrome adds the count only when folded', () => {
    expect(foldChromeSvg(200, 50, true, FOLD_SLOT, { hiddenCount: 5 })).toContain('map-fold-count');
    expect(foldChromeSvg(200, 50, false, FOLD_SLOT, { hiddenCount: 5 })).not.toContain('map-fold-count');
    expect(foldChromeSvg(200, 50, true, FOLD_SLOT)).not.toContain('map-fold-count');
  });

  it('paint counts direct children and names them in the pill label', () => {
    expect(mapSrc).toContain('const hiddenCount = col ? n.children?.length ?? 0 : 0;');
    expect(mapSrc).toContain(', collapsed, ${foldCountLabel(hiddenCount)}');
  });

  it('CSS: menu surface, 11 px, text colour, no pointer events', () => {
    expect(cssBlock('.map-fold-count {')).toContain('pointer-events: none;');
    const rect = cssBlock('.map-fold-count rect {');
    expect(rect).toContain('fill: var(--map-menu-bg);');
    expect(rect).toContain('stroke: var(--map-menu-stroke);');
    const text = cssBlock('.map-fold-count text {');
    expect(text).toContain('font-size: 11px;');
    expect(text).toContain('fill: var(--text, var(--of-text));');
  });
});

/** Just enough DOM for renderLinkPopRows in node. */
function withFakeDocument<T>(fn: () => T): T {
  type El = {
    tagName: string;
    className: string;
    children: El[];
    attrs: Record<string, string>;
    dataset: Record<string, string>;
    textContent: string;
    href?: string;
    title?: string;
    target?: string;
    rel?: string;
    tabIndex?: number;
    classList: { add: (c: string) => void };
    setAttribute: (k: string, v: string) => void;
    getAttribute: (k: string) => string | null;
    appendChild: (c: El) => El;
  };
  const make = (tagName: string): El => {
    const el: El = {
      tagName,
      className: '',
      children: [],
      attrs: {},
      dataset: {},
      textContent: '',
      classList: { add: (c) => (el.className += ` ${c}`) },
      setAttribute: (k, v) => (el.attrs[k] = v),
      getAttribute: (k) => el.attrs[k] ?? null,
      appendChild: (c) => (el.children.push(c), c),
    };
    return el;
  };
  const g = globalThis as { document?: unknown };
  const prev = g.document;
  g.document = { createElement: make };
  try {
    return fn();
  } finally {
    g.document = prev;
  }
}

describe('K3: ↗ on rows that open a new window', () => {
  const rowsOf = (rows: ReturnType<typeof noteLinkRows>) =>
    withFakeDocument(() => renderLinkPopRows(rows, { fine: true, kind: 'note' }).items) as unknown as {
      children: { className: string; textContent: string; attrs: Record<string, string> }[];
      attrs: Record<string, string>;
      target?: string;
    }[];

  it('Open #N, Open map and Open details each end in a muted, aria-hidden ↗', () => {
    const items = rowsOf(
      noteLinkRows('2101', 'https://notes.example.org/n/2101', {
        mapHref: 'https://notes.example.org/map?id=2101',
        detailsHref: '/notes/2101/details',
      }),
    );
    expect(items).toHaveLength(3);
    for (const a of items) {
      const last = a.children[a.children.length - 1]!;
      expect(last.className).toBe('map-link-ext');
      expect(last.textContent).toBe(LINK_EXT_ARROW);
      expect(LINK_EXT_ARROW).toBe('↗');
      expect(last.attrs['aria-hidden']).toBe('true');
      expect(a.target).toBe('_blank');
      expect(a.attrs['aria-label']).toMatch(/, opens in new window$/);
    }
    expect(items[0]!.attrs['aria-label']).toBe('Open #2101, notes.example.org, opens in new window');
  });

  it('Open #N without a noteUri fires onNoteLink only: no ↗', () => {
    const [a] = rowsOf(noteLinkRows('2101', null));
    expect(a!.children.map((c) => c.className)).toEqual(['map-link-label']);
    expect(a!.attrs['aria-label']).toBeUndefined();
  });

  it('in-map jumps (hop rows) never get ↗; external caption links do', () => {
    const rows = captionLinkRows(
      [
        { label: 'Back to the three', href: '#id:three', hopId: 'three' },
        { label: 'Seed catalogue', href: 'https://seeds.example.org/' },
      ] as never,
      'https://garden.example.org/day',
    );
    expect(opensNewWindow(rows[0]!)).toBe(false);
    expect(opensNewWindow(rows[1]!)).toBe(true);
    const items = withFakeDocument(() => renderLinkPopRows(rows, { fine: true }).items) as unknown as {
      children: { className: string }[];
    }[];
    expect(items[0]!.children.some((c) => c.className === 'map-link-ext')).toBe(false);
    expect(items[1]!.children.some((c) => c.className === 'map-link-ext')).toBe(true);
  });

  it('jump chips in the map have no ↗', () => {
    const jump = mapSrc.slice(mapSrc.indexOf("if (piece.kind === 'jump')"), mapSrc.indexOf('const pieceIndex = noteIndex++'));
    expect(jump).not.toContain('↗');
    expect(jump).not.toContain('2197');
  });
});

describe('authored (+) on a line with no id', () => {
  const MD = ['- Allotment <id:day>', '  - Reference shelf (+)', '    - Frost dates', '    - Soil notes', ''].join('\n');

  it('validateDocument(md).doc keeps the mark on the line but has no id to fold (unchanged)', () => {
    const { doc } = validateDocument(MD);
    const shelf = byTitle(doc!.nodes, 'Reference shelf');
    expect(shelf.id).toBeUndefined();
    expect(shelf.foldMark).toBe('collapsed');
    expect(doc!.fold.ids).toEqual([]);
  });

  it('validateDocument(md, { sessionIds: true }).doc folds it, like parse(md, { sessionIds: true })', () => {
    const { ok, doc } = validateDocument(MD, { sessionIds: true });
    expect(ok).toBe(true);
    const shelf = byTitle(doc!.nodes, 'Reference shelf');
    expect(shelf.id).toBeTruthy();
    expect(shelf.autoId).toBe(true);
    expect(doc!.fold.ids).toEqual([shelf.id]);
    expect(doc).toEqual(parse(MD, { sessionIds: true }));
  });

  it('sessionIds takes a prefix and is ignored for a doc source', () => {
    const { doc } = validateDocument(MD, { sessionIds: { prefix: 's' } });
    expect(byTitle(doc!.nodes, 'Reference shelf').id).toMatch(/^s\d+$/);
    const given = parse(MD);
    expect(validateDocument(given, { sessionIds: true }).doc).toBe(given);
  });
});
