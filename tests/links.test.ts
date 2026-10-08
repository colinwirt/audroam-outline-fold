/**
 * Links in the core parser (0.2.34): `<t:N>` and `[label](#pnid:N)` are note links,
 * `<r:x>` and `[label](#id:x)` are jumps to a node in this map. Every form keeps its
 * spelling through serialize; the parser never writes an id.
 */
import { describe, expect, it } from 'vitest';
import {
  cleanIds,
  displayCaption,
  displayTags,
  parse,
  parseHopTarget,
  parseNoteTarget,
  resolveJumps,
  serialize,
  toggleFold,
} from '../src/index.js';

const first = (body: string) => parse(body).nodes[0]!;
const same = (body: string) => expect(serialize(parse(body))).toBe(body);

describe('<r:x> jump tag', () => {
  const spellings = ['<r:plants>', '<r : plants>', '<r: plants>', '<r :plants>', '< r:plants >', '<R:plants>'];
  for (const tag of spellings) {
    it(`${tag} reads as a jump to plants and round-trips byte for byte`, () => {
      const body = `- See the list ${tag} <id:a>\n- Plant list <id:plants>\n`;
      const n = first(body);
      expect(n.title).toBe('See the list');
      expect(n.links).toEqual([{ kind: 'jump', target: 'plants', form: 'tag', source: tag }]);
      expect(n.noteLinks).toBeUndefined();
      same(body);
      // A fold keeps it too.
      expect(serialize(toggleFold(parse(body), 'a'))).toContain(`See the list ${tag} <id:a>`);
    });
  }

  it('reads leading and mid-caption; serialize writes it with the other tags', () => {
    expect(first('- <r: plants> Row\n').links?.[0]).toMatchObject({ target: 'plants', source: '<r: plants>' });
    const mid = first('- See <r : plants> today\n');
    expect(mid.title).toBe('See today');
    expect(serialize(parse('- See <r : plants> today\n'))).toBe('- See today <r : plants>\n');
  });

  it('uses the <id:> characters: anything else stays caption text', () => {
    for (const body of ['- Row <r:_x>\n', '- Row <r:a.b>\n', '- Row <r:a:b>\n', '- Row <r:>\n']) {
      expect(first(body).links).toBeUndefined();
      same(body);
    }
    expect(first('- Code `<r:plants>` stays\n').links).toBeUndefined();
    same('- Code `<r:plants>` stays\n');
  });

  it('keeps <t:N> and <r:x> in source order, each with its spelling', () => {
    const body = '- Row <r:b> <t: 5> <r : c> <t:6> <id:a>\n';
    expect(first(body).links).toEqual([
      { kind: 'jump', target: 'b', form: 'tag', source: '<r:b>' },
      { kind: 'note', target: '5', form: 'tag', source: '<t: 5>' },
      { kind: 'jump', target: 'c', form: 'tag', source: '<r : c>' },
      { kind: 'note', target: '6', form: 'tag', source: '<t:6>' },
    ]);
    expect(first(body).noteLinks).toEqual(['5', '6']);
    same(body);
  });

  it('a jump the host adds is written <r:x>; a changed target drops the old spelling', () => {
    const doc = parse('- Row <id:a>\n- Plants <id:plants>\n');
    doc.nodes[0]!.links = [{ kind: 'jump', target: 'plants', form: 'tag' }];
    expect(serialize(doc)).toBe('- Row <r:plants> <id:a>\n- Plants <id:plants>\n');
    const spaced = parse('- Row <r : plants> <id:a>\n');
    spaced.nodes[0]!.links![0]!.target = 'tom';
    expect(serialize(spaced)).toBe('- Row <r:tom> <id:a>\n');
  });

  it('noteLinks stays the <t:N> list: a number taken out drops its tag', () => {
    const doc = parse('- Row <t:5> <r:b> <t: 6>\n');
    doc.nodes[0]!.noteLinks = ['6'];
    expect(serialize(doc)).toBe('- Row <r:b> <t: 6>\n');
    doc.nodes[0]!.noteLinks.push('7');
    expect(serialize(doc)).toBe('- Row <r:b> <t: 6> <t:7>\n');
  });

  it('display helpers drop or clean it', () => {
    expect(displayCaption('Go < r : plants > now')).toBe('Go now');
    expect(displayTags('Go < r : plants >')).toBe('Go <r:plants>');
    expect(resolveJumps({ title: 'a <r:x> b <r : y>', depth: 0 })).toEqual(['x', 'y']);
    expect(resolveJumps(first('- a <r:x> <r:x> <t:1>\n'))).toEqual(['x']);
  });
});

describe('markdown links', () => {
  it('[label](#id:x) is a jump and [label](#pnid:N) a note link; both stay in the caption', () => {
    const body = '- Tasks · [Plants](#id:plants) · [Seed swap](#pnid:1004) <t:7> <id:a>\n';
    const n = first(body);
    expect(n.title).toBe('Tasks · [Plants](#id:plants) · [Seed swap](#pnid:1004)');
    expect(n.links).toEqual([
      { kind: 'note', target: '7', form: 'tag', source: '<t:7>' },
      { kind: 'jump', target: 'plants', form: 'markdown', source: '[Plants](#id:plants)', label: 'Plants' },
      { kind: 'note', target: '1004', form: 'markdown', source: '[Seed swap](#pnid:1004)', label: 'Seed swap' },
    ]);
    expect(n.noteLinks).toEqual(['7']);
    same(body);
  });

  it('#pnid: is digits only; anything else is not a link', () => {
    expect(parseNoteTarget('#pnid:1004')).toBe('1004');
    expect(parseNoteTarget('#pnid:x1')).toBeNull();
    expect(first('- [A](#pnid:abc)\n').links).toBeUndefined();
    same('- [A](#pnid:abc)\n');
  });

  it('#id: uses the <id:> characters (0.2.34)', () => {
    expect(parseHopTarget('#id:plants')).toBe('plants');
    expect(parseHopTarget('#id:a5-1_b')).toBe('a5-1_b');
    for (const bad of ['#id:a.b', '#id:a:b', '#id:_a', '#id:-a', '#id:']) expect(parseHopTarget(bad)).toBeNull();
    expect(first('- [A](#id:a.b)\n').links).toBeUndefined();
  });

  it('links inside code are not read', () => {
    expect(first('- `[A](#id:x)` and `[B](#pnid:4)`\n').links).toBeUndefined();
  });
});

describe('ids: lazy, never written by the parser', () => {
  it('a jump does not give its target (or itself) an id', () => {
    same('- Row <r:b>\n- Other\n');
    same('- [Go](#id:b)\n- Other\n');
  });

  it('a jump to an id not in the map is kept as written (unresolved, not dropped)', () => {
    const body = '- Row [Old](#id:gone2) <r:gone> <id:a>\n';
    expect(first(body).links?.map((l) => l.target)).toEqual(['gone', 'gone2']);
    same(body);
  });

  it('session ids never take a jump target', () => {
    const doc = parse('- A <r:2>\n- B\n- C [x](#id:3)\n', { sessionIds: true });
    const ids = doc.nodes.map((n) => n.id);
    expect(ids).not.toContain('2');
    expect(ids).not.toContain('3');
    expect(serialize(doc)).toBe('- A <r:2>\n- B\n- C [x](#id:3)\n');
  });

  it('linking to a session-id node makes serialize write its id', () => {
    const doc = parse('- A\n- B\n', { sessionIds: true });
    const b = doc.nodes[1]!;
    doc.nodes[0]!.links = [{ kind: 'jump', target: b.id!, form: 'tag' }];
    expect(serialize(doc)).toBe(`- A <r:${b.id}>\n- B <id:${b.id}>\n`);
  });

  it('cleanIds keeps an id a <r:> jump names', () => {
    expect(cleanIds('- Top <id:1>\n  - See <r : 2>\n  - Leaf <id:2>\n')).toEqual({
      text: '- Top\n  - See <r : 2>\n  - Leaf <id:2>\n',
      removed: ['1'],
      kept: ['2'],
    });
  });
});
