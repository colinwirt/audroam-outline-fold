/**
 * Passphrase KDF for the keyring wrap (and the v1 legacy key list).
 *
 * Argon2id (RFC 9106, version 0x13) via a pinned @noble/hashes 2.4.0 build. Pure JS,
 * so it runs in the browser and in Node with no WASM, no CDN, and no extra file
 * fetch, which the static offline viewer needs.
 *
 * 0.7.0: the bundled provider is installed by default (see `sealedBranch.ts`), so
 * every new keyring wrap writes Argon2id. PBKDF2-SHA256 is decrypt-only.
 *
 * Seals themselves still derive the content key with HKDF-SHA256 from the unwrapped
 * kid secret (`kdf` in the of-seal-v3 header is `hkdf-sha256`).
 *
 * The numbers below are the DevSecOps-proposed defaults from
 * docs/spikes/argon2id-kdf.md §6. They are named constants so a later decision only
 * changes this file.
 */
import { argon2idAsync } from '@noble/hashes/argon2.js';
import type { Argon2Provider, KdfRunOptions } from './sealedBranch.js';

/** One Argon2id cost profile. `m` is KiB, as in RFC 9106 and the PHC string. */
export interface Argon2Profile {
  readonly m: number;
  readonly t: number;
  readonly p: number;
}

/** Write default: 64 MiB, t=3, p=1. */
export const ARGON2_DEFAULT_PROFILE: Argon2Profile = Object.freeze({ m: 65536, t: 3, p: 1 });
/** Mobile profile: 32 MiB, t=4, p=1. Written only when the host asks for `kdfProfile: 'mobile'`. */
export const ARGON2_MOBILE_PROFILE: Argon2Profile = Object.freeze({ m: 32768, t: 4, p: 1 });
/**
 * Hostile-header caps, on read and inside the KDF. A header over any cap fails with the
 * same generic `SealError` ("Can't unlock") as a wrong passphrase, so it is not an oracle.
 */
export const ARGON2_CAPS: Argon2Profile = Object.freeze({ m: 262144, t: 8, p: 4 });
/** Keyring salt length, exact on read and write. */
export const ARGON2_SALT_BYTES = 16;

/** Which profile a new keyring wrap uses. The host decides; the library has no heuristic. */
export type KdfProfile = 'default' | 'mobile';

export function argon2Profile(p: KdfProfile = 'default'): Argon2Profile {
  if (p === 'default') return ARGON2_DEFAULT_PROFILE;
  if (p === 'mobile') return ARGON2_MOBILE_PROFILE;
  throw new Error(`argon2id: unknown kdfProfile "${String(p)}"`);
}

/** Params for one Argon2id derivation. `m` is KiB, as in RFC 9106. */
export interface Argon2idOptions extends KdfRunOptions {
  m: number;
  t: number;
  p: number;
  /** Output length in bytes (32 for a keyring KEK). */
  len: number;
  /**
   * Optional secret K (RFC 9106). The seal path never sets this. Exposed so the public
   * RFC 9106 §5.3 vector can be checked; do not use it to bind a note, owner, or host.
   */
  key?: Uint8Array;
  /**
   * Optional associated data X (RFC 9106). Mapped to noble's `personalization` field,
   * the fourth length-prefixed H0 input. The seal path never sets this.
   */
  associatedData?: Uint8Array;
}

const VERSION = 0x13; // Argon2 v1.3, as in `$argon2id$v=19$`

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? Object.assign(new Error('Aborted'), { name: 'AbortError' });
}

/**
 * Argon2id (v=19). Seal-header floors live in `parseKdfHeader`; this enforces only the
 * caps (defence in depth). `onProgress` gets 0..1; aborting `signal` rejects with its
 * reason (an `AbortError` by default) and stops the derivation at the next progress tick.
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
  if (opts.m > ARGON2_CAPS.m || opts.t > ARGON2_CAPS.t || opts.p > ARGON2_CAPS.p || opts.len > 64) {
    throw new Error('argon2id: parameters exceed the cap');
  }
  const { signal, onProgress } = opts;
  if (signal?.aborted) throw abortError(signal);
  const tick =
    signal || onProgress
      ? (f: number) => {
          if (signal?.aborted) throw abortError(signal);
          onProgress?.(f);
        }
      : undefined;
  const out = await argon2idAsync(password, salt, {
    t: opts.t,
    m: opts.m,
    p: opts.p,
    dkLen: opts.len,
    version: VERSION,
    maxmem: opts.m * 1024,
    key: opts.key,
    personalization: opts.associatedData,
    onProgress: tick,
  });
  if (signal?.aborted) {
    out.fill(0);
    throw abortError(signal);
  }
  return out as Uint8Array<ArrayBuffer>;
}

/** The bundled provider, in the shape `setArgon2Provider` takes. */
export function createArgon2Provider(): Argon2Provider {
  return async (passphrase, salt, params, run) =>
    argon2idDerive(passphrase, salt, { m: params.m, t: params.t, p: params.p, len: params.len, onProgress: run?.onProgress, signal: run?.signal });
}
