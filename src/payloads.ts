import { headerKid, isSealedBranchPayload, SEAL_ALG } from './sealedState.js';
import { parseEncBody } from './sealed.js';
import { parseAutoWidth } from './mapFit.js';
import type {
  NodeLayout,
  OutlineFrontmatter,
  OutlineNode,
  SealedPayload,
  SealKeyEntry,
  SealKeyringEntry,
} from './types.js';

/** Fence labels accepted for the trailer payload map (case-insensitive). */
const PAYLOAD_FENCES = new Set(['payloads', 'sealed', 'enc']);

export type PayloadMap = Record<string, SealedPayload>;

/** Layout trailer keyed by node id or, when the line has no id, by 1-based position. */
export type LayoutMap = Record<string, NodeLayout>;

const KEY_LINE = /^([A-Za-z0-9][A-Za-z0-9_-]*):\s*$/;

/**
 * Peel trailing `--- payloads ---` / `--- sealed ---` / `--- enc ---` … `---`,
 * trailing `--- layout ---` … `---`, and trailing YAML `---` … `---` from the
 * outline body (tail first). Leading frontmatter is handled separately.
 * Document keys inside the layout block (`fold-`, `fold+`, markers, `fontSize`)
 * win over an earlier trailing YAML block.
 */
export function peelTrailingSections(body: string): {
  outline: string;
  trailingFm: OutlineFrontmatter;
  payloads: PayloadMap;
  layouts: LayoutMap;
  keys: SealKeyEntry[];
  keyring: SealKeyringEntry[];
} {
  let rest = body.replace(/\s+$/, '');
  const trailingFm: OutlineFrontmatter = {};
  let payloads: PayloadMap = {};
  let layouts: LayoutMap = {};
  let layoutFm: OutlineFrontmatter | undefined;
  let keys: SealKeyEntry[] = [];
  let keyring: SealKeyringEntry[] = [];

  const takeLayout = (inner: string) => {
    const parsed = parseLayoutBlock(inner);
    layouts = { ...layouts, ...parsed.layouts };
    // The loop peels the tail-most block first. That block wins.
    if (!layoutFm) layoutFm = parsed.frontmatter;
  };

  let peeled = true;
  while (peeled) {
    peeled = false;

    const lay = rest.match(/\n---\s*layout\s*---\r?\n([\s\S]*?)\r?\n---\s*$/i);
    if (lay) {
      takeLayout(lay[1]!);
      rest = rest.slice(0, lay.index).replace(/\s+$/, '');
      peeled = true;
      continue;
    }

    const layBol = rest.match(/^---\s*layout\s*---\r?\n([\s\S]*?)\r?\n---\s*$/i);
    if (layBol) {
      takeLayout(layBol[1]!);
      rest = '';
      peeled = true;
      continue;
    }

    const ringBlk = rest.match(/(?:^|\n)---\s*keyring\s*---\r?\n([\s\S]*?)\r?\n---\s*$/i);
    if (ringBlk) {
      keyring = [...parseKeyringBlock(ringBlk[1]!), ...keyring];
      rest = rest.slice(0, ringBlk.index).replace(/\s+$/, '');
      peeled = true;
      continue;
    }

    const keyBlk = rest.match(/(?:^|\n)---\s*keys\s*---\r?\n([\s\S]*?)\r?\n---\s*$/i);
    if (keyBlk) {
      keys = [...parseKeysBlock(keyBlk[1]!), ...keys];
      rest = rest.slice(0, keyBlk.index).replace(/\s+$/, '');
      peeled = true;
      continue;
    }

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

  return {
    outline: rest,
    trailingFm: mergeFrontmatter(trailingFm, layoutFm ?? {}),
    payloads,
    layouts,
    keys,
    keyring,
  };
}

/** `--- keyring ---` body: `kid:` then `  kdf:`, `  wrap:` and optional `  pub: "…"`. */
export function parseKeyringBlock(block: string): SealKeyringEntry[] {
  const out: SealKeyringEntry[] = [];
  let cur: SealKeyringEntry | null = null;
  for (const raw of block.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const top = raw.match(/^([A-Za-z0-9][A-Za-z0-9_-]*):\s*$/);
    if (top) {
      cur = { kid: top[1]!, kdf: '', wrap: '' };
      out.push(cur);
      continue;
    }
    const f = raw.match(/^\s+(kdf|wrap|pub)\s*:\s*(.+)$/i);
    if (f && cur) {
      const v = f[2]!.trim();
      const k = f[1]!.toLowerCase();
      if (k === 'kdf') cur.kdf = v;
      else if (k === 'wrap') cur.wrap = v;
      else cur.pub = v.startsWith('"') ? JSON.parse(v) : unquote(v);
    }
  }
  return out.filter((k) => k.kdf && k.wrap);
}

export function formatKeyringBlock(ring: SealKeyringEntry[] | undefined): string {
  if (!ring?.length) return '';
  const lines = ['--- keyring ---'];
  for (const k of ring) {
    lines.push(`${k.kid}:`);
    lines.push(`  kdf: ${k.kdf}`);
    lines.push(`  wrap: ${k.wrap}`);
    if (k.pub) lines.push(`  pub: ${JSON.stringify(k.pub)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

/** `--- keys ---` body: `kid:` then `  kdf: …` and optional `  pub: "…"`. */
export function parseKeysBlock(block: string): SealKeyEntry[] {
  const out: SealKeyEntry[] = [];
  let cur: SealKeyEntry | null = null;
  for (const raw of block.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const top = raw.match(/^([A-Za-z0-9_-]+):\s*$/);
    if (top) {
      cur = { kid: top[1]!, kdf: '' };
      out.push(cur);
      continue;
    }
    const f = raw.match(/^\s+(kdf|pub)\s*:\s*(.+)$/i);
    if (f && cur) {
      const v = f[2]!.trim();
      if (f[1]!.toLowerCase() === 'kdf') cur.kdf = v;
      else cur.pub = v.startsWith('"') ? JSON.parse(v) : unquote(v);
    }
  }
  return out.filter((k) => k.kdf);
}

export function formatKeysBlock(keys: SealKeyEntry[] | undefined): string {
  if (!keys?.length) return '';
  const lines = ['--- keys ---'];
  for (const k of keys) {
    lines.push(`${k.kid}:`);
    lines.push(`  kdf: ${k.kdf}`);
    if (k.pub) lines.push(`  pub: ${JSON.stringify(k.pub)}`);
  }
  lines.push('---');
  return lines.join('\n');
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
    const top = raw.match(KEY_LINE);
    if (top) {
      flush();
      current = top[1]!;
      continue;
    }
    const field = raw.match(/^\s+(kid|alg|ct|uri|pub)\s*:\s*(.+)$/i);
    if (field && current) {
      const v = field[2]!.trim();
      const k = field[1]!.toLowerCase();
      fields[k] = k === 'pub' && v.startsWith('"') ? JSON.parse(v) : unquote(v);
      continue;
    }
    const compact = raw.match(/^([A-Za-z0-9][A-Za-z0-9_-]*):\s*(.+)$/);
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
  const hasCt = Boolean(fields.ct);
  const hasUri = Boolean(fields.uri);
  if (hasCt === hasUri) return null;
  const sealed: SealedPayload = {};
  if (fields.kid) sealed.kid = fields.kid;
  if (fields.ct) sealed.ciphertext = fields.ct;
  if (fields.uri) sealed.uri = fields.uri;
  if (fields.alg) sealed.alg = fields.alg;
  if (fields.pub) sealed.pub = fields.pub;
  return sealed;
}

/**
 * `--- layout ---` body.
 * Column-0 frontmatter keys (`fold-`, `fold+`, markers, `fontSize`) are the
 * document. `id:` / `12:` then `w:` are per-node widths.
 */
export function parseLayoutBlock(block: string): {
  layouts: LayoutMap;
  frontmatter: OutlineFrontmatter;
} {
  const out: LayoutMap = {};
  const fm: OutlineFrontmatter = {};
  let current: string | null = null;
  let width: number | undefined;
  let wAuto: string | undefined;

  const flush = () => {
    if (!current || width == null) {
      current = null;
      width = undefined;
      wAuto = undefined;
      return;
    }
    // `w-auto` rides on `w` (F5a): without a `w` the entry is ignored, as older parsers do.
    out[current] = wAuto ? { w: width, wAuto } : { w: width };
    current = null;
    width = undefined;
    wAuto = undefined;
  };

  for (const raw of block.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (/^\s/.test(raw)) {
      const field = raw.match(/^\s+w\s*:\s*(\d+(?:\.\d+)?)\s*$/i);
      if (field && current) {
        const n = Number(field[1]);
        if (Number.isFinite(n) && n > 0) width = n;
      }
      const auto = raw.match(/^\s+w-auto\s*:\s*([A-Za-z][\w-]*)\s*$/i);
      if (auto && current) wAuto = auto[1]!.toLowerCase();
      continue;
    }
    const line = raw.trim();
    if (readFmLine(fm, line, true)) {
      flush();
      continue;
    }
    const top = line.match(KEY_LINE);
    if (top) {
      flush();
      current = top[1]!;
    }
  }
  flush();
  return { layouts: out, frontmatter: fm };
}

/** `id:` / `12:` then `w: <px>`. Document keys in the same block are ignored here. */
export function parseLayoutMap(block: string): LayoutMap {
  return parseLayoutBlock(block).layouts;
}

const URI_KEYS: Record<string, 'noteUri' | 'noteMapUri' | 'noteDetailsUri'> = {
  noteuri: 'noteUri',
  notemapuri: 'noteMapUri',
  notedetailsuri: 'noteDetailsUri',
};

function unquote(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * One frontmatter key. Strict layout blocks reject fold- and fold+ together.
 * Returns true when the line was a document key.
 */
function readFmLine(
  fm: OutlineFrontmatter,
  line: string,
  strict: boolean,
): boolean {
  const foldMinus = line.match(/^fold-\s*:\s*(.*)$/i);
  if (foldMinus) {
    if (strict && fm.foldMode === '+') {
      throw new Error('Document cannot have both fold- and fold+');
    }
    fm.foldMode = '-';
    fm.foldIds = splitIds(foldMinus[1]!);
    return true;
  }
  const foldPlus = line.match(/^fold\+\s*:\s*(.*)$/i);
  if (foldPlus) {
    if (strict && fm.foldMode === '-') {
      throw new Error('Document cannot have both fold- and fold+');
    }
    fm.foldMode = '+';
    fm.foldIds = splitIds(foldPlus[1]!);
    return true;
  }
  const cm = line.match(/^collapsedMarker\s*:\s*(.+)$/i);
  if (cm) {
    fm.collapsedMarker = unquote(cm[1]!.trim());
    return true;
  }
  const em = line.match(/^expandedMarker\s*:\s*(.+)$/i);
  if (em) {
    fm.expandedMarker = unquote(em[1]!.trim());
    return true;
  }
  const autoWidth = line.match(/^autoWidth\s*:\s*(\S+)\s*$/i);
  if (autoWidth) {
    const v = parseAutoWidth(autoWidth[1]);
    if (v) fm.autoWidth = v;
    return true;
  }
  const fontSize = line.match(/^fontSize\s*:\s*(\d+(?:\.\d+)?)\s*$/i);
  if (fontSize) {
    fm.fontSize = Number(fontSize[1]);
    return true;
  }
  // URL templates: `noteUri` (Open #N), `noteMapUri`, `noteDetailsUri` (0.2.34).
  const uri = line.match(/^(noteUri|noteMapUri|noteDetailsUri)\s*:\s*(.+)$/i);
  if (uri) {
    const key = URI_KEYS[uri[1]!.toLowerCase()]!;
    const value = unquote(uri[2]!.trim());
    if (value) fm[key] = value;
    return true;
  }
  return false;
}

/** Parse fold-/markers YAML block (same keys as leading frontmatter). */
export function parseFmBlock(block: string): OutlineFrontmatter {
  const fm: OutlineFrontmatter = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    readFmLine(fm, line, false);
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
  if (tail.fontSize !== undefined) out.fontSize = tail.fontSize;
  if (tail.autoWidth !== undefined) out.autoWidth = tail.autoWidth;
  if (tail.noteUri !== undefined) out.noteUri = tail.noteUri;
  if (tail.noteMapUri !== undefined) out.noteMapUri = tail.noteMapUri;
  if (tail.noteDetailsUri !== undefined) out.noteDetailsUri = tail.noteDetailsUri;
  return out;
}

/**
 * Apply a layout trailer. An id key wins. A numeric key with no such id
 * addresses that 1-based position and does not write an id onto the node.
 */
export function attachLayouts(nodes: OutlineNode[], layouts: LayoutMap): void {
  const ids = new Set<string>();
  const walkIds = (list: OutlineNode[]) => {
    for (const n of list) {
      if (n.id) ids.add(n.id);
      if (n.children?.length) walkIds(n.children);
    }
  };
  walkIds(nodes);

  let pos = 0;
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      pos += 1;
      if (n.id && layouts[n.id]) {
        n.layout = { ...layouts[n.id] };
      } else if (!n.id) {
        const key = String(pos);
        if (layouts[key] && !ids.has(key)) n.layout = { ...layouts[key] };
      }
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
}

export function collectLayouts(nodes: OutlineNode[]): LayoutMap {
  const out: LayoutMap = {};
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      if (n.id && typeof n.layout?.w === 'number' && n.layout.w > 0) {
        out[n.id] = n.layout.wAuto ? { w: n.layout.w, wAuto: n.layout.wAuto } : { w: n.layout.w };
      }
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function formatLayoutBlock(
  layouts: LayoutMap,
  frontmatter?: OutlineFrontmatter,
): string {
  const lines: string[] = ['--- layout ---'];
  if (frontmatter) {
    if (
      frontmatter.foldMode ||
      (frontmatter.foldIds && frontmatter.foldIds.length > 0)
    ) {
      const mode = frontmatter.foldMode === '+' ? '+' : '-';
      lines.push(`fold${mode}: ${(frontmatter.foldIds ?? []).join(', ')}`);
    }
    if (frontmatter.collapsedMarker) {
      lines.push(`collapsedMarker: "${frontmatter.collapsedMarker}"`);
    }
    if (frontmatter.expandedMarker) {
      lines.push(`expandedMarker: "${frontmatter.expandedMarker}"`);
    }
    if (
      typeof frontmatter.fontSize === 'number' &&
      Number.isFinite(frontmatter.fontSize)
    ) {
      lines.push(`fontSize: ${frontmatter.fontSize}`);
    }
    if (frontmatter.autoWidth && parseAutoWidth(frontmatter.autoWidth)) {
      lines.push(`autoWidth: ${parseAutoWidth(frontmatter.autoWidth)}`);
    }
    for (const key of ['noteUri', 'noteMapUri', 'noteDetailsUri'] as const) {
      const uri = frontmatter[key];
      if (!uri) continue;
      const bare = /^(https?:\/\/\S+|\/\S+|none)$/i.test(uri);
      lines.push(bare ? `${key}: ${uri}` : `${key}: "${uri.replace(/"/g, '\\"')}"`);
    }
  }
  const keys = Object.keys(layouts).sort();
  for (const id of keys) {
    const w = layouts[id]?.w;
    if (typeof w !== 'number' || !(w > 0)) continue;
    lines.push(`${id}:`);
    lines.push(`  w: ${Math.round(w)}`);
    const mode = layouts[id]?.wAuto;
    if (mode && /^[A-Za-z][\w-]*$/.test(mode)) lines.push(`  w-auto: ${mode}`);
  }
  if (lines.length === 1) return '';
  lines.push('---');
  return lines.join('\n');
}

/** Attach trailer payloads onto nodes by id (trailer overwrites inline enc). */
export function attachPayloads(
  nodes: OutlineNode[],
  payloads: PayloadMap,
): void {
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      if (n.id && payloads[n.id]) {
        // of-seal-v2: the key id lives on the line (`<enc:KEYID>`), not in the payload.
        const tagKid = n.sealed?.kid;
        n.sealed = { ...payloads[n.id] };
        if (!n.sealed.kid && n.sealed.alg === SEAL_ALG) {
          const k = tagKid ?? headerKid(n.sealed);
          if (k) n.sealed.kid = k;
        }
        const flags = n.flags ?? [];
        if (isSealedBranchPayload(n.sealed)) continue;
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
      if (n.id && n.sealed && (n.sealed.ciphertext || n.sealed.uri)) {
        out[n.id] = { ...n.sealed };
        if (n.sealed.alg === SEAL_ALG) delete out[n.id]!.kid; // written as <enc:KEYID>
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
    if (s.kid) lines.push(`  kid: ${s.kid}`);
    if (s.alg) lines.push(`  alg: ${s.alg}`);
    if (s.pub) lines.push(`  pub: ${JSON.stringify(s.pub)}`);
    if (s.ciphertext) lines.push(`  ct: ${s.ciphertext}`);
    else if (s.uri) lines.push(`  uri: ${s.uri}`);
  }
  lines.push('---');
  return lines.join('\n');
}
