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
  isNodeCollapsed: (id: string) => boolean = (id) => isCollapsed(doc, id),
): number {
  function rows(n: OutlineNode): number {
    if (!n?.id) return 0;
    if (!hasKids(n) || isNodeCollapsed(n.id)) return 1;
    const kids = (n.children || []).filter((c) => c?.id);
    if (!kids.length) return 1;
    let sum = 0;
    for (const c of kids) sum += rows(c);
    return Math.max(1, sum);
  }
  let total = 0;
  for (const r of doc.nodes || []) {
    if (!r?.id) continue;
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
  const roots = (next.nodes || []).filter((r) => r?.id);
  for (let i = roots.length - 1; i >= 0 && h > maxH; i--) {
    const r = roots[i];
    if (!r.id || !hasKids(r) || isCollapsed(next, r.id)) continue;
    const kids = (r.children || []).filter((c) => c?.id);
    for (let k = kids.length - 1; k >= 0 && h > maxH; k--) {
      const kid = kids[k];
      if (!kid.id) continue;
      if (hasKids(kid) && !isCollapsed(next, kid.id)) {
        next = toggleFold(next, kid.id);
        h = measureLineageHeight(next);
      }
    }
    if (h > maxH && !isCollapsed(next, r.id)) {
      next = toggleFold(next, r.id);
      h = measureLineageHeight(next);
    }
  }
  return next;
}
