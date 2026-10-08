import {
  attachLayouts,
  attachPayloads,
  mergeFrontmatter,
  peelTrailingSections,
} from './payloads.js';
import { collectNodeIds, nextAutoId } from './nodeAddress.js';
import { parseEncBody } from './sealed.js';
import { parseLeadingTask } from './taskChrome.js';
import { canonTag } from './tagSpelling.js';
import { markdownLinkSpans, parseHopTarget, parseNoteTarget } from './captionRich.js';
import type {
  NodeLink,
  FoldMode,
  NodeFlag,
  NodeKind,
  OutlineFoldDoc,
  OutlineFrontmatter,
  OutlineNode,
  SealedPayload,
  TagSpellings,
  TaskState,
} from './types.js';

const DEFAULT_COLLAPSED = '(+)';

/**
 * Tags are lenient on read: optional whitespace around the colon and just inside the
 * brackets (`<id : craft-lab>`, `< t: 41609 >`, `<action: https://… >`). Serialize
 * writes `<name:value>` and keeps a spaced spelling as written while it still names the
 * same value (`tagSpellings`, `noteLinkTags`). Bare words (`<doc>`, `<private>`) stay
 * exact: `< doc >` is caption text.
 */
const KIND_WORDS =
  'doc|ticket|globe|db|feature|form|bug|risk|lock|encrypted|system-link|pending-approve';
/** `<name : value >`: value has no `>`, and its own edge spaces are not part of it. */
const tagRe = (name: string, value: string, flags = 'i') =>
  ({
    span: new RegExp(`^<\\s*${name}\\s*:\\s*(${value})\\s*>\\s*`, flags),
    trailing: new RegExp(`\\s*<\\s*${name}\\s*:\\s*(${value})\\s*>\\s*$`, flags),
  });
const ID_VALUE = '[A-Za-z0-9][A-Za-z0-9_-]*';
/** Free value (enc / action / thread): inner spaces allowed, edge spaces trimmed. */
const FREE_VALUE = '[^>]*?[^\\s>]';

const ID_RE = tagRe('id', ID_VALUE, '');
const ID_PREFIXED = ID_RE.span;
const KIND_SPAN = new RegExp(
  `^<(?:\\s*kind\\s*:\\s*(${KIND_WORDS})\\s*|(${KIND_WORDS}))>\\s*`,
  'i',
);
const FLAG_SPAN = /^<(?:(private|encrypted|db)|\s*(db)\s*:\s*([^\s>]+)\s*)>\s*/i;
/** `<enc:kid=…;alg=…;ct=…>` — body may not contain `>`. */
const ENC_RE = tagRe('enc', FREE_VALUE);
const ENC_SPAN = ENC_RE.span;

const ID_TRAILING = ID_RE.trailing;
const KIND_TRAILING = new RegExp(
  `\\s*<(?:\\s*kind\\s*:\\s*(${KIND_WORDS})\\s*|(${KIND_WORDS}))>\\s*$`,
  'i',
);
const FLAG_TRAILING = /\s*<(?:(private|encrypted|db)|\s*(db)\s*:\s*([^\s>]+)\s*)>\s*$/i;
const ENC_TRAILING = ENC_RE.trailing;
/** `<action:https://…>` or `<action:event:…>` — body must not contain `>`. */
const ACTION_RE = tagRe('action', FREE_VALUE);
const ACTION_SPAN = ACTION_RE.span;
const ACTION_TRAILING = ACTION_RE.trailing;
/** `<thread:pnid:…>` or `<thread:/path>` */
const THREAD_RE = tagRe('thread', FREE_VALUE);
const THREAD_SPAN = THREAD_RE.span;
const THREAD_TRAILING = THREAD_RE.trailing;
/** Audroam result-row note link: `<t:101>`, also `<t: 101>`, `< t : 101 >`. Digits only. */
const NOTE_LINK_RE = tagRe('t', '\\d+');
const NOTE_LINK_SPAN = NOTE_LINK_RE.span;
const NOTE_LINK_TRAILING = NOTE_LINK_RE.trailing;
/** How serialize writes a note link when the text gave no spelling. */
const NOTE_LINK_DEFAULT = (id: string) => `<t:${id}>`;
/**
 * Jump to a node in this map: `<r:craft-lab>`, also `<r: craft-lab>`, `< r : craft-lab >`.
 * Same id characters as `<id:>`. Read anywhere on the line, like `<t:N>`.
 */
const JUMP_RE = tagRe('r', ID_VALUE);
const JUMP_SPAN = JUMP_RE.span;
const JUMP_TRAILING = JUMP_RE.trailing;
/** Mid-caption `<t:N>` or `<r:x>`, in source order. */
const LINK_ANY = new RegExp(`<\\s*(?:t\\s*:\\s*(\\d+)|r\\s*:\\s*(${ID_VALUE}))\\s*>`, 'gi');

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

/**
 * Inline code (`…`) is literal: no tag, id, note link or fold marker inside it
 * is read. Each span is swapped for a private-use placeholder (no `<`, `>`, or
 * spaces) while the meta spans are peeled, then put back on the caption.
 */
const CODE_SPAN = /`[^`\n]+`/g;
const CODE_MARK = /\uE000(\d+)\uE001/g;

function maskCodeSpans(text: string): { text: string; spans: string[] } {
  const spans: string[] = [];
  const masked = text.replace(CODE_SPAN, (span) => {
    spans.push(span);
    return `\uE000${spans.length - 1}\uE001`;
  });
  return { text: masked, spans };
}

function unmaskCodeSpans(text: string, spans: string[]): string {
  if (!spans.length) return text;
  return text.replace(CODE_MARK, (all, i: string) => spans[Number(i)] ?? all);
}

/** True when `core` ends with a tag this grammar reads (not any `<word>`). */
function endsWithKnownTag(core: string): boolean {
  return (
    FLAG_TRAILING.test(core) ||
    ENC_TRAILING.test(core) ||
    ACTION_TRAILING.test(core) ||
    THREAD_TRAILING.test(core) ||
    NOTE_LINK_TRAILING.test(core) ||
    JUMP_TRAILING.test(core) ||
    KIND_TRAILING.test(core) ||
    ID_TRAILING.test(core)
  );
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
  inlineExpanded?: boolean;
  task?: TaskState;
  action?: string;
  thread?: string;
  noteLinks?: string[];
  noteLinkTags?: Record<string, string>;
  links?: NodeLink[];
  tagSpellings?: TagSpellings;
} {
  const masked = maskCodeSpans(content.trim());
  let rest = masked.text;
  let id: string | undefined;
  let kind: NodeKind | undefined;
  const flags: NodeFlag[] = [];
  let dbRef: string | undefined;
  let sealed: SealedPayload | undefined;
  let task: TaskState | undefined;
  let action: string | undefined;
  let thread: string | undefined;
  // A colon tag as written, when it is not `<name:value>` (`<id : x>`). Last one read wins,
  // like the value it spells (trailing overrides leading).
  const spelling: TagSpellings = {};
  const spell = (key: keyof TagSpellings, token: string) => {
    spelling[key] = token.trim();
  };
  // `<t:N>` and `<r:x>` as written (`<t: 5>`, `<R:x >`), in source order per list.
  // Serialize writes each spelling back so the body round-trips.
  type TagLink = { kind: 'note' | 'jump'; target: string; source: string };
  const leadingTags: TagLink[] = [];
  const midTags: TagLink[] = [];
  const trailingTags: TagLink[] = [];
  const remember = (into: TagLink[], kind: TagLink['kind'], raw: string, token: string) => {
    const target = raw.trim();
    if (target) into.push({ kind, target, source: token.trim() });
  };

  // Leading task marker only (mid-caption `[ ]` / `☐` stay plain text).
  {
    const leading = parseLeadingTask(rest);
    if (leading) {
      task = leading.state;
      rest = leading.label;
    }
  }

  // Only the known tags are peeled. A bare `<word>` (`<script>`, `<br>`) is caption text.
  let progressed = true;
  while (progressed) {
    progressed = false;

    let m = rest.match(FLAG_SPAN);
    if (m) {
      const flag = (m[1] ?? m[2]).toLowerCase() as NodeFlag;
      flags.push(flag);
      if (flag === 'db' && m[3]) {
        dbRef = m[3];
        spell('db', m[0]);
      }
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
      spell('action', m[0]);
      rest = rest.slice(m[0].length);
      progressed = true;
      continue;
    }

    m = rest.match(THREAD_SPAN);
    if (m) {
      thread = m[1].trim();
      spell('thread', m[0]);
      rest = rest.slice(m[0].length);
      progressed = true;
      continue;
    }

    m = rest.match(NOTE_LINK_SPAN);
    if (m) {
      remember(leadingTags, 'note', m[1], m[0]);
      rest = rest.slice(m[0].length);
      progressed = true;
      continue;
    }

    m = rest.match(JUMP_SPAN);
    if (m) {
      remember(leadingTags, 'jump', m[1], m[0]);
      rest = rest.slice(m[0].length);
      progressed = true;
      continue;
    }

    m = rest.match(KIND_SPAN);
    if (m) {
      kind = (m[1] ?? m[2]).toLowerCase() as NodeKind;
      if (m[1]) spell('kind', m[0]);
      else delete spelling.kind;
      rest = rest.slice(m[0].length);
      progressed = true;
      continue;
    }

    m = rest.match(ID_PREFIXED);
    if (m) {
      id = m[1];
      spell('id', m[0]);
      rest = rest.slice(m[0].length);
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
        // Only a tag this grammar reads (or a fold marker) counts: `the <script> tag`
        // is a sentence, not `<script>` plus a typed suffix.
        const tokenEnd =
          endsWithKnownTag(core) || markers.some((m) => core.endsWith(m));
        if (suffix && tokenEnd) {
          rest = core;
          typedSuffix = suffix;
        }
      }
    }
  }

  let inlineCollapsed = false;
  let inlineExpanded = false;
  if (collapsedMarker && rest.endsWith(collapsedMarker)) {
    inlineCollapsed = true;
    rest = rest.slice(0, -collapsedMarker.length).trimEnd();
  } else if (expandedMarker && rest.endsWith(expandedMarker)) {
    inlineExpanded = true;
    rest = rest.slice(0, -expandedMarker.length).trimEnd();
  }

  // Caption-first: peel trailing <id:…> / enc / kind / flag from title end.
  progressed = true;
  while (progressed) {
    progressed = false;

    let m = rest.match(FLAG_TRAILING);
    if (m) {
      const flag = (m[1] ?? m[2]).toLowerCase() as NodeFlag;
      flags.push(flag);
      if (flag === 'db' && m[3]) {
        dbRef = m[3];
        spell('db', m[0]);
      }
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
      spell('action', m[0]);
      rest = rest.slice(0, rest.length - m[0].length).trimEnd();
      progressed = true;
      continue;
    }

    m = rest.match(THREAD_TRAILING);
    if (m) {
      thread = m[1].trim();
      spell('thread', m[0]);
      rest = rest.slice(0, rest.length - m[0].length).trimEnd();
      progressed = true;
      continue;
    }

    m = rest.match(NOTE_LINK_TRAILING);
    if (m) {
      remember(trailingTags, 'note', m[1], m[0]);
      rest = rest.slice(0, rest.length - m[0].length).trimEnd();
      progressed = true;
      continue;
    }

    m = rest.match(JUMP_TRAILING);
    if (m) {
      remember(trailingTags, 'jump', m[1], m[0]);
      rest = rest.slice(0, rest.length - m[0].length).trimEnd();
      progressed = true;
      continue;
    }

    m = rest.match(KIND_TRAILING);
    if (m) {
      kind = (m[1] ?? m[2]).toLowerCase() as NodeKind;
      if (m[1]) spell('kind', m[0]);
      else delete spelling.kind;
      rest = rest.slice(0, rest.length - m[0].length).trimEnd();
      progressed = true;
      continue;
    }

    m = rest.match(ID_TRAILING);
    if (m) {
      id = m[1]; // trailing overrides leading
      spell('id', m[0]);
      rest = rest.slice(0, rest.length - m[0].length).trimEnd();
      progressed = true;
      continue;
    }
  }

  // Mid-caption `<t: N>` / `<r:x>` (result-row allows the tag anywhere).
  rest = rest
    .replace(LINK_ANY, (all: string, pnid: string | undefined, jump: string | undefined) => {
      if (pnid) remember(midTags, 'note', pnid, all);
      else if (jump) remember(midTags, 'jump', jump, all);
      return ' ';
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  if (typedSuffix) rest = `${rest} ${typedSuffix}`.trim();
  rest = unmaskCodeSpans(rest, masked.spans);
  if (action) action = unmaskCodeSpans(action, masked.spans);
  if (thread) thread = unmaskCodeSpans(thread, masked.spans);
  if (dbRef) dbRef = unmaskCodeSpans(dbRef, masked.spans);
  // Trailing tags peel from the end: reverse them back into source order.
  trailingTags.reverse();
  const noteLinks: string[] = [];
  const noteLinkTags: Record<string, string> = {};
  const links: NodeLink[] = [];
  const seenJump = new Set<string>();
  for (const t of [...leadingTags, ...midTags, ...trailingTags]) {
    if (t.kind === 'note') {
      // One link per note: the first one, as written.
      if (noteLinks.includes(t.target)) continue;
      noteLinks.push(t.target);
      if (t.source !== NOTE_LINK_DEFAULT(t.target)) noteLinkTags[t.target] = t.source;
    } else {
      if (seenJump.has(t.target)) continue;
      seenJump.add(t.target);
    }
    links.push({ kind: t.kind, target: t.target, form: 'tag', source: t.source });
  }
  // Markdown links stay in the caption; they are listed after the tags.
  for (const md of markdownLinkSpans(rest)) {
    const note = parseNoteTarget(md.url);
    const hop = note === null ? parseHopTarget(md.url) : null;
    if (note !== null) links.push({ kind: 'note', target: note, form: 'markdown', source: md.source, label: md.label });
    else if (hop !== null) links.push({ kind: 'jump', target: hop, form: 'markdown', source: md.source, label: md.label });
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
    inlineExpanded,
    task,
    action,
    thread,
    noteLinks: noteLinks.length ? noteLinks : undefined,
    noteLinkTags: Object.keys(noteLinkTags).length ? noteLinkTags : undefined,
    links: links.length ? links : undefined,
    tagSpellings: keptSpellings(spelling, { id, kind, action, thread, db: dbRef }),
  };
}

/** Every jump target (`<r:x>`, `[label](#id:x)`) on these lines. */
function collectJumpTargets(nodes: OutlineNode[], out = new Set<string>()): Set<string> {
  for (const n of nodes) {
    for (const l of n.links ?? []) if (l.kind === 'jump') out.add(l.target);
    if (n.children?.length) collectJumpTargets(n.children, out);
  }
  return out;
}

/** Only spellings that differ from what serialize would write, and still name the value. */
function keptSpellings(
  spelling: TagSpellings,
  values: Partial<Record<keyof TagSpellings, string | undefined>>,
): TagSpellings | undefined {
  const out: TagSpellings = {};
  for (const key of Object.keys(spelling) as (keyof TagSpellings)[]) {
    const value = values[key];
    const token = spelling[key];
    if (!value || !token) continue;
    const plain = `<${key}:${value}>`;
    if (token !== plain && canonTag(token) === plain) out[key] = token;
  }
  return Object.keys(out).length ? out : undefined;
}

export interface ParseOptions {
  /**
   * Give every line without `<id:…>` a session id (`autoId: true`) from
   * `nextAutoId`, which skips ids on lines and keys in the payloads and layout
   * blocks. A `(+)` on such a line folds it. Serialize does not write session ids.
   */
  sessionIds?: boolean | { prefix?: string };
}

/**
 * Parse indented markdown-ish outline (2 spaces or 1 tab ≈ one depth unit;
 * optional leading `- ` / `* ` / `1. `).
 */
export function parse(text: string, opts?: ParseOptions): OutlineFoldDoc {
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
  const inlineCollapsedBare: OutlineNode[] = [];

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
    if (meta.noteLinkTags) node.noteLinkTags = meta.noteLinkTags;
    if (meta.links) node.links = meta.links;
    if (meta.tagSpellings) node.tagSpellings = meta.tagSpellings;
    if (meta.inlineCollapsed && meta.id) {
      inlineCollapsedIds.push(meta.id);
    } else if (meta.inlineCollapsed) {
      inlineCollapsedBare.push(node);
    }
    if (!meta.id && (meta.inlineCollapsed || meta.inlineExpanded)) {
      // Dropped again below if session ids give the node an id.
      node.foldMark = meta.inlineCollapsed ? 'collapsed' : 'expanded';
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

  // Trailer payloads attach by id (overwrite any inline <enc:>).
  attachPayloads(roots, peeled.payloads);
  // Layout keys are ids, or a 1-based position when the line has no id.
  attachLayouts(roots, peeled.layouts);

  if (opts?.sessionIds) {
    const prefix = typeof opts.sessionIds === 'object' ? opts.sessionIds.prefix ?? '' : '';
    const used = collectNodeIds(roots);
    for (const id of Object.keys(peeled.payloads)) used.add(id);
    for (const id of Object.keys(peeled.layouts)) used.add(id);
    // A jump names an id: a session id must never take it, or the jump would
    // land on an unrelated line.
    for (const id of collectJumpTargets(roots)) used.add(id);
    const walk = (list: OutlineNode[]) => {
      for (const n of list) {
        if (!n.id) {
          n.id = nextAutoId(used, prefix);
          n.autoId = true;
          // The session id carries the fold state from here (doc.fold).
          delete n.foldMark;
        }
        if (n.children?.length) walk(n.children);
      }
    };
    walk(roots);
    for (const n of inlineCollapsedBare) inlineCollapsedIds.push(n.id!);
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

  return {
    frontmatter,
    nodes: roots,
    fold: { mode, ids: [...ids] },
  };
}
