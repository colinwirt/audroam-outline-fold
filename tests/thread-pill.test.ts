/**
 * Thread pill (0.2.34): drawn in the chip row after the caption, so the pill's
 * measured width holds it and it never crosses the border. Theme variables, not gold.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mapChipPieces, mapChipSpan, noteChipSpan, pillSize, PILL_PAD_X } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const mapSrc = readFileSync(join(here, '../src/mapView.ts'), 'utf8');
const css = readFileSync(join(here, '../src/outline-fold.css'), 'utf8');

describe('thread pill sits inside the node', () => {
  it('the chip row reserves its width; no extra height', () => {
    const plain = pillSize('Shed meeting');
    const withThread = pillSize('Shed meeting', { thread: true });
    expect(withThread.h).toBe(plain.h);
    expect(withThread.w).toBeGreaterThan(plain.w);
    const pieces = mapChipPieces({ thread: true });
    expect(pieces).toEqual([{ kind: 'thread', id: '', label: 'Thread', w: expect.any(Number) }]);
    // Caption + chip row + air fit inside the box (no fold slot here).
    const widest = withThread.textW - 2 * PILL_PAD_X;
    expect(withThread.w).toBeGreaterThanOrEqual(PILL_PAD_X + widest + mapChipSpan({ thread: true }) - 1);
  });

  it('order is thread, #N, jumps; #N widths are unchanged', () => {
    const kinds = mapChipPieces({ thread: true, noteLinks: ['5'], jumps: [{ id: 'a', label: '→ A' }] }).map((p) => p.kind);
    expect(kinds).toEqual(['thread', 'note', 'jump']);
    expect(noteChipSpan(['1004'])).toBe(mapChipSpan({ noteLinks: ['1004'] }));
  });

  it('paints in the chip row with theme classes, not at the bottom border in gold', () => {
    const paint = mapSrc.slice(mapSrc.indexOf("if (piece.kind === 'thread')"), mapSrc.indexOf('const pieceIndex = noteIndex++'));
    expect(paint).toMatch(/map-thread-hit/);
    expect(paint).not.toMatch(/#C9A227|rgba\(201,162,39/i);
    expect(mapSrc).not.toMatch(/y \+ h - \(affordance \? affordance \+ 4 : 6\)/);
    expect(mapSrc).toMatch(/class="map-thread-pill"/);
    expect(css).toMatch(/\.map-thread-pill \{[^}]*var\(--map-menu-bg\)[^}]*var\(--map-menu-stroke\)/);
    expect(css).toMatch(/\.map-thread-label \{[^}]*var\(--muted, var\(--of-muted\)\)/);
  });
});
