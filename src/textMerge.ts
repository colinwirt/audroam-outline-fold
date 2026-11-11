/**
 * 0.4.11 (bugs D/E): keep what the user typed when a structural writer (seal, ids, Map) writes
 * a serialised root back into the text. The serialiser normalises (drops an empty `- ` node,
 * trailing spaces, blank lines, re-indents); applying its whole output reverted typing.
 *
 * mergeKeeping(prev, normPrev, next): `normPrev` is the serialiser's output for `prev` with no
 * change, `next` is its output after the change. Only the lines that differ between normPrev and
 * next are replaced in prev; every other line of prev stays byte for byte. Pure.
 *
 * Body lines are paired by node identity (authored `<id:>`, then session-tree order
 * of the parsed nodes), never by caption text or jump target. A glued tag that
 * serialize would space out (`3.92<r:5>` vs `3.92 <r:5>`) is the same node, so a
 * Map fold updates that line in place instead of inserting a copy.
 */
import { parse } from './parse.js';
import { parsedLineOf } from './sessionIndex.js';
import type { OutlineNode } from './types.js';

const key = (line: string): string => line.replace(/\s+/g, ' ').trim();
/** 0.4.17: a sealed line is its tag; its caption is not content (dropped by the serialiser). */
const SEAL_TAG = /<enc:[^>]*>\s*<id:[^>]+>/;
const sealKey = (line: string): string => {
  const m = SEAL_TAG.exec(line);
  return m ? `${line.match(/^\s*/)![0].length}|${key(m[0])}` : key(line);
};
/** Caption after one leading bullet. The serialiser always writes `- `. */
const bulletBody = (line: string): string => key(line).replace(/^[-*+]\s+/, '');
const ID_TAIL = /(?:\s+<id:[^>\s]+>)+\s*$/;
/** Mid-caption or glued `<id:N>` (e.g. `MITRE<id:5> https://…`) — serialiser moves it trailing. */
const ID_ANY = /\s*<id:[A-Za-z0-9][A-Za-z0-9_-]*>\s*/g;
/**
 * A plain line and the serialiser's bulleted form are one node (`done` and `- done`).
 * An `<id:>` only the source still has (a session id the serialiser omits) does not
 * make them two nodes. A fold marker stays in the body, so `done` does not match
 * `- done (+)`.
 * 0.6.2: a mid-line `<id:N>` and the serialiser's trailing form are the same node
 * (`MITRE<id:5> url` ↔ `MITRE url <id:5>`), so a style write does not keep both.
 */
const sameSourceLine = (x: string, y: string): boolean => {
  if (sealKey(x) === sealKey(y)) return true;
  const bx = bulletBody(x);
  const by = bulletBody(y);
  if (!bx || !by) return false;
  if (bx === by) return true;
  const sx = bx.replace(ID_TAIL, '');
  const sy = by.replace(ID_TAIL, '');
  if (sx && sx === sy) return bx === sx || by === sy;
  // Mid-line id ↔ trailing id: strip every <id:…>, collapse spaces, compare captions.
  const cx = bx.replace(ID_ANY, ' ').replace(/\s+/g, ' ').trim();
  const cy = by.replace(ID_ANY, ' ').replace(/\s+/g, ' ').trim();
  return !!cx && cx === cy;
};

const LINK_IN_TITLE = /\s*<\s*(?:t\s*:\s*\d+|r\s*:\s*[A-Za-z0-9][A-Za-z0-9_-]*)\s*>\s*/gi;
const captionKey = (title: string): string =>
  title.replace(LINK_IN_TITLE, ' ').replace(/\s+/g, ' ').trim();

type NodeRow = { line: number; sig: string; authored?: string };

/** One row per parsed node, with its 0-based source line. */
function nodeRows(text: string): NodeRow[] | null {
  try {
    const doc = parse(text, { sessionIds: true });
    const out: NodeRow[] = [];
    const walk = (list: OutlineNode[] | undefined) => {
      for (const n of list || []) {
        const line = parsedLineOf(n);
        if (line != null) {
          const links = (n.links ?? [])
            .filter((l) => l.form === 'tag')
            .map((l) => `${l.kind}:${l.target}`)
            .join(',');
          out.push({
            line,
            sig: `${n.depth}\0${captionKey(n.title)}\0${n.task ?? ''}\0${links}`,
            authored: n.id && !n.autoId ? n.id : undefined,
          });
        }
        walk(n.children);
      }
    };
    walk(doc.nodes);
    return out;
  } catch {
    return null;
  }
}

/**
 * normPrev line index → prev line index. Authored ids first, then remaining
 * nodes in document order by a spacing-insensitive signature (depth, caption
 * without inline t/r tags, task, tag links). Independent parses mint their own
 * `__tmp-N` ids, so those are not compared.
 */
function nodeLineMap(prev: string, norm: string): Map<number, number> | null {
  const P = nodeRows(prev);
  const N = nodeRows(norm);
  if (!P || !N) return null;
  const out = new Map<number, number>();
  const usedP = new Set<number>();
  const pByAuth = new Map<string, NodeRow>();
  for (const r of P) if (r.authored && !pByAuth.has(r.authored)) pByAuth.set(r.authored, r);
  for (const r of N) {
    if (!r.authored) continue;
    const p = pByAuth.get(r.authored);
    if (!p || usedP.has(p.line)) continue;
    out.set(r.line, p.line);
    usedP.add(p.line);
  }
  const a = P.filter((r) => !usedP.has(r.line));
  const b = N.filter((r) => !out.has(r.line));
  for (const [i, j] of match(a.map((r) => r.sig), b.map((r) => r.sig), (x, y) => x === y)) {
    out.set(b[j]!.line, a[i]!.line);
  }
  return out;
}

/** LCS pairs (i in a, j in b) on keyed lines; common prefix / suffix trimmed first. */
function match(
  a: string[],
  b: string[],
  eq: (x: string, y: string, i: number, j: number) => boolean,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let s = 0;
  while (s < a.length && s < b.length && eq(a[s]!, b[s]!, s, s)) { out.push([s, s]); s++; }
  let ea = a.length, eb = b.length;
  const tail: Array<[number, number]> = [];
  while (ea > s && eb > s && eq(a[ea - 1]!, b[eb - 1]!, ea - 1, eb - 1)) { ea--; eb--; tail.push([ea, eb]); }
  const n = ea - s, m = eb - s;
  if (n && m) {
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = eq(a[s + i]!, b[s + j]!, s + i, s + j) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (eq(a[s + i]!, b[s + j]!, s + i, s + j)) { out.push([s + i, s + j]); i++; j++; }
      else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++; else j++;
    }
  }
  return out.concat(tail.reverse());
}

export function mergeKeeping(prev: string, normPrev: string, next: string): string {
  if (next === normPrev) return prev;
  if (prev === normPrev) return next;
  const P = prev.split('\n'), N = normPrev.split('\n'), X = next.split('\n');
  // prev line for each normPrev line: node identity first, then loose text for
  // layout / trailer lines that are not nodes.
  const pOf = new Map<number, number>();
  const n2p = nodeLineMap(prev, normPrev);
  const sameLine = (x: string, y: string, i: number, j: number): boolean => {
    if (n2p?.has(j)) return n2p.get(j) === i;
    return sameSourceLine(x, y);
  };
  // A sealed line matches by its tag; the normalised line (fixed label) replaces the stray caption.
  const relabel = new Set<number>();
  for (const [i, j] of match(P, N, sameLine)) {
    pOf.set(j, i);
    // Sealed captions are relabelled. A plain line that only gained a bullet is not:
    // an edit elsewhere must leave `done` as the user typed it.
    if (key(P[i]!) !== key(N[j]!) && sealKey(P[i]!) === sealKey(N[j]!)) relabel.add(i);
  }
  const out: string[] = [];
  let p = 0; // next prev line not yet emitted
  let nPos = 0;
  const pairs = match(N, X, (x, y) => x === y);
  pairs.push([N.length, X.length]);
  let xPos = 0;
  // 0.5.5: an empty `fold-:` / `collapsedMarker` pair does not round-trip (a default layout
  // block is omitted). Those lines have no norm row. An insertion in that gap (unseal writing
  // `fold-: 12`) used to keep the stale pair and add the new one inside the same block.
  const trailerAt = P.findIndex((l) => /^---\s*(?:payloads|sealed|enc|keyring|keys|layout)\s*---$/i.test(l));
  const staleLayout = (index: number): boolean =>
    trailerAt >= 0 && index >= trailerAt && /^(?:fold[-+]\s*:|collapsedMarker\s*:|expandedMarker\s*:)/.test(P[index] ?? '');
  const pushGap = (upTo: number) => {
    while (p < upTo) {
      if (staleLayout(p)) { p++; continue; }
      out.push(P[p++]!);
    }
  };
  for (const [ni, xi] of pairs) {
    if (ni > nPos || xi > xPos) {
      // Hunk N[nPos..ni) -> X[xPos..xi): replace the prev lines that carried N[nPos..ni).
      const carried = [...Array(ni - nPos).keys()].map((k) => pOf.get(nPos + k)).filter((v): v is number => v != null);
      const cut = carried.length ? carried[0]! : p;
      pushGap(cut);
      out.push(...X.slice(xPos, xi));
      if (carried.length) p = carried[carried.length - 1]! + 1;
    }
    if (ni < N.length) {
      const at = pOf.get(ni);
      if (at != null && at >= p) { pushGap(at); out.push(relabel.has(p) ? N[ni]! : P[p]!); p++; }
      // 0.4.19: an unchanged normalised line with no source line is serialiser noise (e.g. an empty
      // `- ` read back as `- -`); prev already holds its source form, so emitting it duplicated a
      // blank node on every write.
    }
    nPos = ni + 1; xPos = xi + 1;
  }
  pushGap(P.length);
  return out.join('\n');
}

/** Pub line per payload id in a `--- payloads ---` section ('' = no pub line). */
function pubLines(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const L = text.split('\n');
  let inP = false, id: string | null = null;
  for (const l of L) {
    if (/^--- payloads ---\s*$/.test(l)) { inP = true; continue; }
    if (!inP) continue;
    if (/^---/.test(l)) break;
    const m = /^(\S[^:]*):\s*$/.exec(l);
    if (m) { id = m[1]!; out.set(id, ''); continue; }
    if (id && /^\s+pub:/.test(l)) out.set(id, l);
  }
  return out;
}

/**
 * 0.4.18: make the text's payload `pub:` lines match `next` (a sealed caption typed in the text
 * is the label; its stored pub follows). Only pub lines change; ct and everything else stay. Pure.
 */
export function syncPubLines(text: string, next: string): string {
  const want = pubLines(next);
  if (!want.size) return text;
  const L = text.split('\n');
  const out: string[] = [];
  let inP = false, done = false, id: string | null = null, wrote = false;
  const flush = () => {
    if (id != null && !wrote && want.get(id)) {
      let k = out.length - 1;
      while (k >= 0 && !/^\S[^:]*:\s*$/.test(out[k]!)) k--;
      const pos = k >= 0 && /^\s+alg:/.test(out[k + 1] ?? '') ? k + 2 : k + 1;
      out.splice(pos, 0, want.get(id)!);
    }
  };
  for (const l of L) {
    if (!done && /^--- payloads ---\s*$/.test(l)) { inP = true; out.push(l); continue; }
    if (inP && !done) {
      if (/^---/.test(l)) { flush(); id = null; done = true; out.push(l); continue; }
      const m = /^(\S[^:]*):\s*$/.exec(l);
      if (m) { flush(); id = m[1]!; wrote = false; out.push(l); continue; }
      if (id && /^\s+pub:/.test(l)) {
        wrote = true;
        if (!want.has(id)) { out.push(l); continue; }
        const w = want.get(id)!;
        if (w) out.push(w); // '' = caption cleared: drop the line
        continue;
      }
    }
    out.push(l);
  }
  const r = out.join('\n');
  return r;
}
