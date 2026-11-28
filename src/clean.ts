import { parse } from './parse.js';
import { peelTrailingSections } from './payloads.js';
import type { OutlineNode } from './types.js';

/** `<id:N>`, also spaced (`<id : N>`, `< id:N >`), like parse. */
const ID_TAG = /[ \t]*<\s*id\s*:\s*([A-Za-z0-9][A-Za-z0-9_-]*)\s*>/g;
/** `#id:x` hops and `<r:x>` jumps (also spaced), with the `<id:>` characters. */
const HOP_REF = /#id:([A-Za-z0-9][A-Za-z0-9_-]*)|<\s*r\s*:\s*([A-Za-z0-9][A-Za-z0-9_-]*)\s*>/gi;
/**
 * Tags the grammar reads, wherever a translation left them in a caption. Lenient like
 * parse: whitespace around the colon and just inside the brackets (`< kind : doc >`).
 */
const STRAY_TAG =
  /[ \t]*<(?:\s*(?:id|t|r|action|thread|kind|enc|db)\s*:[^>\n]*|private|encrypted)>/gi;

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

/** `#id:` and `<r:>` references outside code spans. */
function hopRefs(text: string): string[] {
  const ids: string[] = [];
  replaceOutsideCode(text, HOP_REF, (all, hop: string, jump: string) => {
    ids.push(hop || jump);
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

/**
 * Remove `<id:…>` tags nothing points at. An id stays when a payloads or layout
 * entry is keyed by it, or a `#id:` link or `<r:>` jump names it. A collapsed
 * marker does not keep an id. Other text is left byte for byte.
 */
export function cleanIds(text: string): CleanIdsResult {
  const raw = String(text ?? '');
  const peeled = peelTrailingSections(raw);
  const outline = raw.slice(0, peeled.outline.length);
  const tail = raw.slice(peeled.outline.length);
  const lines = outline.split('\n');
  const start = leadingFmEnd(lines);
  const head = lines.slice(0, start).join('\n');
  const refs = new Set<string>([...Object.keys(peeled.payloads), ...Object.keys(peeled.layouts)]);
  for (const id of hopRefs(raw)) refs.add(id);
  const removed: string[] = [];
  const kept: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    lines[i] = replaceOutsideCode(lines[i]!, ID_TAG, (tag, id: string) => {
      if (refs.has(id)) {
        kept.push(id);
        return tag;
      }
      removed.push(id);
      return '';
    });
  }
  const body = lines.slice(start);
  const out = (start ? [head, ...body] : body).join('\n');
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
