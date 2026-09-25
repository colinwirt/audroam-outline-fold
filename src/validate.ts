import { parse } from './parse.js';
import { parseEncBody } from './sealed.js';
import type { OutlineFoldDoc, OutlineNode } from './types.js';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: ValidationSeverity;
  /** Stable machine code (snake_case). */
  code: string;
  message: string;
  /** 1-based line when known. */
  line?: number;
  nodeId?: string;
  /** Optional path e.g. `payloads.bank`. */
  path?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** Parsed doc when parse succeeded; omit when fatal parse failure. */
  doc?: OutlineFoldDoc;
}

export interface ValidateOptions {
  /**
   * When true (default), sealed entries without kid are errors unless
   * `singleKeyFallback` is true.
   */
  requireKid?: boolean;
  /**
   * Single-key unlock context: missing kid → warning
   * `payload_kid_omitted_single_key` when all sealed omit kid consistently.
   * Default false (strict).
   */
  singleKeyFallback?: boolean;
  /**
   * Assume shared alg when missing if `singleKeyFallback`.
   * Default true when `singleKeyFallback`.
   */
  assumeSharedAlg?: boolean;
}

/** Lenient trailer field bag (may be incomplete). */
interface RawPayloadEntry {
  id: string;
  kid?: string;
  ct?: string;
  uri?: string;
  alg?: string;
  line?: number;
}

function issue(
  severity: ValidationSeverity,
  code: string,
  message: string,
  extra?: Partial<ValidationIssue>,
): ValidationIssue {
  return { severity, code, message, ...extra };
}

function walkNodes(
  nodes: OutlineNode[],
  visit: (n: OutlineNode) => void,
): void {
  for (const n of nodes) {
    visit(n);
    if (n.children) walkNodes(n.children, visit);
  }
}

function collectNodeIds(nodes: OutlineNode[]): Map<string, OutlineNode[]> {
  const map = new Map<string, OutlineNode[]>();
  walkNodes(nodes, (n) => {
    if (!n.id) return;
    const list = map.get(n.id) ?? [];
    list.push(n);
    map.set(n.id, list);
  });
  return map;
}

/**
 * Parse trailer payload map without dropping incomplete entries
 * (missing kid, neither/both ct|uri).
 */
export function parsePayloadEntriesRaw(
  block: string,
  lineOffset = 1,
): RawPayloadEntry[] {
  const out: RawPayloadEntry[] = [];
  let current: string | null = null;
  let currentLine: number | undefined;
  const fields: Record<string, string> = {};
  const lines = block.split(/\r?\n/);

  const flush = () => {
    if (!current) return;
    const entry: RawPayloadEntry = { id: current, line: currentLine };
    if (fields.kid) entry.kid = fields.kid;
    if (fields.ct) entry.ct = fields.ct;
    if (fields.uri) entry.uri = fields.uri;
    if (fields.alg) entry.alg = fields.alg;
    out.push(entry);
    current = null;
    currentLine = undefined;
    for (const k of Object.keys(fields)) delete fields[k];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineNo = lineOffset + i;
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const top = raw.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*$/);
    if (top) {
      flush();
      current = top[1]!;
      currentLine = lineNo;
      continue;
    }
    const field = raw.match(/^\s+(kid|alg|ct|uri)\s*:\s*(.+)$/i);
    if (field && current) {
      fields[field[1]!.toLowerCase()] = unquote(field[2]!.trim());
      continue;
    }
    const compact = raw.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.+)$/);
    if (compact) {
      flush();
      const body = compact[2]!.trim();
      const sealed = parseEncBody(body);
      const entry: RawPayloadEntry = { id: compact[1]!, line: lineNo };
      if (sealed) {
        if (sealed.kid) entry.kid = sealed.kid;
        if (sealed.ciphertext) entry.ct = sealed.ciphertext;
        if (sealed.uri) entry.uri = sealed.uri;
        if (sealed.alg) entry.alg = sealed.alg;
      } else {
        // Best-effort field scrape for incomplete compact forms.
        for (const part of body.split(';')) {
          const eq = part.indexOf('=');
          if (eq <= 0) continue;
          const key = part.slice(0, eq).trim().toLowerCase();
          const val = part.slice(eq + 1).trim();
          if (key === 'kid') entry.kid = val;
          else if (key === 'ct') entry.ct = val;
          else if (key === 'uri') entry.uri = val;
          else if (key === 'alg') entry.alg = val;
        }
      }
      out.push(entry);
      current = null;
      currentLine = undefined;
    }
  }
  flush();
  return out;
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

/** Locate trailing payload fence body + absolute 1-based start line of body. */
function extractPayloadBlocks(
  source: string,
): { block: string; bodyStartLine: number }[] {
  const blocks: { block: string; bodyStartLine: number }[] = [];
  const re =
    /^---\s*(payloads|sealed|enc)\s*---\r?\n([\s\S]*?)\r?\n---\s*$/gim;
  // Also match mid-document (after outline). Work line-based.
  const lines = source.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const open = lines[i]!.match(/^---\s*(payloads|sealed|enc)\s*---\s*$/i);
    if (!open) {
      i++;
      continue;
    }
    const bodyStart = i + 1;
    let j = bodyStart;
    while (j < lines.length && !/^---\s*$/.test(lines[j]!)) j++;
    if (j < lines.length) {
      const block = lines.slice(bodyStart, j).join('\n');
      blocks.push({ block, bodyStartLine: bodyStart + 1 });
      i = j + 1;
    } else {
      i++;
    }
  }
  void re;
  return blocks;
}

function sealedHasXorCtUri(s: {
  ct?: string;
  uri?: string;
  ciphertext?: string;
}): boolean {
  const hasCt = Boolean(s.ct ?? s.ciphertext);
  const hasUri = Boolean(s.uri);
  return hasCt !== hasUri;
}

function scanIgnoredEncTags(
  source: string,
  issues: ValidationIssue[],
): void {
  const re = /<enc:([^>]*)>/gi;
  let m: RegExpExecArray | null;
  const lines = source.split(/\r?\n/);
  while ((m = re.exec(source)) !== null) {
    const body = m[1]!;
    if (parseEncBody(body)) continue;
    // Softened parse may still accept no-kid; check raw completeness.
    const parts = body.split(';').map((p) => p.trim()).filter(Boolean);
    const map = new Map<string, string>();
    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      map.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim());
    }
    const hasCt = map.has('ct');
    const hasUri = map.has('uri');
    // Only warn when the tag is truly dropped (neither/both of ct|uri, or empty).
    if (hasCt !== hasUri && (map.has('kid') || hasCt || hasUri)) {
      // Would attach under softened parse — not ignored.
      continue;
    }
    const before = source.slice(0, m.index);
    const line = before.split(/\r?\n/).length;
    void lines;
    issues.push(
      issue(
        'warning',
        'enc_tag_ignored',
        `Inline <enc:…> ignored (malformed or incomplete)`,
        { line },
      ),
    );
  }
}

function validateDocTree(
  doc: OutlineFoldDoc,
  issues: ValidationIssue[],
  opts: {
    requireKid: boolean;
    singleKeyFallback: boolean;
    assumeSharedAlg: boolean;
  },
  rawEntries: RawPayloadEntry[],
): void {
  const idMap = collectNodeIds(doc.nodes);

  for (const [id, nodes] of idMap) {
    if (nodes.length > 1) {
      issues.push(
        issue(
          'error',
          'duplicate_node_id',
          `Duplicate outline node id "${id}"`,
          { nodeId: id },
        ),
      );
    }
  }

  const sealedRefs: {
    nodeId?: string;
    path?: string;
    kid?: string;
    alg?: string;
    line?: number;
    hasXor: boolean;
  }[] = [];

  walkNodes(doc.nodes, (n) => {
    if (!n.title.trim()) {
      issues.push(
        issue('warning', 'empty_title', 'Blank caption after strip', {
          nodeId: n.id,
        }),
      );
    }
    if (n.sealed) {
      if (!n.id) {
        issues.push(
          issue(
            'error',
            'payload_node_missing_id',
            'Node has sealed payload but no id (cannot key trailer)',
          ),
        );
      }
      const hasCt = Boolean(n.sealed.ciphertext);
      const hasUri = Boolean(n.sealed.uri);
      if (hasCt === hasUri) {
        issues.push(
          issue(
            'error',
            'payload_missing_ct_uri',
            'Sealed entry needs exactly one of ct or uri',
            { nodeId: n.id, path: n.id ? `payloads.${n.id}` : undefined },
          ),
        );
      }
      sealedRefs.push({
        nodeId: n.id,
        path: n.id ? `payloads.${n.id}` : undefined,
        kid: n.sealed.kid,
        alg: n.sealed.alg,
        hasXor: hasCt !== hasUri,
      });
    }
  });

  const knownIds = new Set(idMap.keys());
  const seenRawIds = new Set<string>();

  for (const entry of rawEntries) {
    seenRawIds.add(entry.id);
    const path = `payloads.${entry.id}`;
    if (!knownIds.has(entry.id)) {
      issues.push(
        issue(
          'warning',
          'payload_orphan',
          `Trailer payload id "${entry.id}" has no matching outline node`,
          { nodeId: entry.id, path, line: entry.line },
        ),
      );
    }
    if (!sealedHasXorCtUri(entry)) {
      // Skip if already reported from attached node.sealed with same id
      const already = issues.some(
        (x) =>
          x.code === 'payload_missing_ct_uri' &&
          (x.nodeId === entry.id || x.path === path),
      );
      if (!already) {
        issues.push(
          issue(
            'error',
            'payload_missing_ct_uri',
            `Sealed entry "${entry.id}" needs exactly one of ct or uri`,
            { nodeId: entry.id, path, line: entry.line },
          ),
        );
      }
    }
    // Include orphan / incomplete raw sealed in kid checks when xor holds
    // and not already represented on a node (attached overwrites).
    const onNode = entry.id && knownIds.has(entry.id);
    if (!onNode && sealedHasXorCtUri(entry)) {
      sealedRefs.push({
        nodeId: entry.id,
        path,
        kid: entry.kid,
        alg: entry.alg,
        line: entry.line,
        hasXor: true,
      });
    }
    // Raw entry with xor that IS on a node but parse dropped it (e.g. no kid
    // before softener) — if node has no sealed, still check.
    if (onNode && sealedHasXorCtUri(entry)) {
      const nodes = idMap.get(entry.id) ?? [];
      if (nodes.some((n) => !n.sealed)) {
        sealedRefs.push({
          nodeId: entry.id,
          path,
          kid: entry.kid,
          alg: entry.alg,
          line: entry.line,
          hasXor: true,
        });
      }
    }
  }
  void seenRawIds;

  // Kid / alg policy across sealed refs with usable ct|uri.
  const usable = sealedRefs.filter((s) => s.hasXor);
  if (usable.length === 0) return;

  const withKid = usable.filter((s) => Boolean(s.kid));
  const withoutKid = usable.filter((s) => !s.kid);
  const mixed = withKid.length > 0 && withoutKid.length > 0;

  if (opts.singleKeyFallback) {
    if (mixed) {
      for (const s of withoutKid) {
        issues.push(
          issue(
            'error',
            'payload_missing_kid',
            'Sealed entry missing kid while others declare kid (inconsistent single-key fallback)',
            { nodeId: s.nodeId, path: s.path, line: s.line },
          ),
        );
      }
    } else if (withoutKid.length > 0) {
      // All omit kid consistently → warning each (or one summary + per-entry).
      for (const s of withoutKid) {
        issues.push(
          issue(
            'warning',
            'payload_kid_omitted_single_key',
            'Sealed entry omits kid under single-key fallback',
            { nodeId: s.nodeId, path: s.path, line: s.line },
          ),
        );
      }
      // Mixed algs across unkeyed sealed.
      const algs = new Set(
        withoutKid.map((s) => s.alg ?? (opts.assumeSharedAlg ? '' : undefined)),
      );
      // Normalize: missing alg counts as '' when assumeSharedAlg.
      const distinct = new Set(
        withoutKid.map((s) =>
          s.alg !== undefined && s.alg !== ''
            ? s.alg
            : opts.assumeSharedAlg
              ? '__assumed__'
              : '__missing__',
        ),
      );
      // If assumeSharedAlg, all missing → one bucket; explicit different algs → error.
      const explicit = new Set(
        withoutKid.map((s) => s.alg).filter((a): a is string => Boolean(a)),
      );
      if (explicit.size > 1) {
        issues.push(
          issue(
            'error',
            'alg_mixed_without_kid',
            'Unkeyed sealed entries declare different algs under single-key fallback',
          ),
        );
      } else if (!opts.assumeSharedAlg) {
        const missingAlg = withoutKid.some((s) => !s.alg);
        const hasAlg = withoutKid.some((s) => Boolean(s.alg));
        if (missingAlg && hasAlg) {
          issues.push(
            issue(
              'error',
              'alg_mixed_without_kid',
              'Unkeyed sealed entries mix present and missing alg without assumeSharedAlg',
            ),
          );
        }
      }
      void algs;
      void distinct;
    }
  } else if (opts.requireKid) {
    for (const s of withoutKid) {
      issues.push(
        issue(
          'error',
          'payload_missing_kid',
          'Sealed entry missing kid',
          { nodeId: s.nodeId, path: s.path, line: s.line },
        ),
      );
    }
  }
}

/**
 * Soft-validate an outline document. Never throws for document problems —
 * returns `{ ok, issues, doc? }`. `ok` is false when any issue has severity
 * `error`. Hosts that need a hard gate (save / share / Invite to Beta) refuse
 * when `!ok`.
 */
export function validateDocument(
  source: string | OutlineFoldDoc,
  options?: ValidateOptions,
): ValidationResult {
  const singleKeyFallback = options?.singleKeyFallback ?? false;
  const requireKid = options?.requireKid ?? true;
  const assumeSharedAlg =
    options?.assumeSharedAlg ?? (singleKeyFallback ? true : false);
  const opts = { requireKid, singleKeyFallback, assumeSharedAlg };

  const issues: ValidationIssue[] = [];

  if (typeof source !== 'string') {
    validateDocTree(source, issues, opts, []);
    const ok = !issues.some((i) => i.severity === 'error');
    return { ok, issues, doc: source };
  }

  let doc: OutlineFoldDoc | undefined;
  try {
    doc = parse(source);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/both fold-/i.test(msg) || /fold-\s+and\s+fold\+/i.test(msg)) {
      issues.push(
        issue(
          'error',
          'fold_mode_conflict',
          'Document cannot have both fold- and fold+',
        ),
      );
    } else {
      issues.push(
        issue('error', 'parse_error', msg || 'Fatal parse failure'),
      );
    }
    return { ok: false, issues };
  }

  const rawEntries: RawPayloadEntry[] = [];
  for (const { block, bodyStartLine } of extractPayloadBlocks(source)) {
    rawEntries.push(...parsePayloadEntriesRaw(block, bodyStartLine));
  }
  validateDocTree(doc, issues, opts, rawEntries);
  scanIgnoredEncTags(source, issues);

  const ok = !issues.some((i) => i.severity === 'error');
  return { ok, issues, doc };
}
