import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { composeOutlineDoc, createRegionFoldStore, toHtml } from '../src/index.js';
import { SEAL_ALG } from '../src/sealedState.js';
import type { OutlineFoldDoc, OutlineNode } from '../src/types.js';

const sealedNode = (): OutlineNode => ({
  id: '4', title: 'Sealed branch', depth: 0, children: [],
  sealed: { alg: SEAL_ALG, kid: 'k1', ciphertext: 'CT' },
} as unknown as OutlineNode);
const rootDoc = (): OutlineFoldDoc => ({ nodes: [sealedNode()], fold: { mode: '-', ids: [] } } as OutlineFoldDoc);
const regionDoc = (): OutlineFoldDoc => ({
  nodes: [{ id: '1', title: 'note 3 for test sealing', depth: 0, children: [{ id: '2', title: 'child A', depth: 1, children: [] }] }],
  fold: { mode: '-', ids: [] },
} as unknown as OutlineFoldDoc);

describe('Outline sealed regions (0.4.2)', () => {
  it('locked: no plaintext, locked chrome, Decrypt chip and key pill', () => {
    const html = toHtml(composeOutlineDoc(rootDoc(), [{ id: 's:4', kind: 'sealed', anchor: '4', doc: null }], createRegionFoldStore()));
    expect(html).not.toContain('child A');
    expect(html).toContain('•••• locked ••••');
    expect(html).toContain('data-decrypt="4"');
    expect(html).toContain('data-testid="of-kid-4"');
    expect(html).toContain('data-sealed-branch="locked"');
  });

  it('unlocked: anchor drops locked chrome and Decrypt; region root is a sealed zone', () => {
    const root = rootDoc();
    const html = toHtml(composeOutlineDoc(root, [{ id: 's:4', kind: 'sealed', anchor: '4', doc: regionDoc() }], createRegionFoldStore()));
    expect(html).toContain('child A');
    expect(html).not.toContain('•••• locked ••••');
    expect(html).not.toContain('data-decrypt=');
    expect(html).toContain('data-sealed-branch="unlocked"');
    expect(html).toMatch(/class="of-node[^"]*of-region of-region-sealed"/);
    expect(html).toContain('🔓 k1');
    // The root doc is never mutated: still sealed, no region flags, no plaintext children.
    expect(root.nodes[0]!.regionState).toBeUndefined();
    expect(root.nodes[0]!.children).toEqual([]);
  });

  it('CSS: unlock card rules do not hit the Decrypt chip; card buttons set their own ink', () => {
    const css = readFileSync(new URL('../src/outline-fold.css', import.meta.url), 'utf8');
    expect(css).not.toMatch(/^\.of-unlock \{ position: fixed/m);
    expect(css).toMatch(/^div\.of-unlock \{ position: fixed/m);
    expect(css).toMatch(/\.of-unlock button:not\(\.of-q\) \{[^}]*color: var\(--of-seal-btn-ink/);
  });
});
