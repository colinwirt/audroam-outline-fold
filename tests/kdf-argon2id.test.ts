import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parse,
  serialize,
  createKey,
  unlockKey,
  clearKeys,
  setSealCipher,
  setArgon2Provider,
  sealBranch,
  openSealedBranch,
  SealError,
  DamagedSealError,
  parseKdfHeader,
  changeKeyringPassphrase,
  installDefaultArgon2Provider,
  ARGON2_CAPS,
  ARGON2_DEFAULT_PROFILE,
  ARGON2_MOBILE_PROFILE,
  ARGON2_SALT_BYTES,
  type OutlineFoldDoc,
  type OutlineNode,
} from '../src/index.js';
import { argon2idDerive } from '../src/kdf.js';
import { b64u } from '../src/sealedBranch.js';
import { keyringV3Aad, openSealArmor } from '../src/sealEnvelope.js';

const RFC = JSON.parse(
  readFileSync(new URL('./vectors/rfc9106-argon2id.json', import.meta.url), 'utf8'),
) as {
  m: number; t: number; p: number; len: number;
  password_hex: string; salt_hex: string; secret_hex: string;
  associated_data_hex: string; tag_hex: string;
};

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));

const PASS = 'correct horse battery staple';
const CTX = { noteId: 'note-1', ownerId: 'owner-1' };
const SRC = `- Root <id:r>
  - Vault <id:v>
    - Secret caption child <id:c1>
  - Public sibling <id:s>`;

function find(doc: OutlineFoldDoc, id: string): OutlineNode {
  let hit: OutlineNode | undefined;
  const walk = (l: OutlineNode[]) => l.forEach((n) => { if (n.id === id) hit = n; if (n.children) walk(n.children); });
  walk(doc.nodes);
  return hit!;
}

beforeEach(() => { clearKeys(); setSealCipher('a256gcm'); installDefaultArgon2Provider(); });
afterEach(() => { clearKeys(); installDefaultArgon2Provider(); });

/** Fast stand-in for heavy cases (records the params it was asked for). */
function stub(calls: { m: number; t: number; p: number }[] = []) {
  return async (pw: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, params: { m: number; t: number; p: number; len: number }) => {
    calls.push({ m: params.m, t: params.t, p: params.p });
    const h = await crypto.subtle.digest('SHA-256', new Uint8Array([...pw, ...salt]));
    return new Uint8Array(h) as Uint8Array<ArrayBuffer>;
  };
}

/** A keyring entry the way 0.6.x wrote it with no provider: PBKDF2-SHA256 600k. */
async function legacyPbkdf2Entry(kid: string, pass: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kdf = `kdf=pbkdf2-sha256&i=600000&salt=${b64u(salt)}`;
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 }, base, 256);
  const kek = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt']);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: keyringV3Aad(kdf, salt, kid), tagLength: 128 }, kek, secret));
  return { kid, kdf, wrap: `a256gcm.${b64u(nonce)}.${b64u(ct)}` };
}

describe('Argon2id KDF module', () => {
  it('matches the RFC 9106 §5.3 Argon2id test vector (including K and X)', async () => {
    const tag = await argon2idDerive(hex(RFC.password_hex), hex(RFC.salt_hex), {
      m: RFC.m, t: RFC.t, p: RFC.p, len: RFC.len,
      key: hex(RFC.secret_hex),
      associatedData: hex(RFC.associated_data_hex),
    });
    expect(Buffer.from(tag).toString('hex')).toBe(RFC.tag_hex);
  });

  it('matches the PHC password/somesalt Argon2id vector (m=65536 t=2 p=1, no K/X)', async () => {
    const tag = await argon2idDerive(
      new TextEncoder().encode('password'),
      new TextEncoder().encode('somesalt'),
      { m: 65536, t: 2, p: 1, len: 32 },
    );
    expect(Buffer.from(tag).toString('hex')).toBe(
      '09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7',
    );
  });

  it('named defaults: write 64 MiB/t3/p1, mobile 32 MiB/t4/p1, caps 256 MiB/t8/p4, salt 16', () => {
    expect(ARGON2_DEFAULT_PROFILE).toEqual({ m: 65536, t: 3, p: 1 });
    expect(ARGON2_MOBILE_PROFILE).toEqual({ m: 32768, t: 4, p: 1 });
    expect(ARGON2_CAPS).toEqual({ m: 262144, t: 8, p: 4 });
    expect(ARGON2_SALT_BYTES).toBe(16);
  });

  it('the bundled provider is installed by default: createKey writes Argon2id, never PBKDF2', async () => {
    const calls: { m: number; t: number; p: number }[] = [];
    // Prove the default is Argon2id by header; the stub only keeps the test fast.
    setArgon2Provider(stub(calls));
    const key = await createKey(parse(SRC), PASS);
    expect(key.kdf).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9_-]{22}$/);
    expect(calls).toEqual([{ m: 65536, t: 3, p: 1 }]);
    expect(key.kdf).not.toContain('pbkdf2');
  });

  it('with the provider removed, new keys fail instead of falling back to PBKDF2', async () => {
    setArgon2Provider(null);
    await expect(createKey(parse(SRC), PASS)).rejects.toThrow(/Argon2id provider/);
  });

  it('kdfProfile mobile is an explicit host option (createKey and changeKeyringPassphrase)', async () => {
    const calls: { m: number; t: number; p: number }[] = [];
    setArgon2Provider(stub(calls));
    const doc = parse(SRC);
    const key = await createKey(doc, PASS, { kdfProfile: 'mobile' });
    expect(key.kdf).toMatch(/^\$argon2id\$v=19\$m=32768,t=4,p=1\$/);
    await changeKeyringPassphrase(doc, PASS, 'another long passphrase', undefined, { kdfProfile: 'default' });
    expect(doc.keyring![0]!.kdf).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    clearKeys();
    await expect(unlockKey(doc, key.kid, 'another long passphrase')).resolves.toBe(0);
  });

  it('PBKDF2 keyrings from 0.6.x still decrypt (decrypt-only, forever)', async () => {
    const doc = parse(SRC);
    const entry = await legacyPbkdf2Entry('k1', PASS);
    doc.keyring = [entry];
    await expect(unlockKey(doc, 'k1', 'wrong passphrase here')).rejects.toBeInstanceOf(SealError);
    await expect(unlockKey(doc, 'k1', PASS)).resolves.toBe(0);
    // The next passphrase change re-wraps under Argon2id.
    setArgon2Provider(stub());
    await changeKeyringPassphrase(doc, PASS, PASS);
    expect(doc.keyring![0]!.kdf).toMatch(/^\$argon2id\$/);
  });

  it('read accepts the default and mobile profiles; weaker, over-cap, or wrong-salt headers are the same SealError', () => {
    const s16 = 'A'.repeat(22);
    const ok = (h: string) => expect(parseKdfHeader(h).kdf).toBe('argon2id');
    const bad = (h: string) => {
      try { parseKdfHeader(h); throw new Error('accepted: ' + h); }
      catch (e) { expect(e).toBeInstanceOf(SealError); expect((e as Error).message).toBe("Can't unlock"); }
    };
    ok(`$argon2id$v=19$m=65536,t=3,p=1$${s16}`);
    ok(`$argon2id$v=19$m=32768,t=4,p=1$${s16}`);
    ok(`$argon2id$v=19$m=262144,t=8,p=4$${s16}`);
    bad(`$argon2id$v=19$m=19456,t=2,p=1$${s16}`); // OWASP floor: rejected
    bad(`$argon2id$v=19$m=32768,t=3,p=1$${s16}`);
    bad(`$argon2id$v=19$m=262145,t=3,p=1$${s16}`); // over m cap
    bad(`$argon2id$v=19$m=1048576,t=3,p=1$${s16}`);
    bad(`$argon2id$v=19$m=65536,t=9,p=1$${s16}`); // over t cap
    bad(`$argon2id$v=19$m=65536,t=3,p=5$${s16}`); // over p cap
    bad(`$argon2id$v=19$m=65536,t=3,p=0$${s16}`);
    bad(`$argon2id$v=19$m=65536,t=3,p=1$${'A'.repeat(11)}`); // 8-byte salt
    bad(`$argon2id$v=19$m=65536,t=3,p=1$${'A'.repeat(32)}`); // 24-byte salt
    bad(`kdf=argon2id&m=65536&t=9&p=1&salt=${s16}`);
  });

  it('the KDF itself refuses params over the caps', async () => {
    const pw = new Uint8Array([1]);
    const salt = new Uint8Array(16);
    await expect(argon2idDerive(pw, salt, { m: 262145, t: 1, p: 1, len: 32 })).rejects.toThrow(/cap/);
    await expect(argon2idDerive(pw, salt, { m: 64, t: 9, p: 1, len: 32 })).rejects.toThrow(/cap/);
    await expect(argon2idDerive(pw, salt, { m: 64, t: 1, p: 5, len: 32 })).rejects.toThrow(/cap/);
  });

  it('onProgress reports 0..1 and an AbortSignal cancels the derivation', async () => {
    const seen: number[] = [];
    await argon2idDerive(new Uint8Array([1]), new Uint8Array(16), { m: 256, t: 1, p: 1, len: 32, onProgress: (f) => seen.push(f) });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)).toBe(1);
    expect(seen.every((f) => f >= 0 && f <= 1)).toBe(true);

    const ac = new AbortController();
    const t0 = Date.now();
    const p = argon2idDerive(new Uint8Array([1]), new Uint8Array(16), {
      ...ARGON2_DEFAULT_PROFILE, len: 32, signal: ac.signal, onProgress: (f) => { if (f > 0.01) ac.abort(); },
    });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - t0).toBeLessThan(5_000);
  }, 20_000);

  it('cancel through unlockKey rejects with AbortError, not SealError', async () => {
    setArgon2Provider(stub());
    const doc = parse(SRC);
    const key = await createKey(doc, PASS);
    installDefaultArgon2Provider();
    clearKeys();
    const ac = new AbortController();
    ac.abort();
    const err = await unlockKey(doc, key.kid, PASS, { signal: ac.signal }).catch((e) => e);
    expect(err).not.toBeInstanceOf(SealError);
    expect((err as Error).name).toBe('AbortError');
  });

  it('createKey, seal, unlock, and open round-trip under Argon2id default params', async () => {
    installDefaultArgon2Provider();
    const doc = parse(SRC);
    const key = await createKey(doc, PASS);
    expect(key.kdf).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9_-]+$/);
    await sealBranch(doc, find(doc, 'v'), key.kid, CTX, { pub: 'Vault' });
    const text = serialize(doc);
    expect(text).toContain('-----BEGIN OUTLINE-FOLD SEAL-----');
    expect(text).toContain(key.kdf);

    clearKeys();
    const reloaded = parse(text);
    await expect(unlockKey(reloaded, key.kid, 'wrong passphrase!!!!')).rejects.toBeInstanceOf(SealError);
    await unlockKey(reloaded, key.kid, PASS);
    const viewer = await openSealedBranch(reloaded, 'v', CTX);
    expect(viewer.doc.nodes[0]!.title).toBe('Vault');
    expect(viewer.doc.nodes[0]!.children![0]!.title).toBe('Secret caption child');
  }, 20_000);

  it('a checksum miss is damaged in transit; a wrong passphrase is Can\'t unlock', async () => {
    installDefaultArgon2Provider();
    const doc = parse(SRC);
    const key = await createKey(doc, PASS);
    await sealBranch(doc, find(doc, 'v'), key.kid, CTX, { pub: 'Vault' });
    const ct = find(doc, 'v').sealed!.ciphertext!;
    const flipped = ct.replace(/[0-9a-f]{8}\n-----END OUTLINE-FOLD SEAL-----/, (m) => {
      const sum = m.slice(0, 8);
      const bad = sum[0] === '0' ? '1' : '0';
      return bad + m.slice(1);
    });
    expect(flipped).not.toBe(ct);
    expect(() => openSealArmor(flipped)).toThrow(DamagedSealError);
    try { openSealArmor(flipped); } catch (e) {
      expect(e).toBeInstanceOf(DamagedSealError);
      expect((e as Error).message).toBe('damaged in transit');
    }
    try { await unlockKey(doc, key.kid, 'definitely-not-the-pass'); throw new Error('expected'); }
    catch (e) {
      expect(e).toBeInstanceOf(SealError);
      expect((e as Error).message).toBe("Can't unlock");
    }
  }, 20_000);
});
