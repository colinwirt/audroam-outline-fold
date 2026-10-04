/**
 * Task checkbox helpers — toggle state, strip markers, action fire policy.
 */
import type { OutlineFoldDoc, OutlineNode, TaskState } from './types.js';

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

function findMutable(
  nodes: OutlineNode[],
  id: string,
): OutlineNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const hit = findMutable(n.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** Next state when clicking the task control: open → pending → done → open. */
export function nextTaskState(from: TaskState): TaskState {
  if (from === 'open') return 'pending';
  if (from === 'pending') return 'done';
  return 'open';
}

/**
 * Pure toggle of `node.task`. No-op if node missing or has no task.
 * Returns `{ doc, from, to, node }` or null.
 */
export function toggleTask(
  doc: OutlineFoldDoc,
  id: string,
): {
  doc: OutlineFoldDoc;
  from: TaskState;
  to: TaskState;
  node: OutlineNode;
} | null {
  const next = cloneDoc(doc);
  const node = findMutable(next.nodes, id);
  if (!node?.task) return null;
  const from = node.task;
  const to = nextTaskState(from);
  node.task = to;
  return { doc: next, from, to, node };
}

/**
 * Whether an action should fire for this transition.
 * v1: open|pending → done only; never on uncheck; never caption https auto-bind.
 */
export function shouldFireAction(from: TaskState, to: TaskState): boolean {
  return to === 'done' && from !== 'done';
}
