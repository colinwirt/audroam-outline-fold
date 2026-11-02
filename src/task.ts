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
    ...(doc.keys ? { keys: doc.keys } : {}),
    ...(doc.keyring ? { keyring: doc.keyring } : {}),
    ...(doc.sealedOrphans ? { sealedOrphans: { ...doc.sealedOrphans } } : {}),
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

const MARK_STATE: Record<string, TaskState> = { ' ': 'open', '-': 'pending', x: 'done', X: 'done' };
const STATE_MARK: Record<TaskState, string> = { open: ' ', pending: '-', done: 'x' } as Record<TaskState, string>;
/**
 * 0.4.15: cycle the `[ ]` / `[-]` / `[x]` marker on the outline line tagged `<id:id>`, as a text
 * edit. Only that one character changes: no re-serialise, so a toggle can never trip the
 * sealed-save guard on unrelated lines. Null when the line or marker is not found.
 */
export function toggleTaskLine(text: string, id: string): { text: string; from: TaskState; to: TaskState } | null {
  const tag = `<id:${id}>`;
  let at = 0;
  while (at <= text.length) {
    const nl = text.indexOf('\n', at);
    const end = nl < 0 ? text.length : nl;
    const line = text.slice(at, end);
    if (/^--- /.test(line)) return null; // payloads / keyring / layout blocks
    if (new RegExp(`(^|\\s)${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(line)) {
      const m = /^(\s*[-*+]\s+)\[( |x|X|-)\]/.exec(line);
      if (!m) return null;
      const from = MARK_STATE[m[2]!]!;
      const to = nextTaskState(from);
      const pos = at + m[1]!.length + 1;
      return { text: text.slice(0, pos) + STATE_MARK[to] + text.slice(pos + 1), from, to };
    }
    if (nl < 0) break;
    at = nl + 1;
  }
  return null;
}
