import type {
  FoldMode,
  NodeFlag,
  NodeKind,
  OutlineFoldDoc,
  OutlineFrontmatter,
  OutlineNode,
} from './types.js';

const DEFAULT_COLLAPSED = '(+)';

const ID_PREFIXED = /^<id:([A-Za-z][A-Za-z0-9_-]*)>\s*/;
const KIND_SPAN =
  /^<(?:kind:)?(doc|ticket|globe|db|feature|form|bug|risk|lock|encrypted|system-link|pending-approve)>\s*/i;
const FLAG_SPAN =
  /^<(private|encrypted|db)(?::([^\s>]+))?>\s*/i;

const ID_TRAILING = /\s*<id:([A-Za-z][A-Za-z0-9_-]*)>\s*$/;
const KIND_TRAILING =
  /\s*<(?:kind:)?(doc|ticket|globe|db|feature|form|bug|risk|lock|encrypted|system-link|pending-approve)>\s*$/i;
const FLAG_TRAILING =
  /\s*<(private|encrypted|db)(?::([^\s>]+))?>\s*$/i;

/** Short `<design>` form — excluded reserved flag/kind words. */
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
  't',
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
  inlineCollapsed?: boolean;
} {
  let rest = content.trim();
  let id: string | undefined;
  let kind: NodeKind | undefined;
  const flags: NodeFlag[] = [];
  let dbRef: string | undefined;

  // Prefer flags/kinds before short ids so `<private>` is never an id.
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

  let inlineCollapsed = false;
  if (collapsedMarker && rest.endsWith(collapsedMarker)) {
    inlineCollapsed = true;
    rest = rest.slice(0, -collapsedMarker.length).trimEnd();
  } else if (expandedMarker && rest.endsWith(expandedMarker)) {
    rest = rest.slice(0, -expandedMarker.length).trimEnd();
  }

  // Caption-first: peel trailing <id:…> / short id / kind / flag from title end.
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

  return {
    id,
    title: rest,
    kind,
    flags: flags.length ? flags : undefined,
    dbRef,
    inlineCollapsed,
  };
}

/**
 * Parse indented markdown-ish outline (2 spaces or 1 tab ≈ one depth unit;
 * optional leading `- ` / `* ` / `1. `).
 */
export function parse(text: string): OutlineFoldDoc {
  const { fm, body } = parseFrontmatter(text);
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

  return {
    frontmatter,
    nodes: roots,
    fold: { mode, ids: [...ids] },
  };
}
