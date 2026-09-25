import { parseEncBody } from './sealed.js';
import type {
  OutlineFrontmatter,
  OutlineNode,
  SealedPayload,
} from './types.js';

/** Fence labels accepted for the trailer payload map (case-insensitive). */
const PAYLOAD_FENCES = new Set(['payloads', 'sealed', 'enc']);

export type PayloadMap = Record<string, SealedPayload>;

/**
 * Peel trailing `--- payloads ---` / `--- sealed ---` / `--- enc ---` … `---`
 * and trailing YAML `---` … `---` from the outline body (tail first).
 * Leading frontmatter is handled separately.
 */
export function peelTrailingSections(body: string): {
  outline: string;
  trailingFm: OutlineFrontmatter;
  payloads: PayloadMap;
} {
  let rest = body.replace(/\s+$/, '');
  const trailingFm: OutlineFrontmatter = {};
  let payloads: PayloadMap = {};

  let peeled = true;
  while (peeled) {
    peeled = false;

    const pay = rest.match(
      /\n---\s*(payloads|sealed|enc)\s*---\r?\n([\s\S]*?)\r?\n---\s*$/i,
    );
    if (pay) {
      const label = pay[1]!.toLowerCase();
      if (PAYLOAD_FENCES.has(label)) {
        payloads = { ...payloads, ...parsePayloadMap(pay[2]!) };
        rest = rest.slice(0, pay.index).replace(/\s+$/, '');
        peeled = true;
        continue;
      }
    }

    const payBol = rest.match(
      /^---\s*(payloads|sealed|enc)\s*---\r?\n([\s\S]*?)\r?\n---\s*$/i,
    );
    if (payBol && PAYLOAD_FENCES.has(payBol[1]!.toLowerCase())) {
      payloads = { ...payloads, ...parsePayloadMap(payBol[2]!) };
      rest = '';
      peeled = true;
      continue;
    }

    const fm = rest.match(/\n---\r?\n([\s\S]*?)\r?\n---\s*$/);
    if (fm) {
      Object.assign(trailingFm, parseFmBlock(fm[1]!));
      rest = rest.slice(0, fm.index).replace(/\s+$/, '');
      peeled = true;
      continue;
    }
  }

  return { outline: rest, trailingFm, payloads };
}

/**
 * Minimal YAML-ish map keyed by node id: `id:\n  kid: …\n  ct: …`.
 * Each entry carries its own kid; per-node keys are the grammar default, while
 * deliberate sensitivity-based kid reuse remains valid.
 */
export function parsePayloadMap(block: string): PayloadMap {
  const out: PayloadMap = {};
  let current: string | null = null;
  const fields: Record<string, string> = {};

  const flush = () => {
    if (!current) return;
    const sealed = fieldsToSealed(fields);
    if (sealed) out[current] = sealed;
    current = null;
    for (const k of Object.keys(fields)) delete fields[k];
  };

  for (const raw of block.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const top = raw.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*$/);
    if (top) {
      flush();
      current = top[1]!;
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
      const sealed = parseEncBody(compact[2]!.trim());
      if (sealed) out[compact[1]!] = sealed;
      current = null;
    }
  }
  flush();
  return out;
}

function fieldsToSealed(fields: Record<string, string>): SealedPayload | null {
  const kid = fields.kid;
  if (!kid) return null;
  const hasCt = Boolean(fields.ct);
  const hasUri = Boolean(fields.uri);
  if (hasCt === hasUri) return null;
  const sealed: SealedPayload = { kid };
  if (fields.ct) sealed.ciphertext = fields.ct;
  if (fields.uri) sealed.uri = fields.uri;
  if (fields.alg) sealed.alg = fields.alg;
  return sealed;
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

/** Parse fold-/markers YAML block (same keys as leading frontmatter). */
export function parseFmBlock(block: string): OutlineFrontmatter {
  const fm: OutlineFrontmatter = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const foldMinus = line.match(/^fold-\s*:\s*(.*)$/i);
    if (foldMinus) {
      fm.foldMode = '-';
      fm.foldIds = splitIds(foldMinus[1]!);
      continue;
    }
    const foldPlus = line.match(/^fold\+\s*:\s*(.*)$/i);
    if (foldPlus) {
      fm.foldMode = '+';
      fm.foldIds = splitIds(foldPlus[1]!);
      continue;
    }
    const cm = line.match(/^collapsedMarker\s*:\s*(.+)$/i);
    if (cm) {
      fm.collapsedMarker = unquote(cm[1]!.trim());
      continue;
    }
    const em = line.match(/^expandedMarker\s*:\s*(.+)$/i);
    if (em) {
      fm.expandedMarker = unquote(em[1]!.trim());
      continue;
    }
  }
  return fm;
}

function splitIds(s: string): string[] {
  return s
    .split(/[, ]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Merge frontmatter: tail wins on conflicts. */
export function mergeFrontmatter(
  head: OutlineFrontmatter,
  tail: OutlineFrontmatter,
): OutlineFrontmatter {
  const out: OutlineFrontmatter = { ...head };
  if (tail.foldMode !== undefined) out.foldMode = tail.foldMode;
  if (tail.foldIds !== undefined) out.foldIds = [...tail.foldIds];
  if (tail.collapsedMarker !== undefined)
    out.collapsedMarker = tail.collapsedMarker;
  if (tail.expandedMarker !== undefined)
    out.expandedMarker = tail.expandedMarker;
  return out;
}

/** Attach trailer payloads onto nodes by id (trailer overwrites inline enc). */
export function attachPayloads(
  nodes: OutlineNode[],
  payloads: PayloadMap,
): void {
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      if (n.id && payloads[n.id]) {
        n.sealed = { ...payloads[n.id] };
        const flags = n.flags ?? [];
        if (!flags.includes('private') && !flags.includes('encrypted')) {
          n.flags = [...flags, 'encrypted'];
        }
      }
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
}

/** Collect sealed payloads from the tree, keyed by node id. */
export function collectPayloads(nodes: OutlineNode[]): PayloadMap {
  const out: PayloadMap = {};
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      if (n.id && n.sealed?.kid && (n.sealed.ciphertext || n.sealed.uri)) {
        out[n.id] = { ...n.sealed };
      }
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Format trailer block (stable key order). */
export function formatPayloadsBlock(payloads: PayloadMap): string {
  const keys = Object.keys(payloads).sort();
  if (keys.length === 0) return '';
  const lines: string[] = ['--- payloads ---'];
  for (const id of keys) {
    const s = payloads[id]!;
    lines.push(`${id}:`);
    lines.push(`  kid: ${s.kid}`);
    if (s.alg) lines.push(`  alg: ${s.alg}`);
    if (s.ciphertext) lines.push(`  ct: ${s.ciphertext}`);
    else if (s.uri) lines.push(`  uri: ${s.uri}`);
  }
  lines.push('---');
  return lines.join('\n');
}
