import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parse.js';
import { serialize } from '../src/serialize.js';
import { measurePill, naturalLineWidth, fitTextWidth, autoTextWidth, FIT_TEXT_CH } from '../src/mapLabel.js';
import {
  WIDTH_HELP_LINES,
  WIDTH_MENU_KEYS,
  fitTextEntry,
  oneLineEntry,
  sameWidth,
  siblingScope,
  singleLineCap,
  singleLineWidth,
  stepEntry,
  widthMenuKeyItem,
  widthPickAnnouncement,
  widthToastText,
} from '../src/mapFit.js';
import * as pkg from '../src/index.js';

const LONG = 'Bring gloves, a trowel and a flask of tea; the shed key is under the blue pot by the gate';
const TWO = 'Plot seven waiting list opens in March<br>Ask at the Saturday stall for a paper form, or leave a note in the honesty box';

describe('hold-to-fit P1: w-auto in the layout block (F5a)', () => {
  const text = `- Tool shed <id:shed>
  - The ride-on mower needs a new drive belt <id:mower>
  - Rakes <id:rakes>

--- layout ---
mower:
  w: 150
  w-auto: single-line
rakes:
  w: 200
---
`;

  it('parses w-auto next to w and writes it back after w', () => {
    const doc = parse(text);
    expect(doc.nodes[0]?.children?.[0]?.layout).toEqual({ w: 150, wAuto: 'single-line' });
    expect(doc.nodes[0]?.children?.[1]?.layout).toEqual({ w: 200 });
    const out = serialize(doc);
    expect(out).toContain('mower:\n  w: 150\n  w-auto: single-line\nrakes:\n  w: 200\n---');
    expect(serialize(parse(out))).toBe(out);
  });

  it('a w-auto without a w is not an entry (w is the fallback older parsers read)', () => {
    const doc = parse('- Rakes <id:rakes>\n\n--- layout ---\nrakes:\n  w-auto: single-line\n---\n');
    expect(doc.nodes[0]?.layout).toBeUndefined();
  });

  it('keeps an unknown mode verbatim (a newer writer), lower-cased', () => {
    const doc = parse('- Rakes <id:rakes>\n\n--- layout ---\nrakes:\n  w: 210\n  w-auto: Fit-Column\n---\n');
    expect(doc.nodes[0]?.layout).toEqual({ w: 210, wAuto: 'fit-column' });
  });
});

describe('hold-to-fit P1: measures (F4, F5)', () => {
  it('natural one-line width: the pill at that width never soft-wraps', () => {
    for (const label of [LONG, 'Seeds', '**Bold** words and plain words mixed for a while longer than thirty two']) {
      const w = naturalLineWidth(label);
      expect(measurePill(label, { widthPx: w }).lines).toHaveLength(1);
      expect(measurePill(label, { widthPx: w - 8 }).lines.length).toBeGreaterThanOrEqual(label === 'Seeds' ? 1 : 2);
    }
  });

  it('authored line breaks keep their own rows (never joined)', () => {
    const w = naturalLineWidth(TWO);
    expect(measurePill(TWO, { widthPx: w }).lines).toHaveLength(2);
  });

  it('a task box replaces the left pad, as in measurePill', () => {
    expect(naturalLineWidth(LONG) - naturalLineWidth(LONG, { reserveTask: true })).toBe(16);
  });

  it('Fit text wraps at 60ch: wider than Auto, narrower than one line', () => {
    expect(FIT_TEXT_CH).toBe(60);
    const fit = fitTextWidth(LONG);
    expect(fit).toBeGreaterThan(autoTextWidth(LONG));
    expect(fit).toBeLessThan(naturalLineWidth(LONG));
    expect(measurePill(LONG, { widthPx: fit }).lines).toHaveLength(2);
  });

  it('scales with the font size', () => {
    expect(naturalLineWidth(LONG, { fontSize: 20 })).toBeGreaterThan(naturalLineWidth(LONG, { fontSize: 15 }));
  });
});

describe('hold-to-fit P1: decisions', () => {
  it('single-line cap: min(1400, map width − 48), floor 120', () => {
    expect(singleLineCap(1400)).toBe(1352);
    expect(singleLineCap(2400)).toBe(1400);
    expect(singleLineCap(390)).toBe(342);
    expect(singleLineCap(100)).toBe(120);
    expect(singleLineCap(0)).toBe(1400);
    expect(singleLineCap(undefined)).toBe(1400);
    expect(singleLineWidth(812.2, 1352)).toBe(813);
    expect(singleLineWidth(900, 342)).toBe(342);
    expect(singleLineWidth(80, 1352)).toBe(120);
  });

  it('1 line stores the computed px (never 1400 by default) with w-auto', () => {
    expect(oneLineEntry({ natural: 812, auto: 300, cap: 1352 })).toEqual({
      w: 812,
      wAuto: 'single-line',
      capped: false,
    });
    expect(oneLineEntry({ natural: 1600, auto: 300, cap: 1352 })).toEqual({
      w: 1352,
      wAuto: 'single-line',
      capped: true,
    });
  });

  it('1 line on a caption already on one line at Auto writes nothing (no id, F8)', () => {
    expect(oneLineEntry({ natural: 104, auto: 104, cap: 1352 })).toEqual({ w: null, wAuto: null, capped: false });
    expect(oneLineEntry({ natural: 300, auto: 297, cap: 1352 })).toEqual({ w: null, wAuto: null, capped: false });
  });

  it('Fit text deletes within 4 px of Auto, and when Auto is already wider', () => {
    expect(fitTextEntry({ fit: 529, auto: 307 })).toEqual({ w: 529, wAuto: null });
    expect(fitTextEntry({ fit: 310, auto: 307 })).toEqual({ w: null, wAuto: null });
    expect(fitTextEntry({ fit: 80, auto: 90 })).toEqual({ w: null, wAuto: null });
    expect(fitTextEntry({ fit: 2000, auto: 307 })).toEqual({ w: 1400, wAuto: null });
  });

  it('Slim / Wider step 56 px, clamp to 120..1400 and drop w-auto', () => {
    expect(stepEntry(300, -1)).toEqual({ w: 244, wAuto: null });
    expect(stepEntry(150, -1)).toEqual({ w: 120, wAuto: null });
    expect(stepEntry(1380, 1)).toEqual({ w: 1400, wAuto: null });
  });

  it('sameWidth compares both keys', () => {
    expect(sameWidth({ w: 300, wAuto: null }, { w: 300, wAuto: null })).toBe(true);
    expect(sameWidth({ w: 300, wAuto: null }, { w: 300, wAuto: 'single-line' })).toBe(false);
    expect(sameWidth({ w: null, wAuto: null }, { w: null, wAuto: null })).toBe(true);
  });

  it('siblings scope: the pressed node first, then the same parent’s other children', () => {
    expect(siblingScope('b', ['a', 'b', 'c'])).toEqual(['b', 'a', 'c']);
    expect(siblingScope('x', ['a', 'b'])).toEqual(['x']);
    expect(siblingScope('x', null)).toEqual(['x']);
  });
});

describe('hold-to-fit P1: words (F7, F11, F12, F13)', () => {
  it('toast and live-region text', () => {
    expect(widthToastText(1)).toBe('1 width changed');
    expect(widthToastText(4)).toBe('4 widths changed');
    expect(widthPickAnnouncement('siblings', { title: 'Python next steps', count: 4, capped: 1 })).toBe(
      'Python next steps and 3 siblings on 1 line. 1 wraps at the cap.',
    );
    expect(widthPickAnnouncement('siblings', { title: 'Solo', count: 1 })).toBe('Solo on 1 line.');
    expect(widthPickAnnouncement('line', { title: 'Seeds', capped: 0 })).toBe('Seeds on 1 line.');
    expect(widthPickAnnouncement('line', { title: 'Long', capped: 1 })).toBe('Long on 1 line. 1 wraps at the cap.');
    expect(widthPickAnnouncement('fit', { title: 'Beans' })).toBe('Beans wraps at 60 characters.');
    expect(widthPickAnnouncement('fit', { title: 'Peas', auto: true })).toBe('Peas at default width.');
    expect(widthPickAnnouncement('auto', { title: 'Peas' })).toBe('Peas at default width.');
    expect(widthPickAnnouncement('slim', { title: 'Peas' })).toBe('Peas narrower.');
    expect(widthPickAnnouncement('wider', { title: 'Peas' })).toBe('Peas wider.');
  });

  it('mnemonics t / l / s / a', () => {
    expect(WIDTH_MENU_KEYS).toEqual({ fit: 't', line: 'l', siblings: 's', auto: 'a' });
    expect(widthMenuKeyItem('t')).toBe('fit');
    expect(widthMenuKeyItem('L')).toBe('line');
    expect(widthMenuKeyItem('s')).toBe('siblings');
    expect(widthMenuKeyItem('a')).toBe('auto');
    expect(widthMenuKeyItem('w')).toBeNull();
    expect(widthMenuKeyItem('Tab')).toBeNull();
  });

  it('help lines are the P1 subset of F13, verbatim', () => {
    expect(WIDTH_HELP_LINES).toEqual([
      'Fit text: wrap at 60 characters. 1 line: no wrapping.',
      'Auto: default width.',
      'w: width menu. Ctrl/⌘+Z: undo widths.',
    ]);
  });

  it('exports the API from the package entry', () => {
    for (const name of [
      'naturalLineWidth',
      'fitTextWidth',
      'autoTextWidth',
      'oneLineEntry',
      'fitTextEntry',
      'singleLineCap',
      'WIDTH_HELP_LINES',
      'W_AUTO_SINGLE_LINE',
    ]) {
      expect(pkg).toHaveProperty(name);
    }
  });
});

describe('hold-to-fit P1: mapView wiring (source)', () => {
  const src = readFileSync(new URL('../src/mapView.ts', import.meta.url), 'utf8');

  it('single-line widths resolve before positions; held while the caption is edited', () => {
    const ensure = src.slice(src.indexOf('function ensurePositions(): void {'));
    expect(ensure.indexOf('resolveAutoWidths();')).toBeGreaterThan(0);
    expect(ensure.indexOf('resolveAutoWidths();')).toBeLessThan(ensure.indexOf('autoPackPositions('));
    expect(src).toMatch(/const editingKey = isEditing\(\) \? getFocusId\(\) : '';/);
    expect(src).toContain("...(prev?.wAuto !== undefined ? { wAuto: prev.wAuto } : {}),");
  });

  it('ids are minted only through writeWidth for a written w (F8)', () => {
    const calls = src.match(/assignPersistentId\(/g) || [];
    // writeWidth only, plus the import line.
    expect(calls.length).toBe(1);
    expect(src).toMatch(/import \{ assignPersistentId,/);
    const ww = src.slice(src.indexOf('function writeWidth('), src.indexOf('function fitMeasure('));
    expect(ww.indexOf('if (!persist)')).toBeLessThan(ww.indexOf('assignPersistentId('));
    expect(ww.indexOf('if (next.w == null)', ww.indexOf('if (!persist)') + 20)).toBeLessThan(
      ww.indexOf('assignPersistentId('),
    );
  });

  it('one batched setDoc + onChange per step', () => {
    const flush = src.slice(src.indexOf('function flushWidths('), src.indexOf('function applyEntries('));
    expect(flush.match(/setDoc\(/g)).toHaveLength(1);
    expect(flush.match(/onChange\?\.\(\)/g)).toHaveLength(1);
  });

  it('Ctrl/⌘+Z: view mode only, and only when a width step was undone', () => {
    expect(src).toMatch(/\(e\.key === 'z' \|\| e\.key === 'Z'\) &&\s+!isEditing\(\) &&/);
    expect(src).toMatch(/const done = e\.shiftKey \? redoWidth\(\) : undoWidth\(\);\s+if \(done\) \{\s+e\.preventDefault\(\);/);
  });

  it('the toast survives paint and is outside the gesture handlers', () => {
    expect(src).toContain(".map-live, .map-link-pop, .map-toast'");
    expect(src).toContain("'.map-width-pop, .of-map-controls, .map-level-menu, .map-link-pop, .map-toast'");
  });
});
