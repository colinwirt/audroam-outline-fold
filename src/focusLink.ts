/**
 * One shared focus state keyed by scoped id (Map ⇄ Outline ⇄ editor). Views call `set` when
 * their focus moves and subscribe to follow. Loop guard: a `set` with the current id is a
 * no-op, and a `set` made while listeners run (a follower echoing back) is ignored.
 */
import type { FocusSource, HostApi, ScopedId } from './hostApi.js';

export interface FocusLink {
  get(): ScopedId | null;
  /** Returns true when focus moved (and `focusChange` was emitted). */
  set(id: ScopedId, source: FocusSource): boolean;
  /** Followers: called with the new id and who moved it (skip your own source). */
  subscribe(fn: (id: ScopedId, source: FocusSource) => void): () => void;
}

export function createFocusLink(api?: HostApi): FocusLink {
  let cur: ScopedId | null = null;
  let busy = false;
  const subs = new Set<(id: ScopedId, source: FocusSource) => void>();
  return {
    get: () => cur,
    set(id, source) {
      if (busy || !id || id === cur) return false;
      cur = id;
      busy = true;
      try {
        for (const fn of [...subs]) {
          try { fn(id, source); } catch { /* one broken follower must not stop the rest */ }
        }
      } finally {
        busy = false;
      }
      api?.emit({ type: 'focusChange', id, source });
      return true;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
}
