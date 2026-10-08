import { afterEach, describe, expect, it } from 'vitest';
import {
  measurePill,
  wrapLines,
  fitTextWidth,
  naturalLineWidth,
  captionVisibleText,
  parse,
  pillSize,
  displayCaption,
} from '../src/index.js';
import { captionWithoutLinks } from '../src/captionRich.js';
import { setRunMeasurer } from '../src/svgTextMeasure.js';

/**
 * Spaces between words must survive every wrap width (0.2.35 bug: at some
 * pill widths `ip addr # interface names` painted `interfacenames`).
 */

const CAPTIONS = [
  'ip addr # interface names',
  'alpha beta gamma delta',
  'a # b # c # d # e # f',
  'git log --oneline # show history',
  'one  two   three four',
  'ip  addr  #  interface  names',
  '**ip** addr # *interface* names',
  '`ip addr` # interface names',
  '`ip addr # interface names`',
  'Bring gloves, a trowel and a flask of tea; the shed key is under the blue pot',
];

/**
 * Each rendered line must be the next contiguous slice of the caption's
 * visible text, with only spaces consumed at a break. A line that glues two
 * words ("interfacenames") or loses a character fails here.
 */
function expectLinesTileCaption(caption: string, lines: string[], ctx: string): void {
  const src = captionVisibleText(caption);
  let at = 0;
  for (const line of lines) {
    while (at < src.length && src[at] === ' ') at++;
    expect(src.slice(at, at + line.length), `${ctx} line ${JSON.stringify(line)} of ${JSON.stringify(lines)}`).toBe(line);
    at += line.length;
  }
  expect(src.slice(at).trim(), `${ctx} leftover of ${JSON.stringify(lines)}`).toBe('');
}

/** When every word fits a line, the break is just a space: words come back exactly. */
function expectWordsKept(caption: string, lines: string[], ctx: string): void {
  const words = captionVisibleText(caption).split(/\s+/).filter(Boolean);
  const got = lines.join(' ').split(/\s+/).filter(Boolean);
  expect(got, `${ctx} ${JSON.stringify(lines)}`).toEqual(words);
  for (const line of lines) {
    for (const token of line.split(/\s+/).filter(Boolean)) {
      expect(words, `${ctx} glued token ${JSON.stringify(token)}`).toContain(token);
    }
  }
}

/** Uneven proportional advances, like a real sans-serif. */
const ADV: Record<string, number> = { ' ': 4.4, i: 3.6, l: 3.6, '.': 4, ',': 4, '#': 9.2, m: 13.3, w: 11.7, '-': 5.3 };
function proportional(run: { text: string; code?: boolean; bold?: boolean }, fontPx: number): number {
  let w = 0;
  for (const c of run.text) w += run.code ? 9.6 : (ADV[c] ?? (c >= 'A' && c <= 'Z' ? 10.4 : 8.1));
  if (run.bold) w *= 1.06;
  return (w * fontPx) / 16;
}

afterEach(() => setRunMeasurer(null));

describe('wrap keeps spaces between words at every width', () => {
  it('reproduces the reported pill: no `interfacenames` at any px width', () => {
    for (let w = 96; w <= 320; w++) {
      const lines = measurePill('ip addr # interface names', { widthPx: w }).lines;
      for (const line of lines) expect(line, `widthPx ${w}`).not.toMatch(/interfacenames|addr#|#interface/);
    }
  });

  it('px widths (Fit text / 1 line / hold-to-fit steps), character-advance measure', () => {
    for (const caption of CAPTIONS) {
      for (const fontSize of [11, 16, 22]) {
        for (let w = 96; w <= 900; w += 0.5) {
          const m = measurePill(caption, { widthPx: w, fontSize, maxLines: null });
          expectLinesTileCaption(caption, m.lines, `w=${w} font=${fontSize}`);
        }
      }
    }
  });

  it('px widths with a proportional measurer, task box on and off', () => {
    setRunMeasurer(proportional);
    for (const caption of CAPTIONS) {
      for (const fontSize of [13, 17]) {
        for (const reserveTask of [false, true]) {
          for (let w = 96; w <= 700; w += 0.5) {
            const m = measurePill(caption, { widthPx: w, fontSize, reserveTask, maxLines: null });
            expectLinesTileCaption(caption, m.lines, `prop w=${w} font=${fontSize} task=${reserveTask}`);
          }
        }
      }
    }
  });

  it('words come back whole once the column fits the longest word', () => {
    setRunMeasurer(proportional);
    const fontSize = 19;
    for (const caption of CAPTIONS) {
      const longest = Math.max(
        ...captionVisibleText(caption)
          .split(/\s+/)
          .map((word) => Math.max(proportional({ text: word }, fontSize), proportional({ text: word, code: true }, fontSize))),
      );
      for (let w = Math.ceil(longest + 40); w <= 900; w += 0.5) {
        const m = measurePill(caption, { widthPx: w, fontSize, maxLines: null });
        expectWordsKept(caption, m.lines, `w=${w}`);
      }
    }
  });

  it('auto width (wrapCh sweep, orphan widening) and wrapLines', () => {
    for (const measure of [null, proportional]) {
      setRunMeasurer(measure);
      const fontSize = measure ? 15 : 16;
      for (const caption of CAPTIONS) {
        for (let ch = 1; ch <= 90; ch++) {
          const auto = measurePill(caption, { wrapCh: ch, fontSize, maxLines: null });
          expectLinesTileCaption(caption, auto.lines, `auto wrapCh=${ch}`);
          expectLinesTileCaption(caption, wrapLines(caption, ch, null).lines, `wrapLines ch=${ch}`);
        }
      }
    }
  });

  it('Fit text and 1 line picks paint the same words as the caption', () => {
    for (const measure of [null, proportional]) {
      setRunMeasurer(measure);
      const fontSize = measure ? 14 : 12;
      for (const caption of CAPTIONS) {
        for (const w of [fitTextWidth(caption, { fontSize }), naturalLineWidth(caption, { fontSize })]) {
          const m = measurePill(caption, { widthPx: w, fontSize, maxLines: null });
          expectWordsKept(caption, m.lines, `pick w=${w}`);
        }
        const one = measurePill(caption, { widthPx: naturalLineWidth(caption, { fontSize }), fontSize });
        expect(one.lines).toEqual([captionVisibleText(caption)]);
      }
    }
  });

  it("Colin's repro: inline-code caption, layout `textWidth: 75` and `19:` w 200", () => {
    const doc = parse(
      '- `ip addr # interface names` <id:19>\n\n--- layout ---\ntextWidth: 75\n19:\n  w: 200\n---\n',
    );
    const n = doc.nodes[0]!;
    expect(n.layout?.w).toBe(200);
    const label = captionWithoutLinks(displayCaption(n.title));
    // Monospace advances around the real ones (0.6em), so the 200px column
    // lands on the width window that glued `interface` and `names`.
    for (const em of [null, 0.55, 0.6, 0.62]) {
      setRunMeasurer(em == null ? null : (run, px) => run.text.length * px * (run.code ? em : em * 0.85));
      for (let fontSize = 11; fontSize <= 24; fontSize += 0.5) {
        const s = pillSize(label, { widthPx: n.layout!.w, fontSize: fontSize + (em ?? 0) / 100 });
        expect(s.richLines.flat().every((r) => r.code), 'inline code stays code').toBe(true);
        expectLinesTileCaption(label, s.lines, `em=${em} font=${fontSize}`);
        for (const line of s.lines) expect(line).not.toContain('interfacenames');
      }
    }
    // 13px, character advance: before the fix this painted `ip addr #` / `interfacenames`.
    setRunMeasurer(null);
    expect(pillSize(label, { widthPx: 200, fontSize: 13 }).lines).toEqual(['ip addr #', 'interface names']);
  });

  it('keeps user-typed runs of spaces inside a line', () => {
    const m = measurePill('one  two   three four', { widthPx: 900 });
    expect(m.lines).toEqual(['one  two   three four']);
  });
});
