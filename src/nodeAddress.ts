import type { OutlineFoldDoc, OutlineNode } from './types.js';

/** Document order, 1-based. Position is the address until a line has an id. */
export function indexOutline(nodes: OutlineNode[]): Map<OutlineNode, number> {
  const map = new Map<OutlineNode, number>();
  let i = 0;
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      i += 1;
      map.set(n, i);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes || []);
  return map;
}

/** Authored id, otherwise the 1-based position. Position is not written to the line. */
export function nodeMapKey(node: OutlineNode, position: number): string {
  return node.id || String(position);
}

export function collectNodeIds(nodes: OutlineNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      if (n.id) ids.add(n.id);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes || []);
  return ids;
}

/**
 * Integer id for a node that now needs a persistent payload link.
 * Prefers the node's position when that integer is free.
 */
export function assignPersistentId(doc: OutlineFoldDoc, node: OutlineNode): string {
  if (node.id) return node.id;
  const index = indexOutline(doc.nodes);
  const used = collectNodeIds(doc.nodes);
  const pos = index.get(node);
  if (pos && !used.has(String(pos))) {
    node.id = String(pos);
    return node.id;
  }
  let n = 1;
  while (used.has(String(n))) n += 1;
  node.id = String(n);
  return node.id;
}

function needsPersistentId(node: OutlineNode): boolean {
  if (node.id) return false;
  if (typeof node.layout?.w === 'number') return true;
  if (node.sealed && (node.sealed.ciphertext || node.sealed.uri)) return true;
  return false;
}

/** Give an integer id to nodes whose layout or payload must survive in the text. */
export function linkPayloadNodes(doc: OutlineFoldDoc): void {
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      if (needsPersistentId(n)) assignPersistentId(doc, n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(doc.nodes || []);
}
