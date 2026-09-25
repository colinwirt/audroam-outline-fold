/**
 * DEMO-ONLY sealed payload helpers (AES-GCM + PBKDF2).
 * Not production MFA / key release. Cafe fixtures use passphrase `northside-demo`.
 */
import type { SealedPayload } from './types.js';

/** Documented cafe demo passphrase — fictional fixtures only. */
export const DEMO_PASSPHRASE = 'northside-demo';

/** Algorithm label written into `<enc:… alg=…>`. */
export const DEMO_ALG = 'demo-aes-gcm';

const SALT_LEN = 16;
const IV_LEN = 12;
const PBKDF2_ITERS = 100_000;

function webCrypto(): Crypto {
  const g = globalThis as typeof globalThis & { webcrypto?: Crypto };
  const c = g.crypto?.subtle ? g.crypto : g.webcrypto;
  if (!c?.subtle || !c.getRandomValues) {
    throw new Error(
      'Web Crypto unavailable (need secure context browser or Node >=18)',
    );
  }
  return c;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad =
    padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const subtle = webCrypto().subtle;
  const enc = new TextEncoder();
  const material = await subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Seal plaintext with a demo passphrase → `{ kid, ciphertext, alg }`.
 * Ciphertext is base64url(salt ‖ iv ‖ ciphertext+tag). **Demo only.**
 */
export async function demoSeal(
  plaintext: string,
  passphrase: string,
  kid: string,
): Promise<SealedPayload> {
  const crypto = webCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(passphrase, salt);
  const ctBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  const ct = new Uint8Array(ctBuf);
  const packed = new Uint8Array(SALT_LEN + IV_LEN + ct.length);
  packed.set(salt, 0);
  packed.set(iv, SALT_LEN);
  packed.set(ct, SALT_LEN + IV_LEN);
  return {
    kid,
    ciphertext: bytesToBase64Url(packed),
    alg: DEMO_ALG,
  };
}

/**
 * Open a demo sealed payload. Throws on wrong passphrase / corrupt ct.
 * **Demo only** — not host MFA key release.
 */
export async function demoOpen(
  sealed: SealedPayload,
  passphrase: string,
): Promise<string> {
  if (sealed?.uri && !sealed?.ciphertext) {
    throw new Error(
      'demoOpen: remote sealed payload (uri) — host must fetch blob after key release',
    );
  }
  if (!sealed?.ciphertext) {
    throw new Error('demoOpen: missing ciphertext');
  }
  const packed = base64UrlToBytes(sealed.ciphertext);
  if (packed.length < SALT_LEN + IV_LEN + 16) {
    throw new Error('demoOpen: ciphertext too short');
  }
  const salt = packed.subarray(0, SALT_LEN);
  const iv = packed.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const ct = packed.subarray(SALT_LEN + IV_LEN);
  const key = await deriveKey(passphrase, salt);
  try {
    const pt = await webCrypto().subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ct as BufferSource,
    );
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error(
      'demoOpen: decryption failed (wrong passphrase or corrupt ciphertext)',
    );
  }
}
