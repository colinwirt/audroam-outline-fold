/**
 * One unseal state machine per sealed region (spec 20261101 §3, migration P2).
 *
 *   sealed ─open─▶ unlocking ─ok─▶ unlocked ─save─▶ saving ─ok─▶ unlocked
 *   unlocking ─fail─▶ error (still locked)   saving ─fail─▶ error (edits kept, retry save)
 *   unlocked ─lock/close/idle/parent─▶ sealed (child wiped)
 *
 * Views (Map, Outline, Text, banner) read `session.state` and never keep a copy.
 * Unlock is per tab: keys and plaintext live in this JS realm only (§8.1).
 */
import {
  SealError,
  MAX_SEAL_DEPTH,
  isKeyUnlocked,
  openSealedBranch,
  unlockKey,
  parseBranchCtV2,
  type SealContext,
  type SealedViewer,
} from './sealedBranch.js';
import { SEAL_ALG, isSealedBranchPayload } from './sealedState.js';
import { serialize } from './serialize.js';
import { DEFAULT_AUTO_LOCK_MS } from './payloads.js';
import { createHostApi, type HostApi, type OFErrorCode, type RegionId } from './hostApi.js';
import type { OutlineFoldDoc, OutlineNode } from './types.js';
import type { RegionHostSpec } from './regionLayout.js';
import type { RegionResolver } from './scopedId.js';

export type SealState = 'sealed' | 'unlocking' | 'unlocked' | 'saving' | 'error';
export type LockReason = 'user' | 'close' | 'parent' | 'idle';

export interface SealSessionSnapshot {
  readonly region: RegionId;
  readonly branchId: string;
  readonly state: SealState;
  readonly kid: string | null;
  readonly dirty: boolean;
  readonly error: { code: OFErrorCode; message: string } | null;
  /** Ui status string after a successful save ("Saved"), cleared on the next edit. */
  readonly saved: boolean;
  /** After a wrong passphrase: ms until the state recovers to `sealed` (MPE-1 back-off), else 0. */
  readonly retryAfterMs: number;
}

export interface SealSession extends SealSessionSnapshot {
  /** Parent region ("" = root document). */
  readonly parent: RegionId;
  /** Unlocked child document (memory only) or null while locked. */
  readonly doc: OutlineFoldDoc | null;
  /** True while plaintext is not available (sealed, unlocking, failed unlock). */
  readonly locked: boolean;
  subscribe(fn: (s: SealSessionSnapshot) => void): () => void;
}

export interface SealSessionsOptions {
  /** Root host document (the one that holds the `<enc:KEYID>` lines). */
  getDoc: () => OutlineFoldDoc;
  ctx: SealContext;
  api?: HostApi;
  /** Idle ms before auto-lock; default from the layout block `autoLock:` or 5 min. 0 = off. */
  autoLockMs?: number;
  /** "Unlock this branch too?" when the branch key is already unlocked in this tab. */
  confirmUnlockToo?: (region: RegionId) => boolean | Promise<boolean>;
  /** Lock with unsaved edits: save, discard or cancel. Default: save. */
  confirmLockDirty?: (region: RegionId) => 'save' | 'discard' | 'cancel' | Promise<'save' | 'discard' | 'cancel'>;
  /** Remove seal confirmation (after the passphrase check). Default: proceed. */
  confirmRemoveSeal?: (region: RegionId) => boolean | Promise<boolean>;
  /** Back-off after the n-th consecutive wrong passphrase (ms). Default 1s, 2s, 4s … capped at 30s. */
  backoffMs?: (failures: number) => number;
  /** `reveal` / `focus` / `setFocus` commands (FOLD-8): usually `map.setFocus` / `revealScoped`. */
  onFocusCommand?: (id: string, cmd: 'reveal' | 'focus' | 'setFocus', view?: 'map' | 'outline' | 'text') => void | Promise<void>;
  /** Install a `pagehide` wipe (default true when `window` exists). */
  wipeOnPagehide?: boolean;
}

export interface SealSessions {
  readonly api: HostApi;
  /** Region id for a branch: `s:<branchId>` (nested: `s:<outer>/<inner>`). */
  regionFor(branchId: string, parent?: RegionId): RegionId;
  get(region: RegionId): SealSession;
  list(): SealSession[];
  open(region: RegionId, passphrase?: string): Promise<void>;
  save(region: RegionId): Promise<void>;
  /**
   * 0.4.8: write the region's current text into its SEAL-DRAFT autosave slot (`auto-ct`,
   * fresh nonce). Nested regions autosave outward to the root. True when a slot was written.
   * Throws when the key is locked (the caller holds the save: SealedStateError).
   */
  autosave(region: RegionId): Promise<boolean>;
  lock(region: RegionId | 'all', reason?: LockReason): Promise<void>;
  /** Re-auth with the passphrase (always, §8.6), then inline the children into the parent. */
  removeSeal(region: RegionId, passphrase: string): Promise<void>;
  /** Host calls after edits in a child doc; emits `change`. */
  markChanged(region: RegionId): void;
  /** Reset the idle timer (host calls on input). */
  touch(): void;
  /** Ms left before the idle auto-lock (null when off or nothing is unlocked). For the "Idle lock m:ss" countdown. */
  idleRemainingMs(now?: number): number | null;
  /** Idle-lock ms in effect (option, then layout-block `autoLock:`, then 5 min; 0 = off). */
  autoLockMs(): number;
  /** Banner for a region, derived from state only. */
  banner(region: RegionId): { kind: 'locked' | 'error'; text: string } | null;
  destroy(): void;
}

interface Impl {
  region: RegionId;
  parent: RegionId;
  branchId: string;
  state: SealState;
  error: { code: OFErrorCode; message: string } | null;
  viewer: SealedViewer | null;
  saved: boolean;
  failures: number;
  retryAt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  subs: Set<(s: SealSessionSnapshot) => void>;
}

function findNode(nodes: OutlineNode[] | undefined, id: string): OutlineNode | undefined {
  for (const n of nodes ?? []) {
    if (n.id === id) return n;
    const h = findNode(n.children, id);
    if (h) return h;
  }
  return undefined;
}

function kidOf(n: OutlineNode | undefined): string | null {
  const p = n?.sealed;
  if (!p || !isSealedBranchPayload(p)) return null;
  if (p.kid) return p.kid;
  if (p.alg === SEAL_ALG && p.ciphertext) {
    try {
      return parseBranchCtV2(p.ciphertext).kid;
    } catch {
      return null;
    }
  }
  return null;
}

const MESSAGES: Record<OFErrorCode, string> = {
  'bad-pass': 'Wrong passphrase',
  'aad-mismatch': 'This branch does not belong to this map',
  'too-large': 'Sealed branch is too large',
  depth: `Sealed branches nest at most ${MAX_SEAL_DEPTH} deep`,
  'save-failed': 'Save failed; your edits are kept, try again',
};

export function createSealSessions(opts: SealSessionsOptions): SealSessions {
  const api = opts.api ?? createHostApi();
  const map = new Map<RegionId, Impl>();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let idleDeadline = 0;
  const backoff = opts.backoffMs ?? ((n: number) => Math.min(30_000, 1000 * 2 ** Math.max(0, n - 1)));
  const idleMs = () => opts.autoLockMs ?? opts.getDoc().frontmatter?.autoLockMs ?? DEFAULT_AUTO_LOCK_MS;

  const docOf = (region: RegionId): OutlineFoldDoc | null =>
    region === '' ? opts.getDoc() : (map.get(region)?.viewer?.doc ?? null);

  const snap = (s: Impl): SealSession => {
    const pdoc = docOf(s.parent);
    return {
      region: s.region,
      parent: s.parent,
      branchId: s.branchId,
      state: s.state,
      kid: kidOf(pdoc ? findNode(pdoc.nodes, s.branchId) : undefined),
      dirty: !!s.viewer && !s.viewer.closed && s.viewer.isDirty(),
      error: s.error,
      saved: s.saved,
      retryAfterMs: s.state === 'error' && s.retryAt ? Math.max(0, s.retryAt - Date.now()) : 0,
      doc: s.viewer && !s.viewer.closed ? s.viewer.doc : null,
      locked: !s.viewer || s.viewer.closed,
      subscribe: (fn) => {
        s.subs.add(fn);
        return () => void s.subs.delete(fn);
      },
    };
  };

  const set = (s: Impl, state: SealState, error: Impl['error'] = null) => {
    s.state = state;
    s.error = error;
    const v = snap(s);
    for (const fn of [...s.subs]) {
      try {
        fn(v);
      } catch {
        /* a broken view must not break the machine */
      }
    }
  };

  const impl = (region: RegionId): Impl => {
    const s = map.get(region);
    if (s) return s;
    if (!region.startsWith('s:')) throw new Error(`outline-fold: not a sealed region id: ${region}`);
    const path = region.slice(2).split('/');
    const branchId = path[path.length - 1]!;
    const parent = path.length > 1 ? `s:${path.slice(0, -1).join('/')}` : '';
    const n: Impl = { region, parent, branchId, state: 'sealed', error: null, viewer: null, saved: false, failures: 0, retryAt: 0, retryTimer: null, subs: new Set() };
    map.set(region, n);
    return n;
  };

  const fail = (s: Impl, code: OFErrorCode) => {
    let retryAfterMs: number | undefined;
    if (code === 'bad-pass' && (!s.viewer || s.viewer.closed)) {
      // Wrong passphrase: back off, then recover error → sealed so the user can retry.
      s.failures++;
      retryAfterMs = backoff(s.failures);
      s.retryAt = Date.now() + retryAfterMs;
      if (s.retryTimer) clearTimeout(s.retryTimer);
      const recover = () => {
        s.retryTimer = null;
        s.retryAt = 0;
        if (s.state === 'error' && (!s.viewer || s.viewer.closed)) set(s, 'sealed');
      };
      if (retryAfterMs <= 0) recover();
      else {
        s.retryTimer = setTimeout(recover, retryAfterMs);
        (s.retryTimer as { unref?: () => void }).unref?.();
      }
      if (retryAfterMs <= 0) {
        set(s, 'error', { code, message: MESSAGES[code] });
        api.emit({ type: 'error', region: s.region, code, message: MESSAGES[code], retryAfterMs: 0 });
        recover();
        return;
      }
    }
    set(s, 'error', { code, message: MESSAGES[code] });
    api.emit({ type: 'error', region: s.region, code, message: MESSAGES[code], ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) });
  };

  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    idleDeadline = 0;
    const ms = idleMs();
    if (!ms || ![...map.values()].some((s) => s.viewer && !s.viewer.closed)) return;
    idleDeadline = Date.now() + ms;
    idleTimer = setTimeout(() => void self.lock("all", "idle"), ms);
    (idleTimer as { unref?: () => void }).unref?.();
  };

  const descendants = (region: RegionId) => [...map.values()].filter((s) => s.region.startsWith(region + '/'));

  const doLock = async (s: Impl, reason: LockReason): Promise<boolean> => {
    if (!s.viewer || s.viewer.closed) {
      if (s.state === 'error') set(s, 'sealed');
      return true;
    }
    // Deepest first, so a parent never wipes under an open child.
    for (const d of descendants(s.region).sort((a, b) => b.region.length - a.region.length))
      if (!(await doLock(d, 'parent'))) return false;
    if (s.viewer.isDirty()) {
      let choice: 'save' | 'discard' | 'cancel' = 'save';
      if (reason === 'user' && opts.confirmLockDirty) choice = await opts.confirmLockDirty(s.region);
      if (choice === 'cancel') return false;
      if (choice === 'save') {
        await self.save(s.region);
        if (s.state === 'error') return false; // keep edits, user retries
      }
    }
    s.viewer.close(); // wipes doc nodes; nested viewers close too
    s.viewer = null;
    s.saved = false;
    set(s, 'sealed');
    api.emit({ type: 'lock', region: s.region, reason });
    return true;
  };

  const onPagehide = () => {
    for (const s of map.values()) if (s.viewer) { s.viewer.close(); s.viewer = null; set(s, 'sealed'); }
  };
  if ((opts.wipeOnPagehide ?? true) && typeof window !== 'undefined') window.addEventListener('pagehide', onPagehide);

  const self: SealSessions = {
    api,
    regionFor(branchId, parent = '') {
      return parent ? `${parent}/${branchId}` : `s:${branchId}`;
    },
    get: (region) => snap(impl(region)),
    list: () => [...map.values()].map(snap),

    async open(region, passphrase) {
      const s = impl(region);
      if (s.state === 'unlocking' || s.state === 'saving' || (s.viewer && !s.viewer.closed)) return;
      if (s.state === 'error' && s.retryAt > Date.now()) return; // still backing off
      const pdoc = docOf(s.parent);
      if (!pdoc) return fail(s, 'bad-pass'); // parent still locked
      const node = findNode(pdoc.nodes, s.branchId);
      const kid = kidOf(node);
      if (!node || !kid) return fail(s, 'bad-pass');
      if (region.split('/').length > MAX_SEAL_DEPTH) return fail(s, 'depth');
      set(s, 'unlocking');
      try {
        if (passphrase === undefined || passphrase === '') {
          // §8.5: an already-unlocked key still needs an explicit yes; never silent.
          const ok = isKeyUnlocked(kid) && (await (opts.confirmUnlockToo?.(region) ?? false));
          if (!ok) {
            set(s, 'sealed');
            if (!isKeyUnlocked(kid)) fail(s, 'bad-pass');
            return;
          }
        } else {
          await unlockKey(pdoc, kid, passphrase);
        }
        const parent = s.parent ? map.get(s.parent)!.viewer! : null;
        s.viewer = parent ? await parent.open(s.branchId) : await openSealedBranch(pdoc, s.branchId, opts.ctx);
      } catch (e) {
        s.viewer = null;
        return fail(s, e instanceof SealError || !(e instanceof Error) ? 'bad-pass' : /depth/i.test(e.message) ? 'depth' : 'bad-pass');
      }
      s.failures = 0;
      s.retryAt = 0;
      set(s, 'unlocked');
      api.emit({ type: 'unlock', region });
      armIdle();
    },

    async save(region) {
      const s = impl(region);
      if (!s.viewer || s.viewer.closed || s.state === 'saving') return;
      set(s, 'saving');
      try {
        await s.viewer.save(); // same kid + mode, fresh salt/nonce, AAD rebuilt (sealedBranch)
        // Nested: the parent's child doc changed; save it outward to the root.
        if (s.parent) {
          await self.save(s.parent);
          const p = map.get(s.parent)!;
          if (p.state === 'error') throw new Error('parent save failed');
        }
      } catch {
        return fail(s, 'save-failed');
      }
      s.saved = true;
      set(s, 'unlocked');
      if (!s.parent) api.emit({ type: 'save', region, payload: serialize(opts.getDoc()) });
      api.emit({ type: 'change', region, dirty: false });
    },

    async autosave(region) {
      const s = impl(region);
      if (!s.viewer || s.viewer.closed) return false;
      let wrote = await s.viewer.autosave();
      if (s.parent) wrote = (await self.autosave(s.parent)) || wrote;
      return wrote;
    },

    async lock(region, reason = 'user') {
      const targets = region === 'all' ? [...map.values()].filter((s) => !s.parent) : [impl(region)];
      for (const s of targets) await doLock(s, reason);
      armIdle();
    },

    async removeSeal(region, passphrase) {
      const s = impl(region);
      const pdoc = docOf(s.parent);
      const node = pdoc ? findNode(pdoc.nodes, s.branchId) : undefined;
      const kid = kidOf(node);
      if (!pdoc || !node || !kid) return fail(s, 'bad-pass');
      try {
        await unlockKey(pdoc, kid, passphrase); // §8.6: always re-auth
      } catch {
        return fail(s, 'bad-pass');
      }
      if (!s.viewer || s.viewer.closed) {
        await self.open(region, passphrase);
        if (!s.viewer) return;
      }
      if (opts.confirmRemoveSeal && !(await opts.confirmRemoveSeal(region))) return;
      const root = s.viewer.doc.nodes[0]!;
      let nested = false;
      const scan = (l: OutlineNode[] | undefined) => l?.forEach((n) => { if (isSealedBranchPayload(n.sealed)) nested = true; scan(n.children); });
      scan(root.children);
      if (nested) {
        // Inner payloads bind the outer branch id in AAD; inlining would orphan them.
        return fail(s, 'aad-mismatch');
      }
      const taken = new Set<string>();
      const collect = (l: OutlineNode[] | undefined) => l?.forEach((n) => { if (n.id) taken.add(n.id); collect(n.children); });
      collect(pdoc.nodes);
      let seq = 1;
      const fresh = () => { while (taken.has(`u${seq}`)) seq++; taken.add(`u${seq}`); return `u${seq}`; };
      const clone = (l: OutlineNode[] | undefined, d: number): OutlineNode[] =>
        (l ?? []).map((n) => {
          const c: OutlineNode = { ...n, depth: d, children: clone(n.children, d + 1) };
          if (c.id && !c.autoId) c.id = taken.has(c.id) ? fresh() : (taken.add(c.id), c.id);
          return c;
        });
      const children = clone(root.children, node.depth + 1);
      const caption = root.title;
      for (const d of descendants(region)) map.delete(d.region);
      s.viewer.close();
      s.viewer = null;
      delete node.sealed;
      node.title = caption;
      node.children = children;
      map.delete(region);
      set(s, 'sealed');
      api.emit({ type: 'change', region: s.parent, dirty: true });
    },

    markChanged(region) {
      const s = impl(region);
      s.saved = false;
      set(s, s.state);
      api.emit({ type: 'change', region, dirty: snap(s).dirty });
      armIdle();
    },

    touch: armIdle,
    idleRemainingMs: (now = Date.now()) => (idleDeadline ? Math.max(0, idleDeadline - now) : null),
    autoLockMs: idleMs,

    banner(region) {
      const s = impl(region);
      if (s.state === 'error' && s.error) return { kind: 'error', text: s.error.message };
      if (s.state === 'sealed' || s.state === 'unlocking') return { kind: 'locked', text: 'Sealed branch (locked)' };
      return null;
    },

    destroy() {
      if (idleTimer) clearTimeout(idleTimer);
      for (const s of map.values()) if (s.retryTimer) clearTimeout(s.retryTimer);
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPagehide);
      onPagehide();
      map.clear();
    },
  };

  api.handle({
    open: (c) => self.open(c.region, c.passphrase),
    lock: (c) => self.lock(c.region, 'user'),
    reveal: (c) => opts.onFocusCommand?.(c.id, 'reveal'),
    focus: (c) => opts.onFocusCommand?.(c.id, 'focus', c.view),
    setFocus: (c) => opts.onFocusCommand?.(c.id, 'setFocus'),
  });
  return self;
}

// ---------- bridges: sessions → Map regions and link resolution ----------

/**
 * One region host per sealed branch (recursing into unlocked children). Locked branches
 * render as a folded lock pill; unlocked ones mount their child doc as a cloud.
 * `folded` overrides per view (never written into the payload).
 */
export function regionHostsFromSessions(
  sessions: SealSessions,
  rootDoc: OutlineFoldDoc,
  foldedOrStore: ((region: RegionId) => boolean) | { isRegionFolded(region: RegionId): boolean } = () => false,
): RegionHostSpec[] {
  // Pass the shared region fold store (§R1) so Map and Outline read one fold state.
  const folded = typeof foldedOrStore === 'function' ? foldedOrStore : (r: RegionId) => foldedOrStore.isRegionFolded(r);
  const out: RegionHostSpec[] = [];
  const scan = (doc: OutlineFoldDoc, parent: RegionId, depth: number) => {
    const visit = (l: OutlineNode[] | undefined) =>
      l?.forEach((n) => {
        if (n.id && isSealedBranchPayload(n.sealed)) {
          const region = sessions.regionFor(n.id, parent);
          const s = sessions.get(region);
          out.push({ id: region, kind: 'sealed', parent, anchor: n.id, doc: s.doc, folded: s.locked || folded(region), label: n.sealed?.pub, kid: s.kid });
          if (s.doc && depth < MAX_SEAL_DEPTH) scan(s.doc, region, depth + 1);
        } else visit(n.children);
      });
    visit(doc.nodes);
  };
  scan(rootDoc, '', 1);
  return out;
}

/** RegionResolver over sessions (sealed regions) for `resolveRegionRef`. */
export function sessionResolver(sessions: SealSessions, rootDoc: OutlineFoldDoc): RegionResolver {
  const docOf = (r: RegionId) => (r === '' ? rootDoc : sessions.get(r).doc);
  return {
    parentOf: (r) => (r === '' ? null : sessions.get(r).parent),
    has: (r, id) => !!findNode(docOf(r)?.nodes, id),
    isLocked: (r) => r !== '' && sessions.get(r).locked,
    exists: (r) => {
      if (r === '') return true;
      if (!r.startsWith('s:')) return false;
      const s = sessions.get(r);
      const p = s.parent === '' ? rootDoc : sessions.get(s.parent).doc;
      return p ? !!findNode(p.nodes, s.branchId) : true; // inside a locked parent: exists but unreadable
    },
  };
}
