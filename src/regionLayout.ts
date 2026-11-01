/**
 * Layout for sub-map cloud regions (spec 20261101 §1, migration P3). Each child lays out in
 * its own local frame; the parent then reserves a band under the anchor's subtree that is
 * as large as the region hull, pushing every parent node (and earlier region) that would
 * intersect it downward. Regions under the same anchor stack in a column in source order.
 * Nested regions recurse up to MAX_SEAL_DEPTH. Pure: no DOM.
 */
import type { RegionId } from './hostApi.js';
import type { OutlineFoldDoc, OutlineNode } from './types.js';
import type { RegionBox } from './mapRegion.js';
import { scopeId } from './scopedId.js';
import { isCollapsed } from './fold.js';

function countAll(nodes: OutlineNode[] | undefined): number {
  let c = 0;
  for (const n of nodes ?? []) c += 1 + countAll(n.children);
  return c;
}

export const REGION_PAD = 14;
const LABEL_H = 14;
export const MAX_REGION_DEPTH = 4;

export interface RegionHostSpec {
  id: RegionId;
  kind: 'sealed' | 'record';
  /** Parent region of the anchor ("" = root map). */
  parent?: RegionId;
  /** Anchor node id (local to the parent region). */
  anchor: string;
  /** Child doc; null while locked (renders a folded pill). */
  doc: OutlineFoldDoc | null;
  folded: boolean;
  label?: string;
  /** Sealed key id (shown as the `k1` chip on the locked pill). */
  kid?: string | null;
}

export interface PlacedBox extends RegionBox {
  /** Scoped id (`regionId:nodeId`) or the region id itself for a folded pill. */
  key: string;
  title: string;
  depth: number;
  /** Region the box belongs to. */
  region?: RegionId;
  /** Local node id inside the region (absent for the region root pill). */
  localId?: string;
  /** True for the region root pill (whole region folded / sealed). */
  root?: boolean;
  /** Node has children (or the pill is a region root): draws the fold slot + handle. */
  foldable?: boolean;
  /** Collapsed: circle-+ and the count chip. */
  collapsed?: boolean;
  /** Hidden-count chip value when collapsed (0 = no chip). */
  hidden?: number;
}

export interface PlacedRegion {
  host: RegionHostSpec;
  hull: RegionBox;
  boxes: PlacedBox[];
  /** Parent-frame edges anchor → child roots, [x1,y1,x2,y2]. */
  edges: [number, number, number, number][];
}

export interface RegionLayoutDeps {
  /** Auto-pack a doc: centre points keyed by local node key (region-aware fold). */
  pack(doc: OutlineFoldDoc, region?: RegionId): Record<string, { x: number; y: number }>;
  /** Pill size of a node at key. */
  size(n: OutlineNode, key: string): { w: number; h: number };
  /** Ordered visible nodes with their position key. */
  visible(doc: OutlineFoldDoc, region?: RegionId): { n: OutlineNode; key: string; parentKey: string | null }[];
  /** Region root folded (§R1 b). Default: `host.folded`. Locked / missing doc always folds. */
  regionFolded?(host: RegionHostSpec): boolean;
  /** Node collapsed inside a region (§R1 a). Default: the child doc's own fold. */
  nodeCollapsed?(region: RegionId, doc: OutlineFoldDoc, id: string): boolean;
  /** Hidden-count chip for a folded region root (default: node count; none while locked). */
  rootHidden?(host: RegionHostSpec): number;
  gapY?: number;
  foldedPill?: { w: number; h: number };
}

interface Local {
  boxes: PlacedBox[];
  regions: PlacedRegion[];
  w: number;
  h: number;
}

function translate(l: Local, dx: number, dy: number): void {
  for (const b of l.boxes) { b.x += dx; b.y += dy; }
  for (const r of l.regions) {
    r.hull.x += dx; r.hull.y += dy;
    for (const b of r.boxes) { b.x += dx; b.y += dy; }
    for (const e of r.edges) { e[0] += dx; e[1] += dy; e[2] += dx; e[3] += dy; }
  }
}

/**
 * Lay out regions over the parent boxes. `boxes` holds every visible parent node in the
 * parent frame (top-left x/y); it is mutated in place (shifted down). Returns the placed
 * regions (in the same frame) — no parent box intersects any hull.
 */
export function placeRegions(
  boxes: Map<string, RegionBox>,
  childrenOf: (key: string) => string[],
  region: RegionId,
  hosts: RegionHostSpec[],
  deps: RegionLayoutDeps,
  depth = 0,
): PlacedRegion[] {
  const gap = deps.gapY ?? 14;
  const placed: PlacedRegion[] = [];
  const parents = new Map<string, string>();
  for (const k of boxes.keys()) for (const c of childrenOf(k)) parents.set(c, k);
  const parentKey = (k: string) => parents.get(k);
  const mine = hosts.filter((h) => (h.parent ?? '') === region && boxes.has(h.anchor));
  for (const host of mine) {
    const a = boxes.get(host.anchor)!;
    // Bottom of the anchor's visible subtree, plus earlier regions under the same anchor (column).
    let bottom = a.y + a.h;
    const stack = [host.anchor];
    while (stack.length) {
      const k = stack.pop()!;
      const b = boxes.get(k);
      if (b) bottom = Math.max(bottom, b.y + b.h);
      stack.push(...childrenOf(k));
    }
    for (const p of placed) if (p.host.anchor === host.anchor) bottom = Math.max(bottom, p.hull.y + p.hull.h);
    const local = layoutLocal(host, hosts, deps, depth + 1);
    const top = bottom + gap;
    const hull: RegionBox = { x: a.x + 24, y: top, w: local.w + REGION_PAD * 2, h: local.h + REGION_PAD * 2 + LABEL_H };
    translate(local, hull.x + REGION_PAD, hull.y + REGION_PAD + LABEL_H);
    // Make room: everything that reaches into the band moves down by the band height.
    const dy = hull.h + gap;
    const sub = new Set<string>();
    const s2 = [host.anchor];
    while (s2.length) { const k = s2.pop()!; sub.add(k); s2.push(...childrenOf(k)); }
    // Ancestors (left of the anchor in a tree layout) stay put when they clear the band
    // horizontally, so the root does not jump below a cloud it does not touch.
    const anc = new Set<string>();
    for (let p = parentKey(host.anchor); p; p = parentKey(p)) anc.add(p);
    for (const [k, b] of boxes) {
      if (sub.has(k) || b.y + b.h <= top - gap / 2) continue;
      if (anc.has(k) && (b.x + b.w <= hull.x || b.x >= hull.x + hull.w)) continue;
      b.y += dy;
    }
    for (const p of placed) if (p.hull.y >= top - gap / 2 && p.host.anchor !== host.anchor) {
      p.hull.y += dy;
      for (const b of p.boxes) b.y += dy;
      for (const e of p.edges) { e[1] += dy; e[3] += dy; }
    }
    const pr: PlacedRegion = { host, hull, boxes: local.boxes, edges: [] };
    const roots = local.boxes.filter((b) => b.depth === 0);
    for (const r of roots) pr.edges.push([a.x + 18, a.y + a.h, r.x, r.y + r.h / 2]);
    placed.push(pr, ...local.regions);
  }
  return placed;
}

/** Local frame layout of one region (top-left at 0,0). */
function layoutLocal(host: RegionHostSpec, all: RegionHostSpec[], deps: RegionLayoutDeps, depth: number): Local {
  const pill = deps.foldedPill ?? { w: 170, h: 30 };
  const folded = deps.regionFolded ? deps.regionFolded(host) : host.folded;
  if (folded || !host.doc || depth > MAX_REGION_DEPTH) {
    const hidden = host.doc ? (deps.rootHidden ? deps.rootHidden(host) : countAll(host.doc.nodes)) : 0;
    return {
      boxes: [{ key: host.id, title: host.label ?? '', depth: 0, x: 0, y: 0, ...pill, region: host.id, root: true, foldable: true, collapsed: true, hidden }],
      regions: [],
      w: pill.w,
      h: pill.h,
    };
  }
  const doc = host.doc;
  const collapsedIn = (id: string) => (deps.nodeCollapsed ? deps.nodeCollapsed(host.id, doc, id) : isCollapsed(doc, id));
  const pts = deps.pack(doc, host.id);
  const vis = deps.visible(doc, host.id);
  const boxes = new Map<string, RegionBox>();
  const kids = new Map<string, string[]>();
  const meta = new Map<string, { title: string; depth: number; n: OutlineNode }>();
  for (const v of vis) {
    const p = pts[v.key] ?? { x: 0, y: 0 };
    const s = deps.size(v.n, v.key);
    boxes.set(v.key, { x: p.x - s.w / 2, y: p.y - s.h / 2, ...s });
    meta.set(v.key, { title: v.n.title, depth: v.parentKey === null ? 0 : 1, n: v.n });
    if (v.parentKey !== null) (kids.get(v.parentKey) ?? kids.set(v.parentKey, []).get(v.parentKey)!).push(v.key);
  }
  const nested = placeRegions(boxes, (k) => kids.get(k) ?? [], host.id, all, deps, depth);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (b: RegionBox) => { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); };
  boxes.forEach(grow);
  nested.forEach((r) => grow(r.hull));
  if (!isFinite(x0)) { x0 = y0 = 0; x1 = pill.w; y1 = pill.h; }
  const out: Local = {
    boxes: [...boxes].map(([k, b]) => {
      const mt = meta.get(k)!;
      const id = mt.n.id ?? k;
      const foldable = !!mt.n.children?.length;
      const collapsed = foldable && !!mt.n.id && collapsedIn(mt.n.id);
      return {
        ...b,
        key: scopeId(host.id, id),
        title: mt.title,
        depth: mt.depth,
        region: host.id,
        localId: id,
        foldable,
        collapsed,
        hidden: collapsed ? mt.n.children!.length : 0,
      };
    }),
    regions: nested,
    w: x1 - x0,
    h: y1 - y0,
  };
  translate(out, -x0, -y0);
  return out;
}

/** True when any two of the given rectangles intersect (QA helper for SEAL-2). */
export function anyOverlap(rects: RegionBox[]): boolean {
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!, b = rects[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return true;
    }
  return false;
}
