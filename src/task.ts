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

const STATE_MARK: Record<TaskState, string> = { open: ' ', pending: '-', done: 'x' } as Record<TaskState, string>;
/**
 * `[ ]`, `[]`, `[-]`, `[x]` / `[X]` at the start of a line. A list bullet is optional.
 * The inside may be empty. A space after the box is required, the same rule as parse.
 */
const TASK_MARK = /^(\s*(?:[-*+]\s+)?)\[([ xX-]*)\](?=\s)/;

function stateOfInner(inner: string): TaskState | null {
  if (inner === 'x' || inner === 'X') return 'done';
  if (inner === '-') return 'pending';
  if (inner.trim() === '') return 'open';
  return null;
}

/** The `[ ]` span on a line, or null when the line is not a task. */
export function taskMarkAt(line: string): { from: number; to: number; state: TaskState } | null {
  const m = TASK_MARK.exec(line);
  if (!m) return null;
  const state = stateOfInner(m[2]!);
  if (!state) return null;
  const from = m[1]!.length;
  return { from, to: from + 2 + m[2]!.length, state };
}

/** Replace the bracket contents with the next mark. Null when the line is not a task. */
export function editTaskMarker(line: string): { line: string; from: TaskState; to: TaskState; innerFrom: number; innerTo: number; mark: string } | null {
  const hit = taskMarkAt(line);
  if (!hit) return null;
  const to = nextTaskState(hit.state);
  const mark = STATE_MARK[to];
  const innerFrom = hit.from + 1;
  const innerTo = hit.to - 1;
  return {
    line: line.slice(0, innerFrom) + mark + line.slice(innerTo),
    from: hit.state,
    to,
    innerFrom,
    innerTo,
    mark,
  };
}

/** A line parse turns into a node: non-blank, and not an empty non-list line. */
function isNodeLine(line: string): boolean {
  if (!line.trim()) return false;
  const trimmedStart = line.trimStart();
  const content = trimmedStart.replace(/^[-*+]\s+/, '');
  if (!content.trim() && !/^[-*+]\s+$/.test(trimmedStart)) return false;
  return true;
}

function skipFrontmatter(text: string): number {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return m ? m[0].length : 0;
}

/**
 * 0.4.15: cycle the `[ ]` / `[-]` / `[x]` marker on the outline line tagged `<id:id>`, as a text
 * edit. Only the marker changes: no re-serialise, so a toggle can never trip the sealed-save
 * guard on unrelated lines. `[]` is open. Null when the line or marker is not found.
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
      const edited = editTaskMarker(line);
      if (!edited) return null;
      return { text: text.slice(0, at) + edited.line + text.slice(end), from: edited.from, to: edited.to };
    }
    if (nl < 0) break;
    at = nl + 1;
  }
  return null;
}

/**
 * Same one-line edit at the ordinal-th outline node. Used when the id is a session id that
 * was never written on the line. The ordinal is the node's place in the current parse, so a
 * line inserted above moves it. Null when that line is not a task.
 */
export function toggleTaskAtLine(text: string, ordinal: number): { text: string; from: TaskState; to: TaskState } | null {
  if (ordinal < 0) return null;
  let at = skipFrontmatter(text);
  let seen = 0;
  while (at <= text.length) {
    const nl = text.indexOf('\n', at);
    const end = nl < 0 ? text.length : nl;
    let line = text.slice(at, end);
    const cr = line.endsWith('\r');
    if (cr) line = line.slice(0, -1);
    if (/^---(\s|$)/.test(line)) return null;
    if (isNodeLine(line)) {
      if (seen === ordinal) {
        const edited = editTaskMarker(line);
        if (!edited) return null;
        const next = edited.line + (cr ? '\r' : '');
        return { text: text.slice(0, at) + next + text.slice(end), from: edited.from, to: edited.to };
      }
      seen += 1;
    }
    if (nl < 0) break;
    at = nl + 1;
  }
  return null;
}
