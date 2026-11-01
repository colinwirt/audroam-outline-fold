/**
 * 0.4.13 (Colin, bug 1): the zone's text → its child doc, always a valid tree. Pure, no DOM.
 *
 * - Exactly one root: the zone's first outline line is the anchor's own row. A later line at
 *   or above the root's indent (malformed indentation, a pasted line, a stray Tab on the root)
 *   becomes a child of the nearest shallower line, which is the root, as the main editor reads
 *   it. A zone with no outline line gets an empty root, never zero roots.
 * - Every row gets an id: the root keeps the anchor id; rows without `<id:N>` get a session id
 *   (`autoId`, never serialised or sealed). Session ids are carried over by preorder position
 *   from the previous doc, so Map keys, focus and folds stay put while typing. Without this the
 *   Map keyed id-less rows by position, and position 4 collided with anchor id 4.
 */
import { parse } from './parse.js';
import type { OutlineFoldDoc, OutlineNode } from './types.js';

function walk(nodes: OutlineNode[] | undefined, fn: (n: OutlineNode) => void): void {
  for (const n of nodes ?? []) { if (!n) continue; fn(n); walk(n.children, fn); }
}
const reDepth = (list: OutlineNode[], d: number): void => list.forEach((c) => { c.depth = d; if (c.children) reDepth(c.children, d + 1); });

/** Fold extra roots under the first one (or make an empty root). Mutates and returns `doc`. */
export function oneZoneRoot(doc: OutlineFoldDoc): OutlineFoldDoc {
  if (!doc.nodes.length) doc.nodes = [{ title: '', depth: 0 }];
  if (doc.nodes.length > 1) {
    const [root, ...rest] = doc.nodes as [OutlineNode, ...OutlineNode[]];
    root.children = [...(root.children ?? []), ...rest];
    doc.nodes = [root];
  }
  reDepth(doc.nodes, 0);
  return doc;
}

/** Session ids for id-less rows: previous ids by preorder position first, then fresh `zN`. */
export function pinZoneIds(doc: OutlineFoldDoc, prev: OutlineFoldDoc | null, reserved: Iterable<string> = []): void {
  const used = new Set<string>([...reserved].map(String));
  walk(doc.nodes, (n) => { if (n.id) used.add(String(n.id)); });
  const carried: (string | undefined)[] = [];
  walk(prev?.nodes, (n) => { carried.push(n.autoId ? n.id : undefined); });
  let i = 0, seq = 1;
  walk(doc.nodes, (n) => {
    const old = carried[i++];
    if (n.id) return;
    if (old && !used.has(old)) n.id = old;
    else { while (used.has('z' + seq)) seq++; n.id = 'z' + seq; }
    n.autoId = true;
    used.add(n.id);
  });
}

/** Parse a zone's text into its child doc: one root carrying `anchorId`, every row keyed. */
export function parseZoneText(text: string, anchorId: string, prev: OutlineFoldDoc | null = null): OutlineFoldDoc {
  const doc = oneZoneRoot(parse(text));
  const root = doc.nodes[0]!;
  if (!root.id || root.autoId) { root.id = anchorId; delete root.autoId; }
  pinZoneIds(doc, prev, [anchorId]);
  return doc;
}
