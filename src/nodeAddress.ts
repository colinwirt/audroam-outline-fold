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
 * With no prefix, a free 1-based position stays the id so a layout key such
 * as `2:` does not move. If that number is already taken, the next id is
 * one past the highest existing number, not a restart at 1.
 */
export function assignPersistentId(
  doc: OutlineFoldDoc,
  node: OutlineNode,
  opts?: AutoIdOptions,
): string {
  // A session id already came from nextAutoId over every id in the doc: write it.
  if (node.id) {
    delete node.autoId;
    return node.id;
  }
  const prefix = opts?.prefix ?? '';
  const used = collectNodeIds(doc.nodes);
  let id: string | undefined;
  if (!prefix) {
    const pos = indexOutline(doc.nodes).get(node);
    if (pos && !used.has(String(pos))) id = String(pos);
  }
  node.id = id ?? nextAutoId(used, prefix);
  moveFoldMarkToDoc(doc, node);
  return node.id;
}

/**
 * The id `assignPersistentId` would give `node`, without writing it (0.2.39).
 * A written id is returned as is.
 */
export function previewPersistentId(
  doc: OutlineFoldDoc,
  node: OutlineNode,
  opts?: AutoIdOptions,
): string {
  if (node.id) return node.id;
  const prefix = opts?.prefix ?? '';
  const used = collectNodeIds(doc.nodes);
  if (!prefix) {
    const pos = indexOutline(doc.nodes).get(node);
    if (pos && !used.has(String(pos))) return String(pos);
  }
  return nextAutoId(used, prefix);
}

/** The id written on the line (`<id:…>`), or null. A session id not yet written is null. */
export function writtenId(node: OutlineNode | null | undefined): string | null {
  return node?.id && !node.autoId ? node.id : null;
}

/**
 * Copy jump / Copy link (0.2.39): the line's written id, or a new one when
 * `canMint`. A new id comes from `assignPersistentId` (a session id is kept
 * and written; otherwise the free position or the next number, so a short
 * id with no spaces). Only `node.id` changes: the caption, its tags and their
 * spelling and spacing are untouched. Read-only (`canMint: false`) and no id:
 * nothing is written and `id` is null. The caller writes the doc back
 * (setDoc + onChange) when `minted`.
 */
export function mintNodeId(
  doc: OutlineFoldDoc,
  node: OutlineNode,
  opts: AutoIdOptions & { canMint: boolean },
): { id: string | null; minted: boolean } {
  const have = writtenId(node);
  if (have) return { id: have, minted: false };
  if (!opts.canMint) return { id: null, minted: false };
  return { id: assignPersistentId(doc, node, opts.prefix ? { prefix: opts.prefix } : undefined), minted: true };
}

/** A line's own `(+)` (no id) becomes fold state on `doc.fold` once it has an id. */
function moveFoldMarkToDoc(doc: OutlineFoldDoc, node: OutlineNode): void {
  if (!node.foldMark || !node.id) return;
  const collapsed = node.foldMark === 'collapsed';
  delete node.foldMark;
  const listed = doc.fold.mode === '-' ? collapsed : !collapsed;
  if (listed && !doc.fold.ids.includes(node.id)) {
    doc.fold.ids.push(node.id);
    if (doc.frontmatter) doc.frontmatter.foldIds = [...doc.fold.ids];
  }
}

function needsPersistentId(node: OutlineNode): boolean {
  if (node.id && !node.autoId) return false;
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
