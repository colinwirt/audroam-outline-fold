import { collectPayloads, formatPayloadsBlock } from './payloads.js';
import type { OutlineFoldDoc, OutlineNode } from './types.js';

const DEFAULT_COLLAPSED = '(+)';

function isCollapsed(doc: OutlineFoldDoc, id: string | undefined): boolean {
  if (!id) return false;
  const { mode, ids } = doc.fold;
  const inList = ids.includes(id);
  return mode === '-' ? inList : !inList;
}

/**
 * Caption-first trailing tags (v0.2 lean):
 * `title <kind:…>? <flag>* <id:…>? (+)?`
 * Sealed material lives in the trailing `--- payloads ---` block, not on the line.
 */
function formatTrailingSpans(node: OutlineNode): string {
  const parts: string[] = [];
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
  let line = `${indent}- ${node.title}${formatTrailingSpans(node)}`;
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
  const lines: string[] = ['---'];
  const mode = doc.fold.mode;
  const ids = doc.fold.ids.join(', ');
  if (mode === '-') {
    lines.push(`fold-: ${ids}`);
  } else {
    lines.push(`fold+: ${ids}`);
  }
  const cm = doc.frontmatter?.collapsedMarker ?? DEFAULT_COLLAPSED;
  if (cm !== DEFAULT_COLLAPSED) {
    lines.push(`collapsedMarker: "${cm}"`);
  } else {
    lines.push(`collapsedMarker: "(+)"`);
  }
  if (doc.frontmatter?.expandedMarker) {
    lines.push(`expandedMarker: "${doc.frontmatter.expandedMarker}"`);
  }
  lines.push('---', '');
  for (const n of doc.nodes) serializeNode(n, doc, lines);
  const payloads = collectPayloads(doc.nodes);
  const block = formatPayloadsBlock(payloads);
  if (block) {
    lines.push('', block);
  }
  lines.push('');
  return lines.join('\n');
}
