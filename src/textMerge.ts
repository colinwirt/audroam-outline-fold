/**
 * 0.4.11 (bugs D/E): keep what the user typed when a structural writer (seal, ids, Map) writes
 * a serialised root back into the text. The serialiser normalises (drops an empty `- ` node,
 * trailing spaces, blank lines, re-indents); applying its whole output reverted typing.
 *
 * mergeKeeping(prev, normPrev, next): `normPrev` is the serialiser's output for `prev` with no
 * change, `next` is its output after the change. Only the lines that differ between normPrev and
 * next are replaced in prev; every other line of prev stays byte for byte. Pure.
 */
const key = (line: string): string => line.replace(/\s+/g, ' ').trim();
/** 0.4.17: a sealed line is its tag; its caption is not content (dropped by the serialiser). */
const SEAL_TAG = /<enc:[^>]*>\s*<id:[^>]+>/;
const sealKey = (line: string): string => {
  const m = SEAL_TAG.exec(line);
  return m ? `${line.match(/^\s*/)![0].length}|${key(m[0])}` : key(line);
};

/** LCS pairs (i in a, j in b) on keyed lines; common prefix / suffix trimmed first. */
function match(a: string[], b: string[], eq: (x: string, y: string) => boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let s = 0;
  while (s < a.length && s < b.length && eq(a[s]!, b[s]!)) { out.push([s, s]); s++; }
  let ea = a.length, eb = b.length;
  const tail: Array<[number, number]> = [];
  while (ea > s && eb > s && eq(a[ea - 1]!, b[eb - 1]!)) { ea--; eb--; tail.push([ea, eb]); }
  const n = ea - s, m = eb - s;
  if (n && m) {
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = eq(a[s + i]!, b[s + j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (eq(a[s + i]!, b[s + j]!)) { out.push([s + i, s + j]); i++; j++; }
      else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++; else j++;
    }
  }
  return out.concat(tail.reverse());
}

export function mergeKeeping(prev: string, normPrev: string, next: string): string {
  if (next === normPrev) return prev;
  if (prev === normPrev) return next;
  const P = prev.split('\n'), N = normPrev.split('\n'), X = next.split('\n');
  // prev line for each normPrev line (loose: whitespace-insensitive).
  const pOf = new Map<number, number>();
  // A sealed line matches by its tag; the normalised line (fixed label) replaces the stray caption.
  const relabel = new Set<number>();
  for (const [i, j] of match(P, N, (x, y) => sealKey(x) === sealKey(y))) {
    pOf.set(j, i);
    if (key(P[i]!) !== key(N[j]!)) relabel.add(i);
  }
  const out: string[] = [];
  let p = 0; // next prev line not yet emitted
  let nPos = 0;
  const pairs = match(N, X, (x, y) => x === y);
  pairs.push([N.length, X.length]);
  let xPos = 0;
  for (const [ni, xi] of pairs) {
    if (ni > nPos || xi > xPos) {
      // Hunk N[nPos..ni) -> X[xPos..xi): replace the prev lines that carried N[nPos..ni).
      const carried = [...Array(ni - nPos).keys()].map((k) => pOf.get(nPos + k)).filter((v): v is number => v != null);
      const cut = carried.length ? carried[0]! : p;
      while (p < cut) out.push(P[p++]!);
      out.push(...X.slice(xPos, xi));
      if (carried.length) p = carried[carried.length - 1]! + 1;
    }
    if (ni < N.length) {
      const at = pOf.get(ni);
      if (at != null && at >= p) { while (p < at) out.push(P[p++]!); out.push(relabel.has(p) ? N[ni]! : P[p]!); p++; }
      // 0.4.19: an unchanged normalised line with no source line is serialiser noise (e.g. an empty
      // `- ` read back as `- -`); prev already holds its source form, so emitting it duplicated a
      // blank node on every write.
    }
    nPos = ni + 1; xPos = xi + 1;
  }
  while (p < P.length) out.push(P[p++]!);
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
