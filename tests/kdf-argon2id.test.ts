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
  type OutlineFoldDoc,
  type OutlineNode,
} from '../src/index.js';
import { argon2idDerive, installDefaultArgon2Provider } from '../src/kdf.js';
import { openSealArmor } from '../src/sealEnvelope.js';

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

beforeEach(() => { clearKeys(); setSealCipher('a256gcm'); setArgon2Provider(null); });
afterEach(() => { clearKeys(); setArgon2Provider(null); });

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

  it('createKey still writes PBKDF2 when no provider is installed', async () => {
    const doc = parse(SRC);
    const key = await createKey(doc, PASS);
    expect(key.kdf.startsWith('kdf=pbkdf2-sha256&i=600000&salt=')).toBe(true);
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
