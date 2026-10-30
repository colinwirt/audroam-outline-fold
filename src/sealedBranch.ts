/**
 * Sealed branches, format of-seal-v2 (writes) and of-seal-v1 (decrypt-only, migration).
 *
 * v2: the line is `Caption <enc:KEYID>`. The key id resolves to a random 256-bit branch
 * secret held in the `--- keyring ---` block only in wrapped form (AES-256-GCM under a KEK
 * from the passphrase KDF, own salt, key id in AAD). The secret is never used directly:
 * per cipher/purpose keys come from HKDF-SHA256 with the labels of/a256gcm/v1, of/xc20p/v1,
 * of/share/v1 (label bound in AAD). Ciphers: a256gcm (WebCrypto, 96-bit nonce) and xc20p
 * (XChaCha20-Poly1305 from @noble/ciphers, 192-bit nonce). The host chooses the cipher for
 * new seals; every branch records its own. Core owns header, salt and nonce.
 * Keys live in memory only (non-extractable CryptoKey); clearKeys() drops them.
 * Spec: docs/sealed-branches-approval.md §9.12 (OF-41..46).
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { parse } from './parse.js';
import { serialize } from './serialize.js';
import {
  SEAL_ALG,
  SEAL_ALG_V1,
  SEALED_PLACEHOLDER,
  KID_RE,
  isSealedBranchPayload,
} from './sealedState.js';
import type { OutlineFoldDoc, OutlineNode, SealKeyEntry, SealKeyringEntry, SealedPayload } from './types.js';

export { SEAL_ALG, SEAL_ALG_V1, SEALED_PLACEHOLDER };

/** Ciphers for of-seal-v2 branches (OF-41). */
export type SealCipher = 'a256gcm' | 'xc20p';
export const SEAL_CIPHERS: readonly SealCipher[] = Object.freeze(['a256gcm', 'xc20p'] as SealCipher[]);
/** HKDF labels per cipher / purpose (OF-44). */
export const SEAL_LABELS = Object.freeze({
  a256gcm: 'of/a256gcm/v1',
  xc20p: 'of/xc20p/v1',
  share: 'of/share/v1',
} as const);
const NONCE_BYTES: Record<SealCipher, number> = { a256gcm: 12, xc20p: 24 };

/** Formats this build reads (writes only SEAL_ALG). */
export function supportedVersions(): { read: string[]; write: string } {
  return { read: [SEAL_ALG, SEAL_ALG_V1], write: SEAL_ALG };
}

let configuredCipher: SealCipher | null = null;
/**
 * Host/config choice of cipher for new seals (OF-42). The library never picks one:
 * sealBranch fails unless this is set or `opts.cipher` is passed. Re-seals of an
 * existing branch keep that branch's cipher.
 */
export function setSealCipher(c: SealCipher | null): void {
  if (c !== null && !SEAL_CIPHERS.includes(c)) throw new SealError();
  configuredCipher = c;
}

/** The one error every unlock failure raises (wrong key, tamper, moved blob, bad header). */
export class SealError extends Error {
  constructor() {
    super("Can't unlock");
    this.name = 'SealError';
  }
}

export interface SealContext {
  /** Host note id (map id). Bound in AAD and HKDF info. */
  noteId: string;
  /** Host owner id. Bound in AAD. */
  ownerId: string;
  /** Id of the enclosing sealed branch, or undefined at top level. */
  parentId?: string;
  /** Sealed nesting depth of the document this branch lives in (set by viewers). */
  depth?: number;
}

export type Argon2Provider = (
  passphrase: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  params: { m: number; t: number; p: number; len: number },
) => Promise<Uint8Array<ArrayBuffer>>;

export const MAX_SEAL_DEPTH = 4;
export const MAX_CT_CHARS = 1_400_000; // ~1 MiB plaintext
const SALT_LEN = 16;
const NONCE_LEN = 12; // v1 + keyring wrap (AES-GCM)
const SECRET_LEN = 32;
const TAG_LEN = 16;
const ARGON2_DEFAULT = { m: 65536, t: 3, p: 1 };
const ARGON2_FLOOR = { m: 19456, t: 2 };
const PBKDF2_ITERS = 600_000;

let argon2: Argon2Provider | null = null;
/** Register a pinned, self-hosted Argon2id implementation (WASM). */
export function setArgon2Provider(fn: Argon2Provider | null): void {
  argon2 = fn;
}

// ---------- utils ----------
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

function wc(): Crypto {
  const g = globalThis as typeof globalThis & { webcrypto?: Crypto };
  const c = g.crypto?.subtle ? g.crypto : g.webcrypto;
  if (!c?.subtle) throw new Error('Web Crypto unavailable');
  return c;
}
export function b64u(bytes: Uint8Array<ArrayBuffer>): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
export function unb64u(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new SealError();
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(p + '='.repeat((4 - (p.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  if (b64u(out) !== s) throw new SealError(); // canonical only
  return out;
}
function rand(n: number): Uint8Array<ArrayBuffer> {
  return wc().getRandomValues(new Uint8Array(n));
}

// ---------- headers ----------
export type KdfParams =
  | { kdf: 'argon2id'; m: number; t: number; p: number; salt: Uint8Array<ArrayBuffer> }
  | { kdf: 'pbkdf2-sha256'; i: number; salt: Uint8Array<ArrayBuffer> };

export function formatKdfHeader(k: KdfParams): string {
  return k.kdf === 'argon2id'
    ? `kdf=argon2id&m=${k.m}&t=${k.t}&p=${k.p}&salt=${b64u(k.salt)}`
    : `kdf=pbkdf2-sha256&i=${k.i}&salt=${b64u(k.salt)}`;
}

/** Strict, canonical KDF header parse. Unknown or weak params are rejected. */
export function parseKdfHeader(h: string): KdfParams {
  const a = h.match(/^kdf=argon2id&m=(\d{1,7})&t=(\d{1,2})&p=(\d)&salt=([A-Za-z0-9_-]{22})$/);
  let out: KdfParams | null = null;
  if (a) {
    const m = +a[1]!, t = +a[2]!, p = +a[3]!;
    if (m < ARGON2_FLOOR.m || t < ARGON2_FLOOR.t || p < 1 || m > 1_048_576 || t > 10)
      throw new SealError();
    out = { kdf: 'argon2id', m, t, p, salt: unb64u(a[4]!) };
  }
  const b = h.match(/^kdf=pbkdf2-sha256&i=(\d{6,8})&salt=([A-Za-z0-9_-]{22})$/);
  if (b) {
    const i = +b[1]!;
    if (i < PBKDF2_ITERS || i > 10_000_000) throw new SealError();
    out = { kdf: 'pbkdf2-sha256', i, salt: unb64u(b[2]!) };
  }
  if (!out || out.salt.length !== SALT_LEN || formatKdfHeader(out) !== h) throw new SealError();
  return out;
}

const BRANCH_HDR_V1 = /^v=1&alg=A256GCM&kdf=hkdf-sha256&salt=([A-Za-z0-9_-]{22})$/;

interface BranchBlob {
  hdr: string;
  salt: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
  ct: Uint8Array<ArrayBuffer>;
}

/** v1 (decrypt-only) ct field = b64u(header) "." b64u(nonce) "." b64u(ciphertext‖tag). */
export function parseBranchCtV1(s: string): BranchBlob {
  if (s.length > MAX_CT_CHARS) throw new SealError();
  const parts = s.split('.');
  if (parts.length !== 3) throw new SealError();
  let hdr: string;
  try {
    hdr = dec.decode(unb64u(parts[0]!));
  } catch {
    throw new SealError();
  }
  const m = hdr.match(BRANCH_HDR_V1);
  if (!m) throw new SealError();
  const salt = unb64u(m[1]!);
  const nonce = unb64u(parts[1]!);
  const ct = unb64u(parts[2]!);
  if (salt.length !== SALT_LEN || nonce.length !== NONCE_LEN || ct.length < TAG_LEN)
    throw new SealError();
  return { hdr, salt, nonce, ct };
}

function aadV1(hdr: string, kid: string, key: SealKeyEntry, nodeId: string, ctx: SealContext): Uint8Array<ArrayBuffer> {
  return enc.encode(
    JSON.stringify(['of-seal-aad-1', hdr, kid, key.kdf, ctx.noteId, ctx.ownerId, nodeId, ctx.parentId ?? ''])
  );
}

// ---------- of-seal-v2 header ----------
const BRANCH_HDR_V2 =
  /^v=2&c=([a-z0-9]{1,16})&label=([a-z0-9/]{1,32})&kdf=hkdf-sha256&kid=([A-Za-z0-9][A-Za-z0-9_-]{0,63})&salt=([A-Za-z0-9_-]{22})$/;

export interface BranchBlobV2 {
  hdr: string;
  cipher: SealCipher;
  label: string;
  kid: string;
  salt: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
  ct: Uint8Array<ArrayBuffer>;
}

export function formatBranchHdrV2(cipher: SealCipher, kid: string, salt: Uint8Array<ArrayBuffer>): string {
  return `v=2&c=${cipher}&label=${SEAL_LABELS[cipher]}&kdf=hkdf-sha256&kid=${kid}&salt=${b64u(salt)}`;
}

/**
 * v2 ct field = b64u(header) "." b64u(nonce) "." b64u(ciphertext‖tag 16B).
 * Unknown cipher, a label that is not the cipher's own, wrong nonce size: SealError.
 */
export function parseBranchCtV2(s: string): BranchBlobV2 {
  if (s.length > MAX_CT_CHARS) throw new SealError();
  const parts = s.split('.');
  if (parts.length !== 3) throw new SealError();
  let hdr: string;
  try {
    hdr = dec.decode(unb64u(parts[0]!));
  } catch {
    throw new SealError();
  }
  const m = hdr.match(BRANCH_HDR_V2);
  if (!m) throw new SealError();
  const cipher = m[1] as SealCipher;
  if (!SEAL_CIPHERS.includes(cipher) || m[2] !== SEAL_LABELS[cipher]) throw new SealError();
  const salt = unb64u(m[4]!);
  const nonce = unb64u(parts[1]!);
  const ct = unb64u(parts[2]!);
  if (salt.length !== SALT_LEN || nonce.length !== NONCE_BYTES[cipher] || ct.length < TAG_LEN) throw new SealError();
  if (formatBranchHdrV2(cipher, m[3]!, salt) !== hdr) throw new SealError();
  return { hdr, cipher, label: m[2]!, kid: m[3]!, salt, nonce, ct };
}

/** Parse either format (validation helper). */
export function parseBranchCt(s: string, alg: string = SEAL_ALG_V1): BranchBlob | BranchBlobV2 {
  return alg === SEAL_ALG ? parseBranchCtV2(s) : parseBranchCtV1(s);
}

/** AAD (v2): whole header (cipher id + label inside), label again, kid and the binding context. */
export function aadV2(hdr: string, label: string, kid: string, nodeId: string, ctx: SealContext): Uint8Array<ArrayBuffer> {
  return enc.encode(
    JSON.stringify(['of-seal-aad-2', hdr, label, kid, ctx.noteId, ctx.ownerId, nodeId, ctx.parentId ?? '']),
  );
}

function hkdfInfoV2(label: string, noteId: string, nodeId: string): Uint8Array<ArrayBuffer> {
  return enc.encode(JSON.stringify(['of-seal-v2', label, noteId, nodeId]));
}

// ---------- memory-only keys ----------
/** v2: kid -> HKDF base key imported from the unwrapped branch secret (non-extractable). */
const secrets = new Map<string, CryptoKey>();
/** v1 (decrypt-only): kid -> HKDF base key from the passphrase KDF. */
const masterKeys = new Map<string, CryptoKey>();
const sessionUnlocked: string[] = []; // kids unlocked this session, most recent first

/** Drop every derived key from memory (host idle lock / logout). */
export function clearKeys(): void {
  closeAllViewers();
  secrets.clear();
  masterKeys.clear();
  sessionUnlocked.length = 0;
}

/** Kids unlocked in memory this session (for seal-dialog preselect), most recent first. */
export function unlockedKids(): string[] {
  return [...sessionUnlocked];
}

export function isKeyUnlocked(kid: string): boolean {
  return secrets.has(kid) || masterKeys.has(kid);
}

async function kdfBits(passphrase: string, k: KdfParams): Promise<Uint8Array<ArrayBuffer>> {
  const pw = enc.encode(passphrase.normalize('NFC'));
  try {
    if (k.kdf === 'argon2id') {
      if (!argon2) throw new SealError();
      return await argon2(pw, k.salt, { m: k.m, t: k.t, p: k.p, len: 32 });
    }
    const base = await wc().subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(
      await wc().subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: k.salt, iterations: k.i }, base, 256),
    );
  } finally {
    pw.fill(0);
  }
}

async function importHkdf(bits: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const key = await wc().subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey', 'deriveBits']);
  bits.fill(0);
  return key;
}

function remember(map: Map<string, CryptoKey>, kid: string, key: CryptoKey): void {
  map.set(kid, key);
  const i = sessionUnlocked.indexOf(kid);
  if (i >= 0) sessionUnlocked.splice(i, 1);
  sessionUnlocked.unshift(kid);
}

function newKdfParams(): KdfParams {
  const salt = rand(SALT_LEN);
  return argon2 ? { kdf: 'argon2id', ...ARGON2_DEFAULT, salt } : { kdf: 'pbkdf2-sha256', i: PBKDF2_ITERS, salt };
}

// ---------- keyring (wrapped entries, OF-46) ----------
const WRAP_RE = /^a256gcm\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{64})$/;

function wrapAad(kid: string, kdf: string): Uint8Array<ArrayBuffer> {
  return enc.encode(JSON.stringify(['of-keyring-v2', 'a256gcm', kid, kdf]));
}

async function kekFrom(passphrase: string, kdf: string): Promise<CryptoKey> {
  const bits = await kdfBits(passphrase, parseKdfHeader(kdf));
  try {
    return await wc().subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } finally {
    bits.fill(0);
  }
}

async function wrapSecret(kid: string, passphrase: string, secret: Uint8Array<ArrayBuffer>): Promise<{ kdf: string; wrap: string }> {
  const kdf = formatKdfHeader(newKdfParams());
  const kek = await kekFrom(passphrase, kdf);
  const nonce = rand(NONCE_LEN);
  const ct = new Uint8Array(
    await wc().subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: wrapAad(kid, kdf), tagLength: 128 }, kek, secret),
  );
  return { kdf, wrap: `a256gcm.${b64u(nonce)}.${b64u(ct)}` };
}

/** Unwrap a keyring entry. Wrong passphrase, tamper, swapped kid: SealError. Caller zeroes. */
async function unwrapSecret(entry: SealKeyringEntry, passphrase: string): Promise<Uint8Array<ArrayBuffer>> {
  try {
    if (!KID_RE.test(entry.kid)) throw 0;
    const m = entry.wrap.match(WRAP_RE);
    if (!m) throw 0;
    const nonce = unb64u(m[1]!);
    const ct = unb64u(m[2]!);
    if (nonce.length !== NONCE_LEN || ct.length !== SECRET_LEN + TAG_LEN) throw 0;
    const kek = await kekFrom(passphrase, entry.kdf);
    return new Uint8Array(
      await wc().subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: wrapAad(entry.kid, entry.kdf), tagLength: 128 }, kek, ct),
    );
  } catch {
    throw new SealError();
  }
}

function nextKid(doc: OutlineFoldDoc): string {
  const used = new Set([...(doc.keyring ?? []), ...(doc.keys ?? [])].map((k) => k.kid));
  for (let i = 1; ; i++) if (!used.has(`k${i}`)) return `k${i}`;
}

/**
 * Create a keyring entry: a random 256-bit branch secret, wrapped under a KEK from the
 * passphrase (Argon2id when a provider is registered, else PBKDF2-SHA256 600k; own salt).
 * The secret is unlocked in memory. `kid` defaults to the next free `k1`, `k2`, …
 */
export async function createKey(
  doc: OutlineFoldDoc,
  passphrase: string,
  opts: { pub?: string; kid?: string } = {},
): Promise<SealKeyringEntry> {
  const kid = opts.kid ?? nextKid(doc);
  if (!KID_RE.test(kid) || doc.keyring?.some((k) => k.kid === kid) || doc.keys?.some((k) => k.kid === kid))
    throw new Error('createKey: key id is invalid or already in use');
  const secret = rand(SECRET_LEN);
  const w = await wrapSecret(kid, passphrase, secret);
  const entry: SealKeyringEntry = { kid, kdf: w.kdf, wrap: w.wrap };
  if (opts.pub) entry.pub = opts.pub;
  remember(secrets, kid, await importHkdf(secret));
  doc.keyring = [...(doc.keyring ?? []), entry];
  return { ...entry };
}

function findRing(doc: OutlineFoldDoc, kid: string): SealKeyringEntry | undefined {
  return doc.keyring?.find((k) => k.kid === kid);
}

function findKey(doc: OutlineFoldDoc, kid: string): SealKeyEntry {
  const e = doc.keys?.find((k) => k.kid === kid);
  if (!e) throw new SealError();
  return e;
}

/**
 * Unlock a key id into memory. Keyring (v2) entries are verified by the wrap AEAD, so a
 * wrong passphrase raises SealError here. Legacy `--- keys ---` (v1) entries have no
 * verifier; a wrong passphrase only shows when a branch fails to open.
 * Returns the number of visible branches that reference the kid.
 */
export async function unlockKey(doc: OutlineFoldDoc, kid: string, passphrase: string): Promise<number> {
  const ring = findRing(doc, kid);
  if (ring) {
    remember(secrets, kid, await importHkdf(await unwrapSecret(ring, passphrase)));
  } else {
    const entry = findKey(doc, kid);
    remember(masterKeys, kid, await importHkdf(await kdfBits(passphrase, parseKdfHeader(entry.kdf))));
  }
  return countKidRefs(doc, kid);
}

/** One passphrase per keyring: unlock every entry it opens. None opens: SealError. */
export async function unlockKeyring(doc: OutlineFoldDoc, passphrase: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of doc.keyring ?? []) {
    try {
      remember(secrets, e.kid, await importHkdf(await unwrapSecret(e, passphrase)));
      out.push(e.kid);
    } catch {
      /* uniform: reported below only as "nothing opened" */
    }
  }
  if (!out.length) throw new SealError();
  return out;
}

/**
 * Change the keyring passphrase: re-wrap entries (fresh KDF salt and nonce) under the new
 * passphrase. Branch payloads are untouched. All-or-nothing: if any selected entry does
 * not open with `oldPassphrase`, nothing changes and SealError is raised.
 */
export async function changeKeyringPassphrase(
  doc: OutlineFoldDoc,
  oldPassphrase: string,
  newPassphrase: string,
  kids?: string[],
): Promise<string[]> {
  const ring = doc.keyring ?? [];
  const pick = kids ? ring.filter((e) => kids.includes(e.kid)) : ring;
  if (!pick.length || (kids && pick.length !== kids.length)) throw new SealError();
  const next = new Map<string, SealKeyringEntry>();
  for (const e of pick) {
    const secret = await unwrapSecret(e, oldPassphrase);
    try {
      const w = await wrapSecret(e.kid, newPassphrase, secret);
      next.set(e.kid, { ...e, kdf: w.kdf, wrap: w.wrap });
    } finally {
      secret.fill(0);
    }
  }
  doc.keyring = ring.map((e) => next.get(e.kid) ?? e);
  return [...next.keys()];
}

/** Copyable entry: v2 wrapped keyring entry, or a v1 public key-list entry. Never a secret. */
export function exportKeyEntry(doc: OutlineFoldDoc, kid: string): SealKeyringEntry | SealKeyEntry {
  const r = findRing(doc, kid);
  if (r) return r.pub ? { kid: r.kid, kdf: r.kdf, wrap: r.wrap, pub: r.pub } : { kid: r.kid, kdf: r.kdf, wrap: r.wrap };
  const e = findKey(doc, kid);
  return e.pub ? { kid: e.kid, kdf: e.kdf, pub: e.pub } : { kid: e.kid, kdf: e.kdf };
}

/** Add a copied entry to another map (keyring entry if it has `wrap`). Validates the header. */
export function importKeyEntry(doc: OutlineFoldDoc, entry: SealKeyringEntry | SealKeyEntry): SealKeyringEntry | SealKeyEntry {
  parseKdfHeader(entry.kdf);
  if ('wrap' in entry && entry.wrap) {
    if (!KID_RE.test(entry.kid) || !WRAP_RE.test(entry.wrap)) throw new SealError();
    const clean: SealKeyringEntry = { kid: entry.kid, kdf: entry.kdf, wrap: entry.wrap, ...(entry.pub ? { pub: String(entry.pub) } : {}) };
    const existing = findRing(doc, clean.kid);
    if (existing) {
      if (existing.kdf !== clean.kdf || existing.wrap !== clean.wrap) throw new SealError();
      return { ...existing };
    }
    doc.keyring = [...(doc.keyring ?? []), clean];
    return { ...clean };
  }
  if (!/^[A-Za-z0-9_-]{22}$/.test(entry.kid)) throw new SealError();
  const clean: SealKeyEntry = entry.pub ? { kid: entry.kid, kdf: entry.kdf, pub: String(entry.pub) } : { kid: entry.kid, kdf: entry.kdf };
  const existing = doc.keys?.find((k) => k.kid === clean.kid);
  if (existing) {
    if (existing.kdf !== clean.kdf) throw new SealError();
    return { ...existing };
  }
  doc.keys = [...(doc.keys ?? []), clean];
  return { ...clean };
}

function walkAll(nodes: OutlineNode[], fn: (n: OutlineNode) => void): void {
  for (const n of nodes) {
    fn(n);
    if (n.children?.length) walkAll(n.children, fn);
  }
}

function branchPayload(n: OutlineNode): SealedPayload | undefined {
  return isSealedBranchPayload(n.sealed) ? n.sealed : undefined;
}

/** Visible references to a kid (inner branches of locked branches are not visible). */
export function countKidRefs(doc: OutlineFoldDoc, kid: string): number {
  let c = 0;
  walkAll(doc.nodes, (n) => {
    if (branchPayload(n)?.kid === kid) c++;
  });
  return c;
}

/**
 * Remove a key entry (keyring or legacy list). Blocked (ok:false) while any visible branch
 * references the kid, or while a locked branch could hide an inner reference.
 */
export function removeKey(doc: OutlineFoldDoc, kid: string): { ok: boolean; reason?: string } {
  if (countKidRefs(doc, kid) > 0) return { ok: false, reason: 'in-use' };
  let hidden = false;
  walkAll(doc.nodes, (n) => {
    if (isSealedBranchPayload(n.sealed)) hidden = true;
  });
  if (hidden) return { ok: false, reason: 'locked-branches-may-reference' };
  doc.keys = (doc.keys ?? []).filter((k) => k.kid !== kid);
  doc.keyring = (doc.keyring ?? []).filter((k) => k.kid !== kid);
  if (!doc.keys.length) delete doc.keys;
  if (!doc.keyring.length) delete doc.keyring;
  masterKeys.delete(kid);
  secrets.delete(kid);
  return { ok: true };
}

// ---------- v1 (decrypt-only) ----------
async function subkeyV1(kid: string, salt: Uint8Array<ArrayBuffer>, nodeId: string, ctx: SealContext): Promise<CryptoKey> {
  const master = masterKeys.get(kid);
  if (!master) throw new SealError();
  return wc().subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(JSON.stringify(['of-seal-v1', ctx.noteId, nodeId])) },
    master,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
}

async function decryptV1(doc: OutlineFoldDoc, p: SealedPayload, nodeId: string, ctx: SealContext): Promise<Uint8Array<ArrayBuffer>> {
  const entry = findKey(doc, p.kid!);
  const blob = parseBranchCtV1(p.ciphertext!);
  const key = await subkeyV1(p.kid!, blob.salt, nodeId, ctx);
  return new Uint8Array(
    await wc().subtle.decrypt(
      { name: 'AES-GCM', iv: blob.nonce, additionalData: aadV1(blob.hdr, p.kid!, entry, nodeId, ctx), tagLength: 128 },
      key,
      blob.ct,
    ),
  );
}

// ---------- v2 seal / open ----------
async function branchKeyBits(secret: CryptoKey, label: string, salt: Uint8Array<ArrayBuffer>, noteId: string, nodeId: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(
    await wc().subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: hkdfInfoV2(label, noteId, nodeId) }, secret, 256),
  );
}

async function aeadV2(
  dir: 'enc' | 'dec',
  secret: CryptoKey,
  cipher: SealCipher,
  salt: Uint8Array<ArrayBuffer>,
  nonce: Uint8Array<ArrayBuffer>,
  ad: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
  noteId: string,
  nodeId: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const label = SEAL_LABELS[cipher];
  if (cipher === 'a256gcm') {
    const key = await wc().subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: hkdfInfoV2(label, noteId, nodeId) },
      secret,
      { name: 'AES-GCM', length: 256 },
      false,
      [dir === 'enc' ? 'encrypt' : 'decrypt'],
    );
    const p = { name: 'AES-GCM', iv: nonce, additionalData: ad, tagLength: 128 };
    return new Uint8Array(dir === 'enc' ? await wc().subtle.encrypt(p, key, data) : await wc().subtle.decrypt(p, key, data));
  }
  if (cipher === 'xc20p') {
    // Raw bytes are needed by the JS AEAD; zeroed right after use.
    const k = await branchKeyBits(secret, label, salt, noteId, nodeId);
    try {
      const a = xchacha20poly1305(k, nonce, ad);
      return new Uint8Array(dir === 'enc' ? a.encrypt(data) : a.decrypt(data));
    } finally {
      k.fill(0);
    }
  }
  throw new SealError();
}

async function encryptV2(
  kid: string,
  cipher: SealCipher,
  nodeId: string,
  ctx: SealContext,
  plaintext: string,
  fixed?: { salt: Uint8Array<ArrayBuffer>; nonce: Uint8Array<ArrayBuffer> },
): Promise<string> {
  if (!SEAL_CIPHERS.includes(cipher)) throw new SealError();
  const secret = secrets.get(kid);
  if (!secret) throw new SealError();
  const salt = fixed?.salt ?? rand(SALT_LEN);
  const nonce = fixed?.nonce ?? rand(NONCE_BYTES[cipher]);
  if (salt.length !== SALT_LEN || nonce.length !== NONCE_BYTES[cipher]) throw new SealError();
  const hdr = formatBranchHdrV2(cipher, kid, salt);
  const ad = aadV2(hdr, SEAL_LABELS[cipher], kid, nodeId, ctx);
  const ct = await aeadV2('enc', secret, cipher, salt, nonce, ad, enc.encode(plaintext), ctx.noteId, nodeId);
  return `${b64u(enc.encode(hdr))}.${b64u(nonce)}.${b64u(ct)}`;
}

async function decryptV2(p: SealedPayload, nodeId: string, ctx: SealContext): Promise<Uint8Array<ArrayBuffer>> {
  const blob = parseBranchCtV2(p.ciphertext!);
  const kid = p.kid ?? blob.kid;
  if (kid !== blob.kid) throw new SealError(); // <enc:KEYID> must match the header
  const secret = secrets.get(kid);
  if (!secret) throw new SealError();
  const ad = aadV2(blob.hdr, blob.label, kid, nodeId, ctx);
  return aeadV2('dec', secret, blob.cipher, blob.salt, blob.nonce, ad, blob.ct, ctx.noteId, nodeId);
}

/**
 * Test-only known-answer hooks (fixed secret, salt, nonce). Not for production use: the
 * secret is installed under `kid` in memory like an unwrapped keyring entry.
 */
export async function __installSecretForKat(kid: string, secret: Uint8Array<ArrayBuffer>): Promise<void> {
  remember(secrets, kid, await importHkdf(new Uint8Array(secret)));
}
export async function __branchKeyBitsForKat(kid: string, cipher: SealCipher | 'share', salt: Uint8Array<ArrayBuffer>, noteId: string, nodeId: string): Promise<Uint8Array<ArrayBuffer>> {
  const s = secrets.get(kid);
  if (!s) throw new SealError();
  return branchKeyBits(s, SEAL_LABELS[cipher], salt, noteId, nodeId);
}
export function __encryptForKat(
  kid: string, cipher: SealCipher, nodeId: string, ctx: SealContext, plaintext: string,
  fixed: { salt: Uint8Array<ArrayBuffer>; nonce: Uint8Array<ArrayBuffer> },
): Promise<string> {
  return encryptV2(kid, cipher, nodeId, ctx, plaintext, fixed);
}

/**
 * Share-purpose key bits (label of/share/v1) for a key id; separate from every branch
 * cipher key by construction (OF-44). Raw bits: the caller zeroes them.
 */
export async function deriveShareKeyBits(kid: string, salt: Uint8Array<ArrayBuffer>, noteId: string, nodeId: string): Promise<Uint8Array<ArrayBuffer>> {
  const s = secrets.get(kid);
  if (!s || salt.length !== SALT_LEN) throw new SealError();
  return branchKeyBits(s, SEAL_LABELS.share, salt, noteId, nodeId);
}

// ---------- seal ----------
function innerText(node: OutlineNode): string {
  const shift = (list: OutlineNode[], d: number): OutlineNode[] =>
    list.map((c) => ({ ...c, depth: d, children: c.children ? shift(c.children, d + 1) : undefined }));
  return innerJson(node.title, serialize({ nodes: shift(node.children ?? [], 0), fold: { mode: '-', ids: [] } }));
}

function sealedDepth(ctx: SealContext, _doc?: OutlineFoldDoc): number {
  return ctx.depth ?? (ctx.parentId ? 1 : 0);
}

export interface SealResult {
  warnings: string[];
}

/**
 * Seal a node and its subtree (of-seal-v2) under an unlocked keyring kid. The caption is
 * encrypted; the line shows the public label (opts.pub) or "Sealed branch" plus
 * `<enc:KEYID>`. The cipher comes from opts.cipher or setSealCipher(); never chosen
 * silently. Requires node.id. Inner sealed branches stay sealed inside.
 */
export async function sealBranch(
  doc: OutlineFoldDoc,
  node: OutlineNode,
  kid: string,
  ctx: SealContext,
  opts: { pub?: string; cipher?: SealCipher } = {},
  __fixed?: { salt: Uint8Array<ArrayBuffer>; nonce: Uint8Array<ArrayBuffer> },
): Promise<SealResult> {
  if (!node.id || node.autoId) throw new Error('sealBranch: node needs a persistent id');
  const cipher = opts.cipher ?? configuredCipher;
  if (cipher === null || cipher === undefined) throw new Error('sealBranch: no cipher chosen (pass opts.cipher or call setSealCipher)');
  if (!SEAL_CIPHERS.includes(cipher)) throw new SealError();
  if (!findRing(doc, kid)) throw new SealError();
  const warnings: string[] = [];
  const depth = sealedDepth(ctx, doc);
  if (depth >= MAX_SEAL_DEPTH) throw new Error(`sealBranch: nesting depth over ${MAX_SEAL_DEPTH}`);
  if (ctx.parentId) {
    let parentKid: string | undefined;
    walkAll(doc.nodes, (n) => {
      if (n.id === ctx.parentId) parentKid = branchPayload(n)?.kid;
    });
    if (!parentKid)
      for (const v of liveViewers) if (v.doc === doc && v.branchId === ctx.parentId) parentKid = v.mode.kid;
    if (parentKid === kid) warnings.push('same-kid-as-parent: no extra protection');
  }
  const pt = innerText(node);
  const ct = await encryptV2(kid, cipher, node.id, ctx, pt, __fixed);
  const payload: SealedPayload = { kid, alg: SEAL_ALG, ciphertext: ct };
  if (opts.pub) payload.pub = opts.pub;
  node.sealed = payload;
  node.title = opts.pub ?? SEALED_PLACEHOLDER;
  node.children = [];
  return { warnings };
}

/** Cipher recorded in a v2 branch payload, or null (v1 / not a branch / unreadable). */
export function branchCipher(p: SealedPayload | undefined): SealCipher | null {
  if (p?.alg !== SEAL_ALG || !p.ciphertext) return null;
  try {
    return parseBranchCtV2(p.ciphertext).cipher;
  } catch {
    return null;
  }
}

// ---------- protected viewer (unlock never edits the main document) ----------
function innerJson(caption: string, body: string): string {
  return JSON.stringify({ v: 1, caption, body });
}

/** Decrypt one branch. Returns plaintext caption and body; never touches the doc. */
async function decryptBranch(doc: OutlineFoldDoc, node: OutlineNode, ctx: SealContext): Promise<{ caption: string; body: string }> {
  const p = node.sealed;
  if (!node.id || !p || !isSealedBranchPayload(p) || !p.ciphertext) throw new SealError();
  if (p.alg === SEAL_ALG_V1 && !p.kid) throw new SealError();
  if (sealedDepth(ctx, doc) >= MAX_SEAL_DEPTH) throw new SealError();
  let text: string;
  try {
    const pt = p.alg === SEAL_ALG ? await decryptV2(p, node.id, ctx) : await decryptV1(doc, p, node.id, ctx);
    text = dec.decode(pt);
  } catch {
    throw new SealError();
  }
  try {
    const inner = JSON.parse(text);
    if (inner.v !== 1 || typeof inner.caption !== 'string' || typeof inner.body !== 'string') throw 0;
    return { caption: inner.caption, body: inner.body };
  } catch {
    throw new SealError();
  }
}

/** Fixed crypto mode of a viewer, taken from the branch it opened. Read-only. */
export interface SealedViewerMode {
  readonly kid: string;
  readonly alg: string;
  /** of-seal-v2 cipher of the opened branch (null for v1, which is decrypt-only). */
  readonly cipher: SealCipher | null;
  /** KDF header of the kid at open time (params + salt). */
  readonly kdf: string;
}

export interface SealedViewer {
  /** Branch id in the host document. */
  readonly branchId: string;
  /** In-memory only document: one root (the decrypted caption) with the inner branch. */
  readonly doc: OutlineFoldDoc;
  /** Locked encryption mode; save always re-seals with exactly this. */
  readonly mode: SealedViewerMode;
  readonly closed: boolean;
  /** True when the viewer doc differs from what was decrypted. */
  isDirty(): boolean;
  /**
   * Re-seal into the host branch payload: fresh salt+nonce, same kid/alg, same AAD binding.
   * Only that payload changes. Options that try to change the mode are rejected.
   */
  save(opts?: Record<string, unknown>): Promise<void>;
  /** Wipe the plaintext and close (and every nested viewer). */
  close(): void;
  /** Open a nested sealed branch inside this viewer in a further viewer. */
  open(branchId: string): Promise<SealedViewer>;
}

const liveViewers = new Set<SealedViewer>();

/** Number of open viewers (all hold plaintext in memory). */
export function openViewerCount(): number {
  return liveViewers.size;
}

/** Branch ids (of a given host doc) that currently have an open viewer; for Map overlays. */
export function openViewerIds(host: OutlineFoldDoc): string[] {
  return [...liveViewers].filter((v) => (v as ViewerImpl).host === host).map((v) => v.branchId);
}

/** Close every viewer (idle lock / logout). clearKeys() calls this. */
export function closeAllViewers(): void {
  for (const v of [...liveViewers]) v.close();
}

function findById(nodes: OutlineNode[], id: string): OutlineNode | undefined {
  let hit: OutlineNode | undefined;
  walkAll(nodes, (n) => {
    if (!hit && n.id === id) hit = n;
  });
  return hit;
}

function wipe(nodes: OutlineNode[]): void {
  walkAll(nodes, (n) => {
    n.title = '';
    n.children = [];
  });
  nodes.length = 0;
}

interface ViewerImpl extends SealedViewer {
  host: OutlineFoldDoc;
}

/**
 * Unlock a sealed branch into a protected viewer (a separate in-memory document for a
 * 2nd outline-fold instance). The host document is not modified: it keeps only the
 * sealed line, so serialize(host) can never see plaintext.
 */
export async function openSealedBranch(
  host: OutlineFoldDoc,
  branchId: string,
  ctx: SealContext,
): Promise<SealedViewer> {
  const node = findById(host.nodes, branchId);
  if (!node || !isSealedBranchPayload(node.sealed)) throw new SealError();
  const { caption, body } = await decryptBranch(host, node, ctx);
  const opened: SealedPayload = { ...node.sealed! };
  const isV2 = opened.alg === SEAL_ALG;
  const kid = opened.kid ?? (isV2 ? parseBranchCtV2(opened.ciphertext!).kid : '');
  const kdfOf = (d: OutlineFoldDoc) => (isV2 ? findRing(d, kid)?.kdf : d.keys?.find((k) => k.kid === kid)?.kdf);
  const kdf0 = kdfOf(host);
  if (!kdf0) throw new SealError();
  const mode: SealedViewerMode = Object.freeze({
    kid,
    alg: opened.alg!,
    cipher: isV2 ? parseBranchCtV2(opened.ciphertext!).cipher : null,
    kdf: kdf0,
  });
  const depth = sealedDepth(ctx, host) + 1;
  const sub = parse(body);
  const root: OutlineNode = { id: branchId, title: caption, depth: 0, children: sub.nodes } as OutlineNode;
  const reDepth = (list: OutlineNode[], d: number) => list.forEach((c) => { c.depth = d; if (c.children) reDepth(c.children, d + 1); });
  reDepth(sub.nodes, 1);
  // The viewer shares the key list read-only (frozen copies) so nested branches can open.
  const doc: OutlineFoldDoc = {
    nodes: [root],
    fold: { mode: '-', ids: [] },
    keys: Object.freeze((host.keys ?? []).map((k) => Object.freeze({ ...k }))) as SealKeyEntry[],
    keyring: Object.freeze((host.keyring ?? []).map((k) => Object.freeze({ ...k }))) as SealKeyringEntry[],
    ...(sub.sealedOrphans ? { sealedOrphans: sub.sealedOrphans } : {}),
  };
  const snapshot = () => {
    const r = doc.nodes[0];
    if (doc.nodes.length !== 1 || !r) throw new Error('Sealed viewer: the document must keep exactly one root');
    const kids = (r.children ?? []).map((c) => c);
    const shift = (list: OutlineNode[], d: number): OutlineNode[] =>
      list.map((c) => ({ ...c, depth: d, children: c.children ? shift(c.children, d + 1) : undefined }));
    return innerJson(r.title, serialize({ nodes: shift(kids, 0), fold: { mode: '-', ids: [] }, ...(doc.sealedOrphans ? { sealedOrphans: doc.sealedOrphans } : {}) }));
  };
  let original = innerJson(caption, body);
  const children = new Set<SealedViewer>();
  let closed = false;
  const viewer: ViewerImpl = {
    host,
    branchId,
    doc,
    mode,
    get closed() {
      return closed;
    },
    isDirty() {
      return !closed && snapshot() !== original;
    },
    async save(opts?: Record<string, unknown>) {
      if (closed) throw new Error('Sealed viewer is closed');
      if (opts && Object.keys(opts).length)
        throw new Error('Sealed viewer: kid, alg and params are fixed; use an explicit key rotation instead');
      const target = findById(host.nodes, branchId);
      if (target !== node) throw new Error(`Sealed viewer: branch ${branchId} is no longer in the host document`);
      if (!mode.cipher)
        throw new Error('Sealed viewer: of-seal-v1 is decrypt-only; migrate the document (migrateSealedV1) before editing');
      const cur = node.sealed;
      if (!cur || (cur.kid ?? mode.kid) !== mode.kid || cur.alg !== mode.alg || cur.ciphertext !== opened.ciphertext)
        throw new Error(`Sealed viewer: branch ${branchId} payload changed outside the viewer; refusing to overwrite`);
      if (kdfOf(host) !== mode.kdf) throw new Error('Sealed viewer: key entry changed; re-sealing refused');
      const same = <T extends { kid: string; kdf: string }>(a: T[] | undefined, b: T[] | undefined) =>
        (a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((k, i) => k.kid === b![i]!.kid && k.kdf === b![i]!.kdf);
      if (!same(doc.keys, host.keys) || !same(doc.keyring, host.keyring))
        throw new Error('Sealed viewer: key list is read-only in the viewer');
      for (const c of children) if (!c.closed && c.isDirty()) throw new Error('Sealed viewer: save or close the nested viewer first');
      const pt = snapshot(); // also runs the fail-closed checks on the inner content
      if (pt === original) return;
      const ct = await encryptV2(mode.kid, mode.cipher, branchId, ctx, pt);
      const next: SealedPayload = { kid: mode.kid, alg: mode.alg, ciphertext: ct };
      if (opened.pub) next.pub = opened.pub;
      node.sealed = next;
      opened.ciphertext = ct;
      original = pt;
    },
    close() {
      if (closed) return;
      for (const c of children) c.close();
      closed = true;
      wipe(doc.nodes);
      liveViewers.delete(viewer);
    },
    async open(innerId: string) {
      if (closed) throw new Error('Sealed viewer is closed');
      const v = await openSealedBranch(doc, innerId, { noteId: ctx.noteId, ownerId: ctx.ownerId, parentId: branchId, depth });
      children.add(v);
      return v;
    },
  };
  liveViewers.add(viewer);
  return viewer;
}

/** Sealed-branch validation diagnostics (structure only; never decrypts). */
export function validateSealedBranches(doc: OutlineFoldDoc): string[] {
  const errs: string[] = [];
  const kids = new Set((doc.keys ?? []).map((k) => k.kid));
  const ringKids = new Set((doc.keyring ?? []).map((k) => k.kid));
  for (const k of [...(doc.keys ?? []), ...(doc.keyring ?? [])]) {
    try {
      parseKdfHeader(k.kdf);
    } catch {
      errs.push(`key ${k.kid}: bad or weak kdf header`);
    }
  }
  for (const k of doc.keyring ?? []) {
    if (!KID_RE.test(k.kid) || !WRAP_RE.test(k.wrap)) errs.push(`key ${k.kid}: bad keyring entry`);
    if (kids.has(k.kid)) errs.push(`key ${k.kid}: in both keyring and legacy key list`);
  }
  walkAll(doc.nodes, (n) => {
    if (!isSealedBranchPayload(n.sealed)) return;
    const p = n.sealed!;
    const v2 = p.alg === SEAL_ALG;
    if (!p.kid || !(v2 ? ringKids : kids).has(p.kid)) errs.push(`${n.id}: unknown kid`);
    if (!p.ciphertext) errs.push(`${n.id}: missing ct`);
    else
      try {
        const b = parseBranchCt(p.ciphertext, p.alg);
        if (v2 && p.kid && (b as BranchBlobV2).kid !== p.kid) errs.push(`${n.id}: <enc:${p.kid}> does not match the payload header`);
      } catch {
        errs.push(`${n.id}: bad ct`);
      }
    if (!v2) errs.push(`${n.id}: legacy of-seal-v1 (decrypt-only; migrate)`);
    if (n.children?.length) errs.push(`${n.id}: locked sealed branch has plaintext children`);
    if (n.title !== (p.pub ?? SEALED_PLACEHOLDER)) errs.push(`${n.id}: caption must be the public label`);
  });
  return errs;
}

// ---------- v1 -> v2 migration ----------
export interface MigrationResult {
  /** Number of branches re-sealed (nested ones included). */
  migrated: number;
  /** Legacy kid -> new keyring kid. */
  kidMap: Record<string, string>;
}

/**
 * Re-seal every of-seal-v1 branch (nested included) as of-seal-v2. Every legacy kid in use
 * must be unlocked first (unlockKey with its old passphrase). Each legacy kid gets a new
 * keyring entry wrapped under `passphrase`; `cipher` is the host's choice. Legacy key-list
 * entries that are no longer referenced are removed. All-or-nothing: on failure the doc
 * is unchanged and SealError (or the viewer/structure error) is raised.
 */
export async function migrateSealedV1(
  doc: OutlineFoldDoc,
  ctx: SealContext,
  opts: { passphrase: string; cipher: SealCipher; pub?: Record<string, string> },
): Promise<MigrationResult> {
  if (!SEAL_CIPHERS.includes(opts.cipher)) throw new SealError();
  if (openViewerIds(doc).length) throw new Error('migrateSealedV1: close open sealed viewers first');
  const work: OutlineFoldDoc = { ...doc, nodes: structuredClone(doc.nodes), keyring: [...(doc.keyring ?? [])] };
  const kidMap: Record<string, string> = {};
  let migrated = 0;
  const target = async (oldKid: string): Promise<string> => {
    if (kidMap[oldKid]) return kidMap[oldKid]!;
    const e = findKey(doc, oldKid);
    const k = await createKey(work, opts.passphrase, { pub: opts.pub?.[oldKid] ?? e.pub });
    kidMap[oldKid] = k.kid;
    return k.kid;
  };
  const walkList = async (nodes: OutlineNode[], parentId: string | undefined, depth: number): Promise<void> => {
    for (const n of nodes) {
      const p = n.sealed;
      if (p?.alg === SEAL_ALG_V1 && n.id) {
        const c: SealContext = { noteId: ctx.noteId, ownerId: ctx.ownerId, parentId, depth };
        const { caption, body } = await decryptBranch(doc, n, c);
        const sub = parse(body);
        await walkList(sub.nodes, n.id, depth + 1);
        const inner = innerJson(caption, serialize({ nodes: sub.nodes, fold: { mode: '-', ids: [] }, ...(sub.sealedOrphans ? { sealedOrphans: sub.sealedOrphans } : {}) }));
        const kid = await target(p.kid!);
        const ct = await encryptV2(kid, opts.cipher, n.id, c, inner);
        n.sealed = { kid, alg: SEAL_ALG, ciphertext: ct, ...(p.pub ? { pub: p.pub } : {}) };
        migrated++;
      } else if (n.children?.length) {
        await walkList(n.children, parentId, depth);
      }
    }
  };
  await walkList(work.nodes, ctx.parentId, ctx.depth ?? (ctx.parentId ? 1 : 0));
  doc.nodes = work.nodes;
  if (work.keyring!.length) doc.keyring = work.keyring;
  const stillV1 = new Set<string>();
  walkAll(doc.nodes, (n) => {
    if (n.sealed?.alg === SEAL_ALG_V1 && n.sealed.kid) stillV1.add(n.sealed.kid);
  });
  for (const id of Object.keys(doc.sealedOrphans ?? {})) {
    const o = doc.sealedOrphans![id]!;
    if (o.alg === SEAL_ALG_V1 && o.kid) stillV1.add(o.kid);
  }
  if (doc.keys) {
    doc.keys = doc.keys.filter((k) => !kidMap[k.kid] || stillV1.has(k.kid));
    if (!doc.keys.length) delete doc.keys;
  }
  return { migrated, kidMap };
}
