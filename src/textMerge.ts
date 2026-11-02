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
      else if (at == null) out.push(N[ni]!);
    }
    nPos = ni + 1; xPos = xi + 1;
  }
  while (p < P.length) out.push(P[p++]!);
  return out.join('\n');
}
