/**
 * A glued in-map jump (`3.92<r:5>`, no space before the tag) used to fail to
 * round-trip: parse peeled it as a trailing tag, serialize wrote `3.92 <r:5>`,
 * and mergeKeeping (Map fold / commitView) could not match the original line,
 * so it inserted `3.92 <r:5> (+)` and left `3.92<r:5>` in place.
 *
 * `(+)` is the collapsed-fold marker, not a badge of hidden identical siblings.
 *
 * A no-space `<r:>` / `<t:>` is still a tag, but it stays mid-caption so the
 * original spacing is written back. Body lines in mergeKeeping pair by node
 * identity, never by caption text or jump target.
 */
import { describe, expect, it } from 'vitest';
import {
  parse,
  serialize,
  mergeKeeping,
  toggleFold,
  displayCaption,
  isBlankNode,
  createSessionIndex,
} from '../src/index.js';
// @ts-ignore — test host helper
import { mountOutlineFold } from './_host.mjs';

const CHARGING = [
  '- Charging <cloud>',
  '  - 4.16 <r:15>',
  '  - 3.92<r:5>',
  '  - ',
  '',
].join('\n');

function walk<T>(nodes: any[] | undefined, fn: (n: any) => T | undefined): T | undefined {
  for (const n of nodes ?? []) {
    const hit = fn(n);
    if (hit !== undefined) return hit;
    const child = walk(n.children, fn);
    if (child !== undefined) return child;
  }
  return undefined;
}

function allNodes(nodes: any[] | undefined, out: any[] = []): any[] {
  for (const n of nodes ?? []) {
    out.push(n);
    allNodes(n.children, out);
  }
  return out;
}

function lineCount(text: string, re: RegExp): number {
  return text.split('\n').filter((l) => re.test(l)).length;
}

describe('glued <r:> tag does not insert a duplicate line', () => {
  it('parses 3.92<r:5> as a jump tag and keeps the glued spelling in the title', () => {
    const doc = parse(CHARGING, { sessionIds: true });
    const node = walk(doc.nodes, (n) => (String(n.title).includes('3.92') ? n : undefined));
    expect(node).toBeTruthy();
    expect(node.title).toBe('3.92<r:5>');
    expect(node.links).toEqual([
      expect.objectContaining({ kind: 'jump', target: '5', form: 'tag', source: '<r:5>' }),
    ]);
    expect(displayCaption(node.title)).toBe('3.92');
    const spaced = walk(doc.nodes, (n) => (n.title === '4.16' ? n : undefined));
    expect(spaced?.title).toBe('4.16');
    expect(spaced?.links).toEqual([
      expect.objectContaining({ kind: 'jump', target: '15', form: 'tag', source: '<r:15>' }),
    ]);
  });

  it('serialize of a glued jump keeps the original spacing (no added line, no added space)', () => {
    const out = serialize(parse(CHARGING, { sessionIds: true }));
    expect(lineCount(out, /3\.92/)).toBe(1);
    expect(out).toContain('  - 3.92<r:5>\n');
    expect(out).not.toContain('3.92 <r:5>');
  });

  it('folding the glued line through mergeKeeping writes (+) in place and adds no line', () => {
    const prev = CHARGING;
    const doc = parse(prev, { sessionIds: true });
    const node = walk(doc.nodes, (n) => (String(n.title).includes('3.92') ? n : undefined));
    if (!node?.id) throw new Error('missing 3.92 node');
    const norm = serialize(parse(prev, { sessionIds: true }));
    const next = serialize(toggleFold(doc, node.id));
    const merged = mergeKeeping(prev, norm, next);
    expect(lineCount(merged, /3\.92/)).toBe(1);
    expect(merged).toContain('  - 3.92<r:5> (+)\n');
    expect(merged).not.toContain('3.92 <r:5>');
    expect(merged.split('\n').filter((l) => l.includes('4.16'))).toEqual(['  - 4.16 <r:15>']);
  });

  it('Map commitView fold on the glued line does not insert a spaced copy', () => {
    const fh = mountOutlineFold({ text: CHARGING, debounceMs: 1e9 });
    const view = parse(fh.getText(), { sessionIds: true });
    const node = walk(view.nodes, (n) => (String(n.title).includes('3.92') ? n : undefined));
    if (!node?.id) throw new Error('missing 3.92 node');
    const folded = toggleFold(view, node.id);
    fh.markView();
    expect(fh.commitView(folded, 'map')).toBe(true);
    const text = fh.getText();
    expect(lineCount(text, /3\.92/)).toBe(1);
    expect(text).toContain('  - 3.92<r:5> (+)\n');
    expect(text).not.toMatch(/3\.92 <r:5>/);
  });

  it('even a spaced serialize of the glued line updates in place (node identity, not text)', () => {
    // Safety net: if a writer still emitted the spaced form, mergeKeeping must
    // replace the original line, not keep both.
    const prev = CHARGING;
    const norm = prev.replace('3.92<r:5>', '3.92 <r:5>');
    const next = prev.replace('3.92<r:5>', '3.92 <r:5> (+)');
    const merged = mergeKeeping(prev, norm, next);
    expect(lineCount(merged, /3\.92/)).toBe(1);
    expect(merged).toContain('  - 3.92 <r:5> (+)\n');
    expect(merged).not.toContain('3.92<r:5>');
  });

  it('identical-caption siblings and identical <r:> targets stay two nodes with distinct session ids', () => {
    const text = [
      '- Charging <cloud>',
      '  - 3.92 <r:5>',
      '  - 3.92<r:5>',
      '',
    ].join('\n');
    const doc = parse(text, { sessionIds: true });
    const kids = doc.nodes[0]!.children ?? [];
    expect(kids).toHaveLength(2);
    expect(kids[0]!.title).toBe('3.92');
    expect(kids[1]!.title).toBe('3.92<r:5>');
    expect(kids[0]!.links?.[0]?.target).toBe('5');
    expect(kids[1]!.links?.[0]?.target).toBe('5');
    expect(kids[0]!.id).toBeTruthy();
    expect(kids[1]!.id).toBeTruthy();
    expect(kids[0]!.id).not.toBe(kids[1]!.id);
    const index = createSessionIndex();
    index.sync(doc);
    const visible = allNodes(doc.nodes).filter((n) => !isBlankNode(n));
    const keys = visible.map((n) => index.keyOf(n));
    expect(new Set(keys).size).toBe(keys.length);
    // Charging + two 3.92 pills, each with its own session / view key.
    expect(visible).toHaveLength(3);
    const folded = toggleFold(doc, kids[0]!.id!);
    const merged = mergeKeeping(text, serialize(parse(text, { sessionIds: true })), serialize(folded));
    expect(lineCount(merged, /3\.92/)).toBe(2);
    expect(merged).toContain('  - 3.92 <r:5> (+)\n');
    expect(merged).toContain('  - 3.92<r:5>\n');
  });
});
