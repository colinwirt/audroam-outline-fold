/**
 * 0.4.8: `createOutlineDoc` — the one owner of a note's text, its parsed root doc and the
 * seal sessions (v1 spec R-1 "doc owner"). Every pane (CodeMirror text, Map, Outline)
 * reads and writes through this handle; there is no `<textarea>` and no host-side copy.
 *
 * Save protocol (host adapter):
 *   doc.on('save-needed', ({ rev }) => …)   debounced (~400 ms) after text / Map / zone edits
 *   const { text, rev } = await doc.serialise()   re-seals dirty zones first (auto-ct, fresh IV)
 *   PUT text → doc.saved(rev) | doc.failed(rev, err)
 * A zone "Save & re-seal" is only `confirmed` in `status()` after `saved(rev)`; a failure keeps
 * the doc dirty, keeps the auto-ct slot in the text, and schedules a retry `save-needed`.
 */
import { toggleTaskLine } from './task.js';
import type { TaskState } from './types.js';
import { createIdAllocator, type IdDiagnostic, type IdScope } from './idAllocator.js';
import { parse } from './parse.js';
import { serialize } from './serialize.js';
import { mergeKeeping } from './textMerge.js';
import type { OutlineFoldDoc, OutlineNode } from './types.js';
import {
  createSealSessions,
  regionHostsFromSessions,
  type SealSessions,
  type SealSessionsOptions,
  type LockReason,
} from './sealSession.js';
import type { RegionHostSpec } from './regionLayout.js';
import type { RegionId } from './hostApi.js';
import { createRegionFoldStore, bindRegionFoldToSessions, composeOutlineDoc, type RegionFoldStore } from './regionFold.js';
import { createFocusLink, type FocusLink } from './focusLink.js';
import { mountUnlockPrompt } from './sealUi.js';
import { sealBranch } from './sealedBranch.js';
import { parseScopedId } from './scopedId.js';

export type { IdDiagnostic } from './idAllocator.js';
export type SaveReason = 'text' | 'map' | 'zone' | 'seal' | 'host' | 'retry';
export type TextSource = 'text' | 'map' | 'zone' | 'seal' | 'host' | 'load' | 'serialise' | 'ids';

export class SealedStateError extends Error {
  readonly regions: RegionId[];
  constructor(message: string, regions: RegionId[]) {
    super(message);
    this.name = 'SealedStateError';
    this.regions = regions;
  }
}

export interface OutlineDocChange { text: string; rev: number; source: TextSource }
export interface SaveNeeded { rev: number; reason: SaveReason }
export interface RegionStatus { region: RegionId; branchId: string; state: 'dirty' | 'pending' | 'confirmed' | 'clean' }
export interface OutlineDocStatus {
  rev: number;
  savedRev: number;
  dirty: boolean;
  inflight: number | null;
  error: unknown;
  regions: RegionStatus[];
}
export interface RevealRequest { from: number; to: number; select: boolean }

type Events = {
  change: OutlineDocChange;
  'save-needed': SaveNeeded;
  status: OutlineDocStatus;
  caret: { pos: number };
  reveal: RevealRequest;
  seal: { type: string; region?: RegionId; [k: string]: unknown };
  /** 0.4.9: a duplicate id was renumbered or flagged (bug C). */
  ids: IdDiagnostic;
};

export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (t: unknown) => void;
}

export interface OutlineDocOptions {
  text: string;
  /** `{ noteId, ownerId }` bound into the ciphertext AAD. */
  ctx?: () => { noteId?: string | number; ownerId?: string | number };
  /** Root doc → text. Default `serialize`. Hosts keep their own tags / width here. */
  serializeRoot?: (root: OutlineFoldDoc, prevText: string) => string;
  /** Text → root doc. Default `parse`. */
  parseText?: (text: string) => OutlineFoldDoc;
  /** Debounce for `save-needed` (default 400 ms). */
  debounceMs?: number;
  timers?: Timers;
  autoLockMs?: number;
  wipeOnPagehide?: boolean;
  backoffMs?: SealSessionsOptions['backoffMs'];
  confirmLockDirty?: SealSessionsOptions['confirmLockDirty'];
  confirmUnlockToo?: SealSessionsOptions['confirmUnlockToo'];
  onFocus?: (id: string) => void;
  /** Seal cipher for `sealNode` (default a256gcm). */
  sealCipher?: string;
}

export interface OutlineDocHandle {
  getText(): string;
  /** 0.4.9: a fresh id unique across the root, every open region and the anchors. */
  mintId(): string;
  /** 0.4.9: every id in use (root, open regions, anchors). */
  idsInUse(): Set<string>;
  /** Replace the text. `source: 'load'` resets the clean baseline and locks open zones. */
  setText(text: string, o?: { source?: TextSource; reason?: SaveReason }): void;
  readonly rev: number;
  serialise(): Promise<{ text: string; rev: number }>;
  saved(rev: number): void;
  failed(rev: number, err?: unknown): void;
  status(): OutlineDocStatus;
  on<K extends keyof Events>(type: K, fn: (e: Events[K]) => void): () => void;
  /** Caret offset last reported by the text editor (no doc change, no rev bump). */
  caret(): number;
  setCaret(pos: number): void;
  /** Ask the text editor to show (and optionally select) a range: Follow / Show in text. */
  reveal(from: number, to: number, o?: { select?: boolean }): void;
  /** Editor hook: unlocked regions the Text pane cannot show. serialise() refuses while non-empty. */
  setZoneProbe(fn: (() => RegionId[]) | null): void;
  root(): OutlineFoldDoc;
  readonly sessions: SealSessions;
  readonly store: RegionFoldStore;
  readonly focusLink: FocusLink;
  regionFor(branchId: string): RegionId;
  branchOf(region: RegionId): string;
  isOpen(branchId: string): boolean;
  openRegions(): { region: RegionId; branchId: string; kid: string | null; dirty: boolean }[];
  regionHosts(): RegionHostSpec[];
  outlineDoc(view?: OutlineFoldDoc | null): OutlineFoldDoc;
  scoped(id: string): { region: string; id: string };
  regionNode(id: string): OutlineNode | null;
  hasRegionChildren(id: string): boolean;
  toggleRegionFold(id: string): boolean;
  toggleRegionTask(id: string): boolean;
  /** 0.4.15: cycle a main-doc task marker as a one-line text edit (never re-serialises). */
  toggleTask(id: string): { from: TaskState; to: TaskState } | null;
  mapOptions(onUnlock?: (region: RegionId) => void, onMore?: (branchId: string, rect: DOMRect) => void): {
    getRegionHosts: () => RegionHostSpec[];
    regionFold: RegionFoldStore;
    onRegionUnlock: (region: RegionId) => void;
    onRegionLock: (region: RegionId) => void;
    onRegionMore: (region: RegionId, rect: DOMRect) => void;
    onRegionTaskToggle: (id: string) => boolean;
    onMainTaskToggle: (id: string) => { from: TaskState; to: TaskState } | null;
  };
  unlock(branchId: string, anchorEl?: HTMLElement | null, o?: { label?: string; container?: HTMLElement; inline?: boolean }): Promise<boolean>;
  lock(branchId: string | 'all', reason?: LockReason): Promise<void>;
  saveRegion(region: RegionId): Promise<void>;
  removeSeal(branchId: string, passphrase: string): Promise<boolean>;
  /** Seal a plain branch of `view` (default the root) with an unlocked key, then write the text. */
  sealNode(node: OutlineNode, kid: string, view?: OutlineFoldDoc): Promise<void>;
  touch(): void;
  idleRemainingMs(): number | null;
  destroy(): void;
}

function walk(nodes: OutlineNode[] | undefined, fn: (n: OutlineNode) => void): void {
  for (const n of nodes || []) { if (!n) continue; fn(n); walk(n.children, fn); }
}
function find(nodes: OutlineNode[] | undefined, id: string): OutlineNode | null {
  let hit: OutlineNode | null = null;
  walk(nodes, (n) => { if (!hit && n.id === id) hit = n; });
  return hit;
}
function replace(nodes: OutlineNode[] | undefined, from: OutlineNode, to: OutlineNode): boolean {
  if (!nodes) return false;
  const i = nodes.indexOf(from);
  if (i >= 0) { nodes[i] = to; return true; }
  return nodes.some((n) => n && replace(n.children, from, to));
}
/** Region rows with no stored id get a session id (autoId: never serialized, never sealed). */
function pinIds(doc: OutlineFoldDoc | null): void {
  const used = new Set<string>();
  walk(doc?.nodes, (n) => { if (n.id) used.add(String(n.id)); });
  let seq = 1;
  walk(doc?.nodes, (n) => {
    if (n.id) return;
    while (used.has('z' + seq)) seq++;
    n.id = 'z' + seq; n.autoId = true; used.add(n.id);
  });
}

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
};

export function createOutlineDoc(o: OutlineDocOptions): OutlineDocHandle {
  const timers = o.timers ?? defaultTimers;
  const debounceMs = o.debounceMs ?? 400;
  const parseText = o.parseText ?? ((t: string) => parse(t));
  const serializeRoot = o.serializeRoot ?? ((r: OutlineFoldDoc) => serialize(r));
  let text = String(o.text ?? '');
  let rev = 0;
  let savedRev = 0;
  let inflight: number | null = null;
  let lastError: unknown = null;
  let caretPos = 0;
  let parsed: OutlineFoldDoc | null = null;
  let parsedText: string | null = null;
  let zoneProbe: (() => RegionId[]) | null = null;
  let saveTimer: unknown = null;
  let pendingReason: SaveReason | null = null;
  let destroyed = false;
  /** Zone re-seals waiting for the host ack: region → rev that carries the new ct. */
  const pendingSeal = new Map<RegionId, number>();
  const confirmed = new Set<RegionId>();
  const listeners = new Map<string, Set<(e: unknown) => void>>();

  const emit = <K extends keyof Events>(type: K, e: Events[K]): void => {
    for (const fn of [...(listeners.get(type) ?? [])]) {
      try { fn(e); } catch { /* a broken listener must not break the doc */ }
    }
  };

  const pinned = new Map<RegionId, OutlineNode>();
  const rootNow = (): OutlineFoldDoc => {
    if (parsedText !== text || !parsed) {
      try { parsed = parseText(text); } catch { parsed = { nodes: [], fold: { mode: '-', ids: [] } } as unknown as OutlineFoldDoc; }
      parsedText = text;
      rebind();
    }
    return parsed!;
  };
  // Viewers keep their host doc; the proxy keeps that pointing at the live root.
  const live = new Proxy({} as OutlineFoldDoc, {
    get: (_t, k) => (rootNow() as unknown as Record<PropertyKey, unknown>)[k],
    set: (_t, k, v) => { (rootNow() as unknown as Record<PropertyKey, unknown>)[k] = v; return true; },
    has: (_t, k) => k in rootNow(),
    ownKeys: () => Reflect.ownKeys(rootNow()),
    getOwnPropertyDescriptor: (_t, k) => {
      const d = Reflect.getOwnPropertyDescriptor(rootNow(), k);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
  const ctx = {
    get noteId() { return String(o.ctx?.().noteId ?? ''); },
    get ownerId() { return String(o.ctx?.().ownerId ?? ''); },
  };
  const sessions = createSealSessions({
    getDoc: () => live,
    ctx,
    autoLockMs: o.autoLockMs,
    wipeOnPagehide: o.wipeOnPagehide,
    backoffMs: o.backoffMs,
    confirmUnlockToo: o.confirmUnlockToo,
    onFocusCommand: (id) => o.onFocus?.(id),
    confirmLockDirty: o.confirmLockDirty ?? (() => 'save'),
  });
  const store = createRegionFoldStore();
  const focusLink = createFocusLink();
  const offFold = bindRegionFoldToSessions(store, sessions);
  const branchOf = (region: RegionId) => sessions.get(region).branchId;

  function rebind(): void {
    if (!parsed) return;
    for (const [region, node] of [...pinned]) {
      const cur = find(parsed.nodes, branchOf(region));
      if (cur === node) continue;
      if (!cur || !cur.sealed || !node) { pinned.delete(region); void sessions.lock(region, 'user'); continue; }
      replace(parsed.nodes, cur, node);
    }
  }

  const status = (): OutlineDocStatus => {
    const regions: RegionStatus[] = [];
    for (const s of sessions.list()) {
      if (s.parent) continue;
      const state: RegionStatus['state'] = s.dirty ? 'dirty'
        : pendingSeal.has(s.region) ? 'pending'
          : confirmed.has(s.region) ? 'confirmed' : 'clean';
      regions.push({ region: s.region, branchId: s.branchId, state });
    }
    for (const [region] of pendingSeal) if (!regions.some((r) => r.region === region)) regions.push({ region, branchId: branchOf(region), state: 'pending' });
    return { rev, savedRev, dirty: rev > savedRev, inflight, error: lastError, regions };
  };
  const emitStatus = () => emit('status', status());

  const schedule = (reason: SaveReason, ms = debounceMs): void => {
    if (destroyed) return;
    pendingReason = reason;
    if (saveTimer != null) timers.clear(saveTimer);
    saveTimer = timers.set(() => {
      saveTimer = null;
      const r = pendingReason ?? reason;
      pendingReason = null;
      emit('save-needed', { rev, reason: r });
    }, ms);
  };

  /** Write the root doc back into the text (seal / zone / remove seal). */
  const writeRoot = (source: TextSource): boolean => {
    const root = rootNow();
    let next: string;
    // 0.4.15: a refused serialise (e.g. the strict sealed-save guard on a re-captioned sealed
    // line) is a reported save failure, never a throw into the caller (Map click, zone save).
    // The text stays as the user left it.
    try { next = serializeRoot(root, text); } catch (err) { lastError = err; emitStatus(); return false; }
    if (next === text) return false;
    // 0.4.11 (bugs D/E): replace only the lines the root change touched; the user's empty
    // nodes and whitespace elsewhere stay byte for byte.
    let norm = next;
    try { norm = serializeRoot(parseText(text), text); } catch { /* unparsable: take next */ }
    const merged = mergeKeeping(text, norm, next);
    if (merged === text) return false;
    text = merged;
    parsedText = text; // the parsed root is this text (up to whitespace): keep pinned node objects
    emit('change', { text, rev, source });
    return true;
  };

  // 0.4.9 (bug C): one allocator for every id in the note.
  const ids = createIdAllocator();
  const scopes = (): IdScope[] => {
    const out: IdScope[] = [{ region: '', doc: rootNow() }];
    for (const s of sessions.list()) if (!s.locked && s.doc) out.push({ region: s.region, doc: s.doc, anchorId: s.branchId });
    return out;
  };
  let checking = false;
  /** Renumber newer duplicates (or flag linked ones) and write the fixes back. */
  const checkIds = (): void => {
    if (checking) return;
    checking = true;
    try {
      const sc = scopes();
      const links = [text, ...sc.slice(1).map((x) => { try { return serialize(x.doc!); } catch { return ''; } })].join('\n');
      const { changed, diagnostics } = ids.reconcile(sc, links);
      if (changed.has('')) { rev++; if (writeRoot('ids')) schedule('text'); else rev--; }
      for (const r of changed) if (r) { sessions.markChanged(r); }
      for (const d of diagnostics) emit('ids', d);
    } finally { checking = false; }
  };

  const offs: (() => void)[] = [];
  offs.push(sessions.api.on('unlock', (e) => {
    const s = sessions.get(e.region);
    if (!s.parent) { const n = find(rootNow().nodes, s.branchId); if (n) pinned.set(e.region, n); }
    pinIds(s.doc);
    checkIds();
    emit('seal', e as Events['seal']);
  }));
  offs.push(sessions.api.on('lock', (e) => { pinned.delete(e.region); emit('seal', e as Events['seal']); }));
  offs.push(sessions.api.on('error', (e) => emit('seal', e as Events['seal'])));
  offs.push(sessions.api.on('save', (e) => {
    // A confirmed zone re-seal (Save & re-seal, lock-while-dirty, serialise): the new ct is in
    // the root; it reaches the text now and is `pending` until the host acks this rev.
    rev++;
    writeRoot('seal');
    confirmed.delete(e.region);
    pendingSeal.set(e.region, rev);
    emit('seal', e as Events['seal']);
    schedule('seal', 0);
    emitStatus();
  }));
  offs.push(sessions.api.on('change', (e) => {
    emit('seal', e as Events['seal']);
    if (!e.dirty) return;
    if (e.region === '') {
      // Root changed under the sessions (remove seal): text follows.
      rev++;
      writeRoot('seal');
      schedule('seal');
    } else {
      rev++;
      const top = e.region.split('/')[0]!;
      confirmed.delete(top);
      schedule('zone');
      checkIds();
    }
    emitStatus();
  }));

  const handle: OutlineDocHandle = {
    getText: () => text,
    mintId: () => ids.mint(scopes()),
    idsInUse: () => ids.inUse(scopes()),
    get rev() { return rev; },
    setText(next, opt = {}) {
      const value = next == null ? '' : String(next);
      const source = opt.source ?? 'host';
      if (source === 'load') {
        void sessions.lock('all', 'close');
        pinned.clear();
        pendingSeal.clear();
        confirmed.clear();
        if (saveTimer != null) { timers.clear(saveTimer); saveTimer = null; }
        text = value;
        rev++;
        savedRev = rev;
        lastError = null;
        emit('change', { text, rev, source });
        emitStatus();
        checkIds();
        return;
      }
      if (value === text) return;
      text = value;
      rev++;
      emit('change', { text, rev, source });
      schedule(opt.reason ?? (source === 'map' ? 'map' : source === 'zone' ? 'zone' : 'text'));
      emitStatus();
      checkIds();
    },
    async serialise() {
      const problems = zoneProbe?.() ?? [];
      if (problems.length) throw new SealedStateError('A sealed branch is open but not shown in Text.', problems);
      const bad: RegionId[] = [];
      // Deepest first: an inner autosave changes its parent's child doc.
      const open = sessions.list().filter((s) => !s.locked).sort((a, b) => b.region.length - a.region.length);
      for (const s of open) {
        if (s.state === 'error') { bad.push(s.region); continue; }
        if (!sessions.get(s.region).dirty) continue;
        try { await sessions.autosave(s.region); } catch { bad.push(s.region); }
      }
      if (bad.length) throw new SealedStateError('A sealed branch could not be re-sealed.', bad);
      if (open.length) writeRoot('serialise');
      inflight = rev;
      emitStatus();
      return { text, rev };
    },
    saved(r) {
      if (r > savedRev) savedRev = Math.min(r, rev);
      if (inflight != null && r >= inflight) inflight = null;
      lastError = null;
      for (const [region, at] of [...pendingSeal]) if (at <= r) { pendingSeal.delete(region); confirmed.add(region); }
      emitStatus();
    },
    failed(r, err) {
      if (inflight === r) inflight = null;
      lastError = err ?? new Error('save failed');
      // The re-sealed text (auto-ct and new ct alike) stays in the text; nothing is dropped.
      schedule('retry');
      emitStatus();
    },
    status,
    on(type, fn) {
      let set = listeners.get(type);
      if (!set) listeners.set(type, (set = new Set()));
      set.add(fn as (e: unknown) => void);
      return () => void set!.delete(fn as (e: unknown) => void);
    },
    caret: () => caretPos,
    setCaret(pos) {
      if (pos === caretPos) return;
      caretPos = pos;
      emit('caret', { pos });
    },
    reveal(from, to, opt = {}) { emit('reveal', { from, to, select: !!opt.select }); },
    setZoneProbe(fn) { zoneProbe = fn; },
    root: () => rootNow(),
    sessions,
    store,
    focusLink,
    regionFor: (b) => sessions.regionFor(String(b)),
    branchOf,
    isOpen: (b) => !sessions.get(sessions.regionFor(String(b))).locked,
    openRegions: () => sessions.list().filter((s) => !s.locked && !s.parent)
      .map((s) => ({ region: s.region, branchId: s.branchId, kid: s.kid, dirty: s.dirty })),
    regionHosts: () => regionHostsFromSessions(sessions, rootNow(), store),
    outlineDoc(view) {
      const base = view || rootNow();
      const h = regionHostsFromSessions(sessions, base, store);
      return h.some((x) => x.doc) ? composeOutlineDoc(base, h, store) : base;
    },
    scoped(id) {
      const p = parseScopedId(String(id || ''));
      if (p.region) return { region: p.region, id: p.id };
      if (/^s:/.test(String(id))) return { region: String(id), id: '' };
      return { region: '', id: p.id };
    },
    regionNode(id) {
      const p = handle.scoped(id);
      if (!p.region) return null;
      const s = sessions.get(p.region);
      return s.doc ? (p.id ? find(s.doc.nodes, p.id) : s.doc.nodes[0] || null) : null;
    },
    hasRegionChildren(id) {
      const p = handle.scoped(id);
      if (!p.region) {
        const s = sessions.get(sessions.regionFor(String(id)));
        return !!(s.doc && s.doc.nodes.length);
      }
      const n = handle.regionNode(id);
      return !!(n && n.children && n.children.length) || (!p.id && !!sessions.get(p.region).doc);
    },
    toggleRegionFold(id) {
      const p = handle.scoped(id);
      if (!p.region) return false;
      const s = sessions.get(p.region);
      if (!s.doc) return false;
      if (!p.id) store.setRegionFolded(p.region, !store.isRegionFolded(p.region));
      else store.setNodeCollapsed(p.region, p.id, !store.isNodeCollapsed(p.region, s.doc, p.id));
      sessions.touch();
      return true;
    },
    toggleRegionTask(id) {
      const n = handle.regionNode(id);
      if (!n || !n.task) return false;
      n.task = n.task === 'open' ? 'pending' : n.task === 'pending' ? 'done' : 'open';
      sessions.markChanged(handle.scoped(id).region);
      return true;
    },
    toggleTask(id) {
      const r = toggleTaskLine(handle.getText(), String(id));
      if (!r) return null;
      handle.setText(r.text, { source: 'host' });
      return { from: r.from, to: r.to };
    },
    mapOptions(onUnlock, onMore) {
      return {
        getRegionHosts: () => handle.regionHosts(),
        regionFold: store,
        onRegionUnlock: (region) => onUnlock?.(region),
        onRegionLock: (region) => { rootNow(); void sessions.lock(region, 'user'); },
        onRegionMore: (region, rect) => onMore?.(branchOf(region), rect),
        onRegionTaskToggle: (id) => handle.toggleRegionTask(id),
        onMainTaskToggle: (id) => handle.toggleTask(id),
      };
    },
    unlock(branchId, anchorEl, opt = {}) {
      const region = sessions.regionFor(String(branchId));
      if (!sessions.get(region).locked) return Promise.resolve(true);
      return mountUnlockPrompt({ sessions, region, anchorEl: anchorEl ?? undefined, label: opt.label, container: opt.container, inline: !!opt.inline } as Parameters<typeof mountUnlockPrompt>[0]).done;
    },
    lock(branchId, reason = 'user') {
      rootNow();
      return sessions.lock(branchId === 'all' ? 'all' : sessions.regionFor(String(branchId)), reason);
    },
    async saveRegion(region) {
      rootNow();
      const s = sessions.get(region);
      if (s.locked || !s.dirty) return;
      await sessions.save(region);
    },
    async removeSeal(branchId, passphrase) {
      rootNow();
      const region = sessions.regionFor(String(branchId));
      await sessions.removeSeal(region, passphrase);
      pinned.delete(region);
      // The sessions' save event already wrote the plain branch into the text (source 'seal').
      return !find(rootNow().nodes, String(branchId))?.sealed;
    },
    async sealNode(node, kid, view) {
      const target = view ?? rootNow();
      await sealBranch(target, node, kid, ctx, { cipher: (o.sealCipher ?? 'a256gcm') as 'a256gcm' });
      if (!view) { rev++; writeRoot('seal'); schedule('seal'); emitStatus(); }
    },
    touch: () => sessions.touch(),
    idleRemainingMs: () => sessions.idleRemainingMs(),
    destroy() {
      destroyed = true;
      if (saveTimer != null) timers.clear(saveTimer);
      offs.forEach((f) => f());
      offFold();
      try { sessions.destroy(); } catch { /* already gone */ }
      pinned.clear();
      listeners.clear();
    },
  };
  return handle;
}
