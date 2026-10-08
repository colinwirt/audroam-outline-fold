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
  stripLinkTags,
  toHtml,
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

  it('reads leading and mid-caption tags and leaves them where they were typed', () => {
    expect(first('- <r: plants> Row\n').links?.[0]).toMatchObject({ target: 'plants', source: '<r: plants>' });
    const mid = first('- See <r : plants> today\n');
    expect(mid.title).toBe('See <r : plants> today');
    expect(mid.links).toEqual([{ kind: 'jump', target: 'plants', form: 'tag', source: '<r : plants>' }]);
    same('- See <r : plants> today\n');
    same('- <r: plants> Row\n');
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

describe('tags typed mid-caption or at the start stay where they were typed', () => {
  it('ask <t:41> about rota: round-trips byte for byte, still a note link', () => {
    const body = '- ask <t:41> about rota\n';
    same(body);
    const n = first(body);
    expect(n.title).toBe('ask <t:41> about rota');
    expect(n.noteLinks).toEqual(['41']);
    expect(n.links).toEqual([{ kind: 'note', target: '41', form: 'tag', source: '<t:41>' }]);
    expect(displayCaption(n.title)).toBe('ask about rota');
  });

  it('keeps spaced spellings and the spaces around them', () => {
    for (const body of [
      '- ask < T : 41 > about rota\n',
      '- ask <t: 41>  about rota <id:a>\n',
      '- see <r : tom> first\n',
      '- <t : 41> ask about rota <id:a>\n',
      '- <r: tom>  <t:7> ask <id:a>\n',
      '- ask <t:41>about rota\n',
      '- ask <t:41>3\n',
    ]) {
      same(body);
    }
    expect(first('- see <r : tom> first\n').links).toEqual([
      { kind: 'jump', target: 'tom', form: 'tag', source: '<r : tom>' },
    ]);
  });

  it('mixes typed-in-place tags with the tag group, each written back where it was', () => {
    const body = '- [ ] <t:3> see <r : tom> before <t: 7> lunch <thread:pnid:9> <t:8> <r:x> <id:a>\n';
    same(body);
    const n = first(body);
    expect(n.task).toBe('open');
    expect(n.title).toBe('<t:3> see <r : tom> before <t: 7> lunch');
    expect(n.noteLinks).toEqual(['3', '7', '8']);
    expect(resolveJumps(n)).toEqual(['tom', 'x']);
  });

  it('a line in standard order still round-trips byte for byte', () => {
    for (const body of [
      '- Row <t:5> <id:a>\n',
      '- Row <t: 5> <r : b> <kind:doc> <id:a>\n',
      '- Row <thread:pnid:9> <r:b> <t:6> <id:a>\n',
    ]) {
      same(body);
    }
    expect(first('- Row <t:5> <id:a>\n').title).toBe('Row');
  });

  it('software-added tags go into the tag group', () => {
    const doc = parse('- ask <t:41> about rota <id:a>\n');
    doc.nodes[0]!.noteLinks!.push('42');
    doc.nodes[0]!.links!.push({ kind: 'jump', target: 'tom', form: 'tag', source: '<r:tom>' });
    expect(serialize(doc)).toBe('- ask <t:41> about rota <r:tom> <t:42> <id:a>\n');
  });

  it('taking N out of noteLinks drops its tag from where it was typed', () => {
    const doc = parse('- ask <t:41> about rota <id:a>\n- <t:5> first\n- last <t:6>3\n');
    for (const n of doc.nodes) n.noteLinks = [];
    expect(serialize(doc)).toBe('- ask about rota <id:a>\n- first\n- last 3\n');
  });

  it('a tag a host types into the caption is kept, never duplicated in the group', () => {
    const doc = parse('- Row <id:a>\n');
    doc.nodes[0]!.title = 'Row <t:5> now';
    expect(serialize(doc)).toBe('- Row <t:5> now <id:a>\n');
    doc.nodes[0]!.noteLinks = ['5'];
    expect(serialize(doc)).toBe('- Row <t:5> now <id:a>\n');
  });

  it('code spans stay text', () => {
    const body = '- ask `<t:41>` about <t:42> rota\n';
    same(body);
    expect(first(body).noteLinks).toEqual(['42']);
    expect(stripLinkTags('ask `<t:41>` about <t:42> rota')).toBe('ask `<t:41>` about rota');
  });

  it('the Outline shows the caption without the tags and draws the chips', () => {
    const html = toHtml(parse('- ask <t:41> about <r:b> rota <id:a>\n- B <id:b>\n'));
    expect(html).not.toMatch(/&lt;\s*[tr]\s*:/);
    expect(html).toContain('ask about rota');
    expect(html).toContain('#41');
    expect(html).toContain('data-hop-id="b"');
  });
});
