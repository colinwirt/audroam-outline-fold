import { formatAssetsBlock } from './thumbnails.js';
import { assertSealedSafe, syncSealedLabels, isEncRef } from './sealedState.js';
import { assignPersistentId, linkPayloadNodes } from './nodeAddress.js';
import { collectLayouts, collectPayloads, formatLayoutBlock, formatPayloadsBlock, formatKeysBlock, formatKeyringBlock } from './payloads.js';
import { isSealedBranchPayload } from './sealedState.js';
import { canonTag, spelledTag } from './tagSpelling.js';
import { markdownLinkSpans, parseHopTarget } from './captionRich.js';
import type { OutlineFoldDoc, OutlineNode, TaskState } from './types.js';

const DEFAULT_COLLAPSED = '(+)';

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
  if (node.sealed?.kid && isEncRef(node.sealed)) parts.push(`<enc:${node.sealed.kid}>`);
  // 0.5.22: a layout colour is written in the layout block; only a shadowed inline tag stays.
  const inlineCol = node.layout?.color ? node.inlineColor : node.color ? { color: node.color, fill: node.colorFill } : undefined;
  if (inlineCol) {
    const plain = `<color:${inlineCol.color}${inlineCol.fill ? ':fill' : ''}>`;
    const k = kept?.color;
    parts.push(k && canonTag(k).replace(/^<colour:/, '<color:') === plain ? k : plain);
  }
  const fontTag = node.layout?.font ? node.inlineFont : node.font;
  if (fontTag) {
    const plain = `<font:${fontTag}>`;
    const k = kept?.font;
    parts.push(k && canonTag(k).replace(/^<style:/, '<font:') === plain ? k : plain);
  }
  if (node.cloud) parts.push(node.cloud === 'default' ? '<cloud>' : `<cloud:${node.cloud}>`);
  if (node.img) parts.push(`<img:${node.img}>`);
  if (node.writtenId) parts.push(spelledTag(kept?.id, `<id:${node.writtenId}>`));
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
  const lead = (node.task ? taskMarker(node.task) : '') + (leadIcon(node) ? `${leadIcon(node)} ` : '');
  const inline = inlineLinks(node);
  let line = `${indent}- ${lead}${inline.title}${formatTrailingSpans(node, inline)}`;
  // Never write (+) on a node with no children.
  const hasChildren = node.children && node.children.length > 0;
  if (node.collapsed && hasChildren) {
    line += ` ${collapsedMarker}`;
  } else if (expandedMarker && hasChildren) {
    line += ` ${expandedMarker}`;
  }
  lines.push(line);
  if (node.children) {
    for (const c of node.children) serializeNode(c, doc, lines);
  }
}

/**
 * A jump whose target is this node's session key gets a written id, so the
 * jump still lands after a reload. The session key itself is never written.
 */
function linkJumpTargets(doc: OutlineFoldDoc): void {
  const targets = new Set<string>();
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      for (const l of n.links ?? []) if (l.kind === 'jump' && l.form === 'tag') targets.add(l.target);
      for (const md of markdownLinkSpans(n.title)) {
        const hop = parseHopTarget(md.url);
        if (hop) targets.add(hop);
      }
      if (n.children?.length) walk(n.children);
    }
  };
  walk(doc.nodes);
  const mint = (list: OutlineNode[]) => {
    for (const n of list) {
      if (!n.writtenId && targets.has(n.sessionKey)) {
        const old = n.sessionKey;
        const neu = assignPersistentId(doc, n);
        const retarget = (nodes?: OutlineNode[]) => {
          for (const x of nodes ?? []) {
            for (const l of x.links ?? []) {
              if (l.kind === 'jump' && l.form === 'tag' && l.target === old) l.target = neu;
            }
            retarget(x.children);
          }
        };
        retarget(doc.nodes);
      }
      if (n.children?.length) mint(n.children);
    }
  };
  mint(doc.nodes);
}

/**
 * Copy that keeps sealed payloads and the keyring, so the block still opens
 * with outline-fold and the key. Same text serialize() writes.
 */
export function portableCopy(doc: OutlineFoldDoc): string {
  return serialize(doc);
}

/**
 * Copy with no ciphertext and no keyring. Sealed lines keep their public label.
 * Plain children, if the caller has put any on the node, stay. The sealed bytes do not.
 */
export function cleanCopy(doc: OutlineFoldDoc): string {
  const clone = structuredClone(doc);
  const walk = (nodes: OutlineFoldDoc['nodes']) => {
    for (const n of nodes) {
      if (n.sealed && isSealedBranchPayload(n.sealed)) {
        n.title = n.sealed.pub || n.title || '';
        delete n.sealed;
      }
      if (n.children?.length) walk(n.children);
    }
  };
  walk(clone.nodes);
  delete clone.keyring;
  delete clone.keys;
  delete clone.sealedOrphans;
  return serialize(clone);
}

/**
 * Body lines are a pre-order walk of `doc.nodes` (document order): each node
 * is written, then its `children` in array order, including blank `- ` nodes
 * at their tree position. Trailing payloads / keyring / assets / layout blocks
 * follow. portableCopy and cleanCopy use this same walk.
 */
export function serialize(doc: OutlineFoldDoc): string {
  // Fail closed before anything is written (see sealedState.assertSealedSafe).
  syncSealedLabels(doc.nodes); // caption -> public label (0.4.17)
  assertSealedSafe(doc);
  linkPayloadNodes(doc);
  linkJumpTargets(doc);
  const lines: string[] = [];
  for (const n of doc.nodes) serializeNode(n, doc, lines);
  const payloads = collectPayloads(doc.nodes);
  const block = formatPayloadsBlock(payloads);
  if (block) {
    if (lines.length) lines.push('');
    lines.push(block);
  }
  const ringBlock = formatKeyringBlock(doc.keyring);
  if (ringBlock) {
    if (lines.length) lines.push('');
    lines.push(ringBlock);
  }
  const keyBlock = formatKeysBlock(doc.keys);
  if (keyBlock) {
    if (lines.length) lines.push('');
    lines.push(keyBlock);
  }
  const assetsBlock = formatAssetsBlock(doc.assets);
  if (assetsBlock) {
    if (lines.length) lines.push('');
    lines.push(assetsBlock);
  }
  // Document keys live in the layout trailer so a pilot_note summary is the
  // first outline line, not a leading `---` fence.
  const layouts = collectLayouts(doc.nodes);
  const fm = doc.frontmatter;
  // Nothing but the default collapsed marker says nothing: leave the block out.
  const onlyDefaults =
    !Object.keys(layouts).length &&
    (fm?.collapsedMarker ?? DEFAULT_COLLAPSED) === DEFAULT_COLLAPSED &&
    !fm?.expandedMarker &&
    fm?.fontSize == null &&
    !fm?.autoWidth &&
    fm?.autoLockMs == null &&
    fm?.followText == null &&
    !fm?.noteUri &&
    !fm?.noteMapUri &&
    !fm?.noteDetailsUri;
  const layoutBlock = onlyDefaults ? '' : formatLayoutBlock(layouts, {
    collapsedMarker: fm?.collapsedMarker ?? DEFAULT_COLLAPSED,
    expandedMarker: fm?.expandedMarker,
    fontSize: fm?.fontSize,
    autoWidth: fm?.autoWidth,
    autoLockMs: fm?.autoLockMs,
    followText: fm?.followText,
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

/** 0.5.22: the leading icon to write inline (a layout icon lives in the layout block). */
function leadIcon(node: OutlineNode): string | undefined {
  return node.layout?.icon ? node.inlineIcon : node.icon;
}
