/**
 * Typed host API (spec 20261101 §5, migration P1). Hosts subscribe with `on(type, fn)`
 * and drive the instance with `dispatch(command)`; they never touch DOM or session
 * internals. Events are emitted only after a state transition has been committed.
 */
export type RegionId = string;
/** `regionId:nodeId`; root-region ids have no prefix. */
export type ScopedId = string;

export type OFErrorCode = 'bad-pass' | 'aad-mismatch' | 'too-large' | 'depth' | 'save-failed';

export type OFEvent =
  | { type: 'unlock'; region: RegionId }
  | { type: 'lock'; region: RegionId; reason: 'user' | 'close' | 'parent' | 'idle' }
  | { type: 'save'; region: RegionId; payload: string }
  | { type: 'select'; id: ScopedId }
  | { type: 'change'; region: RegionId; dirty: boolean }
  | { type: 'error'; region?: RegionId; code: OFErrorCode; message: string };

export type OFCommand =
  | { cmd: 'open'; region: RegionId; passphrase: string }
  | { cmd: 'lock'; region: RegionId | 'all' }
  | { cmd: 'reveal'; id: ScopedId }
  | { cmd: 'focus'; id: ScopedId; view?: 'map' | 'outline' | 'text' };

export type OFEventOf<T extends OFEvent['type']> = Extract<OFEvent, { type: T }>;
export type OFCommandHandler = { [K in OFCommand['cmd']]?: (c: Extract<OFCommand, { cmd: K }>) => void | Promise<void> };

export interface HostApi {
  on<T extends OFEvent['type']>(type: T, fn: (e: OFEventOf<T>) => void): () => void;
  dispatch(c: OFCommand): Promise<void>;
  /** Internal: emit an event (instance side only). */
  emit(e: OFEvent): void;
  /** Internal: install / replace command handlers (instance side only). */
  handle(h: OFCommandHandler): void;
}

/** Event bus + command router. A listener that throws never blocks the others. */
export function createHostApi(handlers: OFCommandHandler = {}): HostApi {
  const subs = new Map<string, Set<(e: OFEvent) => void>>();
  let h: OFCommandHandler = { ...handlers };
  return {
    on(type, fn) {
      let s = subs.get(type);
      if (!s) subs.set(type, (s = new Set()));
      const f = fn as (e: OFEvent) => void;
      s.add(f);
      return () => void s!.delete(f);
    },
    emit(e) {
      for (const fn of [...(subs.get(e.type) ?? [])]) {
        try {
          fn(e);
        } catch (err) {
          if (typeof console !== 'undefined') console.error('outline-fold: host listener failed', err);
        }
      }
    },
    handle(next) {
      h = { ...h, ...next };
    },
    async dispatch(c) {
      const fn = h[c.cmd] as ((c: OFCommand) => void | Promise<void>) | undefined;
      if (!fn) throw new Error(`outline-fold: no handler for command "${c.cmd}"`);
      await fn(c);
    },
  };
}
