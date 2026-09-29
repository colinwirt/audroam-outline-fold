import type { OutlineFoldDoc, OutlineNode } from './types.js';

function cloneDoc(doc: OutlineFoldDoc): OutlineFoldDoc {
  return {
    frontmatter: doc.frontmatter
      ? {
          ...doc.frontmatter,
          foldIds: doc.frontmatter.foldIds
            ? [...doc.frontmatter.foldIds]
            : undefined,
        }
      : undefined,
    nodes: structuredClone(doc.nodes),
    fold: { mode: doc.fold.mode, ids: [...doc.fold.ids] },
  };
}

/**
 * Whether the node with `id` is collapsed, respecting fold- vs fold+.
 * Unknown ids: fold- → expanded (false); fold+ → collapsed (true).
 */
export function isCollapsed(doc: OutlineFoldDoc, id: string): boolean {
  const inList = doc.fold.ids.includes(id);
  return doc.fold.mode === '-' ? inList : !inList;
}

/**
 * Pure toggle: returns a new doc. Under fold-, toggling adds/removes from
 * collapsed list; under fold+, adds/removes from expanded list.
 */
export function toggleFold(doc: OutlineFoldDoc, id: string): OutlineFoldDoc {
  const next = cloneDoc(doc);
  const idx = next.fold.ids.indexOf(id);
  if (idx >= 0) {
    next.fold.ids.splice(idx, 1);
  } else {
    next.fold.ids.push(id);
  }
  if (next.frontmatter) {
    next.frontmatter.foldIds = [...next.fold.ids];
    next.frontmatter.foldMode = next.fold.mode;
  }
  return next;
}

/** Expand-level argument: digit 0–9, or expand-all. */
export type ExpandLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | '*' | 'all';

/** Options for {@link setExpandLevel}. */
export interface SetExpandLevelOptions {
  /**
   * When set, apply expand/collapse only within this node's subtree
   * (including the node). Depth is **relative to the anchor**: digit `1`
   * expands the anchor (shows its children) and collapses deeper foldables;
   * `0` collapses the whole subtree under the anchor; `*` expands all
   * foldables in the subtree. Nodes outside the subtree are left unchanged.
   */
  under?: string;
}

function walkFoldable(
  nodes: OutlineNode[],
  visit: (node: OutlineNode & { id: string }) => void,
): void {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      if (node.id) {
        visit(node as OutlineNode & { id: string });
      }
      walkFoldable(node.children, visit);
    }
  }
}

function findNode(
  nodes: OutlineNode[],
  id: string,
): OutlineNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Merge per-id collapsed desires into fold.ids (mode-aware). Ids not in
 * `wantCollapsed` keep their prior state.
 */
function applyWantCollapsed(
  next: OutlineFoldDoc,
  wantCollapsed: Map<string, boolean>,
): void {
  const set = new Set(next.fold.ids);
  if (next.fold.mode === '-') {
    // ids = collapsed
    for (const [id, collapsed] of wantCollapsed) {
      if (collapsed) set.add(id);
      else set.delete(id);
    }
  } else {
    // ids = expanded
    for (const [id, collapsed] of wantCollapsed) {
      if (collapsed) set.delete(id);
      else set.add(id);
    }
  }
  next.fold.ids = [...set];
  if (next.frontmatter) {
    next.frontmatter.foldIds = [...next.fold.ids];
    next.frontmatter.foldMode = next.fold.mode;
  }
}

/**
 * Pure expand-level (iThoughts-style). Returns a new doc; fold mode unchanged.
 *
 * Depth uses **1-based aria-level** semantics (roots = 1). `node.depth` is
 * 0-based → aria-level = depth + 1.
 *
 * - `n` in 1..9: expand foldable nodes with level &lt; n; collapse foldable at level ≥ n
 * - `0`: top level only (collapse everything under roots; same as level `1`)
 * - `'*'` / `'all'`: expand all foldable nodes
 *
 * With `{ under: id }`, depth is **relative to that node** (Map digits-when-selected):
 * digit `1` expands the selected node (shows its children); `0` collapses the
 * subtree; outside nodes are untouched. Absolute tree-wide behaviour is unchanged
 * when `under` is omitted (Outline / cold-start seed).
 *
 * Only nodes with both an `id` and children participate in fold.ids.
 */
export function setExpandLevel(
  doc: OutlineFoldDoc,
  level: ExpandLevel | number | string,
  opts?: SetExpandLevelOptions,
): OutlineFoldDoc {
  const next = cloneDoc(doc);
  const underId = opts?.under;

  let expandAll = false;
  /** Absolute: expand foldable when ariaLevel < this; collapse when ≥. For 0/1 → 1. */
  let showThrough = 1;
  /** Relative under-anchor: digit 0 → showThroughRel 0 (collapse whole subtree). */
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
    if (underId) {
      // Relative: 0 collapses the subtree; 1..9 = show that many levels under anchor.
      showThroughRel = n;
    } else {
      // 0 = explicit “fold under roots” alias; same visible result as level 1.
      showThrough = n === 0 ? 1 : n;
    }
  }

  const wantCollapsed = new Map<string, boolean>();

  if (underId) {
    const anchor = findNode(next.nodes, underId);
    if (!anchor) {
      return next;
    }
    const anchorDepth = anchor.depth;
    walkFoldable([anchor], (node) => {
      if (expandAll) {
        wantCollapsed.set(node.id, false);
        return;
      }
      const relativeDepth = node.depth - anchorDepth;
      wantCollapsed.set(node.id, relativeDepth >= showThroughRel);
    });
    applyWantCollapsed(next, wantCollapsed);
    return next;
  }

  walkFoldable(next.nodes, (node) => {
    const ariaLevel = node.depth + 1;
    if (expandAll) {
      wantCollapsed.set(node.id, false);
    } else {
      wantCollapsed.set(node.id, ariaLevel >= showThrough);
    }
  });

  if (next.fold.mode === '-') {
    next.fold.ids = [...wantCollapsed.entries()]
      .filter(([, collapsed]) => collapsed)
      .map(([id]) => id);
  } else {
    next.fold.ids = [...wantCollapsed.entries()]
      .filter(([, collapsed]) => !collapsed)
      .map(([id]) => id);
  }

  if (next.frontmatter) {
    next.frontmatter.foldIds = [...next.fold.ids];
    next.frontmatter.foldMode = next.fold.mode;
  }
  return next;
}
