/**
 * Fold-to-level picker model (Design UX 2026-10-06, L3, L13, L14, L16).
 * Pure: items, current level, counts, live text and guard rails for the
 * picker a long-press or right-click on a fold handle opens. Applying an
 * item is `setExpandLevel(doc, level, { under: id })`, which resets the
 * whole subtree (L16).
 */

import { isCollapsed, setExpandLevel } from './fold.js';
import type { OutlineFoldDoc, OutlineNode } from './types.js';

/** Picker levels: Fold (0), 1, 2, 3, All. */
export type FoldLevelKey = 0 | 1 | 2 | 3 | '*';

export const FOLD_LEVEL_KEYS: readonly FoldLevelKey[] = [0, 1, 2, 3, '*'];

/** "All" under a bigger subtree asks first (L14). */
export const LEVEL_ALL_CONFIRM_NODES = 1500;
/** Above this many fold changes, apply without the FLIP animation (L14). */
export const LEVEL_NO_FLIP_CHANGES = 300;

export interface FoldLevelItem {
  key: FoldLevelKey;
  /** Item label: `Fold`, `1`, `2`, `3`, `All`. */
  label: string;
  /** Key hint: `0 1 2 3 *`. */
  hint: string;
  /** Deeper than the subtree: nothing new to show. */
  disabled: boolean;
  /** Same result as All (the level equals the subtree height). */
  sameAsAll: boolean;
  /** The subtree is in exactly this state now. */
  checked: boolean;
  /** Nodes below the pressed node that this level shows. */
  shown: number;
  /** Nodes below the pressed node that this level hides. */
  hidden: number;
}

export interface FoldLevelPicker {
  id: string;
  title: string;
  /** Nodes below the pressed node. */
  total: number;
  /** Levels below the pressed node (0 for a leaf). */
  height: number;
  items: FoldLevelItem[];
}

function findNode(nodes: OutlineNode[] | undefined, id: string): OutlineNode | null {
  for (const n of nodes || []) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

function countBelow(n: OutlineNode): number {
  let c = 0;
  for (const k of n.children || []) c += 1 + countBelow(k);
  return c;
}

function heightBelow(n: OutlineNode): number {
  let h = 0;
  for (const k of n.children || []) h = Math.max(h, 1 + heightBelow(k));
  return h;
}

/** Visible nodes below `anchor` (not counting it), given the doc's folds. */
function visibleBelow(doc: OutlineFoldDoc, anchor: OutlineNode): string[] {
  const out: string[] = [];
  const walk = (n: OutlineNode, path: string) => {
    if (n.id && isCollapsed(doc, n.id)) return;
    (n.children || []).forEach((k, i) => {
      const key = k.id ?? `${path}.${i}`;
      out.push(key);
      walk(k, key);
    });
  };
  walk(anchor, anchor.id ?? '');
  return out;
}

/**
 * Picker items for the node with `id`. Counts are worked out once per open
 * (O(n) per item). Returns null when the node is missing or has no children.
 */
export function foldLevelPicker(doc: OutlineFoldDoc, id: string): FoldLevelPicker | null {
  const anchor = findNode(doc.nodes, id);
  if (!anchor || !anchor.children?.length) return null;
  const total = countBelow(anchor);
  const height = heightBelow(anchor);
  const now = visibleBelow(doc, anchor).join('\n');

  const items: FoldLevelItem[] = FOLD_LEVEL_KEYS.map((key) => {
    const next = setExpandLevel(doc, key, { under: id });
    const nextAnchor = findNode(next.nodes, id)!;
    const shownIds = visibleBelow(next, nextAnchor);
    const n = key === '*' ? Infinity : key;
    return {
      key,
      label: key === 0 ? 'Fold' : key === '*' ? 'All' : String(key),
      hint: key === '*' ? '*' : String(key),
      disabled: key !== '*' && key !== 0 && n > height,
      sameAsAll: key !== '*' && key !== 0 && n === height,
      checked: false,
      shown: shownIds.length,
      hidden: total - shownIds.length,
      _sig: shownIds.join('\n'),
    } as FoldLevelItem & { _sig: string };
  });

  // Mark the current state. All wins over a numbered level with the same result.
  const order = [...items].sort((a, b) => (a.key === '*' ? -1 : b.key === '*' ? 1 : 0));
  const hit = order.find((it) => !it.disabled && (it as FoldLevelItem & { _sig: string })._sig === now);
  for (const it of items) {
    it.checked = it === hit;
    delete (it as Partial<FoldLevelItem & { _sig: string }>)._sig;
  }

  return { id, title: anchor.title, total, height, items };
}

/** The level the subtree is at now, or null when it matches none. */
export function currentFoldLevel(doc: OutlineFoldDoc, id: string): FoldLevelKey | null {
  return foldLevelPicker(doc, id)?.items.find((it) => it.checked)?.key ?? null;
}

/** "All" under a subtree above {@link LEVEL_ALL_CONFIRM_NODES} asks first. */
export function foldLevelNeedsConfirm(picker: FoldLevelPicker, key: FoldLevelKey): boolean {
  return key === '*' && picker.total > LEVEL_ALL_CONFIRM_NODES;
}

/** How many nodes change fold state between two docs. */
export function foldChangeCount(before: OutlineFoldDoc, after: OutlineFoldDoc): number {
  let c = 0;
  const walk = (nodes: OutlineNode[] | undefined) => {
    for (const n of nodes || []) {
      if (n.id && n.children?.length && isCollapsed(before, n.id) !== isCollapsed(after, n.id)) c++;
      walk(n.children);
    }
  };
  walk(after.nodes);
  return c;
}

/** Skip the FLIP animation when more than {@link LEVEL_NO_FLIP_CHANGES} nodes change. */
export function foldLevelSkipsAnimation(before: OutlineFoldDoc, after: OutlineFoldDoc): boolean {
  return foldChangeCount(before, after) > LEVEL_NO_FLIP_CHANGES;
}

/**
 * Live-region text after a pick (L13): "Programs folded to level 1. 11 items
 * hidden." For Fold and All the spec gives no wording; these follow the same
 * pattern.
 */
export function foldLevelAnnouncement(picker: FoldLevelPicker, key: FoldLevelKey): string {
  const it = picker.items.find((i) => i.key === key);
  const title = picker.title.trim() || 'Node';
  if (!it) return '';
  const hidden = `${it.hidden} ${it.hidden === 1 ? 'item' : 'items'} hidden.`;
  if (key === 0) return `${title} folded. ${hidden}`;
  if (key === '*') return `${title} open to all levels. ${it.shown} shown.`;
  return `${title} folded to level ${key}. ${hidden}`;
}

/** Live-region text for a whole-map level: "Whole map at level 2. 18 of 64 shown." */
export function wholeMapAnnouncement(doc: OutlineFoldDoc, level: number | '*'): string {
  let total = 0;
  let shown = 0;
  const walk = (nodes: OutlineNode[] | undefined, visible: boolean) => {
    for (const n of nodes || []) {
      total++;
      if (visible) shown++;
      walk(n.children, visible && !(n.id && isCollapsed(doc, n.id)));
    }
  };
  walk(doc.nodes, true);
  const at = level === '*' ? 'all levels' : `level ${level}`;
  return `Whole map at ${at}. ${shown} of ${total} shown.`;
}
