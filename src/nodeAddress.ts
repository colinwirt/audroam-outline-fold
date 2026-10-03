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

/** `prefix` is written in front of the number. The default is no prefix. */
export type AutoIdOptions = { prefix?: string };

/**
 * Next id in `prefix` + decimal series. Existing `prefix`+number values count,
 * so a doc that already has 2 and 7 gets 8, not 1. The id is added to `used`.
 */
export function nextAutoId(used: Set<string>, prefix = ''): string {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}(\\d+)$`);
  let max = 0;
  for (const id of used) {
    const m = re.exec(id);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  let n = max + 1;
  let id = prefix + String(n);
  while (used.has(id)) {
    n += 1;
    id = prefix + String(n);
  }
  used.add(id);
  return id;
}

/**
 * Integer id for a node that now needs a persistent payload link.
 * Continues after ids already in the document. Does not reuse a free position.
 */
export function assignPersistentId(
  doc: OutlineFoldDoc,
  node: OutlineNode,
  opts?: AutoIdOptions,
): string {
  if (node.id) return node.id;
  const used = collectNodeIds(doc.nodes);
  node.id = nextAutoId(used, opts?.prefix ?? '');
  return node.id;
}

function needsPersistentId(node: OutlineNode): boolean {
  if (node.id) return false;
  if (typeof node.layout?.w === 'number') return true;
  if (node.sealed && (node.sealed.ciphertext || node.sealed.uri)) return true;
  return false;
}

/** Give an integer id to nodes whose layout or payload must survive in the text. */
export function linkPayloadNodes(doc: OutlineFoldDoc, opts?: AutoIdOptions): void {
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      if (needsPersistentId(n)) assignPersistentId(doc, n, opts);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(doc.nodes || []);
}
