/**
 * 0.4.13 (Colin, bug 1): the zone's text → its child doc, always a valid tree. Pure, no DOM.
 *
 * - Exactly one root: the zone's first outline line is the anchor's own row. A later line at
 *   or above the root's indent (malformed indentation, a pasted line, a stray Tab on the root)
 *   becomes a child of the nearest shallower line, which is the root, as the main editor reads
 *   it. A zone with no outline line gets an empty root, never zero roots.
 * - The root keeps the anchor's written id when the line has none. Every row already has a
 *   session key from parse. Those keys are carried over by preorder position from the previous
 *   doc, so Map focus stays put while typing. Session keys are never serialised.
 */
import { sessionKey, writtenId } from './ids.js';
import { parse } from './parse.js';
import type { OutlineFoldDoc, OutlineNode } from './types.js';
import type { SessionKey } from './ids.js';

function walk(nodes: OutlineNode[] | undefined, fn: (n: OutlineNode) => void): void {
  for (const n of nodes ?? []) { if (!n) continue; fn(n); walk(n.children, fn); }
}
const reDepth = (list: OutlineNode[], d: number): void => list.forEach((c) => { c.depth = d; if (c.children) reDepth(c.children, d + 1); });

/** Fold extra roots under the first one (or make an empty root). Mutates and returns `doc`. */
export function oneZoneRoot(doc: OutlineFoldDoc): OutlineFoldDoc {
  if (!doc.nodes.length) {
    doc.nodes = [{ title: '', depth: 0, writtenId: null, sessionKey: sessionKey(0), collapsed: false }];
  }
  if (doc.nodes.length > 1) {
    const [root, ...rest] = doc.nodes as [OutlineNode, ...OutlineNode[]];
    root.children = [...(root.children ?? []), ...rest];
    doc.nodes = [root];
  }
  reDepth(doc.nodes, 0);
  return doc;
}

/** Carry session keys by preorder position so a re-parse keeps the same runtime identity. */
export function pinZoneIds(doc: OutlineFoldDoc, prev: OutlineFoldDoc | null, reserved: Iterable<string> = []): void {
  const used = new Set<string>([...reserved].map(String));
  walk(doc.nodes, (n) => {
    if (n.writtenId) used.add(n.writtenId);
    used.add(n.sessionKey);
  });
  const carried: SessionKey[] = [];
  walk(prev?.nodes, (n) => { carried.push(n.sessionKey); });
  let i = 0;
  walk(doc.nodes, (n) => {
    const old = carried[i++];
    if (!old || used.has(old) || old === n.sessionKey) return;
    used.delete(n.sessionKey);
    n.sessionKey = old;
    used.add(old);
  });
}

/** Parse a zone's text into its child doc: one root carrying `anchorId`, session keys carried. */
export function parseZoneText(text: string, anchorId: string, prev: OutlineFoldDoc | null = null): OutlineFoldDoc {
  const doc = oneZoneRoot(parse(text));
  const root = doc.nodes[0]!;
  if (!root.writtenId) root.writtenId = writtenId(anchorId);
  pinZoneIds(doc, prev, [anchorId]);
  return doc;
}
