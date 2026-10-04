import { linkPayloadNodes } from './nodeAddress.js';
import { collectLayouts, collectPayloads, formatLayoutBlock, formatPayloadsBlock } from './payloads.js';
import type { OutlineFoldDoc, OutlineNode, TaskState } from './types.js';

const DEFAULT_COLLAPSED = '(+)';

function isCollapsed(doc: OutlineFoldDoc, id: string | undefined): boolean {
  if (!id) return false;
  const { mode, ids } = doc.fold;
  const inList = ids.includes(id);
  return mode === '-' ? inList : !inList;
}

function taskMarker(task: TaskState): string {
  if (task === 'done') return '[x] ';
  if (task === 'pending') return '[-] ';
  return '[ ] ';
}

/**
 * Caption-first trailing tags (v0.2 lean):
 * `[ ]? title <action:…>? <thread:…>? <t: N>* <kind:…>? <flag>* <id:…>? (+)?`
 * Sealed material lives in the trailing `--- payloads ---` block, not on the line.
 */
function formatTrailingSpans(node: OutlineNode): string {
  const parts: string[] = [];
  if (node.action) parts.push(`<action:${node.action}>`);
  if (node.thread) parts.push(`<thread:${node.thread}>`);
  if (node.noteLinks) {
    for (const id of node.noteLinks) {
      if (/^\d+$/.test(id)) parts.push(`<t: ${id}>`);
    }
  }
  if (node.kind) parts.push(`<kind:${node.kind}>`);
  if (node.flags) {
    for (const f of node.flags) {
      if (f === 'db' && node.dbRef) parts.push(`<db:${node.dbRef}>`);
      else parts.push(`<${f}>`);
    }
  }
  if (node.id) parts.push(`<id:${node.id}>`);
  return parts.length ? ' ' + parts.join(' ') : '';
}

function serializeNode(
  node: OutlineNode,
  doc: OutlineFoldDoc,
  lines: string[],
): void {
  const collapsedMarker =
    doc.frontmatter?.collapsedMarker ?? DEFAULT_COLLAPSED;
  const expandedMarker = doc.frontmatter?.expandedMarker;
  const indent = '  '.repeat(node.depth);
  const lead = node.task ? taskMarker(node.task) : '';
  let line = `${indent}- ${lead}${node.title}${formatTrailingSpans(node)}`;
  if (node.id && isCollapsed(doc, node.id)) {
    line += ` ${collapsedMarker}`;
  } else if (node.id && expandedMarker) {
    line += ` ${expandedMarker}`;
  }
  lines.push(line);
  if (node.children) {
    for (const c of node.children) serializeNode(c, doc, lines);
  }
}

export function serialize(doc: OutlineFoldDoc): string {
  linkPayloadNodes(doc);
  const lines: string[] = [];
  for (const n of doc.nodes) serializeNode(n, doc, lines);
  const payloads = collectPayloads(doc.nodes);
  const block = formatPayloadsBlock(payloads);
  if (block) {
    if (lines.length) lines.push('');
    lines.push(block);
  }
  // Document keys live in the layout trailer so a pilot_note summary is the
  // first outline line, not a leading `---` fence.
  const layoutBlock = formatLayoutBlock(collectLayouts(doc.nodes), {
    foldMode: doc.fold.mode,
    foldIds: doc.fold.ids,
    collapsedMarker: doc.frontmatter?.collapsedMarker ?? DEFAULT_COLLAPSED,
    expandedMarker: doc.frontmatter?.expandedMarker,
    fontSize: doc.frontmatter?.fontSize,
    noteUri: doc.frontmatter?.noteUri,
  });
  if (layoutBlock) {
    if (lines.length) lines.push('');
    lines.push(layoutBlock);
  }
  lines.push('');
  return lines.join('\n');
}
