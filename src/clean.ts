import { parse } from './parse.js';
import { peelTrailingSections } from './payloads.js';
import type { OutlineNode } from './types.js';

const ID_TAG = /[ \t]*<id:([A-Za-z0-9][A-Za-z0-9_-]*)>/g;
const HOP_REF = /#id:([A-Za-z0-9_.:-]+)/g;
const FOLD_LINE = /^(\s*fold([-+])\s*:)[ \t]*(.*?)(\r?)$/im;
const DEFAULT_LAYOUT_BLOCK = /\n*--- layout ---\r?\nfold-:[ \t]*\r?\ncollapsedMarker: "\(\+\)"\r?\n---\s*$/;
/** Tags the grammar reads, wherever a translation left them in a caption. */
const STRAY_TAG = /[ \t]*<(?:(?:id|t|action|thread|kind|enc|db)\s*:[^>\n]*|private|encrypted)>/gi;

/** Inline code (`…`) is literal, as in parse: no tag or `#id:` inside it is touched. */
const CODE_SPAN = /`[^`\n]+`/g;

/** `text.replace(re, fn)` on the parts of `text` outside backtick code spans. */
function replaceOutsideCode(
  text: string,
  re: RegExp,
  fn: (match: string, ...groups: string[]) => string,
): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(CODE_SPAN)) {
    out += text.slice(last, m.index).replace(re, fn as never) + m[0];
    last = m.index! + m[0].length;
  }
  return out + text.slice(last).replace(re, fn as never);
}

/** `#id:` references outside code spans. */
function hopRefs(text: string): string[] {
  const ids: string[] = [];
  replaceOutsideCode(text, HOP_REF, (all, id: string) => {
    ids.push(id);
    return all;
  });
  return ids;
}

export interface CleanIdsResult {
  text: string;
  /** Ids taken off their lines. */
  removed: string[];
  /** Ids left in place because something points at them. */
  kept: string[];
}

function leadingFmEnd(lines: string[]): number {
  if (!lines.length || lines[0]!.trim() !== '---') return 0;
  let i = 1;
  while (i < lines.length && lines[i]!.trim() !== '---') i += 1;
  return i < lines.length ? i + 1 : 0;
}

function foldOf(block: string): { mode: '-' | '+'; ids: string[] } | null {
  const m = FOLD_LINE.exec(block);
  if (!m) return null;
  return { mode: m[2] as '-' | '+', ids: m[3]!.split(',').map((s) => s.trim()).filter(Boolean) };
}

function dropFromFold(block: string, drop: Set<string>): string {
  return block.replace(FOLD_LINE, (_all, key: string, _mode: string, list: string, cr: string) => {
    const ids = list.split(',').map((s) => s.trim()).filter((id) => id && !drop.has(id));
    return `${key} ${ids.join(', ')}${cr}`;
  });
}

/**
 * Remove `<id:…>` tags nothing points at. An id stays when a payloads or layout
 * entry is keyed by it, a `#id:` link names it, or a fold+ list holds it. A fold-
 * entry whose line already ends with the collapsed marker is redundant: the id and
 * the entry both go, and the `(+)` keeps the fold. Other text is left byte for byte.
 */
export function cleanIds(text: string): CleanIdsResult {
  const raw = String(text ?? '');
  const peeled = peelTrailingSections(raw);
  const outline = raw.slice(0, peeled.outline.length);
  let tail = raw.slice(peeled.outline.length);
  const lines = outline.split('\n');
  const start = leadingFmEnd(lines);
  const head = lines.slice(0, start).join('\n');
  const fold = foldOf(tail) ?? foldOf(head);
  const marker = peeled.trailingFm.collapsedMarker ?? '(+)';
  const refs = new Set<string>([...Object.keys(peeled.payloads), ...Object.keys(peeled.layouts)]);
  for (const id of hopRefs(raw)) refs.add(id);
  const foldIds = new Set(fold?.ids ?? []);
  const removed: string[] = [];
  const kept: string[] = [];
  const dropFold = new Set<string>();
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i]!;
    const folded = line.trimEnd().endsWith(marker);
    lines[i] = replaceOutsideCode(line, ID_TAG, (tag, id: string) => {
      const keep = refs.has(id) || (foldIds.has(id) && (fold!.mode === '+' || !folded));
      if (keep) {
        kept.push(id);
        return tag;
      }
      if (foldIds.has(id)) dropFold.add(id);
      removed.push(id);
      return '';
    });
  }
  let headOut = head;
  if (dropFold.size) {
    tail = dropFromFold(tail, dropFold);
    headOut = dropFromFold(head, dropFold);
    if (DEFAULT_LAYOUT_BLOCK.test(tail)) tail = tail.replace(DEFAULT_LAYOUT_BLOCK, '') + (/\n$/.test(raw) ? '\n' : '');
  }
  const body = lines.slice(start);
  const out = (start ? [headOut, ...body] : body).join('\n');
  return { text: out + tail, removed, kept };
}

export interface CleanMarkdownOptions {
  /** Keep `[ ]` / `[x]` / `[-]` task boxes. Default true. */
  tasks?: boolean;
}

/**
 * Plain markdown list from an outline: `- ` bullets, two spaces per level, the
 * caption only. No ids, note links, kind / flag / action / thread / enc tags,
 * fold markers, layout or payload blocks. Sealed rows keep their cleartext caption.
 */
export function cleanMarkdown(text: string, opts?: CleanMarkdownOptions): string {
  const tasks = opts?.tasks !== false;
  const doc = parse(String(text ?? ''));
  const out: string[] = [];
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      const box = tasks && n.task ? (n.task === 'done' ? '[x] ' : n.task === 'pending' ? '[-] ' : '[ ] ') : '';
      const title = replaceOutsideCode(n.title, STRAY_TAG, () => '').replace(/[ \t]{2,}/g, ' ').trim();
      out.push(`${'  '.repeat(n.depth)}- ${box}${title}`);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(doc.nodes);
  return out.length ? out.join('\n') + '\n' : '';
}
