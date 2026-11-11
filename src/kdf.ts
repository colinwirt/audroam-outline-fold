/**
 * Passphrase KDF for the keyring wrap (and v1 legacy key list).
 *
 * Argon2id (RFC 9106, version 0x13) via a pinned @noble/hashes build. Pure JS,
 * so it runs in the browser and in Node with no WASM, no CDN, and no extra
 * file fetch — required by the static offline viewer.
 *
 * This module does not install itself. Call `installDefaultArgon2Provider()`
 * (or `setArgon2Provider(createArgon2Provider())`) so new keyring wraps use
 * Argon2id. Until then, `createKey` still writes PBKDF2-SHA256 at 600k.
 * Existing PBKDF2 (and legacy query-form Argon2id) headers keep decrypting.
 *
 * Seals themselves still derive the content key with HKDF-SHA256 from the
 * unwrapped kid secret (`kdf` in the of-seal-v3 header is `hkdf-sha256`).
 */
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { setArgon2Provider, type Argon2Provider } from './sealedBranch.js';

/** Params for one Argon2id derivation. `m` is KiB, as in RFC 9106. */
export interface Argon2idOptions {
  m: number;
  t: number;
  p: number;
  /** Output length in bytes (32 for a keyring KEK). */
  len: number;
  /**
   * Optional secret K (RFC 9106). The seal path never sets this. Exposed so
   * the public RFC 9106 §5.3 vector can be checked; do not use it to bind a
   * note, owner, or host into a key.
   */
  key?: Uint8Array;
  /**
   * Optional associated data X (RFC 9106). Mapped to noble's `personalization`
   * field, which is the fourth length-prefixed H0 input. The seal path never
   * sets this.
   */
  associatedData?: Uint8Array;
  onProgress?: (progress: number) => void;
}

const VERSION = 0x13; // Argon2 v1.3, as in `$argon2id$v=19$`

/**
 * Argon2id (v=19). Does not enforce seal-header floors: those belong in
 * `parseKdfHeader`. Callers must pass params they have already accepted.
 */
export async function argon2idDerive(
  password: Uint8Array,
  salt: Uint8Array,
  opts: Argon2idOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isInteger(opts.m) || !Number.isInteger(opts.t) || !Number.isInteger(opts.p) || !Number.isInteger(opts.len)) {
    throw new Error('argon2id: parameters must be integers');
  }
  if (opts.m < 8 || opts.t < 1 || opts.p < 1 || opts.len < 4) {
    throw new Error('argon2id: parameters out of range');
  }
  // Defence in depth against a hostile header. The header parser has its own cap.
  if (opts.m > 1_048_576 || opts.t > 10 || opts.p > 9 || opts.len > 64) {
    throw new Error('argon2id: parameters exceed the cap');
  }
  const out = await argon2idAsync(password, salt, {
    t: opts.t,
    m: opts.m,
    p: opts.p,
    dkLen: opts.len,
    version: VERSION,
    maxmem: opts.m * 1024,
    key: opts.key,
    personalization: opts.associatedData,
    onProgress: opts.onProgress,
  });
  return out as Uint8Array<ArrayBuffer>;
}

/** Provider that matches `setArgon2Provider`. */
export function createArgon2Provider(): Argon2Provider {
  return async (passphrase, salt, params) =>
    argon2idDerive(passphrase, salt, { m: params.m, t: params.t, p: params.p, len: params.len });
}

/**
 * Register the bundled Argon2id implementation as the process-wide provider.
 * New wraps then use the default profile (m=65536, t=3, p=1). Safe to call
 * more than once. Tests that need a stub should call `setArgon2Provider`
 * afterwards, or not call this at all.
 */
export function installDefaultArgon2Provider(): void {
  setArgon2Provider(createArgon2Provider());
}
