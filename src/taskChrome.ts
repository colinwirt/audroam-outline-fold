/**
 * Task checkbox chrome helpers (title-scan fallback + display caption).
 * Prefer structured `node.task` / `node.action` / `node.thread` from parse when set.
 * Leading task markers only — mid-caption brackets and ballot boxes stay text.
 * Open: `[ ]`, `[]`, or `☐`. Done: `[x]` or `☑`. Pending: `[-]`.
 */

import type { OutlineNode, TaskState } from './types.js';
export type { TaskState } from './types.js';

export interface ParsedTask {
  state: TaskState;
  /** Title with leading `[ ]`/`[x]`/`[-]` removed (tags intact). */
  label: string;
}

export interface TaskToggleEvent {
  id: string;
  from: TaskState;
  to: TaskState;
  node: OutlineNode;
}

/** Hyphen-minus and the dashes a copilot may type instead. */
const DASH = '-\u2010\u2011\u2012\u2013\u2014\u2015\u2212';
/** Empty box, white squares. */
const OPEN_GLYPH = '\u2610\u25A1\u25A2\u25FB\u25FD\u2B1C';
/** Checked, crossed, and tick marks. */
const DONE_GLYPH = '\u2611\u2612\u2713\u2714\u2705';

/** `[ ]`, `[]`, `[x]`/`[X]`, `[-]` and unicode dashes. Whitespace after the bracket is required. */
const LEADING_BRACKETS = new RegExp(
  `^\\s*\\[(?:([xX])|([${DASH}])|(\\s*))\\]\\s+`,
);
/** Leading `☐` / `☑` and the same family. A space after the glyph is required. */
const LEADING_GLYPH = new RegExp(
  `^\\s*([${OPEN_GLYPH}${DONE_GLYPH}])\\s+`,
  'u',
);

function taskStateFromMatch(done: string | undefined, pending: string | undefined): TaskState {
  if (done) return 'done';
  if (pending) return 'pending';
  return 'open';
}

/** `<action:https://…>` or `<action:event:…>`; spaces around `:` and inside `<>` read too. */
const ACTION_TAG = /<\s*action\s*:\s*([^>]*?[^\s>])\s*>/i;

/** `<thread:pnid:…>` or `<thread:/path>` etc. (lenient like every tag). */
const THREAD_TAG = /<\s*thread\s*:\s*([^>]*?[^\s>])\s*>/i;

/** Result-row note link `<t:101>`, also `<t: 101>` / `< t : 101 >`. */
const NOTE_LINK_TAG = /<\s*t\s*:\s*(\d+)\s*>/gi;

export function parseLeadingTask(title: string): ParsedTask | null {
  const text = String(title);
  const glyph = text.match(LEADING_GLYPH);
  if (glyph) {
    const ch = glyph[1];
    const state: TaskState = DONE_GLYPH.includes(ch) ? 'done' : 'open';
    const label = text.slice(glyph[0].length).replace(/^\uFE0F/, '');
    return { state, label };
  }
  const m = text.match(LEADING_BRACKETS);
  if (!m) return null;
  return {
    state: taskStateFromMatch(m[1], m[2]),
    label: text.slice(m[0].length),
  };
}

/** Display caption: strip leading task ASCII + optional action/thread tags.
 * Preserves newlines / break tokens for Map scrapbook wrap (0.2.13).
 * Collapses horizontal whitespace runs only (spaces/tabs), not newlines.
 */
export function displayCaption(title: string): string {
  const task = parseLeadingTask(title);
  let s = task ? task.label : String(title);
  s = s.replace(ACTION_TAG, '').replace(THREAD_TAG, '').replace(NOTE_LINK_TAG, '');
  // Per-line trim of horizontal ws; keep \n intact for normalizeCaptionBreaks.
  s = s
    .split(/\n/)
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+|[ \t]+$/g, ''))
    .join('\n');
  return s.replace(/^\n+|\n+$/g, '');
}

export function parseActionTag(title: string): string | null {
  const m = String(title).match(ACTION_TAG);
  return m ? m[1].trim() : null;
}

export function parseThreadTag(title: string): string | null {
  const m = String(title).match(THREAD_TAG);
  return m ? m[1].trim() : null;
}

/** Rewrite leading `[ ]` ↔ `[x]`; if no marker, prepend for `to`. */
export function toggleTaskMarker(title: string, to: TaskState): string {
  const marker =
    to === 'done' ? '[x] ' : to === 'pending' ? '[-] ' : '[ ] ';
  const parsed = parseLeadingTask(title);
  if (parsed) {
    const text = String(title);
    const glyph = text.match(LEADING_GLYPH);
    if (glyph) {
      const rest = text.slice(glyph[0].length).replace(/^\uFE0F/, '');
      return marker + rest;
    }
    return text.replace(LEADING_BRACKETS, marker);
  }
  return marker + String(title);
}

export function taskStateOf(title: string): TaskState | null {
  return parseLeadingTask(title)?.state ?? null;
}

/** Resolve task state from structured node or title marker. */
export function resolveTask(node: OutlineNode): TaskState | null {
  if (node.task) return node.task;
  return parseLeadingTask(node.title)?.state ?? null;
}

export function resolveAction(node: OutlineNode): string | null {
  if (node.action) return node.action;
  return parseActionTag(node.title);
}

export function resolveThread(node: OutlineNode): string | null {
  if (node.thread) return node.thread;
  return parseThreadTag(node.title);
}

/**
 * Turn a layout `noteUri` into an http(s) or root-relative link.
 * `{id}` and `{pnid}` both take the note id. Anything else is ignored.
 */
export function noteLinkHref(pattern: string | undefined, id: string): string | null {
  if (!pattern || !id) return null;
  if (!/\{(?:id|pnid)\}/.test(pattern)) return null;
  const href = pattern.replace(/\{(?:id|pnid)\}/g, encodeURIComponent(id));
  if (href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\')) {
    return href;
  }
  try {
    const url = new URL(href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Numeric `<t: N>` links. Structured field wins; otherwise scan the title. */
export function resolveNoteLinks(node: OutlineNode): string[] {
  if (node.noteLinks && node.noteLinks.length) return [...node.noteLinks];
  const ids: string[] = [];
  const re = new RegExp(NOTE_LINK_TAG.source, 'gi');
  let m: RegExpExecArray | null;
  const title = String(node.title);
  while ((m = re.exec(title)) !== null) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}
