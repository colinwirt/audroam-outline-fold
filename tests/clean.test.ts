import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanIds, cleanMarkdown, parse } from '../src/index.js';
import type { OutlineNode } from '../src/types.js';

describe('cleanIds', () => {
  it('removes ids nothing points at and leaves the rest of the text alone', () => {
    const text = '- Top <id:1>\n  - Eat <id:2>\n  - [x] Fuel <id:3>\n- Food\n';
    expect(cleanIds(text)).toEqual({ text: '- Top\n  - Eat\n  - [x] Fuel\n- Food\n', removed: ['1', '2', '3'], kept: [] });
  });

  it('keeps ids a width, a payload or a #id: link points at', () => {
    const text = [
      '- Top <id:1>',
      '  - See [Fuel](#id:3) <id:2>',
      '  - Fuel <id:3>',
      '  - Wide <id:4>',
      '  - Secret <id:5>',
      '',
      '--- payloads ---',
      '5:',
      '  kid: k1',
      '  ct: QUJD',
      '---',
      '',
      '--- layout ---',
      'fold-: ',
      'collapsedMarker: "(+)"',
      '4:',
      '  w: 240',
      '---',
      '',
    ].join('\n');
    const out = cleanIds(text);
    expect(out.removed).toEqual(['1', '2']);
    expect(out.kept).toEqual(['3', '4', '5']);
    expect(out.text).toBe(text.replace('- Top <id:1>', '- Top').replace('(#id:3) <id:2>', '(#id:3)'));
  });

  it('a fold- entry on a line with (+) is redundant: id and entry go, the (+) stays', () => {
    const text = '- a <id:1> (+)\n  - b <id:2>\n- c <id:3>\n  - d <id:4>\n\n--- layout ---\nfold-: 1, 3\ncollapsedMarker: "(+)"\n---\n';
    const out = cleanIds(text);
    expect(out.text).toBe('- a (+)\n  - b\n- c <id:3>\n  - d\n\n--- layout ---\nfold-: 3\ncollapsedMarker: "(+)"\n---\n');
    expect(out.kept).toEqual(['3']);
    const both = cleanIds('- a <id:1> (+)\n  - b\n\n--- layout ---\nfold-: 1\ncollapsedMarker: "(+)"\n---\n');
    expect(both.text).toBe('- a (+)\n  - b\n');
    expect(parse(both.text).nodes[0]!.title).toBe('a');
  });

  it('keeps fold+ entries', () => {
    const text = '- a <id:1>\n  - b <id:2>\n\n--- layout ---\nfold+: 1\n---\n';
    expect(cleanIds(text).text).toBe('- a <id:1>\n  - b\n\n--- layout ---\nfold+: 1\n---\n');
  });

  it('sparse ids: only the referenced one stays', () => {
    const text = '- a\n  - b <id:2>\n  - c\n- d\n  - e <id:5>\n\n--- layout ---\nfold-: \n5:\n  w: 200\n---\n';
    const out = cleanIds(text);
    expect(out.removed).toEqual(['2']);
    expect(out.text).toBe(text.replace(' <id:2>', ''));
  });

  it('handles a leading id, CRLF and a note without ids', () => {
    expect(cleanIds('- <id:7> Title\r\n  - x <id:8>\r\n').text).toBe('- Title\r\n  - x\r\n');
    const plain = '- a\n  - b (+)\n';
    expect(cleanIds(plain)).toEqual({ text: plain, removed: [], kept: [] });
  });
});

const FIXTURES = join(__dirname, '..', 'examples', 'fixtures');
const fixtureFiles = readdirSync(FIXTURES).filter((f) => f.endsWith('.md') && f !== 'README.md');

function flat(nodes: OutlineNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    out.push(`${n.depth}|${n.task ?? ''}|${n.title}`);
    if (n.children) flat(n.children, out);
  }
  return out;
}

describe('cleanMarkdown', () => {
  it('strips every Audroam tag, marker and block', () => {
    const text = [
      '- [x] Top <t:41766> <kind:doc> <id:1> (+)',
      '  - Check-in <thread:pnid:9> <action:https://x.test/a> <private> <id:2>',
      '  - <id:3> Lead id and <t: 5> mid link',
      '  - Locked <enc:kid=k;ct=QUJD> <id:4>',
      '',
      '--- payloads ---',
      '4:',
      '  kid: k1',
      '  ct: QUJD',
      '---',
      '',
      '--- layout ---',
      'fold-: 1',
      'collapsedMarker: "(+)"',
      '---',
    ].join('\n');
    expect(cleanMarkdown(text)).toBe('- [x] Top\n  - Check-in\n  - Lead id and mid link\n  - Locked\n');
    expect(cleanMarkdown(text, { tasks: false })).toMatch(/^- Top\n/);
  });

  it('drops tags a translation moved into the middle of a caption', () => {
    expect(cleanMarkdown('- Car <id:4> burant\n')).toBe('- Car burant\n');
  });

  it('leaves no sealed payload material from cafe-map.md', () => {
    const text = readFileSync(join(__dirname, '..', 'examples', 'cafe-map.md'), 'utf8');
    const cts = [...text.matchAll(/^\s*ct:\s*(\S+)/gm)].map((m) => m[1]!);
    expect(cts.length).toBeGreaterThan(0);
    const clean = cleanMarkdown(text);
    for (const ct of cts) expect(clean).not.toContain(ct);
    expect(clean).not.toMatch(/kid:|--- payloads ---/);
  });

  for (const file of fixtureFiles) {
    it(`round-trips ${file}: same outline, nothing left to strip`, () => {
      const text = readFileSync(join(FIXTURES, file), 'utf8');
      const clean = cleanMarkdown(text);
      expect(clean).not.toMatch(/<id:|<t:\s*\d|<enc:|<action:|<thread:|--- (layout|payloads|sealed|enc) ---/);
      expect(clean).not.toMatch(/ \(\+\)$/m);
      expect(cleanMarkdown(clean)).toBe(clean);
      const strip = (s: string) => s.replace(/<(?:kind:)?[a-z-]+>/gi, '').replace(/[ \t]{2,}/g, ' ').trim();
      expect(flat(parse(clean).nodes).map(strip)).toEqual(flat(parse(text).nodes).map(strip));
    });
  }
});
