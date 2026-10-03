import { describe, expect, it } from 'vitest';
import { assignPersistentId, nextAutoId } from '../src/nodeAddress.js';
import type { OutlineFoldDoc } from '../src/types.js';

describe('nextAutoId', () => {
  it('continues after existing numbers instead of starting at 1', () => {
    const used = new Set(['1', '2', '7', 'bank']);
    expect(nextAutoId(used)).toBe('8');
    expect(nextAutoId(used)).toBe('9');
  });

  it('keeps a prefix series separate and defaults to no prefix', () => {
    const used = new Set(['1', '4', 'n3']);
    expect(nextAutoId(used, 'n')).toBe('n4');
    expect(nextAutoId(used)).toBe('5');
  });
});

describe('assignPersistentId', () => {
  it('does not reuse a low position when a higher auto id exists', () => {
    const doc: OutlineFoldDoc = {
      nodes: [{ title: 'kept', id: '4' }, { title: 'blank' }],
      fold: { mode: '-', ids: [] },
    };
    expect(assignPersistentId(doc, doc.nodes[1]!)).toBe('5');
    expect(doc.nodes[1]!.id).toBe('5');
  });
});
