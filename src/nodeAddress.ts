import { sessionKey, writtenId, type SessionKey, type WrittenId } from './ids.js';
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

export function collectNodeIds(nodes: OutlineNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      if (n.writtenId) ids.add(n.writtenId);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes || []);
  return ids;
}

/** Next `__sid-N` not already in `used`. The id is added to `used`. */
export function nextSessionId(used: Set<string>): SessionKey {
  const raw = nextAutoId(used, '__sid-');
  return sessionKey(Number(raw.slice('__sid-'.length)));
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
): WrittenId {
  if (node.writtenId) return node.writtenId;
  const prefix = opts?.prefix ?? '';
  const used = collectNodeIds(doc.nodes);
  let id: string | undefined;
  if (!prefix) {
    const pos = indexOutline(doc.nodes).get(node);
    if (pos && !used.has(String(pos))) id = String(pos);
  }
  node.writtenId = writtenId(id ?? nextAutoId(used, prefix));
  return node.writtenId;
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
  if (node.writtenId) return node.writtenId;
  const prefix = opts?.prefix ?? '';
  const used = collectNodeIds(doc.nodes);
  if (!prefix) {
    const pos = indexOutline(doc.nodes).get(node);
    if (pos && !used.has(String(pos))) return String(pos);
  }
  return nextAutoId(used, prefix);
}

/**
 * Copy jump / Copy link: the line's written id, or a new one when `canMint`.
 * A new id is written onto `writtenId` only. `sessionKey` stays. Read-only
 * and no written id: nothing is written and `id` is null.
 */
export function mintNodeId(
  doc: OutlineFoldDoc,
  node: OutlineNode,
  opts: AutoIdOptions & { canMint: boolean },
): { id: string | null; minted: boolean } {
  if (node.writtenId) return { id: node.writtenId, minted: false };
  if (!opts.canMint) return { id: null, minted: false };
  return { id: assignPersistentId(doc, node, opts.prefix ? { prefix: opts.prefix } : undefined), minted: true };
}

function needsPersistentId(node: OutlineNode): boolean {
  if (node.writtenId) return false;
  // 0.6.2: any layout entry that serialize would write (w / colour / icon / fill:none)
  // needs a real id — not only width. Otherwise `__sid-N:` leaks into the layout block.
  const L = node.layout;
  if (L && (typeof L.w === 'number' || L.color || L.icon || L.noFill)) return true;
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
