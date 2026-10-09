/**
 * 0.2.37: a leading list number (`1. `, `12. `) is caption text, never stripped.
 * Only one leading `-` / `*` / `+` bullet is line syntax. Fiction text only.
 */
import { describe, expect, it } from 'vitest';
import {
  captionToHtml,
  displayCaption,
  parse,
  serialize,
  toggleFold,
  toggleTask,
  toHtml,
  validateDocument,
} from '../src/index.js';

const one = (line: string) => parse(`${line}\n`).nodes[0]!;

describe('parse keeps a leading number in the caption', () => {
  const cases: [string, string][] = [
    ['- 1. Water the ferns', '1. Water the ferns'],
    ['1. Water the ferns', '1. Water the ferns'],
    ['- 12. Sweep the porch', '12. Sweep the porch'],
    ['12. Sweep the porch', '12. Sweep the porch'],
    ['* 3. Feed the cat', '3. Feed the cat'],
    ['+ 4. Lock the shed', '4. Lock the shed'],
    ['- 1.5 kg of flour', '1.5 kg of flour'],
    ['- 2026. A year to plan', '2026. A year to plan'],
  ];
  for (const [line, title] of cases) {
    it(`"${line}" → "${title}"`, () => {
      expect(one(line).title).toBe(title);
    });
  }

  it('strips only one bullet', () => {
    expect(one('- - 1. Nested dash').title).toBe('- 1. Nested dash');
  });

  it('a line that is only a number is a caption, not an empty line', () => {
    const doc = parse('- 1. \n- 2. Second\n');
    expect(doc.nodes.map((n) => n.title)).toEqual(['1.', '2. Second']);
  });

  it('keeps nesting with numbered children', () => {
    const doc = parse('- Morning list <id:am>\n  - 1. Stretch\n  - 2. Tea\n    - 2.1 Kettle on\n');
    const am = doc.nodes[0]!;
    expect(am.children!.map((n) => n.title)).toEqual(['1. Stretch', '2. Tea']);
    expect(am.children![1]!.children![0]!.title).toBe('2.1 Kettle on');
  });

  it('tags around a numbered caption are still read', () => {
    const n = one('- 1. Check the boiler <t:42> <kind:doc> <id:boiler> (+)');
    expect(n.title).toBe('1. Check the boiler');
    expect(n.id).toBe('boiler');
    expect(n.kind).toBe('doc');
    expect(n.noteLinks).toEqual(['42']);
  });
});

describe('task markers stay leading-only', () => {
  it('- [ ] 1. x is a task whose caption keeps the number', () => {
    const n = one('- [ ] 1. Pack the tent');
    expect(n.task).toBe('open');
    expect(n.title).toBe('1. Pack the tent');
  });

  it('- [x] 2. x is a done task', () => {
    const n = one('- [x] 2. Pack the tent');
    expect(n.task).toBe('done');
    expect(n.title).toBe('2. Pack the tent');
  });

  it('- 1. [ ] x is plain text, not a task', () => {
    const n = one('- 1. [ ] Pack the tent');
    expect(n.task).toBeUndefined();
    expect(n.title).toBe('1. [ ] Pack the tent');
  });

  it('1. [ ] x without a dash is plain text too', () => {
    const n = one('1. [ ] Pack the tent');
    expect(n.task).toBeUndefined();
    expect(n.title).toBe('1. [ ] Pack the tent');
  });

  it('displayCaption keeps the number after a task box', () => {
    expect(displayCaption('[ ] 1. Pack the tent')).toBe('1. Pack the tent');
    expect(displayCaption('1. [ ] Pack the tent')).toBe('1. [ ] Pack the tent');
  });
});

describe('serialize round trip', () => {
  it('writes "- 1. Check the oven" and re-parses to the same caption', () => {
    const doc = parse('1. Check the oven\n');
    const out = serialize(doc);
    expect(out).toBe('- 1. Check the oven\n');
    expect(parse(out).nodes[0]!.title).toBe('1. Check the oven');
  });

  it('dash lines round-trip byte for byte', () => {
    const body = [
      '- Garden jobs <id:garden>',
      '  - 1. Rake leaves <id:rake>',
      '  - [ ] 2. Prune roses <id:roses>',
      '  - 10. Oil the gate <t:7>',
      '  - 3. [ ] Not a task',
      '',
    ].join('\n');
    const out = serialize(parse(body));
    expect(out).toBe(body);
    expect(serialize(parse(out))).toBe(body);
  });

  it('fold and task toggles keep the number', () => {
    let doc = parse('- 1. Rake leaves <id:rake>\n  - [ ] 2. Bag them <id:bag>\n');
    doc = toggleFold(doc, 'rake');
    doc = toggleTask(doc, 'bag')!.doc;
    const out = serialize(doc);
    expect(out).toContain('- 1. Rake leaves <id:rake> (+)');
    expect(out).toContain('- [-] 2. Bag them <id:bag>'); // open → pending
    const again = parse(out);
    expect(again.nodes[0]!.title).toBe('1. Rake leaves');
    expect(again.nodes[0]!.children![0]!.title).toBe('2. Bag them');
  });
});

describe('editing a caption never drops the number', () => {
  it('edit → serialize → parse keeps the new number', () => {
    const doc = parse('- 1. Rake leaves <id:rake>\n');
    doc.nodes[0]!.title = '7. Rake the front lawn';
    const out = serialize(doc);
    expect(out).toBe('- 7. Rake the front lawn <id:rake>\n');
    expect(parse(out).nodes[0]!.title).toBe('7. Rake the front lawn');
  });

  it('an edit that adds a number keeps it', () => {
    const doc = parse('- Rake leaves <id:rake>\n');
    doc.nodes[0]!.title = '1. Rake leaves';
    expect(parse(serialize(doc)).nodes[0]!.title).toBe('1. Rake leaves');
  });
});

describe('validateDocument and render', () => {
  const body = '- Garden jobs <id:garden>\n  - 1. Rake leaves <id:rake>\n  - 12. Oil the gate\n';

  it('validateDocument is ok and keeps the captions', () => {
    const r = validateDocument(body);
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(r.doc!.nodes[0]!.children!.map((n) => n.title)).toEqual(['1. Rake leaves', '12. Oil the gate']);
  });

  it('captionToHtml keeps "1. " as text (no <ol>/<li>)', () => {
    const html = captionToHtml('1. Rake leaves');
    expect(html).toContain('1. Rake leaves');
    expect(html).not.toMatch(/<ol|<li/i);
  });

  it('toHtml shows the number in the outline', () => {
    const html = toHtml(parse(body));
    expect(html).toContain('1. Rake leaves');
    expect(html).toContain('12. Oil the gate');
    expect(html).not.toMatch(/<ol/i);
  });
});
