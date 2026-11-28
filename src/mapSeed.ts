/**
 * Cold-start fold seed (no saved fold):
 * 1. Try depth 3 (setExpandLevel 3)
 * 2. If visible lineage height > cap → depth 2
 * 3. If still > cap → collapse excess root children from the bottom until ≤ cap
 *
 * Lineage height = leaf-row count of the painted L→R stack (not per-parent
 * kid count).
 */

import { isCollapsed, setExpandLevel, toggleFold } from './fold.js';
import { sessionKeyFromAttribute } from './ids.js';
import type { OutlineFoldDoc, OutlineNode } from './types.js';

export const DEFAULT_LINEAGE_HEIGHT_CAP = 10;

function hasKids(n: OutlineNode): boolean {
  return !!(n.children && n.children.length > 0);
}

/**
 * Visible lineage height: each painted leaf-row in the L→R stack.
 * Parents with visible kids contribute the child stack sum (not +1).
 */
export function measureLineageHeight(
  doc: OutlineFoldDoc,
  isNodeCollapsed: (id: string) => boolean = (id) => isCollapsed(doc, sessionKeyFromAttribute(id)),
): number {
  function rows(n: OutlineNode): number {
    if (!n) return 0;
    if (!hasKids(n) || isNodeCollapsed(n.sessionKey)) return 1;
    const kids = n.children || [];
    if (!kids.length) return 1;
    let sum = 0;
    for (const c of kids) sum += rows(c);
    return Math.max(1, sum);
  }
  let total = 0;
  for (const r of doc.nodes || []) {
    if (!r) continue;
    total += rows(r);
  }
  return total;
}

/**
 * Intelligent cold-start fold. Caller should skip when resume fold exists.
 */
export function seedColdStartFold(
  doc: OutlineFoldDoc,
  opts: { maxHeight?: number } = {},
): OutlineFoldDoc {
  const maxH = opts.maxHeight ?? DEFAULT_LINEAGE_HEIGHT_CAP;

  let next = setExpandLevel(doc, 3);
  if (measureLineageHeight(next) <= maxH) return next;

  next = setExpandLevel(doc, 2);
  let h = measureLineageHeight(next);
  if (h <= maxH) return next;

  // Collapse excess root children from the bottom until height ≤ maxH.
  const roots = (next.nodes || []).filter((r) => r);
  for (let i = roots.length - 1; i >= 0 && h > maxH; i--) {
    const r = roots[i]!;
    if (!hasKids(r) || isCollapsed(next, r.sessionKey)) continue;
    const kids = r.children || [];
    for (let k = kids.length - 1; k >= 0 && h > maxH; k--) {
      const kid = kids[k]!;
      if (hasKids(kid) && !isCollapsed(next, kid.sessionKey)) {
        next = toggleFold(next, kid.sessionKey);
        h = measureLineageHeight(next);
      }
    }
    if (h > maxH && !isCollapsed(next, r.sessionKey)) {
      next = toggleFold(next, r.sessionKey);
      h = measureLineageHeight(next);
    }
  }
  return next;
}

/** True when any parent was parsed collapsed. A host then skips the level-1 seed. */
export function hasSavedFold(doc: OutlineFoldDoc): boolean {
  const walk = (nodes: OutlineNode[] | undefined): boolean => {
    for (const n of nodes ?? []) {
      if (n.children?.length && n.collapsed) return true;
      if (walk(n.children)) return true;
    }
    return false;
  };
  return walk(doc.nodes);
}

/**
 * First-view rule when there is no saved fold state (fold-to-level L11):
 * - `level1` (default): each root and its children, `setExpandLevel(doc, 2)`;
 * - `cold-start`: the older lock rule, {@link seedColdStartFold};
 * - `all`: everything expanded (no change).
 */
export type DefaultFoldRule = 'level1' | 'cold-start' | 'all';

export type SeedDefaultFoldOptions = {
  rule?: DefaultFoldRule;
  /** Lineage height cap for `cold-start`. */
  maxHeight?: number;
};

/**
 * Seed the first view of a doc with no saved fold state. Returns the doc
 * itself, untouched, when a parent was parsed collapsed (`(+)`).
 *
 * Load order for a host: per-user resume if present, else the body's `(+)`,
 * else this seed. Call it once on load, not on every re-parse.
 */
export function seedDefaultFold(
  doc: OutlineFoldDoc,
  opts: SeedDefaultFoldOptions = {},
): OutlineFoldDoc {
  if (hasSavedFold(doc)) return doc;
  const rule = opts.rule ?? 'level1';
  if (rule === 'all') return doc;
  if (rule === 'cold-start') return seedColdStartFold(doc, { maxHeight: opts.maxHeight });
  return setExpandLevel(doc, 2);
}
