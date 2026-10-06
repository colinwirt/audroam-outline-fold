import { describe, expect, it } from 'vitest';
import {
  assignPersistentId,
  parse,
  serialize,
  setExpandLevel,
  toggleFold,
} from '../src/index.js';
import type { OutlineFoldDoc, OutlineNode } from '../src/types.js';

const NOTE = [
  '- 2026 09 02 - Top',
  '  - Check-in: 09 11',
  '  - Recharge',
  '  - Work (+)',
  '    - [x] Invoice',
  '- Food',
  '  - buy',
  '    - [x] broccoli',
  '',
].join('\n');

const SPARSE = '- a\n  - b <id:2>\n  - c\n- d\n  - e <id:5>\n  - f\n';

function byTitle(doc: OutlineFoldDoc, title: string): OutlineNode {
  let hit: OutlineNode | null = null;
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      if (n.title === title) hit = n;
      if (n.children) walk(n.children);
    }
  };
  walk(doc.nodes);
  if (!hit) throw new Error(title);
  return hit;
}

const load = (text: string) => parse(text, { sessionIds: true });

describe('parse sessionIds', () => {
  it('gives id-less lines session ids in document order and round-trips byte for byte', () => {
    const doc = load(NOTE);
    expect(byTitle(doc, 'Food').id).toBe('6');
    expect(byTitle(doc, 'Food').autoId).toBe(true);
    expect(serialize(doc)).toBe(NOTE);
  });

  it('folds a (+) line that has no id', () => {
    const doc = load(NOTE);
    expect(doc.fold.ids).toEqual([byTitle(doc, 'Work').id]);
  });

  it('leaves parse without the option as before', () => {
    const doc = parse(NOTE);
    expect(byTitle(doc, 'Food').id).toBeUndefined();
    expect(doc.fold.ids).toEqual([]);
  });

  it('fold and unfold change only the (+) marker', () => {
    const doc = load(NOTE);
    const folded = serialize(toggleFold(doc, byTitle(doc, 'Food').id!));
    expect(folded).toBe(NOTE.replace('\n- Food\n', '\n- Food (+)\n'));
    const again = load(folded);
    expect(serialize(toggleFold(again, byTitle(again, 'Food').id!))).toBe(NOTE);
    expect(serialize(toggleFold(doc, byTitle(doc, 'Work').id!))).toBe(NOTE.replace('  - Work (+)', '  - Work'));
    expect(serialize(setExpandLevel(doc, 1))).not.toMatch(/<id:|--- layout ---/);
  });

  it('a width writes one id (its session id) and one layout entry', () => {
    const doc = load(NOTE);
    const node = byTitle(doc, 'Recharge');
    expect(assignPersistentId(doc, node)).toBe('3');
    node.layout = { w: 240 };
    const text = serialize(doc);
    expect(text.match(/<id:\d+>/g)).toEqual(['<id:3>']);
    expect(text).toContain('  - Recharge <id:3>\n');
    expect(text).toMatch(/--- layout ---\nfold-: [\d, ]*\ncollapsedMarker: "\(\+\)"\n3:\n {2}w: 240\n---\n$/);
    expect(node.autoId).toBeUndefined();
    expect(byTitle(parse(text), 'Recharge').layout).toEqual({ w: 240 });
  });

  it('a width set without assignPersistentId still gets its id on serialize', () => {
    const doc = load(NOTE);
    byTitle(doc, 'buy').layout = { w: 180 };
    const text = serialize(doc);
    expect(text.match(/<id:\d+>/g)).toEqual(['<id:7>']);
    expect(text).toContain('\n7:\n  w: 180\n');
  });

  it('a payload writes one id', () => {
    const doc = load(NOTE);
    byTitle(doc, 'Invoice').sealed = { kid: 'k1', ciphertext: 'QUJD' };
    const text = serialize(doc);
    expect(text.match(/<id:\d+>/g)).toEqual(['<id:5>']);
    expect(text).toMatch(/--- payloads ---\n5:\n/);
  });

  it('sparse ids: session ids skip 2 and 5, never collide, and the written id is one of them', () => {
    const doc = load(SPARSE);
    expect(['a', 'b', 'c', 'd', 'e', 'f'].map((t) => byTitle(doc, t).id)).toEqual(['6', '2', '7', '8', '5', '9']);
    expect(serialize(doc)).toBe(SPARSE);
    const folded = serialize(toggleFold(doc, '8'));
    expect(folded).toBe(SPARSE.replace('- d\n', '- d (+)\n'));
    const node = byTitle(doc, 'c');
    expect(assignPersistentId(doc, node)).toBe('7');
    node.layout = { w: 200 };
    expect(serialize(doc).match(/<id:\d+>/g)).toEqual(['<id:2>', '<id:7>', '<id:5>']);
  });

  it('skips ids keyed in the payloads and layout blocks', () => {
    const text = '- a\n- b <id:3>\n\n--- layout ---\nfold-: \n9:\n  w: 120\n---\n';
    const doc = load(text);
    expect(byTitle(doc, 'a').id).toBe('10');
  });

  it('a real fold- id stays listed; a session id stays off the list', () => {
    const doc = load('- a <id:3>\n  - b\n- c\n  - d\n');
    const both = toggleFold(toggleFold(doc, '3'), byTitle(doc, 'c').id!);
    const text = serialize(both);
    expect(text).toMatch(/^- a <id:3> \(\+\)\n {2}- b\n- c \(\+\)\n {2}- d\n/);
    expect(text).toContain('fold-: 3\n');
  });

  it('fold+ writes the id of an expanded line: that entry is a persistent link', () => {
    const doc = load('- a\n  - b\n- c\n  - d\n\n--- layout ---\nfold+: \n---\n');
    const text = serialize(toggleFold(doc, byTitle(doc, 'c').id!));
    expect(text).toMatch(/^- a \(\+\)\n {2}- b\n- c <id:3>\n {2}- d\n/);
    expect(text).toContain('fold+: 3\n');
  });
});
