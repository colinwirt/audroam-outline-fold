import {
  attachLayouts,
  attachPayloads,
  mergeFrontmatter,
  peelTrailingSections,
} from './payloads.js';
import { parseEncBody } from './sealed.js';
import { parseLeadingTask } from './taskChrome.js';
import type {
  FoldMode,
  NodeFlag,
  NodeKind,
  OutlineFoldDoc,
  OutlineFrontmatter,
  OutlineNode,
  SealedPayload,
  TaskState,
} from './types.js';

const DEFAULT_COLLAPSED = '(+)';

const ID_PREFIXED = /^<id:([A-Za-z0-9][A-Za-z0-9_-]*)>\s*/;
const KIND_SPAN =
  /^<(?:kind:)?(doc|ticket|globe|db|feature|form|bug|risk|lock|encrypted|system-link|pending-approve)>\s*/i;
const FLAG_SPAN =
  /^<(private|encrypted|db)(?::([^\s>]+))?>\s*/i;
/** `<enc:kid=…;alg=…;ct=…>` — body may not contain `>`. */
const ENC_SPAN = /^<enc:([^>]+)>\s*/i;

const ID_TRAILING = /\s*<id:([A-Za-z0-9][A-Za-z0-9_-]*)>\s*$/;
const KIND_TRAILING =
  /\s*<(?:kind:)?(doc|ticket|globe|db|feature|form|bug|risk|lock|encrypted|system-link|pending-approve)>\s*$/i;
const FLAG_TRAILING =
  /\s*<(private|encrypted|db)(?::([^\s>]+))?>\s*$/i;
const ENC_TRAILING = /\s*<enc:([^>]+)>\s*$/i;
/** `<action:https://…>` or `<action:event:…>` — body must not contain `>`. */
const ACTION_SPAN = /^<action:([^>]+)>\s*/i;
const ACTION_TRAILING = /\s*<action:([^>]+)>\s*$/i;
/** `<thread:pnid:…>` or `<thread:/path>` */
const THREAD_SPAN = /^<thread:([^>]+)>\s*/i;
const THREAD_TRAILING = /\s*<thread:([^>]+)>\s*$/i;
/** Audroam result-row note link: `<t: 101>` or `<t:101>`. Digits only. */
const NOTE_LINK_SPAN = /^<t:\s*(\d+)\s*>\s*/i;
const NOTE_LINK_TRAILING = /\s*<t:\s*(\d+)\s*>\s*$/i;
const NOTE_LINK_ANY = /<t:\s*(\d+)\s*>/gi;
/** Short `<design>` form — excluded reserved flag/kind/enc words. */
const RESERVED_SHORT = new Set([
  'private',
  'encrypted',
  'db',
  'doc',
  'ticket',
  'globe',
  'feature',
  'form',
  'bug',
  'risk',
  'lock',
  'encrypted',
  'system-link',
  'kind',
  'id',
  'enc',
  't',
  'action',
  'thread',
  'task',
]);

function parseFrontmatter(text: string): {
  fm: OutlineFrontmatter;
  body: string;
} {
  const fm: OutlineFrontmatter = {};
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm, body: text };

  const block = m[1];
  const body = text.slice(m[0].length);

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const foldMinus = line.match(/^fold-\s*:\s*(.*)$/i);
    if (foldMinus) {
      if (fm.foldMode === '+') {
        throw new Error('Document cannot have both fold- and fold+');
      }
      fm.foldMode = '-';
      fm.foldIds = splitIds(foldMinus[1]);
      continue;
    }
    const foldPlus = line.match(/^fold\+\s*:\s*(.*)$/i);
    if (foldPlus) {
      if (fm.foldMode === '-') {
        throw new Error('Document cannot have both fold- and fold+');
      }
      fm.foldMode = '+';
      fm.foldIds = splitIds(foldPlus[1]);
      continue;
    }
    const cm = line.match(/^collapsedMarker\s*:\s*(.+)$/i);
    if (cm) {
      fm.collapsedMarker = unquote(cm[1].trim());
      continue;
    }
    const em = line.match(/^expandedMarker\s*:\s*(.+)$/i);
    if (em) {
      fm.expandedMarker = unquote(em[1].trim());
      continue;
    }
    const fontSize = line.match(/^fontSize\s*:\s*(\d+(?:\.\d+)?)\s*$/i);
    if (fontSize) {
      fm.fontSize = Number(fontSize[1]);
      continue;
    }
    const noteUri = line.match(/^noteUri\s*:\s*(.+)$/i);
    if (noteUri) {
      const raw = noteUri[1].trim();
      const value =
        (raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'"))
          ? raw.slice(1, -1)
          : raw;
      if (value) fm.noteUri = value;
    }
  }

  return { fm, body };
}

function splitIds(s: string): string[] {
  return s
    .split(/[, ]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function unquote(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function indentWidth(line: string): number {
  let i = 0;
  let w = 0;
  while (i < line.length) {
    if (line[i] === ' ') {
      w += 1;
      i++;
    } else if (line[i] === '\t') {
      w += 2;
      i++;
    } else break;
  }
  return w;
}

function stripListMarker(rest: string): string {
  return rest.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '');
}

function tryShortId(rest: string): { id: string; rest: string } | null {
  const m = rest.match(/^<([A-Za-z][A-Za-z0-9_-]*)>\s*/);
  if (!m) return null;
  if (RESERVED_SHORT.has(m[1].toLowerCase())) return null;
  return { id: m[1], rest: rest.slice(m[0].length) };
}

function tryShortIdTrailing(rest: string): { id: string; rest: string } | null {
  const m = rest.match(/\s*<([A-Za-z][A-Za-z0-9_-]*)>\s*$/);
  if (!m) return null;
  if (RESERVED_SHORT.has(m[1].toLowerCase())) return null;
  return { id: m[1], rest: rest.slice(0, rest.length - m[0].length).trimEnd() };
}

/**
 * Peel leading meta spans (backward compatible), then strip fold marker from
 * the end, then peel trailing meta spans so `(+)` stays outermost.
 * Trailing id overrides a leading id when both are present.
 * Grammar v0.2: caption-first trailing tags; `<enc:…>` → `node.sealed`.
 */
function parseTitleAndMeta(
  content: string,
  collapsedMarker: string,
  expandedMarker?: string,
): {
  id?: string;
  title: string;
  kind?: NodeKind;
  flags?: NodeFlag[];
  dbRef?: string;
  sealed?: SealedPayload;
  inlineCollapsed?: boolean;
  task?: TaskState;
  action?: string;
  thread?: string;
  noteLinks?: string[];
} {
  let rest = content.trim();
  let id: string | undefined;
  let kind: NodeKind | undefined;
  const flags: NodeFlag[] = [];
  let dbRef: string | undefined;
  let sealed: SealedPayload | undefined;
  let task: TaskState | undefined;
  let action: string | undefined;
  let thread: string | undefined;
  const leadingNotes: string[] = [];
  const trailingNotes: string[] = [];
  const midNotes: string[] = [];
  const remember = (into: string[], rawId: string) => {
    const id = rawId.trim();
    if (id && !into.includes(id)) into.push(id);
  };

  // Leading task marker only (mid-caption `[ ]` / `☐` stay plain text).
  {
    const leading = parseLeadingTask(rest);
    if (leading) {
      task = leading.state;
      rest = leading.label;
    }
  }

  // Prefer flags/kinds/enc before short ids so `<private>` is never an id.
  let progressed = true;
  while (progressed) {
    progressed = false;

    let m = rest.match(FLAG_SPAN);
    if (m) {
      const flag = m[1].toLowerCase() as NodeFlag;
      flags.push(flag);
      if (flag === 'db' && m[2]) dbRef = m[2];
      rest = rest.slice(m[0].length);
      progressed = true;
      continue;
    }

    m = rest.match(ENC_SPAN);
    if (m) {
      const parsed = parseEncBody(m[1]);
      if (parsed) sealed = parsed;
      rest = rest.slice(m[0].length);
      progressed = true;
      continue;
    }

    m = rest.match(ACTION_SPAN);
    if (m) {
      action = m[1].trim();
      rest = rest.slice(m[0].length);
      progressed = true;
      continue;
    }

    m = rest.match(THREAD_SPAN);
    if (m) {
      thread = m[1].trim();
      rest = rest.slice(m[0].length);
      progressed = true;
      continue;
    }

    m = rest.match(NOTE_LINK_SPAN);
    if (m) {
      remember(leadingNotes, m[1]);
      rest = rest.slice(m[0].length);
      progressed = true;
      continue;
    }

    m = rest.match(KIND_SPAN);
    if (m) {
      kind = m[1].toLowerCase() as NodeKind;
      rest = rest.slice(m[0].length);
      progressed = true;
      continue;
    }

    m = rest.match(ID_PREFIXED);
    if (m) {
      id = m[1];
      rest = rest.slice(m[0].length);
      progressed = true;
      continue;
    }

    const short = tryShortId(rest);
    if (short) {
      id = short.id;
      rest = short.rest;
      progressed = true;
      continue;
    }
  }

  // A character typed after the closing tag or fold marker (`<id:n>3`,
  // `(+)3`) must not hide the token. Peel that plain suffix, parse the
  // tokens, then put the suffix back on the caption.
  let typedSuffix = '';
  {
    const markers = [collapsedMarker, expandedMarker].filter(
      (m): m is string => !!m,
    );
    const endsWithMarker = markers.some((m) => rest.endsWith(m));
    if (!endsWithMarker && !rest.endsWith('>')) {
      let i = rest.length;
      while (i > 0) {
        const marker = markers.find(
          (m) => i >= m.length && rest.slice(i - m.length, i) === m,
        );
        if (marker || rest[i - 1] === '>' || rest[i - 1] === '\n') break;
        i--;
      }
      if (i > 0 && i < rest.length) {
        const core = rest.slice(0, i).trimEnd();
        const suffix = rest.slice(i).trim();
        const tokenEnd =
          /<[^>\n]+>$/.test(core) || markers.some((m) => core.endsWith(m));
        if (suffix && tokenEnd) {
          rest = core;
          typedSuffix = suffix;
        }
      }
    }
  }

  let inlineCollapsed = false;
  if (collapsedMarker && rest.endsWith(collapsedMarker)) {
    inlineCollapsed = true;
    rest = rest.slice(0, -collapsedMarker.length).trimEnd();
  } else if (expandedMarker && rest.endsWith(expandedMarker)) {
    rest = rest.slice(0, -expandedMarker.length).trimEnd();
  }

  // Caption-first: peel trailing <id:…> / enc / short id / kind / flag from title end.
  progressed = true;
  while (progressed) {
    progressed = false;

    let m = rest.match(FLAG_TRAILING);
    if (m) {
      const flag = m[1].toLowerCase() as NodeFlag;
      flags.push(flag);
      if (flag === 'db' && m[2]) dbRef = m[2];
      rest = rest.slice(0, rest.length - m[0].length).trimEnd();
      progressed = true;
      continue;
    }

    m = rest.match(ENC_TRAILING);
    if (m) {
      const parsed = parseEncBody(m[1]);
      if (parsed) sealed = parsed;
      rest = rest.slice(0, rest.length - m[0].length).trimEnd();
      progressed = true;
      continue;
    }

    m = rest.match(ACTION_TRAILING);
    if (m) {
      action = m[1].trim();
      rest = rest.slice(0, rest.length - m[0].length).trimEnd();
      progressed = true;
      continue;
    }

    m = rest.match(THREAD_TRAILING);
    if (m) {
      thread = m[1].trim();
      rest = rest.slice(0, rest.length - m[0].length).trimEnd();
      progressed = true;
      continue;
    }

    m = rest.match(NOTE_LINK_TRAILING);
    if (m) {
      remember(trailingNotes, m[1]);
      rest = rest.slice(0, rest.length - m[0].length).trimEnd();
      progressed = true;
      continue;
    }

    m = rest.match(KIND_TRAILING);
    if (m) {
      kind = m[1].toLowerCase() as NodeKind;
      rest = rest.slice(0, rest.length - m[0].length).trimEnd();
      progressed = true;
      continue;
    }

    m = rest.match(ID_TRAILING);
    if (m) {
      id = m[1]; // trailing overrides leading
      rest = rest.slice(0, rest.length - m[0].length).trimEnd();
      progressed = true;
      continue;
    }

    const short = tryShortIdTrailing(rest);
    if (short) {
      id = short.id; // trailing overrides leading
      rest = short.rest;
      progressed = true;
      continue;
    }
  }

  // Mid-caption `<t: N>` (result-row allows the tag anywhere).
  rest = rest
    .replace(NOTE_LINK_ANY, (_all, id: string) => {
      remember(midNotes, id);
      return ' ';
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  if (typedSuffix) rest = `${rest} ${typedSuffix}`.trim();
  const noteLinks: string[] = [];
  for (const id of [...leadingNotes, ...midNotes, ...trailingNotes.reverse()]) {
    if (!noteLinks.includes(id)) noteLinks.push(id);
  }

  // `<enc:>` without private/encrypted implies encrypted chrome.
  if (
    sealed &&
    !flags.includes('private') &&
    !flags.includes('encrypted')
  ) {
    flags.push('encrypted');
  }

  return {
    id,
    title: rest,
    kind,
    flags: flags.length ? flags : undefined,
    dbRef,
    sealed,
    inlineCollapsed,
    task,
    action,
    thread,
    noteLinks: noteLinks.length ? noteLinks : undefined,
  };
}

/**
 * Parse indented markdown-ish outline (2 spaces or 1 tab ≈ one depth unit;
 * optional leading `- ` / `* ` / `1. `).
 */
export function parse(text: string): OutlineFoldDoc {
  const head = parseFrontmatter(text);
  const peeled = peelTrailingSections(head.body);
  const fm = mergeFrontmatter(head.fm, peeled.trailingFm);
  const body = peeled.outline;
  const collapsedMarker = fm.collapsedMarker ?? DEFAULT_COLLAPSED;
  const expandedMarker = fm.expandedMarker;

  const lines = body.split(/\r?\n/);
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  const indentToDepth: number[] = [];
  const inlineCollapsedIds: string[] = [];

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const w = indentWidth(raw);
    const trimmedStart = raw.trimStart();
    const content = stripListMarker(trimmedStart);
    if (!content.trim()) continue;

    let depth = 0;
    if (indentToDepth.length === 0) {
      indentToDepth.push(w);
      depth = 0;
    } else {
      while (
        indentToDepth.length &&
        w < indentToDepth[indentToDepth.length - 1]
      ) {
        indentToDepth.pop();
      }
      if (w > indentToDepth[indentToDepth.length - 1]) {
        indentToDepth.push(w);
      }
      depth = indentToDepth.length - 1;
    }

    const meta = parseTitleAndMeta(content, collapsedMarker, expandedMarker);
    const node: OutlineNode = {
      title: meta.title,
      depth,
    };
    if (meta.id) node.id = meta.id;
    if (meta.kind) node.kind = meta.kind;
    if (meta.flags) node.flags = meta.flags;
    if (meta.dbRef) node.dbRef = meta.dbRef;
    if (meta.sealed) node.sealed = meta.sealed;
    if (meta.task) node.task = meta.task;
    if (meta.action) node.action = meta.action;
    if (meta.thread) node.thread = meta.thread;
    if (meta.noteLinks) node.noteLinks = meta.noteLinks;
    if (meta.inlineCollapsed && meta.id) {
      inlineCollapsedIds.push(meta.id);
    }

    while (stack.length && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      const parent = stack[stack.length - 1];
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    }
    stack.push(node);
  }

  const mode: FoldMode = fm.foldMode ?? '-';
  let ids = [...(fm.foldIds ?? [])];

  if (mode === '-') {
    for (const id of inlineCollapsedIds) {
      if (!ids.includes(id)) ids.push(id);
    }
  }

  const frontmatter: OutlineFrontmatter = { ...fm };
  if (!frontmatter.collapsedMarker) {
    frontmatter.collapsedMarker = collapsedMarker;
  }
  frontmatter.foldMode = mode;
  frontmatter.foldIds = ids;

  // Trailer payloads attach by id (overwrite any inline <enc:>).
  attachPayloads(roots, peeled.payloads);
  // Layout keys are ids, or a 1-based position when the line has no id.
  attachLayouts(roots, peeled.layouts);

  return {
    frontmatter,
    nodes: roots,
    fold: { mode, ids: [...ids] },
  };
}
