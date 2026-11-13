import { parse } from './parse.js';
import type { OutlineNode } from './types.js';

/**
 * 0.5.15: a certain reference from a Map row to its outline line. The Map may show only part
 * of the note ("View from here"), so the reference is resolved against a parse of the WHOLE
 * text, never by position within what the Map shows.
 *
 * Order: the id (a written `<id:N>`, or a `__sid-N` session id, which `parse(text,
 * { sessionIds: true })` gives the same row every time for the same text), then the path
 * (the shown top row's id or index, then child indexes), then the 0.5.14 ordinal as a last
 * resort. Every match must carry the same title, or the edit is refused.
 */
export interface MapNodeRef {
  id: string;
  title?: string;
  path?: { rootId?: string; rootIndex: number; steps: number[] };
  ordinal?: number;
}

export type MapRefResult =
  | { ok: true; ordinal: number; node: OutlineNode; via: 'id' | 'path' | 'ordinal' }
  | { ok: false; reason: 'not-found' | 'title-mismatch'; via?: 'id' | 'path' | 'ordinal' };

export function resolveMapRef(text: string, ref: MapNodeRef): MapRefResult {
  const doc = parse(text, { sessionIds: true });
  const order: OutlineNode[] = [];
  const byId = new Map<string, OutlineNode>();
  const walk = (list?: OutlineNode[]): void => {
    for (const n of list ?? []) {
      order.push(n);
      if (n.id && !byId.has(String(n.id))) byId.set(String(n.id), n);
      walk(n.children);
    }
  };
  walk(doc.nodes);
  let mismatch: 'id' | 'path' | 'ordinal' | undefined;
  const check = (n: OutlineNode | undefined, via: 'id' | 'path' | 'ordinal'): MapRefResult | null => {
    if (!n) return null;
    if (ref.title !== undefined && n.title !== ref.title) { mismatch ??= via; return null; }
    return { ok: true, ordinal: order.indexOf(n), node: n, via };
  };
  // Each candidate must carry the row's title; a stale id (a host-kept session id that now
  // names another row) falls through to the path, then the ordinal, never to a blind edit.
  const byIdHit = check(byId.get(String(ref.id)), 'id');
  if (byIdHit) return byIdHit;
  if (ref.path) {
    const p = ref.path;
    let n: OutlineNode | undefined = p.rootId !== undefined ? byId.get(String(p.rootId)) : doc.nodes[p.rootIndex];
    for (const i of p.steps) n = n?.children?.[i];
    const hit = check(n, 'path');
    if (hit) return hit;
  }
  if (ref.ordinal !== undefined && ref.ordinal >= 0) {
    const hit = check(order[ref.ordinal], 'ordinal');
    if (hit) return hit;
  }
  return mismatch ? { ok: false, reason: 'title-mismatch', via: mismatch } : { ok: false, reason: 'not-found' };
}

/** The reference for `node` as drawn in `shown` (the doc the Map was given). */
export function mapRefOf(shown: { nodes: OutlineNode[] }, node: OutlineNode): MapNodeRef | null {
  let ord = 0;
  let out: MapNodeRef | null = null;
  const walk = (list: OutlineNode[] | undefined, top: number, root: OutlineNode | null, steps: number[]): void => {
    (list ?? []).forEach((n, i) => {
      if (out) return;
      const r = root ?? n;
      const ti = root ? top : i;
      const s = root ? [...steps, i] : [];
      if (n === node) {
        out = {
          id: String(n.id ?? ''),
          title: n.title,
          path: { ...(r.id ? { rootId: String(r.id) } : {}), rootIndex: ti, steps: s },
          ordinal: ord,
        };
        return;
      }
      ord += 1;
      walk(n.children, ti, r, s);
    });
  };
  walk(shown.nodes, 0, null, []);
  return out;
}
