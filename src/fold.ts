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
 * Only nodes with both an `id` and children participate in fold.ids.
 */
export function setExpandLevel(
  doc: OutlineFoldDoc,
  level: ExpandLevel | number | string,
): OutlineFoldDoc {
  const next = cloneDoc(doc);

  let expandAll = false;
  /** Expand foldable when ariaLevel < this; collapse when ≥. For 0/1 → 1. */
  let showThrough = 1;

  if (level === '*' || level === 'all') {
    expandAll = true;
  } else {
    const n = typeof level === 'number' ? level : Number(level);
    if (!Number.isInteger(n) || n < 0 || n > 9) {
      throw new Error(
        `setExpandLevel: level must be 0–9 or '*'/'all', got ${JSON.stringify(level)}`,
      );
    }
    // 0 = explicit “fold under roots” alias; same visible result as level 1.
    showThrough = n === 0 ? 1 : n;
  }

  /** id → want collapsed */
  const wantCollapsed = new Map<string, boolean>();
  walkFoldable(next.nodes, (node) => {
    const ariaLevel = node.depth + 1;
    if (expandAll) {
      wantCollapsed.set(node.id, false);
    } else {
      wantCollapsed.set(node.id, ariaLevel >= showThrough);
    }
  });

  if (next.fold.mode === '-') {
    // ids = collapsed
    next.fold.ids = [...wantCollapsed.entries()]
      .filter(([, collapsed]) => collapsed)
      .map(([id]) => id);
  } else {
    // ids = expanded
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
