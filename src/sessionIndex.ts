/**
 * Session index (0.6.6): every node in a visualisation session gets one session
 * id (`__sid-N`), including nodes with an authored `<id:N>`.
 *
 * - All internal keying (Map paint, hit-test, layout, selection, focus, style and
 *   fold targets) uses that session id. No positional key is ever an identity.
 * - The view key lives in this index. It is stored on `node.id` with `autoId` only
 *   when a caller already needs a name for the line (`parse({ sessionIds: true })`,
 *   a region row, a zone row, or a fold). Sync does not write one onto a line that
 *   has none. An authored id (`<id:N>`) stays on `node.id` and is a separate fixed
 *   reference: serialize writes it, and deep links, `#id:N`, and `<r:…>` jumps use
 *   it. `resolve(ref)` turns an authored id into the session id; `fixedOf(key)` goes back.
 * - A duplicate authored id never shares a key: the first line in document order owns
 *   the reference, later lines keep their own view keys and are listed in `duplicates()`.
 * - Line numbers are derived data: `lineOf(key)` / `keyAtLine(line)` come from the
 *   last parse (see `parsedLineOf`) and are refreshed on every re-parse. A line is never
 *   used as a key. A later tree with no parse lines (a fold `structuredClone`) keeps
 *   the line last recorded for that view key, so Follow still lands.
 * - View keys are never written: the parser only accepts ids that start with a letter
 *   or digit, and serialize writes `node.id` (authored) only, so `__sid-` cannot leak.
 *
 * Carry-over: when the host hands over a re-parsed tree (new node objects) the index
 * keeps each node's session id by (1) its authored id, then (2) the line map between the
 * old and new text (unchanged lines above and below the edit; a same-size hunk line for
 * line, so typing on a line keeps its key; a hunk that is the same lines in a new order,
 * so Alt+Up / Alt+Down keeps the key on the words), then (3) caption + depth in
 * order for trees built without line information. Anything left gets a fresh key.
 * A session id already stored on `node.id` (`autoId`) is adopted as that key, so
 * fold state and Follow in text name one reference. Sync does not write a session
 * id onto a line that does not have one.
 */
import { SESSION_ID_PREFIX } from './nodeAddress.js';
import type { OutlineNode } from './types.js';

export const VIEW_KEY_PREFIX = SESSION_ID_PREFIX;

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
  /** Node for a session id or an authored `<id:>`. */
  nodeOf(keyOrRef: string | null | undefined): OutlineNode | null;
  /** View key for a view key or a fixed reference; null when unknown. */
  resolve(keyOrRef: string | null | undefined): string | null;
  /** The node's `node.id` (authored or session), or null. */
  refOf(key: string): string | null;
  /** Authored id only (never a session id), or null. */
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

/**
 * A same-size hunk whose lines are the same texts in a new order (Alt+Up / Alt+Down).
 * Old line → new line, matched in order so two identical lines do not cross.
 * Null when any line was edited: that hunk stays positional so typing keeps its key.
 */
function hunkReorder(a: string[], b: string[], start: number, n: number): Map<number, number> | null {
  if (n === 0) return null;
  let moved = false;
  const queues = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    if (a[start + i] !== b[start + i]) moved = true;
    const q = queues.get(a[start + i]!) ?? [];
    q.push(start + i);
    queues.set(a[start + i]!, q);
  }
  if (!moved) return null;
  const out = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const old = queues.get(b[start + i]!)?.shift();
    if (old === undefined) return null;
    out.set(old, start + i);
  }
  for (const q of queues.values()) if (q.length) return null;
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
  if (ha === hb) {
    const reordered = hunkReorder(a, b, p, ha);
    if (reordered) for (const [ol, nl] of reordered) m.set(ol, nl);
    else for (let i = 0; i < ha; i++) m.set(p + i, p + i);
  }
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
  /** Last source line seen for a view key. A lineless tree (fold clone) does not clear it. */
  let lineByKey = new Map<string, number>();

  const mint = (): string => `${VIEW_KEY_PREFIX}${++seq}`;

  const claim = (id: string): void => {
    if (!isViewKey(id)) return;
    const n = Number(id.slice(VIEW_KEY_PREFIX.length));
    if (Number.isFinite(n) && n > seq) seq = n;
  };

  const keyOf = (n: OutlineNode): string => {
    let k = keyByNode.get(n);
    if (!k) {
      if (n.id && n.autoId && isViewKey(n.id) && !nodeByKey.has(n.id)) {
        k = n.id;
        claim(k);
      } else {
        k = mint();
      }
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
      if (n.id && n.autoId && isViewKey(n.id)) claim(n.id);
    }
    for (const n of preorder(roots || [])) {
      const k = keyOf(n);
      nodeByKey.set(k, n);
      ordered.push(k);
      const line = parsedLineOf(n);
      if (line !== null) lineByKey.set(k, line);
      const known = line !== null ? line : lineByKey.get(k);
      if (known !== undefined) keyByLine.set(known, k);
      if (!n.id) continue;
      const first = keyByRef.get(n.id);
      if (first === undefined) keyByRef.set(n.id, k);
      else if (!n.autoId) {
        const list = dups.get(n.id) ?? [first];
        list.push(k);
        dups.set(n.id, list);
      }
    }
    for (const k of [...lineByKey.keys()]) if (!nodeByKey.has(k)) lineByKey.delete(k);
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
    // (1) Authored ids. A session id already on the node is adopted in keyOf.
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
      if (!nodeByKey.has(key)) return null;
      const live = parsedLineOf(nodeByKey.get(key)!);
      if (live !== null) return live;
      return lineByKey.get(key) ?? null;
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
