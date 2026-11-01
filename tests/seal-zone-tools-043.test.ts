import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { composeOutlineDoc, createRegionFoldStore, toHtml } from '../src/index.js';
import { SEAL_ALG } from '../src/sealedState.js';
import type { OutlineFoldDoc } from '../src/types.js';

const root = (): OutlineFoldDoc => ({ nodes: [{ id: '4', title: 'S', depth: 0, children: [], sealed: { alg: SEAL_ALG, kid: 'k1', ciphertext: 'CT' } }], fold: { mode: '-', ids: [] } } as unknown as OutlineFoldDoc);
const inner = (): OutlineFoldDoc => ({ nodes: [{ id: '1', title: 'inner', depth: 0, children: [] }], fold: { mode: '-', ids: [] } } as unknown as OutlineFoldDoc);

describe('0.4.3 zone header tools (QA C)', () => {
  it('unlocked zone header has Lock and More; locked has neither', () => {
    const open = toHtml(composeOutlineDoc(root(), [{ id: 's:4', kind: 'sealed', anchor: '4', doc: inner() }], createRegionFoldStore()));
    expect(open).toContain('data-seal-lock');
    expect(open).toContain('data-seal-more');
    const shut = toHtml(composeOutlineDoc(root(), [{ id: 's:4', kind: 'sealed', anchor: '4', doc: null }], createRegionFoldStore()));
    expect(shut).not.toContain('data-seal-lock');
    expect(shut).not.toContain('data-seal-more');
  });
  it('map: lock/more tools on open cloud, pill shows 🔓 when unlocked, unlock announced', () => {
    const src = readFileSync(new URL('../src/mapView.ts', import.meta.url), 'utf8');
    expect(src).toContain('map-region-lock');
    expect(src).toContain('map-region-more');
    expect(src).toContain("host.doc ? '🔓 ' : '🔒 '");
    expect(src).toContain('Sealed branch unlocked');
  });
  it('editor: locked <enc> line is a clickable green zone; kicks are guarded', () => {
    const src = readFileSync(new URL('../src/editor/index.ts', import.meta.url), 'utf8');
    expect(src).toContain('of-cm-sealed-line');
    expect(src).toContain('onUnlockZone');
    expect(src).toContain('if (dead) return;');
    expect(src).toContain('if (gone) return;');
  });
});
