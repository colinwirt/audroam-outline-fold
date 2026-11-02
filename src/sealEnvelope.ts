/**
 * of-seal-v3 wire format. The envelope binds only its own header: no note, owner,
 * node, parent, or caption. A copied block opens with this package and the key.
 *
 * Binary (the AAD is the header, length-prefixed, fixed order):
 *   magic "OFSEAL", version "3", alg, KDF id "hkdf-sha256", salt (16 bytes),
 *   kid, seal id (16 bytes), role ("0:body" | "1:autosave")
 * then dek iv (12) || wrapped DEK (AES-256-GCM, 32+16) || content iv || content ct||tag.
 * The DEK is random per seal. The content key is that DEK. HKDF info is
 * "of-seal-v3/wrap" and does not include host context.
 *
 * Text: BEGIN/END markers, base64url wrapped at 76, then 8 hex CRC-32 of the
 * base64url with whitespace removed. The CRC is checked before any decrypt.
 */
export const SEAL_V3_BEGIN = '-----BEGIN OUTLINE-FOLD SEAL-----';
export const SEAL_V3_END = '-----END OUTLINE-FOLD SEAL-----';
export const SEAL_V3_ROLES = Object.freeze({ body: '0:body', autosave: '1:autosave' });

/** The one error every unlock failure raises (wrong key, tamper, bad header). */
export class SealError extends Error {
  /** SEAL-DRAFT: `locked` (key gone, autosave refused) or `verify` (save did not decrypt back). */
  readonly code?: 'locked' | 'verify';
  constructor(code?: 'locked' | 'verify') {
    super(code === 'locked' ? 'Locked' : code === 'verify' ? 'Save could not be verified; nothing was changed' : "Can't unlock");
    this.name = 'SealError';
    if (code) this.code = code;
  }
}

/** Transit damage. Distinct from SealError ("Can't unlock" / wrong key). */
export class DamagedSealError extends Error {
  constructor() {
    super('damaged in transit');
    this.name = 'DamagedSealError';
  }
}

/** Header or binary that is intact (checksum passed) but not a seal. */
export class SealFormatError extends Error {
  constructor() {
    super('bad seal');
    this.name = 'SealFormatError';
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export function concatBytes(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function field(data: Uint8Array | string): Uint8Array<ArrayBuffer> {
  const b = typeof data === 'string' ? enc.encode(data) : data;
  if (b.length > 0xffff) throw new SealFormatError();
  const out = new Uint8Array(2 + b.length);
  out[0] = b.length >> 8;
  out[1] = b.length & 0xff;
  out.set(b, 2);
  return out;
}

function readFields(raw: Uint8Array, n: number): { fields: Uint8Array<ArrayBuffer>[]; end: number } {
  const fields: Uint8Array<ArrayBuffer>[] = [];
  let o = 0;
  for (let i = 0; i < n; i++) {
    if (o + 2 > raw.length) throw new SealFormatError();
    const len = (raw[o]! << 8) | raw[o + 1]!;
    o += 2;
    if (len < 0 || o + len > raw.length) throw new SealFormatError();
    fields.push(raw.subarray(o, o + len) as Uint8Array<ArrayBuffer>);
    o += len;
  }
  return { fields, end: o };
}

function ascii(b: Uint8Array): string {
  return dec.decode(b);
}

/** CRC-32 (ISO-HDLC), lowercase 8 hex. Input is raw bytes. */
export function crc32Hex(bytes: Uint8Array): string {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

export function sealV3Aad(
  alg: string,
  salt: Uint8Array,
  kid: string,
  sid: Uint8Array,
  role: string,
): Uint8Array<ArrayBuffer> {
  return concatBytes([
    field('OFSEAL'),
    field('3'),
    field(alg),
    field('hkdf-sha256'),
    field(salt),
    field(kid),
    field(sid),
    field(role),
  ]);
}

/** Keyring wrap AAD. The kdf string is the stored header (PHC or legacy) and already contains the salt. */
export function keyringV3Aad(kdf: string, salt: Uint8Array, kid: string): Uint8Array<ArrayBuffer> {
  return concatBytes([
    field('OFKR'),
    field('3'),
    field('a256gcm'),
    field(kdf),
    field(salt),
    field(kid),
  ]);
}

export interface SealV3Parts {
  aad: Uint8Array<ArrayBuffer>;
  alg: string;
  kdfId: string;
  salt: Uint8Array<ArrayBuffer>;
  kid: string;
  sid: Uint8Array<ArrayBuffer>;
  role: string;
  dekIv: Uint8Array<ArrayBuffer>;
  dekCt: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  ct: Uint8Array<ArrayBuffer>;
}

export function packSealV3(p: Pick<SealV3Parts, 'aad' | 'dekIv' | 'dekCt' | 'iv' | 'ct'>): Uint8Array<ArrayBuffer> {
  return concatBytes([p.aad, p.dekIv, p.dekCt, p.iv, p.ct]);
}

export function parseSealV3(raw: Uint8Array, ivLen: (alg: string) => number): SealV3Parts {
  const { fields, end } = readFields(raw, 8);
  let magic: string;
  let version: string;
  let alg: string;
  let kdfId: string;
  let kid: string;
  let role: string;
  try {
    magic = ascii(fields[0]!);
    version = ascii(fields[1]!);
    alg = ascii(fields[2]!);
    kdfId = ascii(fields[3]!);
    kid = ascii(fields[5]!);
    role = ascii(fields[7]!);
  } catch {
    throw new SealFormatError();
  }
  if (magic !== 'OFSEAL' || version !== '3' || kdfId !== 'hkdf-sha256') throw new SealError();
  const salt = fields[4]!;
  const sid = fields[6]!;
  if (salt.length < 16 || sid.length !== 16) throw new SealError();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(kid)) throw new SealError();
  const aad = raw.subarray(0, end) as Uint8Array<ArrayBuffer>;
  const rest = raw.subarray(end);
  const contentIv = ivLen(alg);
  if (contentIv < 12) throw new SealError();
  const need = 12 + 48 + contentIv + 16;
  if (rest.length < need) throw new SealFormatError();
  const dekIv = rest.subarray(0, 12) as Uint8Array<ArrayBuffer>;
  const dekCt = rest.subarray(12, 60) as Uint8Array<ArrayBuffer>;
  const iv = rest.subarray(60, 60 + contentIv) as Uint8Array<ArrayBuffer>;
  const ct = rest.subarray(60 + contentIv) as Uint8Array<ArrayBuffer>;
  return { aad, alg, kdfId, salt, kid, sid, role, dekIv, dekCt, iv, ct };
}

export function isV3Ciphertext(s: string | undefined): boolean {
  return Boolean(s && s.includes('BEGIN OUTLINE-FOLD SEAL'));
}

/** One fixed layout. Readers accept whitespace, quotes, and wrapping around this. */
export function armorSeal(raw: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < raw.length; i++) bin += String.fromCharCode(raw[i]!);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const lines = [SEAL_V3_BEGIN];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  lines.push(crc32Hex(enc.encode(b64)));
  lines.push(SEAL_V3_END);
  return lines.join('\n');
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new DamagedSealError();
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(p + '='.repeat((4 - (p.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  let back = '';
  for (let i = 0; i < out.length; i++) back += String.fromCharCode(out[i]!);
  const canon = btoa(back).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  if (canon !== s) throw new DamagedSealError();
  return out;
}

/**
 * Strip mail quotes, indentation, and whitespace. Check the CRC before returning bytes.
 * A checksum miss is damage. A later decrypt miss is a wrong key.
 */
export function openSealArmor(input: string): Uint8Array<ArrayBuffer> {
  if (input.length > 1_400_000) throw new DamagedSealError();
  const lines = input.split(/\r?\n/).map((raw) => {
    let s = raw.replace(/[ \t\r]+$/g, '').replace(/^[ \t]+/g, '');
    while (s.startsWith('>')) s = s.slice(1).replace(/^[ \t]/, '');
    return s;
  });
  const begin = lines.findIndex((l) => l === SEAL_V3_BEGIN);
  const end = begin >= 0 ? lines.findIndex((l, i) => i > begin && l === SEAL_V3_END) : -1;
  const span = begin >= 0 && end > begin ? lines.slice(begin + 1, end) : lines;
  const kept = span.filter((l) => l.length > 0 && l !== SEAL_V3_BEGIN && l !== SEAL_V3_END);
  if (kept.length < 2) throw new DamagedSealError();
  const sumLine = kept[kept.length - 1]!;
  if (!/^[0-9a-f]{8}$/.test(sumLine)) throw new DamagedSealError();
  const b64 = kept.slice(0, -1).join('').replace(/[ \t]+/g, '');
  if (crc32Hex(enc.encode(b64)) !== sumLine) throw new DamagedSealError();
  return unb64(b64);
}

/** Kid from an armored v3 payload. Undefined when the blob is damaged or not v3. */
export function kidFromSealArmor(s: string): string | undefined {
  try {
    const raw = openSealArmor(s);
    const { fields } = readFields(raw, 8);
    if (ascii(fields[0]!) !== 'OFSEAL' || ascii(fields[1]!) !== '3') return undefined;
    return ascii(fields[5]!);
  } catch {
    return undefined;
  }
}
