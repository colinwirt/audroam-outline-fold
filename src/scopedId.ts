/**
 * Per-region id space (spec 20261101 §2, §8.3). Each child instance assigns ids inside its
 * own space; the public id is `regionId:nodeId` (e.g. `s:b7:3`). Root region is `""`, so
 * root ids are unchanged. Payloads only ever hold local ids; scoping happens at mount.
 */
import type { RegionId, ScopedId } from './hostApi.js';

export function scopeId(region: RegionId, id: string): ScopedId {
  return region ? `${region}:${id}` : id;
}

/** Split at the last `:`; a bare id is in the root region. */
export function parseScopedId(s: ScopedId): { region: RegionId; id: string } {
  const i = s.lastIndexOf(':');
  // `s:b7` alone is a region id, not a node: treat ids with one colon after a kind prefix carefully.
  if (i < 0) return { region: '', id: s };
  const region = s.slice(0, i);
  if (!/^[sn]:/.test(region)) return { region: '', id: s };
  return { region, id: s.slice(i + 1) };
}

/** `<r:N>` → { id }, `<r:REGION:N>` → { region, id }. Null when not a jump. */
export function parseRegionRef(tag: string): { region?: RegionId; id: string } | null {
  const m = tag.trim().match(/^<\s*r\s*:\s*([^>]+?)\s*>$/i);
  if (!m) return null;
  const body = m[1]!;
  const i = body.lastIndexOf(':');
  if (i < 0) return { id: body };
  return { region: body.slice(0, i), id: body.slice(i + 1) };
}

export interface RegionResolver {
  /** Parent region of a region (root `""` has none → null). */
  parentOf(region: RegionId): RegionId | null;
  /** Node `id` exists in the (readable) doc of `region`. */
  has(region: RegionId, id: string): boolean;
  /** Region is a sealed region whose session is not unlocked. */
  isLocked(region: RegionId): boolean;
  /** Region known at all (mounted, sealed or not). */
  exists(region: RegionId): boolean;
}

export type ResolvedRef =
  | { kind: 'node'; id: ScopedId }
  /** Target lies in a locked region: jump to the region root, show "🔒 locked target", never the label. */
  | { kind: 'locked'; region: RegionId; id: ScopedId }
  | { kind: 'missing' };

/** Innermost locked region on the path root → `region`, if any. */
function lockedAncestor(region: RegionId, r: RegionResolver): RegionId | null {
  const chain: RegionId[] = [];
  for (let c: RegionId | null = region; c; c = r.parentOf(c)) chain.unshift(c);
  for (const c of chain) if (r.isLocked(c)) return c;
  return null;
}

/** Region root: the anchor line in the parent region (the `<enc:KEYID>` line for sealed). */
function regionRoot(region: RegionId, r: RegionResolver): ScopedId {
  const parent = r.parentOf(region) ?? '';
  const branch = region.split('/').pop()!.replace(/^[sn]:/, '');
  return scopeId(parent, branch);
}

/**
 * Resolve a jump. `<r:N>`: own region, then parent regions outward to root.
 * `<r:REGION:N>`: that region directly; while sealed it goes to the region root (§8.3).
 */
export function resolveRegionRef(ref: { region?: RegionId; id: string }, from: RegionId, r: RegionResolver): ResolvedRef {
  if (ref.region !== undefined) {
    if (!r.exists(ref.region)) return { kind: 'missing' };
    const locked = lockedAncestor(ref.region, r);
    if (locked) return { kind: 'locked', region: locked, id: regionRoot(locked, r) };
    return r.has(ref.region, ref.id) ? { kind: 'node', id: scopeId(ref.region, ref.id) } : { kind: 'missing' };
  }
  for (let c: RegionId | null = from; c !== null; c = r.parentOf(c)) {
    if (!r.isLocked(c) && r.has(c, ref.id)) return { kind: 'node', id: scopeId(c, ref.id) };
    if (c === '') break;
  }
  return { kind: 'missing' };
}

/** Text for a link whose target is locked: never the target label. */
export const LOCKED_TARGET_LABEL = '🔒 locked target';
