/**
 * Map session resume helpers (v1 localStorage).
 * Keys: Pages `of-map:{origin}:{docKey}`; Audroam `of-map:pnid:{pnid}`.
 * Store ids + numbers only — never sealed body.
 */

import type { FoldState } from './types.js';

export interface MapCameraState {
  x: number;
  y: number;
  k: number;
}

/** Per-node nudges overlay authored sidecar. */
export interface MapNodeNudge {
  x: number;
  y: number;
  wrapCh?: number;
  /** Product clip; null = unlimited (soft safety only). Default ~30 when omitted. */
  maxLines?: number | null;
  /** Remember more/less body reveal (orthogonal to child fold). */
  bodyExpanded?: boolean;
}

export interface MapResumeState {
  version: 1;
  fold?: FoldState;
  camera?: MapCameraState;
  nudges?: Record<string, MapNodeNudge>;
  focusId?: string;
  savedAt?: number;
}

export interface MapResumeKeyParts {
  /** `pages` → of-map:{origin}:{docKey}; `pnid` → of-map:pnid:{pnid} */
  kind: 'pages' | 'pnid';
  origin?: string;
  docKey?: string;
  pnid?: string | number;
}

/** Minimal layout shape for overlay (avoids cycle with mapView). */
export interface ResumeLayoutLike {
  nodes?: Record<
    string,
    {
      x?: number;
      y?: number;
      wrapCh?: number;
      maxLines?: number | null;
      bodyExpanded?: boolean;
    }
  >;
  [key: string]: unknown;
}

export function mapResumeStorageKey(parts: MapResumeKeyParts): string {
  if (parts.kind === 'pnid') {
    return `of-map:pnid:${parts.pnid}`;
  }
  const origin = parts.origin ?? '';
  const docKey = parts.docKey ?? '';
  return `of-map:${origin}:${docKey}`;
}

/** Stable Pages docKey from doc URL (+ optional layout URL). */
export function pagesDocKey(docUrl: string, layoutUrl?: string | null): string {
  const base = String(docUrl);
  const layout = layoutUrl ? `|${layoutUrl}` : '';
  let h = 0;
  const s = base + layout;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  const leaf = base.split('/').pop() || 'doc';
  return `${leaf}:${(h >>> 0).toString(36)}`;
}

function lsGet(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    /* private mode / quota */
  }
}

function lsRemove(key: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function loadMapResume(key: string): MapResumeState | null {
  const raw = lsGet(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as MapResumeState;
    if (!parsed || parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveMapResume(key: string, state: MapResumeState): void {
  const payload: MapResumeState = {
    version: 1,
    fold: state.fold
      ? { mode: state.fold.mode, ids: [...state.fold.ids] }
      : undefined,
    camera: state.camera
      ? { x: state.camera.x, y: state.camera.y, k: state.camera.k }
      : undefined,
    nudges: state.nudges ? { ...state.nudges } : undefined,
    focusId: state.focusId,
    savedAt: Date.now(),
  };
  lsSet(key, JSON.stringify(payload));
}

export function clearMapResume(key: string): void {
  lsRemove(key);
}

export interface StaleCheckResult {
  stale: boolean;
  missingRatio: number;
}

/** Soft-stale when many fold ids no longer exist in the outline. */
export function isResumeStale(
  resume: MapResumeState,
  docIds: Set<string> | string[],
  opts: { missingThreshold?: number } = {},
): StaleCheckResult {
  const threshold = opts.missingThreshold ?? 0.4;
  const ids = resume.fold?.ids || [];
  if (!ids.length) return { stale: false, missingRatio: 0 };
  const set = docIds instanceof Set ? docIds : new Set(docIds);
  let missing = 0;
  for (const id of ids) {
    if (!set.has(id)) missing++;
  }
  const missingRatio = missing / ids.length;
  return { stale: missingRatio > threshold, missingRatio };
}

export function collectNodeIds(
  nodes: { id?: string; children?: unknown[] }[],
  out: string[] = [],
): string[] {
  for (const n of nodes || []) {
    if (n?.id) out.push(n.id);
    if (Array.isArray(n.children) && n.children.length) {
      collectNodeIds(
        n.children as { id?: string; children?: unknown[] }[],
        out,
      );
    }
  }
  return out;
}

/**
 * Merge resume nudges over authored sidecar positions.
 * Authored sidecar is base; resume x/y/wrapCh/maxLines overlay per id.
 */
export function overlayResumeOnLayout<T extends ResumeLayoutLike>(
  layout: T,
  resume: MapResumeState | null | undefined,
): T {
  if (!resume?.nudges) return layout;
  const nodes: Record<string, MapNodeNudge> = {};
  for (const [id, pos] of Object.entries(layout.nodes || {})) {
    if (!pos || typeof (pos as MapNodeNudge).x !== 'number') continue;
    const p = pos as MapNodeNudge;
    nodes[id] = {
      x: p.x,
      y: p.y,
      wrapCh: p.wrapCh,
      maxLines: p.maxLines,
      bodyExpanded: p.bodyExpanded,
    };
  }
  for (const [id, nudge] of Object.entries(resume.nudges)) {
    const base = nodes[id] || { x: nudge.x, y: nudge.y };
    nodes[id] = {
      x: typeof nudge.x === 'number' ? nudge.x : base.x,
      y: typeof nudge.y === 'number' ? nudge.y : base.y,
      wrapCh:
        typeof nudge.wrapCh === 'number' ? nudge.wrapCh : base.wrapCh,
      maxLines:
        nudge.maxLines === null
          ? null
          : typeof nudge.maxLines === 'number'
            ? nudge.maxLines
            : base.maxLines,
      bodyExpanded:
        typeof nudge.bodyExpanded === 'boolean'
          ? nudge.bodyExpanded
          : base.bodyExpanded,
    };
  }
  return { ...layout, nodes };
}

/** Soft-reset stale resume: drop fold + nudges; optionally keep camera. */
export function softResetResume(
  resume: MapResumeState,
  opts: { keepCamera?: boolean } = {},
): MapResumeState {
  return {
    version: 1,
    camera: opts.keepCamera !== false ? resume.camera : undefined,
    savedAt: resume.savedAt,
  };
}

export type DebouncedSave = {
  (state: MapResumeState): void;
  flush: () => void;
  cancel: () => void;
};

/** Debounce localStorage writes (default 400ms within 300–500 band). */
export function createDebouncedResumeSave(
  key: string,
  ms = 400,
): DebouncedSave {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: MapResumeState | null = null;
  const run = ((state: MapResumeState) => {
    pending = state;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (pending) saveMapResume(key, pending);
      pending = null;
    }, ms);
  }) as DebouncedSave;
  run.flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (pending) saveMapResume(key, pending);
    pending = null;
  };
  run.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return run;
}
