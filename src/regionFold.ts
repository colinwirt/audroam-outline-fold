/**
 * Region fold store (spec 20261101 §R1). One store per instance, shared by Map and Outline.
 * Keys are scoped ids: `regionId:nodeId` for a node inside a region, `regionId` for the
 * region root (the cloud). Root-doc fold state keeps living in `doc.fold`; this store only
 * holds region entries, so it can never clash with root ids and is never written into any
 * payload (a child doc's own `fold` is only read as the default).
 *
 * - `record` regions (`n:` ids) persist through the map resume path (`regionFold`).
 * - `sealed` regions (`s:` ids, or any region nested inside one) are memory-only and are
 *   wiped together with the doc when the region locks (see {@link bindRegionFoldToSessions}).
 * - A locked sealed region is always folded to its root pill (callers pass `locked`).
 */
import { isCollapsed, setExpandLevel, type ExpandLevel } from './fold.js';
import type { RegionId, ScopedId } from './hostApi.js';
import { scopeId } from './scopedId.js';
import type { OutlineFoldDoc, OutlineNode } from './types.js';

export type RegionFoldEntries = Record<ScopedId, boolean>;

export interface RegionFoldStoreOptions {
  /** Persisted entries to resume (record regions only; others are ignored). */
  initial?: RegionFoldEntries | null;
  /** Called after every change with the persistable entries (record regions only). */
  persist?: (entries: RegionFoldEntries) => void;
}

export interface RegionFoldStore {
  /** Region root folded (cloud collapsed to its pill). `locked` forces true. */
  isRegionFolded(region: RegionId, locked?: boolean): boolean;
  setRegionFolded(region: RegionId, folded: boolean): void;
  /** A node inside `region`: stored entry, else the child doc's own default fold. */
  isNodeCollapsed(region: RegionId, doc: OutlineFoldDoc, id: string): boolean;
  setNodeCollapsed(region: RegionId, id: string, collapsed: boolean): void;
  toggleNode(region: RegionId, doc: OutlineFoldDoc, id: string): boolean;
  /**
   * A shallow view of `doc` whose `fold` reflects this store (mode `-`). Feed it to the
   * normal fold helpers (`isCollapsed`, `toggleFold`, `setExpandLevel`, `foldLevelPicker`)
   * and hand the result to {@link commitView}. The child doc itself is never touched.
   */
  viewDoc(region: RegionId, doc: OutlineFoldDoc): OutlineFoldDoc;
  /** Write a view doc's fold back into the store (one entry per foldable node). */
  commitView(region: RegionId, view: OutlineFoldDoc): void;
  /** `setExpandLevel` inside a region, under a local id (or the whole region). */
  setLevel(region: RegionId, doc: OutlineFoldDoc, level: ExpandLevel, under?: string): void;
  /** Drop every entry of `region` and its nested regions (lock / wipe). */
  wipe(region: RegionId): void;
  /** Drop every memory-only (sealed) entry, e.g. on `pagehide`. */
  wipeSealed(): void;
  /** Persistable entries (record regions only). Never sealed state. */
  exportPersistent(): RegionFoldEntries;
  /** Raw read for debugging / QA (all entries). */
  entries(): RegionFoldEntries;
  subscribe(fn: () => void): () => void;
}

/** True when the region (or any enclosing region) is a sealed region: memory-only state. */
export function isMemoryOnlyRegion(region: RegionId): boolean {
  return region.split('/').some((seg) => !seg.startsWith('n:'));
}

/** Region part of a store key (`s:b7:3` → `s:b7`, `s:b7` → `s:b7`). */
function regionOfKey(key: ScopedId): RegionId {
  const m = key.match(/^((?:[sn]:[^:/]+)(?:\/[sn]:[^:/]+)*)(?::.*)?$/);
  return m ? m[1]! : key;
}

function walk(nodes: OutlineNode[] | undefined, fn: (n: OutlineNode) => void): void {
  for (const n of nodes ?? []) {
    fn(n);
    walk(n.children, fn);
  }
}

/** Number of nodes in a doc (hidden-count chip for a folded region root). */
export function countNodes(doc: OutlineFoldDoc | null | undefined): number {
  let c = 0;
  walk(doc?.nodes, () => c++);
  return c;
}

function findById(nodes: OutlineNode[] | undefined, id: string): OutlineNode | null {
  for (const n of nodes ?? []) {
    if (n.id === id) return n;
    const h = findById(n.children, id);
    if (h) return h;
  }
  return null;
}

/** Ids of the ancestors of `id` (outermost first), or null when not found. */
export function ancestorIds(nodes: OutlineNode[] | undefined, id: string): string[] | null {
  for (const n of nodes ?? []) {
    if (n.id === id) return [];
    const sub = ancestorIds(n.children, id);
    if (sub) return n.id ? [n.id, ...sub] : sub;
  }
  return null;
}

export function createRegionFoldStore(opts: RegionFoldStoreOptions = {}): RegionFoldStore {
  const m = new Map<ScopedId, boolean>();
  for (const [k, v] of Object.entries(opts.initial ?? {}))
    if (typeof v === 'boolean' && !isMemoryOnlyRegion(regionOfKey(k))) m.set(k, v);
  const subs = new Set<() => void>();
  const changed = (persistable: boolean) => {
    if (persistable) opts.persist?.(self.exportPersistent());
    for (const fn of [...subs]) {
      try {
        fn();
      } catch (err) {
        if (typeof console !== 'undefined') console.error('outline-fold: region fold listener failed', err);
      }
    }
  };
  const put = (key: ScopedId, v: boolean): boolean => {
    if (m.get(key) === v) return false;
    m.set(key, v);
    return true;
  };

  const self: RegionFoldStore = {
    isRegionFolded: (region, locked) => !!locked || m.get(region) === true,
    setRegionFolded(region, folded) {
      if (put(region, folded)) changed(!isMemoryOnlyRegion(region));
    },
    isNodeCollapsed(region, doc, id) {
      const v = m.get(scopeId(region, id));
      return v === undefined ? isCollapsed(doc, id) : v;
    },
    setNodeCollapsed(region, id, collapsed) {
      if (put(scopeId(region, id), collapsed)) changed(!isMemoryOnlyRegion(region));
    },
    toggleNode(region, doc, id) {
      const next = !self.isNodeCollapsed(region, doc, id);
      self.setNodeCollapsed(region, id, next);
      return next;
    },
    viewDoc(region, doc) {
      const ids: string[] = [];
      walk(doc.nodes, (n) => {
        if (n.id && n.children?.length && self.isNodeCollapsed(region, doc, n.id)) ids.push(n.id);
      });
      return { ...doc, fold: { mode: '-', ids } };
    },
    commitView(region, view) {
      let any = false;
      walk(view.nodes, (n) => {
        if (n.id && n.children?.length) any = put(scopeId(region, n.id), isCollapsed(view, n.id)) || any;
      });
      if (any) changed(!isMemoryOnlyRegion(region));
    },
    setLevel(region, doc, level, under) {
      self.commitView(region, setExpandLevel(self.viewDoc(region, doc), level, under ? { under } : {}));
    },
    wipe(region) {
      let any = false;
      for (const k of [...m.keys()]) {
        const r = regionOfKey(k);
        if (r === region || r.startsWith(region + '/')) {
          m.delete(k);
          any = true;
        }
      }
      if (any) changed(!isMemoryOnlyRegion(region));
    },
    wipeSealed() {
      let any = false;
      for (const k of [...m.keys()]) if (isMemoryOnlyRegion(regionOfKey(k))) { m.delete(k); any = true; }
      if (any) changed(false);
    },
    exportPersistent() {
      const out: RegionFoldEntries = {};
      for (const [k, v] of m) if (!isMemoryOnlyRegion(regionOfKey(k))) out[k] = v;
      return out;
    },
    entries: () => Object.fromEntries(m),
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
  return self;
}

/** Minimal sessions surface used by {@link bindRegionFoldToSessions} (avoids an import cycle). */
export interface RegionFoldSessionsLike {
  api: { on(type: 'lock', fn: (e: { region: RegionId }) => void): () => void };
}

/**
 * Wipe a sealed region's fold state together with its doc: on every `lock` event (Lock now,
 * close, auto-lock, parent lock; nested regions lock first and are wiped too) and on
 * `pagehide`. The next unlock opens with the child's default fold.
 */
export function bindRegionFoldToSessions(store: RegionFoldStore, sessions: RegionFoldSessionsLike): () => void {
  const off = sessions.api.on('lock', (e) => store.wipe(e.region));
  const onHide = () => store.wipeSealed();
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onHide);
  return () => {
    off();
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onHide);
  };
}

export interface RegionRevealContext {
  /** Parent region of a region (`""` = root). */
  parentOf(region: RegionId): RegionId;
  /** Anchor node id of a region, local to its parent region. */
  anchorOf(region: RegionId): string;
  /** Readable doc of a region (null while sealed). Root is `""`. */
  docOf(region: RegionId): OutlineFoldDoc | null;
  /** Region is sealed and not unlocked. */
  isLocked(region: RegionId): boolean;
}

export interface RegionRevealResult {
  /** Root-doc ids that must be expanded (apply with `toggleFold` on the root doc). */
  rootUnfold: string[];
  /** Scoped id that ends up visible: the target, or the region root while sealed. */
  target: ScopedId;
  /** Set when the path stopped at a sealed region root; the host should ask to unlock it. */
  lockedRegion?: RegionId;
}

/**
 * Unfold every level on the path to `region`/`id` (§R1 d): ancestors inside the region, the
 * region root, enclosing regions and their anchors. Region entries are written to the store;
 * root-doc ids to expand are returned. A locked region on the path stops the walk at its root.
 */
export function revealInRegions(
  store: RegionFoldStore,
  region: RegionId,
  id: string | null,
  ctx: RegionRevealContext,
): RegionRevealResult {
  const chain: RegionId[] = [];
  for (let r = region; r; r = ctx.parentOf(r)) chain.unshift(r);
  // Innermost-out reveal stops at the first (outermost) locked region.
  let stop = chain.findIndex((r) => ctx.isLocked(r));
  let lockedRegion: RegionId | undefined;
  if (stop >= 0) {
    lockedRegion = chain[stop];
    chain.length = stop + 1;
    id = null;
  }
  const rootUnfold: string[] = [];
  const unfoldTo = (r: RegionId, local: string, includeSelf: boolean) => {
    const doc = ctx.docOf(r);
    if (!doc) return;
    const path = ancestorIds(doc.nodes, local) ?? [];
    if (includeSelf && findById(doc.nodes, local)?.children?.length) path.push(local);
    for (const a of path) {
      if (r === '') {
        if (isCollapsed(doc, a)) rootUnfold.push(a);
      } else store.setNodeCollapsed(r, a, false);
    }
  };
  for (let i = 0; i < chain.length; i++) {
    const r = chain[i]!;
    unfoldTo(ctx.parentOf(r), ctx.anchorOf(r), true);
    if (i < chain.length - 1 || !lockedRegion) store.setRegionFolded(r, false);
  }
  if (id !== null) unfoldTo(region, id, false);
  return {
    rootUnfold,
    target: lockedRegion ? lockedRegion : scopeId(region, id ?? ''),
    ...(lockedRegion ? { lockedRegion } : {}),
  };
}

/** Reveal context from region hosts (sessions or mounted records): parent, anchor, doc. */
export function revealContextFromHosts(
  hosts: readonly { id: RegionId; parent?: RegionId; anchor: string; doc: OutlineFoldDoc | null; kind: 'sealed' | 'record' }[],
  rootDoc: OutlineFoldDoc,
): RegionRevealContext {
  const by = new Map(hosts.map((h) => [h.id, h]));
  return {
    parentOf: (r) => by.get(r)?.parent ?? '',
    anchorOf: (r) => by.get(r)?.anchor ?? '',
    docOf: (r) => (r === '' ? rootDoc : by.get(r)?.doc ?? null),
    isLocked: (r) => r !== '' && !by.get(r)?.doc,
  };
}

// ---------- Outline: one composed tree over root + regions (§R1 e) ----------

export interface OutlineRegionHost {
  id: RegionId;
  kind: 'sealed' | 'record';
  parent?: RegionId;
  anchor: string;
  doc: OutlineFoldDoc | null;
  label?: string;
}

function scopeNodes(region: RegionId, nodes: OutlineNode[] | undefined): OutlineNode[] {
  return (nodes ?? []).map((n) => ({
    ...n,
    ...(n.id ? { id: scopeId(region, n.id) } : {}),
    ...(n.children ? { children: scopeNodes(region, n.children) } : {}),
  }));
}

function cloneTree(nodes: OutlineNode[] | undefined): OutlineNode[] {
  return (nodes ?? []).map((n) => ({ ...n, ...(n.children ? { children: cloneTree(n.children) } : {}) }));
}

function regionDepth(r: RegionId): number {
  return r.split('/').length;
}

/**
 * Compose the doc Outline renders: the root doc with every readable region nested under its
 * anchor as a region-root node (id = region id) whose children carry scoped ids. Locked
 * regions add nothing (the anchor keeps its sealed chrome). The fold is read from the root
 * doc (plain ids) and the store (scoped ids), so `toHtml` + `attachOutlineTree` fold,
 * expand-level keys and announcements work unchanged. Never serialize the result.
 */
export function composeOutlineDoc(root: OutlineFoldDoc, hosts: readonly OutlineRegionHost[], store: RegionFoldStore): OutlineFoldDoc {
  const nodes = cloneTree(root.nodes);
  const mode = root.fold.mode;
  const ids = [...root.fold.ids];
  const want = (key: string, collapsed: boolean) => {
    if (mode === '-' ? collapsed : !collapsed) ids.push(key);
  };
  const byId = new Map<string, OutlineNode>();
  const index = (l: OutlineNode[]) => l.forEach((n) => { if (n.id) byId.set(n.id, n); if (n.children) index(n.children); });
  index(nodes);
  for (const h of [...hosts].sort((a, b) => regionDepth(a.id) - regionDepth(b.id))) {
    if (!h.doc) continue;
    const anchor = byId.get(scopeId(h.parent ?? '', h.anchor));
    if (!anchor) continue;
    const kids = scopeNodes(h.id, h.doc.nodes);
    const rootNode: OutlineNode = {
      id: h.id,
      title: h.label || (h.kind === 'sealed' ? 'Sealed branch' : 'Record'),
      children: kids,
    } as OutlineNode;
    anchor.children = [...(anchor.children ?? []), rootNode];
    byId.set(h.id, rootNode);
    index(kids);
    want(h.id, store.isRegionFolded(h.id));
    const walkF = (l: OutlineNode[] | undefined) =>
      l?.forEach((n) => {
        if (n.id && n.children?.length) want(scopeId(h.id, n.id), store.isNodeCollapsed(h.id, h.doc!, n.id));
        walkF(n.children);
      });
    walkF(h.doc.nodes);
  }
  return { ...root, nodes, fold: { mode, ids } };
}

/**
 * Split a composed doc's fold back: scoped / region ids go to the store, plain ids stay in
 * the root doc. Returns the root doc (the same object when its fold did not change).
 */
export function commitOutlineFold(
  composed: OutlineFoldDoc,
  root: OutlineFoldDoc,
  hosts: readonly OutlineRegionHost[],
  store: RegionFoldStore,
): OutlineFoldDoc {
  const regionKeys = new Set<string>();
  for (const h of hosts) {
    if (!h.doc) continue;
    regionKeys.add(h.id);
    store.setRegionFolded(h.id, isCollapsed(composed, h.id));
    const walkF = (l: OutlineNode[] | undefined) =>
      l?.forEach((n) => {
        if (n.id) {
          const k = scopeId(h.id, n.id);
          regionKeys.add(k);
          if (n.children?.length) store.setNodeCollapsed(h.id, n.id, isCollapsed(composed, k));
        }
        walkF(n.children);
      });
    walkF(h.doc.nodes);
  }
  const mode = composed.fold.mode;
  const ids = composed.fold.ids.filter((k) => !regionKeys.has(k));
  const same = mode === root.fold.mode && ids.length === root.fold.ids.length && ids.every((k, i) => k === root.fold.ids[i]);
  if (same) return root;
  return {
    ...root,
    fold: { mode, ids },
    ...(root.frontmatter ? { frontmatter: { ...root.frontmatter, foldIds: [...ids], foldMode: mode } } : {}),
  };
}

/**
 * Wire Outline (`attachOutlineTree` / `toHtml`) to the shared store: pass the returned
 * `getDoc` / `setDoc` instead of the root doc's own. Map reads the same store (FOLD-9).
 */
export function regionOutlineBridge(o: {
  getRootDoc: () => OutlineFoldDoc;
  setRootDoc: (d: OutlineFoldDoc) => void;
  getHosts: () => readonly OutlineRegionHost[];
  store: RegionFoldStore;
}): { getDoc: () => OutlineFoldDoc; setDoc: (d: OutlineFoldDoc) => void } {
  return {
    getDoc: () => composeOutlineDoc(o.getRootDoc(), o.getHosts(), o.store),
    setDoc: (d) => {
      const root = o.getRootDoc();
      const next = commitOutlineFold(d, root, o.getHosts(), o.store);
      if (next !== root) o.setRootDoc(next);
    },
  };
}

/**
 * Handle `reveal` / `focus` commands for scoped ids (§R1 d, FOLD-8): unfold the path (root
 * doc ids through `setRootDoc`, region levels in the store), then `onTarget` with the id that
 * is visible. A sealed region on the path stops the reveal at its root and calls `onLocked`.
 */
export function revealScopedId(
  id: ScopedId,
  o: {
    store: RegionFoldStore;
    hosts: readonly OutlineRegionHost[];
    getRootDoc: () => OutlineFoldDoc;
    setRootDoc: (d: OutlineFoldDoc) => void;
    parse: (id: ScopedId) => { region: RegionId; id: string };
    onLocked?: (region: RegionId) => void;
  },
): RegionRevealResult {
  const known = new Set(o.hosts.map((h) => h.id));
  let region: RegionId;
  let local: string | null;
  if (known.has(id)) {
    region = id;
    local = null;
  } else {
    const p = o.parse(id);
    region = p.region;
    local = p.id;
  }
  const root = o.getRootDoc();
  const res = revealInRegions(o.store, region, local, revealContextFromHosts(o.hosts, root));
  if (!res.lockedRegion && local === null && region) o.store.setRegionFolded(region, false);
  if (res.rootUnfold.length) {
    let d = root;
    for (const a of res.rootUnfold) {
      const ids = d.fold.mode === '-' ? d.fold.ids.filter((k) => k !== a) : [...d.fold.ids, a];
      d = { ...d, fold: { mode: d.fold.mode, ids }, ...(d.frontmatter ? { frontmatter: { ...d.frontmatter, foldIds: [...ids], foldMode: d.fold.mode } } : {}) };
    }
    o.setRootDoc(d);
  }
  if (res.lockedRegion) o.onLocked?.(res.lockedRegion);
  return res;
}
