/**
 * Tags are strict (0.2.32): no space around the colon or just inside the brackets.
 * A spaced `<id : x>`, `<kind: doc>`, `<action:x >` … is caption text and round-trips
 * byte for byte. `<t:` is the one exception: the legacy `<t: N>` still reads (whitespace
 * after the colon only) and keeps its spelling; a new link is written `<t:N>`.
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

const SPACED = [
  '<id : craft-lab>',
  '<id: craft-lab>',
  '<id :craft-lab>',
  '<id:craft-lab >',
  '< id:craft-lab>',
  '<kind : doc>',
  '<kind: doc>',
  '<kind:doc >',
  '<action: https://example.com/go>',
  '<action:https://example.com/go >',
  '<action : event:start>',
  '<thread: pnid:41609>',
  '<thread:pnid:41609 >',
  '<enc: kid=k1;alg=demo;ct=abc>',
  '<enc:kid=k1;alg=demo;ct=abc >',
  '<db: orders>',
  '<db :orders>',
  '<t:41609 >',
  '< t:41609>',
];

describe('strict tags: a spaced form is caption text', () => {
  for (const tag of SPACED) {
    it(`${tag} stays in the caption and round-trips unchanged`, () => {
      for (const body of [`- Row ${tag} <id:a>\n`, `- ${tag} Row <id:a>\n`, `- Row ${tag} more <id:a>\n`]) {
        const node = parse(body).nodes[0];
        expect(node.title).toContain(tag);
        expect(node.id).toBe('a');
        expect(node.kind).toBeUndefined();
        expect(node.action).toBeUndefined();
        expect(node.thread).toBeUndefined();
        expect(node.sealed).toBeUndefined();
        expect(node.dbRef).toBeUndefined();
        expect(node.noteLinks).toBeUndefined();
        expect(serialize(parse(body))).toBe(body);
      }
    });
  }

  it('a spaced id is not an id: the line keeps its real id, and a lone spaced id leaves none', () => {
    expect(parse('- Row <id : x>\n').nodes[0].id).toBeUndefined();
    expect(serialize(parse('- Row <id : x>\n'))).toBe('- Row <id : x>\n');
  });

  it('fold and task tick leave spaced tags alone', () => {
    const body = '- [ ] Top <kind: doc> <id:1>\n  - Child <id : x> <id:2>\n';
    const folded = toggleFold(parse(body), '1');
    expect(serialize(folded)).toContain('Top <kind: doc>');
    expect(serialize(folded)).toContain('Child <id : x> <id:2>');
    const ticked = toggleTask(parse(body), '1');
    const box = ticked!.to === 'done' ? '[x]' : ticked!.to === 'pending' ? '[-]' : '[ ]';
    expect(serialize(ticked!.doc)).toBe(body.replace('[ ]', box));
  });

  it('strict forms still read', () => {
    const node = parse('- Row <action:https://a.example/x y> <thread:pnid:7> <db:orders> <kind:doc> <id:a>\n').nodes[0];
    expect(node.action).toBe('https://a.example/x y');
    expect(node.thread).toBe('pnid:7');
    expect(node.dbRef).toBe('orders');
    expect(node.kind).toBe('doc');
    expect(node.title).toBe('Row');
  });

  it('taskChrome helpers are strict too', () => {
    expect(parseActionTag('Go <action:https://a.example>')).toBe('https://a.example');
    expect(parseActionTag('Go <action: https://a.example>')).toBeNull();
    expect(parseThreadTag('Go <thread:pnid:7 >')).toBeNull();
    expect(displayCaption('Go <action: x> <t: 5>')).toBe('Go <action: x>');
  });
});

describe('<t:N> with the legacy <t: N> exception', () => {
  it('reads <t: N> and whitespace after the colon, keeping the spelling', () => {
    for (const tag of ['<t: 41609>', '<t:  41609>', '<T: 41609>', '<t:41609>']) {
      const body = `- Row ${tag} <id:a>\n`;
      expect(parse(body).nodes[0].noteLinks).toEqual(['41609']);
      expect(serialize(parse(body))).toBe(body);
    }
  });

  it('writes a new link as <t:N>', () => {
    const doc = parse('- Row <id:a>\n');
    doc.nodes[0].noteLinks = ['41609'];
    expect(serialize(doc)).toBe('- Row <t:41609> <id:a>\n');
  });

  it('resolveNoteLinks reads both spellings, not a space before the >', () => {
    expect(resolveNoteLinks({ title: 'a <t: 1> b <t:2> c <t:3 >', depth: 0 })).toEqual(['1', '2']);
  });
});

describe('clean ids and Copy clean with spaced tags', () => {
  it('cleanIds only removes strict <id:N>; a spaced id is text and stays', () => {
    const text = '- Top <id : x> <id:1>\n  - Leaf <id: y>\n  - Other <id:y >\n';
    expect(cleanIds(text)).toEqual({
      text: '- Top <id : x>\n  - Leaf <id: y>\n  - Other <id:y >\n',
      removed: ['1'],
      kept: [],
    });
  });

  it('cleanMarkdown strips strict tags and <t: N>, keeps spaced non-t tags as text', () => {
    const text = '- Row <t: 5> <kind: doc> <id : x> <action:https://a.example> <id:1>\n';
    expect(cleanMarkdown(text)).toBe('- Row <kind: doc> <id : x>\n');
  });
});
