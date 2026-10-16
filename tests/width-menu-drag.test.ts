import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse.js';
import { serialize } from '../src/serialize.js';
import {
  WIDTH_DRAG_THRESHOLD,
  W_AUTO_SINGLE_LINE,
  W_AUTO_SINGLE_LINE_HELD,
  autoWrapCh,
  dragEntry,
  isSingleLineMode,
  normalizeWidthPickKind,
  parseAutoWidth,
  passedDragThreshold,
  wideEntry,
} from '../src/mapFit.js';

describe('0.2.43 corner drag threshold', () => {
  it('jitter under 4 px is a click, not a resize', () => {
    expect(WIDTH_DRAG_THRESHOLD).toBe(4);
    expect(passedDragThreshold(0, 0)).toBe(false);
    expect(passedDragThreshold(2, 2)).toBe(false);
    expect(passedDragThreshold(3, 0)).toBe(false);
    expect(passedDragThreshold(4, 0)).toBe(true);
    expect(passedDragThreshold(-3, 3)).toBe(true);
  });
});

describe('0.2.43 a drag keeps the 1-line flag', () => {
  it('1 line / siblings / level pills stay 1-line (held) at the dragged width', () => {
    expect(dragEntry({ w: 300, wAuto: W_AUTO_SINGLE_LINE }, 412.4)).toEqual({ w: 412, wAuto: W_AUTO_SINGLE_LINE_HELD });
    expect(dragEntry({ w: 300, wAuto: W_AUTO_SINGLE_LINE_HELD }, 200)).toEqual({ w: 200, wAuto: W_AUTO_SINGLE_LINE_HELD });
    expect(isSingleLineMode(W_AUTO_SINGLE_LINE_HELD)).toBe(true);
  });
  it('other pills get a plain width, clamped', () => {
    expect(dragEntry({ w: null, wAuto: null }, 50)).toEqual({ w: 120, wAuto: null });
    expect(dragEntry({ w: 300, wAuto: null }, 9999)).toEqual({ w: 1400, wAuto: null });
  });
  it('held mode round-trips the layout block', () => {
    const t = '- Rakes <id:rakes>\n\n--- layout ---\nrakes:\n  w: 260\n  w-auto: single-line-held\n---\n';
    const doc = parse(t);
    expect(doc.nodes[0]?.layout).toEqual({ w: 260, wAuto: W_AUTO_SINGLE_LINE_HELD });
    expect(serialize(doc)).toContain('  w-auto: single-line-held');
  });
});

describe('0.2.43 Wide replaces Slim / Wider', () => {
  it('widens toward one line, capped at the view', () => {
    expect(wideEntry({ natural: 500, current: 200, cap: 900 })).toEqual({ w: 500, wAuto: null });
    expect(wideEntry({ natural: 2000, current: 200, cap: 900 })).toEqual({ w: 900, wAuto: null });
    // Never narrows.
    expect(wideEntry({ natural: 150, current: 300, cap: 900 })).toEqual({ w: 300, wAuto: null });
  });
  it('legacy kinds map: slim → fit, wider → wide', () => {
    expect(normalizeWidthPickKind('slim')).toBe('fit');
    expect(normalizeWidthPickKind('wider')).toBe('wide');
    expect(normalizeWidthPickKind('auto')).toBe('auto');
    expect(normalizeWidthPickKind('bogus')).toBeNull();
  });
});

describe('0.2.43 autoWidth (map-wide Auto)', () => {
  it('parses values', () => {
    expect(parseAutoWidth('48ch')).toBe('48ch');
    expect(parseAutoWidth('64')).toBe('64ch');
    expect(parseAutoWidth('Fit-View')).toBe('fit-view');
    expect(parseAutoWidth('wide')).toBeNull();
  });
  it('resolves to a wrap in characters', () => {
    expect(autoWrapCh(undefined, { fallback: 32 })).toBe(32);
    expect(autoWrapCh('48ch', { fallback: 32 })).toBe(48);
    const fv = autoWrapCh('fit-view', { viewportW: 1000, fontPx: 14, fallback: 32 });
    expect(fv).toBeGreaterThan(64);
    expect(fv).toBe(Math.floor((1000 - 48 - 32) / (14 * 0.6)));
  });
  it('round-trips in the layout block', () => {
    const t = '- Rakes <id:rakes>\n\n--- layout ---\nautoWidth: 48ch\n---\n';
    const doc = parse(t);
    expect(doc.frontmatter?.autoWidth).toBe('48ch');
    expect(serialize(doc)).toContain('autoWidth: 48ch');
  });
});
