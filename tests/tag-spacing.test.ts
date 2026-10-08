/**
 * Tag spacing (0.2.32): readers accept optional whitespace around the colon and just
 * inside the brackets (`<id : craft-lab>`, `<t: 41609 >`). Writers emit `<name:value>`
 * (`<t:N>` for a new note link), and a spaced tag keeps its spelling through serialize,
 * fold and task tick while it still names the same value. Bare words stay exact.
 */
import { describe, expect, it } from 'vitest';
import {
  cleanIds,
  cleanMarkdown,
  displayCaption,
  parse,
  parseActionTag,
  parseThreadTag,
  resolveNoteLinks,
  serialize,
  toggleFold,
  toggleTask,
} from '../src/index.js';

const first = (body: string) => parse(body).nodes[0]!;

describe('spaced tags are recognised', () => {
  const ids = ['<id : craft-lab>', '<id: craft-lab>', '<id :craft-lab>', '<id:craft-lab >', '< id:craft-lab>', '< id : craft-lab >'];
  for (const tag of ids) {
    it(`${tag} is the id, trailing or leading, and round-trips unchanged`, () => {
      expect(first(`- Row ${tag}\n`).id).toBe('craft-lab');
      expect(first(`- Row ${tag}\n`).title).toBe('Row');
      expect(serialize(parse(`- Row ${tag}\n`))).toBe(`- Row ${tag}\n`);
      expect(first(`- ${tag} Row\n`).id).toBe('craft-lab');
    });
  }

  const others: [string, (n: ReturnType<typeof first>) => unknown, unknown][] = [
    ['<kind : doc>', (n) => n.kind, 'doc'],
    ['<kind:doc >', (n) => n.kind, 'doc'],
    ['<action: https://example.com/go >', (n) => n.action, 'https://example.com/go'],
    ['< action : event:start work >', (n) => n.action, 'event:start work'],
    ['<thread : pnid:41609>', (n) => n.thread, 'pnid:41609'],
    ['<db : orders >', (n) => n.dbRef, 'orders'],
    ['<t: 41609 >', (n) => n.noteLinks, ['41609']],
    ['< t : 41609 >', (n) => n.noteLinks, ['41609']],
    ['<T:41609>', (n) => n.noteLinks, ['41609']],
  ];
  for (const [tag, get, want] of others) {
    it(`${tag} reads and round-trips unchanged`, () => {
      const body = `- Row ${tag} <id:a>\n`;
      expect(get(first(body))).toEqual(want);
      expect(first(body).title).toBe('Row');
      expect(serialize(parse(body))).toBe(body);
    });
  }

  it('an inline spaced <enc : …> seals the row like the plain form', () => {
    const plain = first('- Secret <enc:kid=k1;alg=demo;ct=abc> <id:a>\n');
    const spaced = first('- Secret < enc : kid=k1;alg=demo;ct=abc > <id:a>\n');
    expect(spaced.sealed).toEqual(plain.sealed);
    expect(spaced.title).toBe('Secret');
  });

  it('bare words stay exact: < doc > and < private > are caption text', () => {
    expect(first('- Row < doc > <id:a>\n').kind).toBeUndefined();
    expect(first('- Row < private > <id:a>\n').flags).toBeUndefined();
    expect(serialize(parse('- Row < doc > <id:a>\n'))).toBe('- Row < doc > <id:a>\n');
  });
});

describe('writers emit no spaces; edits keep a spelling', () => {
  it('a new note link is <t:N>; a host-set id is <id:x>', () => {
    const doc = parse('- Row\n');
    doc.nodes[0]!.noteLinks = ['41609'];
    doc.nodes[0]!.id = 'craft-lab';
    expect(serialize(doc)).toBe('- Row <t:41609> <id:craft-lab>\n');
  });

  it('a kept spelling is dropped once the value changes', () => {
    const doc = parse('- Row <kind : doc> <id : a>\n');
    doc.nodes[0]!.id = 'b';
    doc.nodes[0]!.kind = 'bug';
    expect(serialize(doc)).toBe('- Row <kind:bug> <id:b>\n');
  });

  it('fold and task tick keep spaced tags as written', () => {
    const body = '- [ ] Top <t: 5 > <kind : doc> <id : 1>\n  - Child <id: 2>\n';
    const folded = serialize(toggleFold(parse(body), '1'));
    expect(folded).toContain('Top <t: 5 > <kind : doc> <id : 1>');
    expect(folded).toContain('Child <id: 2>');
    const ticked = toggleTask(parse(body), '1')!;
    const box = ticked.to === 'done' ? '[x]' : ticked.to === 'pending' ? '[-]' : '[ ]';
    expect(serialize(ticked.doc)).toBe(body.replace('[ ]', box));
  });

  it('taskChrome helpers read spaced tags', () => {
    expect(parseActionTag('Go <action : https://a.example >')).toBe('https://a.example');
    expect(parseThreadTag('Go < thread: pnid:7 >')).toBe('pnid:7');
    expect(displayCaption('Go <action: x> < t : 5 >')).toBe('Go');
    expect(resolveNoteLinks({ title: 'a <t: 1> b <t:2> c < t : 3 >', depth: 0 })).toEqual(['1', '2', '3']);
  });
});

describe('clean ids and Copy clean handle spaced tags', () => {
  it('cleanIds removes an unused spaced id and keeps a referenced one as written', () => {
    const text = '- Top <id : 1>\n  - See [x](#id:2)\n  - Leaf < id: 2 >\n  - Other <id:3 >\n';
    expect(cleanIds(text)).toEqual({
      text: '- Top\n  - See [x](#id:2)\n  - Leaf < id: 2 >\n  - Other\n',
      removed: ['1', '3'],
      kept: ['2'],
    });
  });

  it('cleanMarkdown strips spaced tags too', () => {
    const text = '- Row < t : 5 > <kind : doc> <action: https://a.example > <id : x>\n  - Child < db : orders > <private>\n';
    expect(cleanMarkdown(text)).toBe('- Row\n  - Child\n');
  });
});
