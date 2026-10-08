import { linkPayloadNodes } from './nodeAddress.js';
import { collectLayouts, collectPayloads, formatLayoutBlock, formatPayloadsBlock } from './payloads.js';
import { spelledTag } from './tagSpelling.js';
import { markdownLinkSpans, parseHopTarget } from './captionRich.js';
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
 * `<t:N>` by default. A spelling kept by parse (`<t: N>`, `<T: N >`) is written
 * back as long as it still names this id, so the author's tag round-trips.
 */
function noteLinkTag(node: OutlineNode, id: string): string {
  const kept = node.noteLinkTags?.[id];
  if (
    typeof kept === 'string' &&
    /^<\s*t\s*:\s*(\d+)\s*>$/i.exec(kept)?.[1] === id
  ) {
    return kept;
  }
  return `<t:${id}>`;
}

const JUMP_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
/** `<t:N>` / `<r:x>` as typed in a caption (spaced too), with the spaces around it. */
const INLINE_LINK = /([ \t]*)<\s*(?:t\s*:\s*(\d+)|r\s*:\s*([A-Za-z0-9][A-Za-z0-9_-]*))\s*>([ \t]*)/gi;
const CODE_SPAN = /`[^`\n]+`/g;

/** `text.replace(re, fn)` outside backtick code spans (a tag in code is text). */
function replaceOutsideCode(text: string, re: RegExp, fn: (...m: any[]) => string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(CODE_SPAN)) {
    out += text.slice(last, m.index).replace(re, fn) + m[0];
    last = m.index! + m[0].length;
  }
  return out + text.slice(last).replace(re, fn);
}

/**
 * The caption with its mid-caption and leading `<t:N>` / `<r:x>` tags where they were
 * typed, plus the notes and jumps those tags name. An inline `<t:N>` that parse listed
 * (a tag link in `links`) is dropped once N leaves `noteLinks`; anything else typed in
 * the caption stays.
 */
function inlineLinks(node: OutlineNode): { title: string; notes: Set<string>; jumps: Set<string> } {
  const notes = new Set<string>();
  const jumps = new Set<string>();
  const active = new Set(node.noteLinks ?? []);
  const listed = new Set(
    (node.links ?? []).filter((l) => l.kind === 'note' && l.form === 'tag').map((l) => l.target),
  );
  const raw = String(node.title ?? '');
  let dropped = false;
  const kept = replaceOutsideCode(
    raw,
    INLINE_LINK,
    (all: string, before: string, pnid: string | undefined, jump: string | undefined, after: string) => {
      if (jump) {
        jumps.add(jump);
        return all;
      }
      if (pnid && (active.has(pnid) || !listed.has(pnid))) {
        notes.add(pnid);
        return all;
      }
      // Dropped: one space stays between the words it stood between.
      dropped = true;
      return before || after;
    },
  );
  return { title: dropped ? kept.trim() : raw, notes, jumps };
}

/**
 * `<t:N>` and `<r:x>` tags in `links` order, each as written while it still names
 * its target (`noteLinkTags` for a note, the link's `source` for a jump). A `<t:N>` is written only while N is in `noteLinks` (the public list);
 * numbers in `noteLinks` that `links` does not have follow, as `<t:N>`.
 */
function linkTags(node: OutlineNode, inline: { notes: Set<string>; jumps: Set<string> }): string[] {
  const notes = (node.noteLinks ?? []).filter((id) => /^\d+$/.test(id));
  const out: string[] = [];
  // Tags typed in the caption are already written there.
  const wrote = new Set<string>(inline.notes);
  const jumped = new Set<string>(inline.jumps);
  for (const l of node.links ?? []) {
    if (l.form !== 'tag') continue;
    if (l.kind === 'note') {
      if (!notes.includes(l.target) || wrote.has(l.target)) continue;
      wrote.add(l.target);
      // `noteLinkTags` holds the spelling (parse fills it from the same tag).
      out.push(noteLinkTag(node, l.target));
    } else if (JUMP_ID.test(l.target) && !jumped.has(l.target)) {
      jumped.add(l.target);
      out.push(spelledTag(l.source, `<r:${l.target}>`));
    }
  }
  for (const id of notes) if (!wrote.has(id)) out.push(noteLinkTag(node, id));
  return out;
}

/**
 * Caption-first trailing tags (v0.2 lean):
 * `[ ]? title <action:…>? <thread:…>? (<t:N>|<r:x>)* <kind:…>? <flag>* <id:…>? (+)?`
 * Sealed material lives in the trailing `--- payloads ---` block, not on the line.
 */
function formatTrailingSpans(
  node: OutlineNode,
  inline: { notes: Set<string>; jumps: Set<string> } = { notes: new Set(), jumps: new Set() },
): string {
  const parts: string[] = [];
  const kept = node.tagSpellings;
  if (node.action) parts.push(spelledTag(kept?.action, `<action:${node.action}>`));
  if (node.thread) parts.push(spelledTag(kept?.thread, `<thread:${node.thread}>`));
  parts.push(...linkTags(node, inline));
  if (node.kind) parts.push(spelledTag(kept?.kind, `<kind:${node.kind}>`));
  if (node.flags) {
    for (const f of node.flags) {
      if (f === 'db' && node.dbRef) parts.push(spelledTag(kept?.db, `<db:${node.dbRef}>`));
      else parts.push(`<${f}>`);
    }
  }
  if (node.id && !node.autoId) parts.push(spelledTag(kept?.id, `<id:${node.id}>`));
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
  const inline = inlineLinks(node);
  let line = `${indent}- ${lead}${inline.title}${formatTrailingSpans(node, inline)}`;
  // Under fold+ every line off the list is collapsed; a session-id leaf has no fold to mark.
  const bareLeaf = node.autoId && doc.fold.mode === '+' && !node.children?.length;
  if (node.id && isCollapsed(doc, node.id) && !bareLeaf) {
    line += ` ${collapsedMarker}`;
  } else if (node.id && expandedMarker) {
    line += ` ${expandedMarker}`;
  } else if (!node.id && node.foldMark === 'collapsed') {
    // Lazy ids: a fold on a line without an id is the inline marker, never an id.
    line += ` ${collapsedMarker}`;
  } else if (!node.id && node.foldMark === 'expanded' && expandedMarker) {
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

/**
 * Lazy ids: a session id that a jump names becomes a written id, so the jump
 * still lands after a reload. Parse never gives a session id a jump's target.
 */
function linkJumpTargets(doc: OutlineFoldDoc): void {
  const targets = new Set<string>();
  const auto: OutlineNode[] = [];
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      for (const l of n.links ?? []) if (l.kind === 'jump' && l.form === 'tag') targets.add(l.target);
      // Markdown hops are read from the caption as it is now.
      for (const md of markdownLinkSpans(n.title)) {
        const hop = parseHopTarget(md.url);
        if (hop) targets.add(hop);
      }
      if (n.id && n.autoId) auto.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(doc.nodes);
  for (const n of auto) if (targets.has(n.id!)) delete n.autoId;
}

export function serialize(doc: OutlineFoldDoc): string {
  linkPayloadNodes(doc);
  linkJumpTargets(doc);
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
    !fm?.noteUri &&
    !fm?.noteMapUri &&
    !fm?.noteDetailsUri;
  const layoutBlock = onlyDefaults ? '' : formatLayoutBlock(layouts, {
    foldMode: doc.fold.mode,
    foldIds,
    collapsedMarker: fm?.collapsedMarker ?? DEFAULT_COLLAPSED,
    expandedMarker: fm?.expandedMarker,
    fontSize: fm?.fontSize,
    noteUri: fm?.noteUri,
    noteMapUri: fm?.noteMapUri,
    noteDetailsUri: fm?.noteDetailsUri,
  });
  if (layoutBlock) {
    if (lines.length) lines.push('');
    lines.push(layoutBlock);
  }
  lines.push('');
  return lines.join('\n');
}
