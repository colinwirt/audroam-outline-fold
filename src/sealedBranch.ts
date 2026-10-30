/**
 * Sealed branches (format of-seal-v1). Core owns the header, salt and nonce.
 * Keys: one KDF run per kid (key list entry), then HKDF-SHA256 per branch
 * (salt = branch salt, info = note id + branch node id). AES-256-GCM via WebCrypto.
 * Derived keys live in memory only (non-extractable CryptoKey); clearKeys() drops them.
 * Spec: docs/sealed-branches-approval.md.
 */
import { parse } from './parse.js';
import { serialize } from './serialize.js';
import {
  openBranches,
  SEAL_ALG,
  SEALED_PLACEHOLDER,
  isSealedBranchPayload,
} from './sealedState.js';
import type { OutlineFoldDoc, OutlineNode, SealKeyEntry, SealedPayload } from './types.js';

export { SEAL_ALG, SEALED_PLACEHOLDER };

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
}

export type Argon2Provider = (
  passphrase: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  params: { m: number; t: number; p: number; len: number },
) => Promise<Uint8Array<ArrayBuffer>>;

export const MAX_SEAL_DEPTH = 4;
export const MAX_CT_CHARS = 1_400_000; // ~1 MiB plaintext
const SALT_LEN = 16;
const NONCE_LEN = 12;
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

const BRANCH_HDR = /^v=1&alg=A256GCM&kdf=hkdf-sha256&salt=([A-Za-z0-9_-]{22})$/;

interface BranchBlob {
  hdr: string;
  salt: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
  ct: Uint8Array<ArrayBuffer>;
}

/** ct field = b64u(header) "." b64u(nonce) "." b64u(ciphertext‖tag). */
export function parseBranchCt(s: string): BranchBlob {
  if (s.length > MAX_CT_CHARS) throw new SealError();
  const parts = s.split('.');
  if (parts.length !== 3) throw new SealError();
  let hdr: string;
  try {
    hdr = dec.decode(unb64u(parts[0]!));
  } catch {
    throw new SealError();
  }
  const m = hdr.match(BRANCH_HDR);
  if (!m) throw new SealError();
  const salt = unb64u(m[1]!);
  const nonce = unb64u(parts[1]!);
  const ct = unb64u(parts[2]!);
  if (salt.length !== SALT_LEN || nonce.length !== NONCE_LEN || ct.length < TAG_LEN)
    throw new SealError();
  return { hdr, salt, nonce, ct };
}

function aad(hdr: string, kid: string, key: SealKeyEntry, nodeId: string, ctx: SealContext): Uint8Array<ArrayBuffer> {
  return enc.encode(
    JSON.stringify(['of-seal-aad-1', hdr, kid, key.kdf, ctx.noteId, ctx.ownerId, nodeId, ctx.parentId ?? ''])
  );
}

// ---------- key list + memory-only keys ----------
const masterKeys = new Map<string, CryptoKey>(); // kid -> HKDF base key (non-extractable)
const sessionUnlocked: string[] = []; // kids unlocked this session, most recent first

/** Drop every derived key from memory (host idle lock / logout). */
export function clearKeys(): void {
  masterKeys.clear();
  sessionUnlocked.length = 0;
}

/** Kids unlocked in memory this session (for seal-dialog preselect), most recent first. */
export function unlockedKids(): string[] {
  return [...sessionUnlocked];
}

export function isKeyUnlocked(kid: string): boolean {
  return masterKeys.has(kid);
}

async function deriveMaster(passphrase: string, k: KdfParams): Promise<CryptoKey> {
  const pw = enc.encode(passphrase.normalize('NFC'));
  let bits: Uint8Array<ArrayBuffer>;
  if (k.kdf === 'argon2id') {
    if (!argon2) throw new SealError();
    bits = await argon2(pw, k.salt, { m: k.m, t: k.t, p: k.p, len: 32 });
  } else {
    const base = await wc().subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
    bits = new Uint8Array(
      await wc().subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: k.salt, iterations: k.i }, base, 256),
    );
  }
  const key = await wc().subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey', 'deriveBits']);
  bits.fill(0);
  pw.fill(0);
  return key;
}

function remember(kid: string, key: CryptoKey): void {
  masterKeys.set(kid, key);
  const i = sessionUnlocked.indexOf(kid);
  if (i >= 0) sessionUnlocked.splice(i, 1);
  sessionUnlocked.unshift(kid);
}

/**
 * Create a new key-list entry (random 128-bit kid, fresh salt) and unlock it in memory.
 * Uses Argon2id 64MiB/t3/p1 when a provider is registered; otherwise the interim
 * PBKDF2-SHA256 600k. Adds the entry to doc.keys.
 */
export async function createKey(
  doc: OutlineFoldDoc,
  passphrase: string,
  opts: { pub?: string } = {},
): Promise<SealKeyEntry> {
  const salt = rand(SALT_LEN);
  const params: KdfParams = argon2
    ? { kdf: 'argon2id', ...ARGON2_DEFAULT, salt }
    : { kdf: 'pbkdf2-sha256', i: PBKDF2_ITERS, salt };
  const entry: SealKeyEntry = { kid: b64u(rand(16)), kdf: formatKdfHeader(params) };
  if (opts.pub) entry.pub = opts.pub;
  remember(entry.kid, await deriveMaster(passphrase, params));
  doc.keys = [...(doc.keys ?? []), entry];
  return { ...entry };
}

/**
 * Derive the kid's key into memory. There is no verifier: a wrong passphrase is
 * only detected when a branch fails to open (uniform SealError). Returns the
 * number of visible branches that reference the kid.
 */
export async function unlockKey(doc: OutlineFoldDoc, kid: string, passphrase: string): Promise<number> {
  const entry = findKey(doc, kid);
  const params = parseKdfHeader(entry.kdf);
  remember(kid, await deriveMaster(passphrase, params));
  return countKidRefs(doc, kid);
}

function findKey(doc: OutlineFoldDoc, kid: string): SealKeyEntry {
  const e = doc.keys?.find((k) => k.kid === kid);
  if (!e) throw new SealError();
  return e;
}

/** Copyable public entry: kid, KDF header, public label. Never a passphrase or derived key. */
export function exportKeyEntry(doc: OutlineFoldDoc, kid: string): SealKeyEntry {
  const e = findKey(doc, kid);
  return e.pub ? { kid: e.kid, kdf: e.kdf, pub: e.pub } : { kid: e.kid, kdf: e.kdf };
}

/** Add a copied entry (same kid, salt, params) to another map. Validates the header. */
export function importKeyEntry(doc: OutlineFoldDoc, entry: SealKeyEntry): SealKeyEntry {
  if (!/^[A-Za-z0-9_-]{22}$/.test(entry.kid)) throw new SealError();
  parseKdfHeader(entry.kdf);
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
  return openBranches.get(n)?.payload ?? (isSealedBranchPayload(n.sealed) ? n.sealed : undefined);
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
 * Remove a key-list entry. Blocked (returns ok:false) while any visible branch
 * references the kid, or while a locked branch could hide an inner reference.
 */
export function removeKey(doc: OutlineFoldDoc, kid: string): { ok: boolean; reason?: string } {
  if (countKidRefs(doc, kid) > 0) return { ok: false, reason: 'in-use' };
  let hidden = false;
  walkAll(doc.nodes, (n) => {
    if (!openBranches.has(n) && isSealedBranchPayload(n.sealed)) hidden = true;
  });
  if (hidden) return { ok: false, reason: 'locked-branches-may-reference' };
  doc.keys = (doc.keys ?? []).filter((k) => k.kid !== kid);
  masterKeys.delete(kid);
  return { ok: true };
}

async function subkey(kid: string, salt: Uint8Array<ArrayBuffer>, nodeId: string, ctx: SealContext): Promise<CryptoKey> {
  const master = masterKeys.get(kid);
  if (!master) throw new SealError();
  return wc().subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(JSON.stringify(['of-seal-v1', ctx.noteId, nodeId])) },
    master,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Test-only: raw HKDF output bits for KATs (same derivation as the AES subkey). */
export async function __subkeyBitsForKat(kid: string, salt: Uint8Array<ArrayBuffer>, nodeId: string, noteId: string): Promise<Uint8Array<ArrayBuffer>> {
  const master = masterKeys.get(kid);
  if (!master) throw new SealError();
  return new Uint8Array(
    await wc().subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(JSON.stringify(['of-seal-v1', noteId, nodeId])) },
      master,
      256,
    ),
  );
}

// ---------- seal / unseal ----------
function innerText(node: OutlineNode): string {
  const shift = (list: OutlineNode[], d: number): OutlineNode[] =>
    list.map((c) => ({ ...c, depth: d, children: c.children ? shift(c.children, d + 1) : undefined }));
  // openBranches is keyed by identity: copy open inner nodes' state onto the copies.
  const copy = shift(node.children ?? [], 0);
  const relink = (orig: OutlineNode[], cp: OutlineNode[]) =>
    orig.forEach((o, i) => {
      const st = openBranches.get(o);
      if (st) openBranches.set(cp[i]!, st);
      if (o.children && cp[i]!.children) relink(o.children, cp[i]!.children!);
    });
  relink(node.children ?? [], copy);
  const body = serialize({ nodes: copy, fold: { mode: '-', ids: [] } });
  return JSON.stringify({ v: 1, caption: node.title, body });
}

function sealedDepth(ctx: SealContext, doc?: OutlineFoldDoc): number {
  if (!ctx.parentId || !doc) return ctx.parentId ? 1 : 0;
  let d = 0;
  walkAll(doc.nodes, (n) => {
    if (n.id === ctx.parentId) d = (openBranches.get(n)?.depth ?? 0) + 1;
  });
  return d;
}

async function encryptFor(
  node: OutlineNode,
  doc: OutlineFoldDoc,
  kid: string,
  ctx: SealContext,
  plaintext: string,
  fixed?: { salt: Uint8Array<ArrayBuffer>; nonce: Uint8Array<ArrayBuffer> },
): Promise<string> {
  const entry = findKey(doc, kid);
  parseKdfHeader(entry.kdf);
  const salt = fixed?.salt ?? rand(SALT_LEN);
  const nonce = fixed?.nonce ?? rand(NONCE_LEN);
  const hdr = `v=1&alg=A256GCM&kdf=hkdf-sha256&salt=${b64u(salt)}`;
  const key = await subkey(kid, salt, node.id!, ctx);
  const ct = new Uint8Array(
    await wc().subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aad(hdr, kid, entry, node.id!, ctx), tagLength: 128 },
      key,
      enc.encode(plaintext),
    ),
  );
  return `${b64u(enc.encode(hdr))}.${b64u(nonce)}.${b64u(ct)}`;
}

export interface SealResult {
  warnings: string[];
}

/**
 * Seal a node and its subtree under an unlocked kid. The caption is encrypted;
 * the line shows the branch's own public label (opts.pub) or
 * "Sealed branch". Requires node.id. Inner sealed branches stay sealed inside.
 */
export async function sealBranch(
  doc: OutlineFoldDoc,
  node: OutlineNode,
  kid: string,
  ctx: SealContext,
  opts: { pub?: string } = {},
  __fixed?: { salt: Uint8Array<ArrayBuffer>; nonce: Uint8Array<ArrayBuffer> },
): Promise<SealResult> {
  if (!node.id || node.autoId) throw new Error('sealBranch: node needs a persistent id');
  const warnings: string[] = [];
  const depth = sealedDepth(ctx, doc);
  if (depth >= MAX_SEAL_DEPTH) throw new Error(`sealBranch: nesting depth over ${MAX_SEAL_DEPTH}`);
  if (ctx.parentId) {
    let parentKid: string | undefined;
    walkAll(doc.nodes, (n) => {
      if (n.id === ctx.parentId) parentKid = branchPayload(n)?.kid;
    });
    if (parentKid === kid) warnings.push('same-kid-as-parent: no extra protection');
  }
  const pt = innerText(node);
  const ct = await encryptFor(node, doc, kid, ctx, pt, __fixed);
  const payload: SealedPayload = { kid, alg: SEAL_ALG, ciphertext: ct };
  if (opts.pub) payload.pub = opts.pub;
  openBranches.delete(node);
  node.sealed = payload;
  node.title = opts.pub ?? SEALED_PLACEHOLDER;
  node.children = [];
  return { warnings };
}

/**
 * Unlock in place: decrypt lazily (only this branch), restore caption and inner
 * branch. Inner sealed branches stay locked. serialize() keeps writing the
 * stored ciphertext until resealBranch() is called.
 */
export async function unsealBranch(doc: OutlineFoldDoc, node: OutlineNode, ctx: SealContext): Promise<void> {
  const p = node.sealed;
  if (!node.id || !p || !isSealedBranchPayload(p) || !p.kid || !p.ciphertext) throw new SealError();
  const depth = sealedDepth(ctx, doc);
  if (depth >= MAX_SEAL_DEPTH) throw new SealError();
  let text: string;
  try {
    const entry = findKey(doc, p.kid);
    const blob = parseBranchCt(p.ciphertext);
    const key = await subkey(p.kid, blob.salt, node.id, ctx);
    const pt = await wc().subtle.decrypt(
      { name: 'AES-GCM', iv: blob.nonce, additionalData: aad(blob.hdr, p.kid, entry, node.id, ctx), tagLength: 128 },
      key,
      blob.ct,
    );
    text = dec.decode(pt);
  } catch {
    throw new SealError();
  }
  let inner: { v: number; caption: string; body: string };
  try {
    inner = JSON.parse(text);
    if (inner.v !== 1 || typeof inner.caption !== 'string' || typeof inner.body !== 'string') throw 0;
  } catch {
    throw new SealError();
  }
  const sub = parse(inner.body);
  const reDepth = (list: OutlineNode[], d: number) => {
    for (const c of list) {
      c.depth = d;
      if (c.children) reDepth(c.children, d + 1);
    }
  };
  reDepth(sub.nodes, node.depth + 1);
  openBranches.set(node, { payload: { ...p }, lockedTitle: node.title, snapshot: text, depth });
  node.title = inner.caption;
  node.children = sub.nodes;
}

/** True when an unlocked branch was edited since unlock (needs resealBranch before save). */
export function isBranchDirty(node: OutlineNode): boolean {
  const st = openBranches.get(node);
  return !!st && innerText(node) !== st.snapshot;
}

export function isBranchOpen(node: OutlineNode): boolean {
  return openBranches.has(node);
}

/** Re-lock without saving changes: drops plaintext from the model. */
export function lockBranch(node: OutlineNode): void {
  const st = openBranches.get(node);
  if (!st) return;
  openBranches.delete(node);
  node.title = st.lockedTitle;
  node.children = [];
  node.sealed = { ...st.payload };
}

/**
 * Save edits of an unlocked branch: fresh salt and nonce, same kid. Unchanged
 * branches are left alone (byte-identical). Then re-locks.
 */
export async function resealBranch(doc: OutlineFoldDoc, node: OutlineNode, ctx: SealContext): Promise<void> {
  const st = openBranches.get(node);
  if (!st) return;
  if (!isBranchDirty(node)) {
    lockBranch(node);
    return;
  }
  await sealBranch(doc, node, st.payload.kid!, ctx, st.payload.pub ? { pub: st.payload.pub } : {});
}

/** Sealed-branch validation diagnostics (structure only; never decrypts). */
export function validateSealedBranches(doc: OutlineFoldDoc): string[] {
  const errs: string[] = [];
  const kids = new Set((doc.keys ?? []).map((k) => k.kid));
  for (const k of doc.keys ?? []) {
    try {
      parseKdfHeader(k.kdf);
    } catch {
      errs.push(`key ${k.kid}: bad or weak kdf header`);
    }
  }
  walkAll(doc.nodes, (n) => {
    if (openBranches.has(n) || !isSealedBranchPayload(n.sealed)) return;
    const p = n.sealed!;
    if (!p.kid || !kids.has(p.kid)) errs.push(`${n.id}: unknown kid`);
    if (!p.ciphertext) errs.push(`${n.id}: missing ct`);
    else
      try {
        parseBranchCt(p.ciphertext);
      } catch {
        errs.push(`${n.id}: bad ct`);
      }
    if (n.children?.length) errs.push(`${n.id}: locked sealed branch has plaintext children`);
    if (n.title !== (p.pub ?? SEALED_PLACEHOLDER)) errs.push(`${n.id}: caption must be the public label`);
  });
  return errs;
}
