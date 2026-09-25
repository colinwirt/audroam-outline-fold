import type { OutlineFoldDoc } from './types.js';

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
