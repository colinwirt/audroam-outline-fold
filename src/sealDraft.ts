/**
 * SEAL-DRAFT: pure slot transitions for a sealed branch payload (spec 20261101 SD-1..SD-12).
 * Slots hold ciphertext only: loaded (`ct`), autosave (`auto-*`) and one discarded (`gone-*`).
 * Every function returns a new payload; callers assign it to `node.sealed` in one step.
 * No DOM, no crypto keys, no clear text.
 */
import type { SealedPayload } from './types.js';

// ---------- sync SHA-256 (hash of the ASCII ct string; no clear text) ----------
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of bytes (sync; used only for slot hashes). */
export function sha256(msg: Uint8Array): Uint8Array {
  const len = msg.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor((len * 8) / 0x100000000));
  dv.setUint32(total - 4, (len * 8) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!, b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as number[];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25);
      const ch = (e! & f!) ^ (~e! & g!);
      const t1 = (hh! + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22);
      const mj = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const t2 = (S0 + mj) >>> 0;
      hh = g; g = f; f = e; e = (d! + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a!; h[1] += b!; h[2] += c!; h[3] += d!; h[4] += e!; h[5] += f!; h[6] += g!; h[7] += hh!;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]!);
  return out;
}

function b64uBytes(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** `h:` + b64u(first 16 bytes of SHA-256 over the ASCII ct string). Ciphertext only. */
export function ctHash(ct: string): string {
  const bytes = new Uint8Array(ct.length);
  for (let i = 0; i < ct.length; i++) bytes[i] = ct.charCodeAt(i) & 0xff;
  return 'h:' + b64uBytes(sha256(bytes).subarray(0, 16));
}

/** ISO-8601 at second precision (`2026-11-01T01:40:00Z`). */
export function draftTime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export type SealDraftState = 'clean' | 'unconfirmed' | 'conflict';

/** State of the slots without decrypting: conflict when `auto-base` is missing or not hash(loaded). */
export function draftStateOf(p: SealedPayload | undefined): SealDraftState {
  if (!p?.autosave) return 'clean';
  if (!p.ciphertext || !p.autosave.base || p.autosave.base !== ctHash(p.ciphertext)) return 'conflict';
  return 'unconfirmed';
}

function need(p: SealedPayload): string {
  if (!p.ciphertext || p.uri) throw new Error('Sealed draft: needs an inline loaded ct');
  return p.ciphertext;
}

/** SD-5: write (or replace) the autosave slot. The loaded ct is untouched. */
export function applyAutosave(p: SealedPayload, ct: string, at: string): SealedPayload {
  const loaded = need(p);
  return { ...p, autosave: { ciphertext: ct, at, base: ctHash(loaded) } };
}

/**
 * SD-7 / SD-11: confirmed Save. The new ct becomes loaded (base = hash(old), at = now), the
 * autosave is removed, and the old loaded ct becomes the one discarded slot (replacing any
 * earlier one, which is what ends its hold).
 */
export function applySave(p: SealedPayload, ct: string, at: string): SealedPayload {
  const old = need(p);
  const { autosave: _a, discarded: _d, ...rest } = p;
  return { ...rest, ciphertext: ct, at, base: ctHash(old), discarded: { ciphertext: old, at, replacedBy: 'save', from: 'loaded' } };
}

/** SD-8: move the autosave to the discarded slot. Loaded is unchanged. */
export function applyDiscard(p: SealedPayload, at: string): SealedPayload {
  need(p);
  if (!p.autosave) throw new Error('Sealed draft: no autosave to discard');
  const { autosave, ...rest } = p;
  return { ...rest, discarded: { ciphertext: autosave.ciphertext, at, replacedBy: 'discard', from: 'autosave' } };
}

/** SD-9: discarded becomes the autosave (base = hash(loaded)); an existing autosave swaps into the gone slot. */
export function applyRestore(p: SealedPayload, at: string): SealedPayload {
  const loaded = need(p);
  if (!p.discarded) throw new Error('Sealed draft: no discarded version to restore');
  const { autosave, discarded, ...rest } = p;
  const next: SealedPayload = { ...rest, autosave: { ciphertext: discarded.ciphertext, at, base: ctHash(loaded) } };
  if (autosave) next.discarded = { ciphertext: autosave.ciphertext, at, replacedBy: 'discard', from: 'autosave' };
  return next;
}
