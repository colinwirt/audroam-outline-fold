/**
 * Session index (0.6.6): every node in a visualisation session gets a fresh
 * view key (`__sid-N`), including nodes with an authored `<id:N>`.
 *
 * - All internal keying (Map paint, hit-test, layout, selection, focus, style and
 *   fold targets) uses view keys only. No positional key is ever an identity.
 * - Authored ids (`<id:N>`) and session ids (`__tmp-N`) stay on `node.id`: they are
 *   the node's fixed reference, the one serialize writes (authored only) and the one
 *   external callers use (deep links, `#id:N`, `<r:…>` jumps, fold lists, host focus).
 *   `resolve(ref)` turns a fixed reference into the view key; `refOf(key)` goes back.
 * - A duplicate authored id never shares a key: the first line in document order owns
 *   the reference, later lines keep their own view keys and are listed in `duplicates()`.
 * - Line numbers are derived data: `lineOf(key)` / `keyAtLine(line)` come from the
 *   last parse (see `parsedLineOf`) and are refreshed on every re-parse. A line is never
 *   used as a key.
 * - View keys are never written: the parser only accepts ids that start with a letter
 *   or digit, and serialize writes `node.id` (authored) only, so `__sid-` cannot leak.
 *
 * Carry-over: when the host hands over a re-parsed tree (new node objects) the index
 * keeps each node's view key by (1) its authored id, then (2) the line map between the
 * old and new text (unchanged lines above and below the edit, and a same-size edited
 * hunk line for line, so typing on a line keeps its key), then (3) caption + depth in
 * order for trees built without line information. Anything left gets a fresh key.
 */
import type { OutlineNode } from './types.js';

export const VIEW_KEY_PREFIX = '__sid-';

/** True for a view key minted by a session index. */
export function isViewKey(k: string | null | undefined): boolean {
  return !!k && k.startsWith(VIEW_KEY_PREFIX);
}

const NODE_LINE = new WeakMap<OutlineNode, number>();
const TREE_LINES = new WeakMap<OutlineNode[], string[]>();

/** Parser hook: 0-based line of `node` in the parsed text. */
export function recordParsedLine(node: OutlineNode, line: number): void {
  NODE_LINE.set(node, line);
}
/** Parser hook: the parsed text's lines for a root list. */
export function recordParsedLines(roots: OutlineNode[], lines: string[]): void {
  TREE_LINES.set(roots, lines);
}
/** 0-based line of the node in the text it was parsed from, or null. */
export function parsedLineOf(node: OutlineNode): number | null {
  const l = NODE_LINE.get(node);
  return typeof l === 'number' ? l : null;
}
/** Lines of the text a root list was parsed from, or null. */
export function parsedLinesOf(roots: OutlineNode[]): string[] | null {
  return TREE_LINES.get(roots) ?? null;
}

/** A blank list line (`- `): no caption and nothing else to draw. Map hides it. */
export function isBlankNode(n: OutlineNode | null | undefined): boolean {
  if (!n) return false;
  if (String(n.title ?? '').trim()) return false;
  return !n.children?.length && !n.task && !n.img && !n.icon && !n.sealed && !n.cloud;
}

export interface SessionIndex {
  /** Bring the index up to the tree (cheap when it is the same tree). */
  sync(tree: { nodes?: OutlineNode[] } | OutlineNode[] | null | undefined): void;
  /** The node's view key (minted on first sight). */
  keyOf(n: OutlineNode): string;
  /** The node's view key when it already has one (never mints). */
  peek(n: OutlineNode): string | null;
  /** Node for a view key or a fixed reference (`<id:>` / `__tmp-`). */
  nodeOf(keyOrRef: string | null | undefined): OutlineNode | null;
  /** View key for a view key or a fixed reference; null when unknown. */
  resolve(keyOrRef: string | null | undefined): string | null;
  /** The node's fixed reference (`node.id`: authored or `__tmp-`), or null. */
  refOf(key: string): string | null;
  /** Authored id only (never `__tmp-`), or null. */
  fixedOf(key: string): string | null;
  /** Fixed reference when the node has one, else the view key. */
  publicId(key: string): string;
  /** Authored ids used on more than one line → every view key that carries it. */
  duplicates(): Map<string, string[]>;
  /** 0-based line from the last parse, or null. */
  lineOf(key: string): number | null;
  /** View key of the node on a 0-based line of the last parse, or null. */
  keyAtLine(line: number): string | null;
  /** View keys in document order. */
  order(): string[];
}

function rootsOf(tree: { nodes?: OutlineNode[] } | OutlineNode[] | null | undefined): OutlineNode[] {
  if (!tree) return [];
  if (Array.isArray(tree)) return tree;
  return tree.nodes || [];
}

function preorder(roots: OutlineNode[]): OutlineNode[] {
  const out: OutlineNode[] = [];
  const walk = (list: OutlineNode[] | undefined) => {
    for (const n of list || []) {
      if (!n) continue;
      out.push(n);
      walk(n.children);
    }
  };
  walk(roots);
  return out;
}

/** old line → new line for lines outside the edit (and a same-size hunk line for line). */
function lineMap(a: string[], b: string[]): Map<number, number> {
  const m = new Map<number, number>();
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  for (let i = 0; i < p; i++) m.set(i, i);
  for (let i = 0; i < s; i++) m.set(a.length - 1 - i, b.length - 1 - i);
  const ha = a.length - p - s;
  const hb = b.length - p - s;
  if (ha === hb) for (let i = 0; i < ha; i++) m.set(p + i, p + i);
  return m;
}

export function createSessionIndex(): SessionIndex {
  let seq = 0;
  const keyByNode = new WeakMap<OutlineNode, string>();
  let roots: OutlineNode[] | null = null;
  let nodeByKey = new Map<string, OutlineNode>();
  let keyByRef = new Map<string, string>();
  let dups = new Map<string, string[]>();
  let ordered: string[] = [];
  let keyByLine = new Map<number, string>();

  const mint = (): string => `${VIEW_KEY_PREFIX}${++seq}`;

  const keyOf = (n: OutlineNode): string => {
    let k = keyByNode.get(n);
    if (!k) {
      k = mint();
      keyByNode.set(n, k);
      nodeByKey.set(k, n);
      if (n.id && !keyByRef.has(n.id)) keyByRef.set(n.id, k);
    }
    return k;
  };

  /** Re-read maps from the current tree (in-place edits, minted ids). */
  const rebuild = (): void => {
    nodeByKey = new Map();
    keyByRef = new Map();
    dups = new Map();
    ordered = [];
    keyByLine = new Map();
    for (const n of preorder(roots || [])) {
      const k = keyOf(n);
      nodeByKey.set(k, n);
      ordered.push(k);
      const line = parsedLineOf(n);
      if (line !== null) keyByLine.set(line, k);
      if (!n.id) continue;
      const first = keyByRef.get(n.id);
      if (first === undefined) keyByRef.set(n.id, k);
      else if (!n.autoId) {
        const list = dups.get(n.id) ?? [first];
        list.push(k);
        dups.set(n.id, list);
      }
    }
  };

  /** A new tree replaced `prev`: carry view keys over to the new node objects. */
  const carry = (prev: OutlineNode[], next: OutlineNode[]): void => {
    const oldNodes = preorder(prev);
    const newNodes = preorder(next).filter((n) => !keyByNode.has(n));
    if (!newNodes.length) return;
    const taken = new Set<string>();
    for (const n of preorder(next)) {
      const k = keyByNode.get(n);
      if (k) taken.add(k);
    }
    const adopt = (n: OutlineNode, k: string | undefined): boolean => {
      if (!k || taken.has(k) || keyByNode.has(n)) return false;
      keyByNode.set(n, k);
      taken.add(k);
      return true;
    };
    // (1) Authored ids (not `__tmp-`: those are re-minted by every parse).
    const oldByFixed = new Map<string, string>();
    for (const o of oldNodes) {
      if (o.id && !o.autoId && !oldByFixed.has(o.id)) oldByFixed.set(o.id, keyByNode.get(o)!);
    }
    const seenFixed = new Set<string>();
    for (const n of newNodes) {
      if (!n.id || n.autoId || seenFixed.has(n.id)) continue;
      seenFixed.add(n.id);
      adopt(n, oldByFixed.get(n.id));
    }
    // (2) Line map between the two parses.
    const a = parsedLinesOf(prev);
    const b = parsedLinesOf(next);
    if (a && b) {
      const map = lineMap(a, b);
      const oldAt = new Map<number, string>();
      for (const o of oldNodes) {
        const l = parsedLineOf(o);
        if (l !== null && keyByNode.has(o)) oldAt.set(l, keyByNode.get(o)!);
      }
      const newLineToOld = new Map<number, number>();
      for (const [ol, nl] of map) newLineToOld.set(nl, ol);
      for (const n of newNodes) {
        const l = parsedLineOf(n);
        if (l === null) continue;
        const ol = newLineToOld.get(l);
        if (ol !== undefined) adopt(n, oldAt.get(ol));
      }
    }
    // (3) Caption + depth, in order (trees with no line information).
    const pool = new Map<string, string[]>();
    for (const o of oldNodes) {
      const k = keyByNode.get(o);
      if (!k || taken.has(k)) continue;
      const sig = `${o.depth}\u0000${o.title}`;
      (pool.get(sig) ?? pool.set(sig, []).get(sig)!).push(k);
    }
    for (const n of newNodes) {
      if (keyByNode.has(n)) continue;
      const list = pool.get(`${n.depth}\u0000${n.title}`);
      while (list?.length && !adopt(n, list.shift())) { /* next */ }
    }
  };

  const sync: SessionIndex['sync'] = (tree) => {
    const next = rootsOf(tree);
    if (next !== roots) {
      if (roots) carry(roots, next);
      roots = next;
      rebuild();
    }
  };

  const resolve = (ref: string | null | undefined): string | null => {
    if (!ref) return null;
    const hit = (): string | null => {
      if (nodeByKey.has(ref)) return ref;
      const k = keyByRef.get(ref);
      if (k && nodeByKey.get(k)?.id === ref) return k;
      return null;
    };
    const k = hit();
    if (k) return k;
    // A scoped id (`region:local`) is never in the main tree: no re-walk for it.
    if (ref.includes(':')) return null;
    if (roots) rebuild();
    return hit();
  };

  return {
    sync,
    keyOf,
    peek: (n) => keyByNode.get(n) ?? null,
    resolve,
    nodeOf: (ref) => {
      const k = resolve(ref);
      return k ? nodeByKey.get(k) ?? null : null;
    },
    refOf: (key) => {
      const n = nodeByKey.get(key) ?? (resolve(key) ? nodeByKey.get(resolve(key)!) : undefined);
      return n?.id ?? null;
    },
    fixedOf: (key) => {
      const n = nodeByKey.get(key);
      return n?.id && !n.autoId ? n.id : null;
    },
    publicId: (key) => {
      const k = resolve(key);
      const n = k ? nodeByKey.get(k) : undefined;
      // A later duplicate of an authored id is not that id's owner: it stays a view key.
      return n?.id && keyByRef.get(n.id) === k ? n.id : (k ?? key);
    },
    duplicates: () => { rebuild(); return new Map(dups); },
    lineOf: (key) => {
      const n = nodeByKey.get(key);
      return n ? parsedLineOf(n) : null;
    },
    keyAtLine: (line) => { rebuild(); return keyByLine.get(line) ?? null; },
    order: () => { rebuild(); return [...ordered]; },
  };
}

type NodesRecord<V> = Record<string, V>;
const SESSION_STORE = new WeakMap<object, Map<string, unknown>>();
const VIEW_CACHE = new WeakMap<object, { idx: SessionIndex; proxy: object }>();

/**
 * View of a host layout keyed by view keys (0.6.6). Reads and writes by view key
 * land on the host's `nodes` under the node's fixed reference (`node.id`), so a
 * saved sidecar, resume nudges and host code keep their ids. A node with no fixed
 * reference keeps its entry in a session-only store (never written into the host
 * object, so `__sid-` cannot reach a saved layout). Keys the index does not know
 * (secure-zone scoped ids, stale entries) pass through unchanged.
 */
export function viewLayout<L extends { nodes?: NodesRecord<V> }, V = unknown>(layout: L, idx: SessionIndex): L {
  if (!layout || typeof layout !== 'object') return layout;
  const hit = VIEW_CACHE.get(layout);
  if (hit && hit.idx === idx) return hit.proxy as L;
  const session = (): Map<string, unknown> => {
    let m = SESSION_STORE.get(layout);
    if (!m) SESSION_STORE.set(layout, (m = new Map()));
    return m;
  };
  const canon = (k: string): { raw?: string; sk?: string } => {
    const key = idx.resolve(k);
    if (!key) return { raw: k };
    const ref = idx.publicId(key);
    return ref !== key ? { raw: ref, sk: key } : { sk: key };
  };
  const nodesCache = new WeakMap<object, object>();
  const wrapNodes = (raw: NodesRecord<V>): NodesRecord<V> => {
    const cached = nodesCache.get(raw);
    if (cached) return cached as NodesRecord<V>;
    const get = (k: string): V | undefined => {
      const c = canon(k);
      if (c.raw !== undefined) {
        let v = raw[c.raw];
        if (v === undefined && c.sk && session().has(c.sk)) {
          // The node has a fixed reference now (minted id): move its entry to the host.
          v = session().get(c.sk) as V;
          raw[c.raw] = v;
          session().delete(c.sk);
        }
        return v;
      }
      return session().get(c.sk!) as V | undefined;
    };
    const proxy = new Proxy(raw, {
      get: (t, k) => (typeof k === 'string' ? get(k) : Reflect.get(t, k)),
      set: (t, k, v) => {
        if (typeof k !== 'string') return Reflect.set(t, k, v);
        const c = canon(k);
        if (c.raw !== undefined) {
          raw[c.raw] = v;
          if (c.sk) session().delete(c.sk);
        } else session().set(c.sk!, v);
        return true;
      },
      deleteProperty: (t, k) => {
        if (typeof k !== 'string') return Reflect.deleteProperty(t, k);
        const c = canon(k);
        if (c.raw !== undefined) delete raw[c.raw];
        if (c.sk) session().delete(c.sk);
        return true;
      },
      has: (t, k) => (typeof k === 'string' ? get(k) !== undefined : Reflect.has(t, k)),
      ownKeys: () => {
        const out: string[] = [];
        const seen = new Set<string>();
        for (const k of Object.keys(raw)) {
          const key = idx.resolve(k) ?? k;
          if (!seen.has(key)) { seen.add(key); out.push(key); }
        }
        for (const k of session().keys()) {
          if (!seen.has(k) && idx.nodeOf(k)) { seen.add(k); out.push(k); }
        }
        return out;
      },
      getOwnPropertyDescriptor: (_t, k) => {
        if (typeof k !== 'string') return undefined;
        const v = get(k);
        return v === undefined ? undefined : { value: v, writable: true, enumerable: true, configurable: true };
      },
    });
    nodesCache.set(raw, proxy);
    return proxy as NodesRecord<V>;
  };
  const proxy = new Proxy(layout, {
    get: (t, k) => {
      if (k === 'nodes') {
        const raw = t.nodes;
        return raw && typeof raw === 'object' ? wrapNodes(raw) : raw;
      }
      return Reflect.get(t, k);
    },
    set: (t, k, v) => {
      if (k !== 'nodes' || !v || typeof v !== 'object') return Reflect.set(t, k, v);
      // Whole-map replace (auto-pack): split into host refs and session entries.
      const next: NodesRecord<V> = {};
      session().clear();
      for (const [key, val] of Object.entries(v as NodesRecord<V>)) {
        const c = canon(key);
        if (c.raw !== undefined) next[c.raw] = val;
        else session().set(c.sk!, val);
      }
      t.nodes = next;
      return true;
    },
  });
  VIEW_CACHE.set(layout, { idx, proxy });
  return proxy;
}
