/**
 * 0.2.31: a `(+)` on a line without an id round-trips with or without session
 * ids. Folding is the inline marker; it never writes an id. Fiction text only.
 */
import { describe, expect, it } from 'vitest';
import { assignPersistentId, isCollapsed, parse, serialize, toggleFold } from '../src/index.js';

const both = (text: string) => [parse(text), parse(text, { sessionIds: true })];

describe('inline (+) on a line with no id', () => {
  const texts = [
    '- Plain caption (+)\n',
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

  it('records the marker on the node only when it has no id', () => {
    const plain = parse('- Plain caption (+)\n');
    expect(plain.nodes[0]!.id).toBeUndefined();
    expect(plain.nodes[0]!.foldMark).toBe('collapsed');
    const session = parse('- Plain caption (+)\n', { sessionIds: true });
    expect(session.nodes[0]!.foldMark).toBeUndefined();
    expect(isCollapsed(session, session.nodes[0]!.id!)).toBe(true);
  });

  it('a line with a written id still keeps its fold in doc.fold', () => {
    const doc = parse('- Lamp room <id:4> (+)\n  - brass\n');
    expect(doc.nodes[0]!.foldMark).toBeUndefined();
    expect(doc.fold.ids).toEqual(['4']);
    expect(serialize(doc)).toBe('- Lamp room <id:4> (+)\n  - brass\n\n--- layout ---\nfold-: 4\ncollapsedMarker: "(+)"\n---\n');
  });

  it('a session-id unfold drops the marker and writes no id', () => {
    const doc = parse('- Plain caption (+)\n  - child\n', { sessionIds: true });
    const open = toggleFold(doc, doc.nodes[0]!.id!);
    expect(serialize(open)).toBe('- Plain caption\n  - child\n');
  });

  it('keeps a custom collapsed marker and the expanded marker', () => {
    const text = '- Shelf [more]\n  - tins\n- Pantry [less]\n  - jars\n\n--- layout ---\nfold-: \ncollapsedMarker: "[more]"\nexpandedMarker: "[less]"\n---\n';
    const doc = parse(text);
    expect(doc.nodes[0]!.foldMark).toBe('collapsed');
    expect(doc.nodes[1]!.foldMark).toBe('expanded');
    const out = serialize(doc);
    expect(out.split('\n').slice(0, 4).join('\n')).toBe('- Shelf [more]\n  - tins\n- Pantry [less]\n  - jars');
  });

  it('under fold+ an id-less (+) also round-trips', () => {
    const text = '- Harbour (+)\n  - boats\n\n--- layout ---\nfold+: \ncollapsedMarker: "(+)"\n---\n';
    const out = serialize(parse(text));
    expect(out.startsWith('- Harbour (+)\n  - boats\n')).toBe(true);
    expect(out).not.toContain('<id:');
  });

  it('assignPersistentId moves the inline fold into doc.fold', () => {
    const doc = parse('- Plain caption (+)\n  - child\n');
    const node = doc.nodes[0]!;
    const id = assignPersistentId(doc, node);
    expect(node.foldMark).toBeUndefined();
    expect(isCollapsed(doc, id)).toBe(true);
    expect(serialize(doc)).toContain(`- Plain caption <id:${id}> (+)`);
  });
});
