import { describe, expect, it } from 'vitest';
import {
  assignPersistentId,
  createSessionIndex,
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

describe('session keys', () => {
  it('gives every line a session key in document order and does not write it', () => {
    const doc = parse(NOTE);
    expect(byTitle(doc, 'Food').sessionKey).toBe('__sid-6');
    expect(byTitle(doc, 'Food').writtenId).toBeNull();
    expect(serialize(doc)).toBe(NOTE);
  });

  it('folds a (+) line that has no written id', () => {
    const doc = parse(NOTE);
    const work = byTitle(doc, 'Work');
    expect(work.collapsed).toBe(true);
    expect(work.writtenId).toBeNull();
  });

  it('assigns session keys when the old sessionIds option is omitted', () => {
    const doc = parse(NOTE);
    expect(byTitle(doc, 'Food').sessionKey).toBe('__sid-6');
    expect(byTitle(doc, 'Work').collapsed).toBe(true);
    expect(byTitle(doc, 'Food').collapsed).toBe(false);
  });

  it('fold and unfold change only the (+) marker', () => {
    const doc = parse(NOTE);
    const food = byTitle(doc, 'Food');
    const folded = serialize(toggleFold(doc, food.sessionKey));
    expect(folded).toBe(NOTE.replace('\n- Food\n', '\n- Food (+)\n'));
    const again = parse(folded);
    expect(serialize(toggleFold(again, byTitle(again, 'Food').sessionKey))).toBe(NOTE);
    expect(serialize(toggleFold(doc, byTitle(doc, 'Work').sessionKey))).toBe(NOTE.replace('  - Work (+)', '  - Work'));
    expect(serialize(setExpandLevel(doc, 1))).not.toMatch(/<id:|--- layout ---/);
  });

  it('a width writes one written id and one layout entry, and leaves the session key', () => {
    const doc = parse(NOTE);
    const node = byTitle(doc, 'Recharge');
    const key = node.sessionKey;
    expect(assignPersistentId(doc, node)).toBe('3');
    expect(node.sessionKey).toBe(key);
    node.layout = { w: 240 };
    const text = serialize(doc);
    expect(text.match(/<id:\d+>/g)).toEqual(['<id:3>']);
    expect(text).toContain('  - Recharge <id:3>\n');
    expect(text).toMatch(/--- layout ---\n3:\n {2}w: 240\n---\n$/);
    expect(text).not.toContain(key);
    expect(byTitle(parse(text), 'Recharge').layout).toEqual({ w: 240 });
  });

  it('a width set without assignPersistentId still gets its written id on serialize', () => {
    const doc = parse(NOTE);
    byTitle(doc, 'buy').layout = { w: 180 };
    const text = serialize(doc);
    expect(text.match(/<id:\d+>/g)).toEqual(['<id:7>']);
    expect(text).toContain('\n7:\n  w: 180\n');
  });

  it('a payload writes one written id', () => {
    const doc = parse(NOTE);
    byTitle(doc, 'Invoice').sealed = { kid: 'k1', ciphertext: 'QUJD' };
    const text = serialize(doc);
    expect(text.match(/<id:\d+>/g)).toEqual(['<id:5>']);
    expect(text).toMatch(/--- payloads ---\n5:\n/);
  });

  it('session keys stay on their own series beside written ids', () => {
    const doc = parse(SPARSE);
    expect(['a', 'b', 'c', 'd', 'e', 'f'].map((t) => byTitle(doc, t).sessionKey)).toEqual([
      '__sid-1', '__sid-2', '__sid-3', '__sid-4', '__sid-5', '__sid-6',
    ]);
    expect(byTitle(doc, 'b').writtenId).toBe('2');
    expect(byTitle(doc, 'e').writtenId).toBe('5');
    expect(byTitle(doc, 'a').writtenId).toBeNull();
    expect(serialize(doc)).toBe(SPARSE);
    const folded = serialize(toggleFold(doc, byTitle(doc, 'd').sessionKey));
    expect(folded).toBe(SPARSE.replace('- d\n', '- d (+)\n'));
    const node = byTitle(doc, 'c');
    expect(assignPersistentId(doc, node)).toBe('3');
    node.layout = { w: 200 };
    expect(serialize(doc).match(/<id:\d+>/g)).toEqual(['<id:2>', '<id:3>', '<id:5>']);
  });

  it('does not treat a layout key as a written id', () => {
    const text = '- a\n- b <id:3>\n\n--- layout ---\n9:\n  w: 120\n---\n';
    const doc = parse(text);
    expect(byTitle(doc, 'a').writtenId).toBeNull();
    expect(byTitle(doc, 'a').sessionKey).toBe('__sid-1');
    expect(byTitle(doc, 'b').writtenId).toBe('3');
  });

  it('the session index uses the session key as the view key', () => {
    const doc = parse(SPARSE);
    const idx = createSessionIndex();
    idx.sync(doc);
    const c = byTitle(doc, 'c');
    expect(c.writtenId).toBeNull();
    expect(idx.keyOf(c)).toBe(c.sessionKey);
  });

  it('a reparse keeps the session key and does not write it', () => {
    const idx = createSessionIndex();
    const first = parse('- a\n  - b\n');
    idx.sync(first);
    const key = idx.keyOf(first.nodes[0]!);
    expect(key).toBe(first.nodes[0]!.sessionKey);
    expect(first.nodes[0]!.writtenId).toBeNull();
    const second = parse('- a\n  - b\n');
    idx.sync(second);
    expect(idx.keyOf(second.nodes[0]!)).toBe(key);
    expect(second.nodes[0]!.writtenId).toBeNull();
    expect(serialize(second)).not.toContain(key);
  });

  it('a written id does not take the fold off the node', () => {
    const doc = parse('- a\n  - b\n- c\n  - d\n');
    const node = byTitle(doc, 'c');
    const key = node.sessionKey;
    const folded = toggleFold(doc, key);
    expect(byTitle(folded, 'c').collapsed).toBe(true);
    const authored = assignPersistentId(folded, byTitle(folded, 'c'));
    expect(authored).toBe('3');
    expect(byTitle(folded, 'c').collapsed).toBe(true);
    expect(byTitle(folded, 'c').sessionKey).toBe(key);
    expect(serialize(folded)).toMatch(/^- a\n {2}- b\n- c <id:3> \(\+\)\n {2}- d\n/);
  });

  it('(+) is written for a folded node with or without a written id', () => {
    const doc = parse('- a <id:3>\n  - b\n- c\n  - d\n');
    const both = toggleFold(toggleFold(doc, byTitle(doc, 'a').sessionKey), byTitle(doc, 'c').sessionKey);
    const text = serialize(both);
    expect(text).toMatch(/^- a <id:3> \(\+\)\n {2}- b\n- c \(\+\)\n {2}- d\n/);
    expect(text).not.toContain('fold-:');
    expect(text).not.toContain(byTitle(doc, 'c').sessionKey);
  });

  it('a fold+: line is not a fold store', () => {
    const doc = parse('- a\n  - b\n- c\n  - d\n\n--- layout ---\nfold+: \n---\n');
    expect(byTitle(doc, 'a').collapsed).toBe(false);
    const text = serialize(toggleFold(doc, byTitle(doc, 'c').sessionKey));
    expect(text).toMatch(/^- a\n {2}- b\n- c \(\+\)\n {2}- d\n/);
    expect(text).not.toContain('<id:');
    expect(text).not.toContain('fold+:');
  });
});
