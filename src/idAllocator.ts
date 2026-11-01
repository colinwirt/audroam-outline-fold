import type { OutlineFoldDoc, OutlineNode } from './types.js';

/**
 * 0.4.9 (bug C): one id allocator for a note: the root doc, every unlocked sealed region and
 * the anchor ids. A region's root row mirrors its anchor (same node, same id) and is exempt;
 * any other id is unique across all scopes. Region-scoped ids (`region:id`) stay unambiguous
 * because a bare id never names two nodes.
 */
export interface IdScope {
  /** "" = root document, else the region id. */
  region: string;
  doc: OutlineFoldDoc | null;
  /** The anchor id whose mirror is this doc's single root row (regions only). */
  anchorId?: string;
  /** Ids known to live in a locked region (from its anchor metadata), reserved. */
  knownIds?: readonly string[];
}

export interface IdDiagnostic {
  kind: 'duplicate-id';
  id: string;
  /** Scope of the node that kept the id (the older one). */
  keptIn: string;
  /** Scope of the newer node. */
  region: string;
  title: string;
  action: 'renumbered' | 'flagged';
  /** New id when renumbered. */
  to?: string;
}

export interface IdAllocator {
  /** Every id in use now (scopes as last reconciled, plus reserved and minted ids). */
  inUse(scopes: readonly IdScope[]): Set<string>;
  /** A fresh numeric id, never one in use or ever minted/seen in this session. */
  mint(scopes: readonly IdScope[]): string;
  /**
   * Find duplicate ids. The older node keeps its id; the newer one is renumbered in place,
   * or flagged (left alone) when a link in `linkText` names the id. Returns what changed,
   * grouped by scope, plus diagnostics.
   */
  reconcile(scopes: readonly IdScope[], linkText: string): { changed: Set<string>; diagnostics: IdDiagnostic[] };
}

function walk(nodes: OutlineNode[] | undefined, fn: (n: OutlineNode) => void): void {
  for (const n of nodes ?? []) { if (!n) continue; fn(n); walk(n.children, fn); }
}

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** True when `text` links to `id`: `<r:id>`, `<r:region:id>`, `#id`. */
export function linksTo(text: string, id: string): boolean {
  const e = reEsc(id);
  return new RegExp(`<r:(?:[^>\\s]*:)?${e}>|#${e}(?![\\w-])`).test(text);
}

/** Ids a scope really owns: real (not session autoId) ids, minus the region root mirror. */
function owned(scope: IdScope): { id: string; node: OutlineNode }[] {
  const out: { id: string; node: OutlineNode }[] = [];
  const roots = scope.doc?.nodes ?? [];
  walk(roots, (n) => {
    if (!n.id || n.autoId) return;
    const id = String(n.id);
    if (scope.region && scope.anchorId != null && roots.length === 1 && n === roots[0] && id === scope.anchorId) return;
    out.push({ id, node: n });
  });
  return out;
}

export function createIdAllocator(): IdAllocator {
  /** id → the scope and title that held it at the last reconcile (who is "older"). */
  const owner = new Map<string, { region: string; title: string }>();
  let high = 0;
  const bump = (id: string) => { if (/^\d+$/.test(id)) high = Math.max(high, Number(id)); };

  const inUse = (scopes: readonly IdScope[]): Set<string> => {
    const s = new Set<string>(owner.keys());
    for (const sc of scopes) {
      for (const { id } of owned(sc)) s.add(id);
      if (sc.anchorId) s.add(sc.anchorId);
      for (const k of sc.knownIds ?? []) s.add(String(k));
    }
    for (const id of s) bump(id);
    return s;
  };

  const mint = (scopes: readonly IdScope[]): string => {
    const used = inUse(scopes);
    let n = high + 1;
    while (used.has(String(n))) n++;
    high = n;
    return String(n);
  };

  const reconcile = (scopes: readonly IdScope[], linkText: string) => {
    const changed = new Set<string>();
    const diagnostics: IdDiagnostic[] = [];
    const entries: { id: string; node: OutlineNode; region: string }[] = [];
    for (const sc of scopes) for (const e of owned(sc)) entries.push({ ...e, region: sc.region });
    const reserved = new Set<string>();
    for (const sc of scopes) for (const k of sc.knownIds ?? []) reserved.add(String(k));
    const byId = new Map<string, typeof entries>();
    for (const e of entries) { bump(e.id); const l = byId.get(e.id) ?? []; l.push(e); byId.set(e.id, l); }
    const keep = new Map<string, { region: string; title: string }>();
    for (const [id, list] of byId) {
      if (list.length === 1 && !reserved.has(id)) { keep.set(id, { region: list[0]!.region, title: list[0]!.node.title ?? '' }); continue; }
      // Older: the one matching the last owner (scope and title), else scope, else first seen.
      const prev = owner.get(id);
      let winner = list[0]!;
      if (prev) {
        winner = list.find((e) => e.region === prev.region && (e.node.title ?? '') === prev.title)
          ?? list.find((e) => e.region === prev.region) ?? winner;
      }
      const losers = reserved.has(id) && !prev ? list : list.filter((e) => e !== winner);
      if (losers.length < list.length) keep.set(id, { region: winner.region, title: winner.node.title ?? '' });
      for (const l of losers) {
        const base = { kind: 'duplicate-id' as const, id, keptIn: losers.length < list.length ? winner.region : 'locked', region: l.region, title: l.node.title ?? '' };
        if (linksTo(linkText, id)) { diagnostics.push({ ...base, action: 'flagged' }); continue; }
        const to = mint(scopes);
        l.node.id = to;
        keep.set(to, { region: l.region, title: l.node.title ?? '' });
        changed.add(l.region);
        diagnostics.push({ ...base, action: 'renumbered', to });
      }
    }
    owner.clear();
    for (const [id, v] of keep) owner.set(id, v);
    return { changed, diagnostics };
  };

  return { inUse, mint, reconcile };
}
