// 0.4.5 (Colin tablet): secure zone caret/footer/keyring/arrows, region connectors, locked pill.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { splitZoneText, joinZoneText } from '../src/editor/index.js';
import { innerRegionEdges, type PlacedBox } from '../src/regionLayout.js';
import { foldedRegionPill, FOLD_SLOT } from '../src/mapView.js';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
// Invented fixture, not real notes.
const ZONE = 'pantry plan\n\tbuy oats\n\t[ ] call grocer\n\n--- keyring ---\nk9: kdf=fake wrap=AAAA\n---';

describe('0.4.5 secure zone', () => {
  it('keyring stays out of the editable zone text and round-trips', () => {
    const s = splitZoneText(ZONE);
    expect(s.body).toBe('pantry plan\n\tbuy oats\n\t[ ] call grocer');
    expect(s.body).not.toContain('keyring');
    expect(s.trailer.startsWith('--- keyring ---')).toBe(true);
    expect(joinZoneText(s.body + '\n\tnew', s.trailer)).toContain('\tnew\n\n--- keyring ---\nk9:');
    expect(splitZoneText('a\nb')).toEqual({ body: 'a\nb', trailer: '' });
  });
  it('nested editor draws its own caret', () => {
    const e = src('editor/index.ts');
    expect(e).toMatch(/drawSelection\(\),\s*zoneCaret/);
    expect(e).toContain("caretColor: 'var(--of-caret, #9ecbff)'");
  });
  it('↑ after the zone and ↑/↓ at zone edges are handled', () => {
    const e = src('editor/index.ts');
    expect(e).toContain("{ key: 'ArrowUp', run: (v) => leave(v, -1) }");
    expect(e).toContain('enterZone'); // 0.4.13: main side is CM's default motion + this hook
  });
  it('footer buttons are themed, never white on white', () => {
    const css = src('outline-fold.css');
    const rule = /\.of-sz-btn \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toContain('var(--of-sz-btn-bg');
    expect(rule).toContain('color: var(--of-sz-btn-ink, var(--of-text');
    expect(rule).not.toMatch(/background: #fff/);
  });
});

describe('0.4.5 map region', () => {
  it('inner connectors join parent and child inside the cloud', () => {
    const b = (key: string, x: number, parent?: string): PlacedBox => ({ key, title: key, depth: parent ? 1 : 0, x, y: 10, w: 50, h: 20, ...(parent ? { parent } : {}) });
    expect(innerRegionEdges([b('r:1', 0), b('r:2', 100, 'r:1'), b('r:3', 200, 'r:missing')])).toEqual([[50, 20, 100, 20]]);
    expect(src('outline-fold.css')).toMatch(/\.map-svg \.map-region-edge \{ stroke: var\(--of-region-edge, #a8e0b8\)/);
  });
  it('locked pill: glyph only (no copied caption), padded for glyph, chip and fold slot', () => {
    const m = src('mapView.ts');
    expect(m).toContain("(r.host.doc ? '🔓' : '🔒') : regionName)");
    const p = foldedRegionPill(24);
    expect(p.w).toBe(12 + Math.ceil(24 * 1.4) + 12 + 34 + FOLD_SLOT);
    expect(p.h).toBeGreaterThanOrEqual(30);
  });
});
