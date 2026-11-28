import type { SessionKey } from './ids.js';
import type { OutlineFoldDoc, OutlineNode } from './types.js';

function cloneDoc(doc: OutlineFoldDoc): OutlineFoldDoc {
  const frontmatter = doc.frontmatter ? { ...doc.frontmatter } : undefined;
  return {
    frontmatter,
    nodes: structuredClone(doc.nodes),
    ...(doc.keys ? { keys: doc.keys } : {}),
    ...(doc.keyring ? { keyring: doc.keyring } : {}),
    ...(doc.assets ? { assets: doc.assets } : {}),
    ...(doc.sealedOrphans ? { sealedOrphans: { ...doc.sealedOrphans } } : {}),
  };
}

export function findBySessionKey(nodes: OutlineNode[] | undefined, key: SessionKey): OutlineNode | null {
  for (const n of nodes ?? []) {
    if (n.sessionKey === key) return n;
    const hit = findBySessionKey(n.children, key);
    if (hit) return hit;
  }
  return null;
}

/** True when the node with this session key is collapsed. Any other argument is not a fold. */
export function isCollapsed(doc: OutlineFoldDoc, key: SessionKey): boolean {
  return findBySessionKey(doc.nodes, key)?.collapsed === true;
}

/** Flip `node.collapsed`. A leaf stays open. */
export function toggleFold(doc: OutlineFoldDoc, key: SessionKey): OutlineFoldDoc {
  const next = cloneDoc(doc);
  const node = findBySessionKey(next.nodes, key);
  if (!node?.children?.length) return next;
  node.collapsed = !node.collapsed;
  return next;
}

/** Expand-level argument: digit 0–9, or expand-all. */
export type ExpandLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | '*' | 'all';

export interface SetExpandLevelOptions {
  /** Session key of the node whose subtree is leveled. Depth is relative to that node. */
  under?: SessionKey;
}

function walkFoldable(
  nodes: OutlineNode[],
  visit: (node: OutlineNode, depth: number) => void,
  depth = 0,
): void {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      visit(node, depth);
      walkFoldable(node.children, visit, depth + 1);
    }
  }
}

/**
 * Set `collapsed` from the walk depth. Roots are level 1.
 * `n` in 1..9 collapses foldable nodes at level >= n.
 * `0` matches level 1. `*` / `all` expands every foldable node.
 * Leaves are left open.
 */
export function setExpandLevel(
  doc: OutlineFoldDoc,
  level: ExpandLevel | number | string,
  opts?: SetExpandLevelOptions,
): OutlineFoldDoc {
  const next = cloneDoc(doc);
  const underId = opts?.under;

  let expandAll = false;
  let showThrough = 1;
  let showThroughRel = 1;

  if (level === '*' || level === 'all') {
    expandAll = true;
  } else {
    const n = typeof level === 'number' ? level : Number(level);
    if (!Number.isInteger(n) || n < 0 || n > 9) {
      throw new Error(
        `setExpandLevel: level must be 0–9 or '*'/'all', got ${JSON.stringify(level)}`,
      );
    }
    if (underId) showThroughRel = n;
    else showThrough = n === 0 ? 1 : n;
  }

  const apply = (node: OutlineNode, depth: number, through: number) => {
    node.collapsed = expandAll ? false : depth >= through;
  };

  if (underId) {
    const anchor = findBySessionKey(next.nodes, underId);
    if (!anchor) return next;
    walkFoldable([anchor], (node, depth) => apply(node, depth, showThroughRel));
    return next;
  }

  walkFoldable(next.nodes, (node, depth) => apply(node, depth + 1, showThrough));
  return next;
}

/** The marker sits at the end of the line, outside an open code span. */
function markerAtEnd(line: string, marker: string): boolean {
  if (!marker || line.length < marker.length || !line.endsWith(marker)) return false;
  const head = line.slice(0, -marker.length);
  return (head.match(/`/g) ?? []).length % 2 === 0;
}

/**
 * Put the collapsed marker on `line`, or take it off.
 * Returns null when the line already says that.
 * An expanded marker, when the note has one, replaces the collapsed marker on open.
 */
export function setCollapsedMarker(
  line: string,
  collapsed: boolean,
  collapsedMarker = '(+)',
  expandedMarker?: string,
): string | null {
  let rest = line;
  if (collapsedMarker && markerAtEnd(rest, collapsedMarker)) {
    rest = rest.slice(0, -collapsedMarker.length).trimEnd();
  } else if (expandedMarker && markerAtEnd(rest, expandedMarker)) {
    rest = rest.slice(0, -expandedMarker.length).trimEnd();
  }
  const next = collapsed
    ? `${rest} ${collapsedMarker}`
    : expandedMarker
      ? `${rest} ${expandedMarker}`
      : rest;
  return next === line ? null : next;
}

/**
 * Set the collapsed marker on the given 0-based text lines.
 * One pass, so a level change is a single text edit.
 * Null when no line changed.
 */
export function setCollapsedAtLines(
  text: string,
  edits: ReadonlyMap<number, boolean>,
  collapsedMarker = '(+)',
  expandedMarker?: string,
): string | null {
  if (edits.size === 0) return null;
  const parts: string[] = [];
  let at = 0;
  let n = 0;
  let changed = false;
  for (;;) {
    const nl = text.indexOf('\n', at);
    const end = nl < 0 ? text.length : nl;
    const raw = text.slice(at, end);
    const cr = raw.endsWith('\r');
    const line = cr ? raw.slice(0, -1) : raw;
    const want = edits.get(n);
    let next = line;
    if (want !== undefined) {
      const edited = setCollapsedMarker(line, want, collapsedMarker, expandedMarker);
      if (edited != null) {
        next = edited;
        changed = true;
      }
    }
    parts.push(next + (cr ? '\r' : ''));
    if (nl < 0) break;
    at = nl + 1;
    n += 1;
  }
  return changed ? parts.join('\n') : null;
}
