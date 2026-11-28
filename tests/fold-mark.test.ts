/**
 * A `(+)` on a line sets `node.collapsed`. It never writes an id. Fiction text only.
 */
import { describe, expect, it } from 'vitest';
import { assignPersistentId, isCollapsed, parse, serialize, toggleFold } from '../src/index.js';

const both = (text: string) => [parse(text), parse(text, { sessionIds: true })];

describe('inline (+) on a line', () => {
  const texts = [
    '- Plain caption\n',
    '- Plain caption (+)\n  - child\n',
    '- Keeper log\n  - Tuesday (+)\n    - lamp oil\n  - Wednesday\n',
    '- [ ] Trim the wick (+)\n  - scissors\n',
    '- Gulls <t: 12> (+)\n  - three on the rail\n',
  ];
  for (const text of texts) {
    it(`round-trips ${JSON.stringify(text)} byte for byte`, () => {
      for (const doc of both(text)) {
        const out = serialize(doc);
        expect(out).toBe(text);
        expect(out).not.toContain('<id:');
        expect(out).not.toContain('--- layout ---');
      }
    });
  }

  it('sets collapsed from (+) and keeps the written id null', () => {
    for (const doc of both('- Plain caption (+)\n  - child\n')) {
      const node = doc.nodes[0]!;
      expect(node.writtenId).toBeNull();
      expect(node.collapsed).toBe(true);
      expect(node.sessionKey).toMatch(/^__sid-/);
      expect(isCollapsed(doc, node.sessionKey)).toBe(true);
    }
  });

  it('folds a line that already has a written id', () => {
    const doc = parse('- Lamp room <id:4> (+)\n  - brass\n');
    const node = doc.nodes[0]!;
    expect(node.writtenId).toBe('4');
    expect(node.collapsed).toBe(true);
    expect(isCollapsed(doc, node.sessionKey)).toBe(true);
    expect(isCollapsed(doc, '4' as never)).toBe(false);
    expect(serialize(doc)).toBe('- Lamp room <id:4> (+)\n  - brass\n');
  });

  it('an unfold drops the marker and writes no id', () => {
    const doc = parse('- Plain caption (+)\n  - child\n');
    const open = toggleFold(doc, doc.nodes[0]!.sessionKey);
    expect(serialize(open)).toBe('- Plain caption\n  - child\n');
  });

  it('keeps a custom collapsed marker and the expanded marker', () => {
    const text = '- Shelf [more]\n  - tins\n- Pantry [less]\n  - jars\n\n--- layout ---\ncollapsedMarker: "[more]"\nexpandedMarker: "[less]"\n---\n';
    const doc = parse(text);
    expect(doc.nodes[0]!.collapsed).toBe(true);
    expect(doc.nodes[1]!.collapsed).toBe(false);
    const out = serialize(doc);
    expect(out.split('\n').slice(0, 4).join('\n')).toBe('- Shelf [more]\n  - tins\n- Pantry [less]\n  - jars');
  });

  it('an old fold+: line does not mint an id', () => {
    const text = '- Harbour (+)\n  - boats\n\n--- layout ---\nfold+: \ncollapsedMarker: "(+)"\n---\n';
    const out = serialize(parse(text));
    expect(out.startsWith('- Harbour (+)\n  - boats\n')).toBe(true);
    expect(out).not.toContain('<id:');
  });

  it('assignPersistentId keeps the fold on the node', () => {
    const doc = parse('- Plain caption (+)\n  - child\n');
    const node = doc.nodes[0]!;
    const id = assignPersistentId(doc, node);
    expect(node.collapsed).toBe(true);
    expect(isCollapsed(doc, node.sessionKey)).toBe(true);
    expect(isCollapsed(doc, id as never)).toBe(false);
    expect(serialize(doc)).toContain(`- Plain caption <id:${id}> (+)`);
  });
});
