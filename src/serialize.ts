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
 * `<t: N>` by default. A spelling kept by parse (`<t:N>`, `<T: N >`) is written
 * back as long as it still names this id, so the author's tag round-trips.
 */
function noteLinkTag(node: OutlineNode, id: string): string {
  const kept = node.noteLinkTags?.[id];
  if (
    typeof kept === 'string' &&
    /^<t:[ \t]*(\d+)[ \t]*>$/i.exec(kept)?.[1] === id
  ) {
    return kept;
  }
  return `<t: ${id}>`;
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
      if (/^\d+$/.test(id)) parts.push(noteLinkTag(node, id));
    }
  }
  if (node.kind) parts.push(`<kind:${node.kind}>`);
  if (node.flags) {
    for (const f of node.flags) {
      if (f === 'db' && node.dbRef) parts.push(`<db:${node.dbRef}>`);
      else parts.push(`<${f}>`);
    }
  }
  if (node.id && !node.autoId) parts.push(`<id:${node.id}>`);
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
  // Under fold+ every line off the list is collapsed; a session-id leaf has no fold to mark.
  const bareLeaf = node.autoId && doc.fold.mode === '+' && !node.children?.length;
  if (node.id && isCollapsed(doc, node.id) && !bareLeaf) {
    line += ` ${collapsedMarker}`;
  } else if (node.id && expandedMarker) {
    line += ` ${expandedMarker}`;
  }
  lines.push(line);
  if (node.children) {
    for (const c of node.children) serializeNode(c, doc, lines);
  }
}

/**
 * Fold ids for the layout block. Under fold- a session id is left out: the line's
 * `(+)` carries it. Under fold+ the entry is a persistent link, so the id is written.
 */
function layoutFoldIds(doc: OutlineFoldDoc): string[] {
  const auto = new Map<string, OutlineNode>();
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      if (n.id && n.autoId) auto.set(n.id, n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(doc.nodes);
  if (!auto.size) return doc.fold.ids;
  if (doc.fold.mode === '+') {
    for (const id of doc.fold.ids) delete auto.get(id)?.autoId;
    return doc.fold.ids;
  }
  return doc.fold.ids.filter((id) => !auto.has(id));
}

export function serialize(doc: OutlineFoldDoc): string {
  linkPayloadNodes(doc);
  const foldIds = layoutFoldIds(doc);
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
  const layouts = collectLayouts(doc.nodes);
  const fm = doc.frontmatter;
  // Nothing but defaults (fold- with no ids, "(+)") says nothing: leave the block out.
  const onlyDefaults =
    !Object.keys(layouts).length &&
    doc.fold.mode === '-' &&
    !foldIds.length &&
    (fm?.collapsedMarker ?? DEFAULT_COLLAPSED) === DEFAULT_COLLAPSED &&
    !fm?.expandedMarker &&
    fm?.fontSize == null &&
    !fm?.noteUri;
  const layoutBlock = onlyDefaults ? '' : formatLayoutBlock(layouts, {
    foldMode: doc.fold.mode,
    foldIds,
    collapsedMarker: fm?.collapsedMarker ?? DEFAULT_COLLAPSED,
    expandedMarker: fm?.expandedMarker,
    fontSize: fm?.fontSize,
    noteUri: fm?.noteUri,
  });
  if (layoutBlock) {
    if (lines.length) lines.push('');
    lines.push(layoutBlock);
  }
  lines.push('');
  return lines.join('\n');
}
