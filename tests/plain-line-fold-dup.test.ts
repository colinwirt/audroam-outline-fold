// Folding a line typed without a bullet used to insert `- title (+)` and leave the
// original line in place. Invented data.
import { it, expect } from 'vitest';
import { parse, serialize, mergeKeeping, toggleFold } from '../src/index.js';

it('folding a plain line replaces it with the bulleted fold marker', () => {
  const prev = 'done\n  - follow in text\n    - it does work\n';
  const doc = parse(prev, { sessionIds: true });
  const id = doc.nodes[0]?.id;
  if (!id || !doc.nodes[0]?.children?.length) throw new Error('missing parent');
  const norm = serialize(doc);
  const next = serialize(toggleFold(doc, id));
  const merged = mergeKeeping(prev, norm, next);
  expect(merged.split('\n').filter((l) => l.includes('done'))).toEqual(['- done (+)']);
  expect(merged).toContain('  - follow in text\n    - it does work\n');
  expect(merged).not.toMatch(/^done$/m);
});

it('an edit on another line leaves a plain line as typed', () => {
  const prev = 'done\n  - follow in text\n';
  const doc = parse(prev, { sessionIds: true });
  const norm = serialize(doc);
  const child = doc.nodes[0]?.children?.[0];
  if (!child) throw new Error('missing child');
  child.title = 'follow in text now';
  const merged = mergeKeeping(prev, norm, serialize(doc));
  expect(merged.startsWith('done\n')).toBe(true);
  expect(merged).toContain('  - follow in text now\n');
  expect(merged.split('\n').filter((l) => l.includes('done'))).toEqual(['done']);
});

it('a minted id on a plain line still replaces that line on fold', () => {
  const prev = 'done <id:5>\n- follow in text\n';
  const doc = parse(prev, { sessionIds: true });
  const node = doc.nodes[0];
  if (!node?.id) throw new Error('missing id');
  node.autoId = true;
  const norm = serialize(doc);
  const merged = mergeKeeping(prev, norm, serialize(toggleFold(doc, node.id)));
  expect(merged.split('\n').filter((l) => l.includes('done'))).toEqual(['- done (+)']);
  expect(merged).toContain('- follow in text\n');
});
