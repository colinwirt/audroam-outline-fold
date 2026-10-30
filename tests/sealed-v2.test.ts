import { describe, it, expect, beforeEach } from 'vitest';
import { hkdfSync, createDecipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import {
  parse, serialize, createKey, unlockKey, clearKeys, setSealCipher, sealBranch, openSealedBranch,
  validateSealedBranches, SealError, type OutlineFoldDoc, type OutlineNode,
} from '../src/index.js';
import {
  __installSecretForKat, __encryptForKat, aadV2, b64u, unb64u, unlockKeyring, changeKeyringPassphrase,
  migrateSealedV1, branchCipher, parseBranchCtV2, deriveShareKeyBits, __branchKeyBitsForKat,
} from '../src/sealedBranch.js';

const KAT = JSON.parse(readFileSync(new URL('./vectors/of-seal-v2-kat.json', import.meta.url), 'utf8'));
const V1 = JSON.parse(readFileSync(new URL('./vectors/of-seal-v1-fixture.json', import.meta.url), 'utf8'));
const PASS = 'v2 test passphrase';
const CTX = { noteId: 'note-1', ownerId: 'owner-1' };
const SRC = `- Root <id:r>
  - A <id:a>
    - a secret <id:a1>
  - B <id:b>
    - b secret <id:b1>
  - Public <id:s>`;
const find = (doc: OutlineFoldDoc, id: string): OutlineNode | undefined => {
  let hit: OutlineNode | undefined;
  const walk = (l: OutlineNode[]) => l.forEach((n) => { if (n.id === id) hit = n; if (n.children) walk(n.children); });
  walk(doc.nodes);
  return hit;
};
const hexb = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

beforeEach(() => { clearKeys(); setSealCipher('a256gcm'); });

describe('of-seal-v2 KAT (committed vectors)', () => {
  for (const v of KAT.vectors) {
    it(`${v.cipher}${v.parentId ? ' nested' : ''}: fixed key/salt/nonce reproduces the committed ciphertext`, async () => {
      await __installSecretForKat(KAT.kid, unb64u(KAT.secret));
      const ctx = v.parentId ? { ...KAT.ctx, parentId: v.parentId } : KAT.ctx;
      const ct = await __encryptForKat(KAT.kid, v.cipher, KAT.nodeId, ctx, KAT.plaintext, { salt: unb64u(v.salt), nonce: unb64u(v.nonce) });
      expect(ct).toBe(v.ct);
    });

    it(`${v.cipher}${v.parentId ? ' nested' : ''}: independent reference decrypts the vector`, () => {
      const blob = parseBranchCtV2(v.ct);
      const label = `of/${v.cipher}/v1`;
      expect(blob.label).toBe(label);
      const key = new Uint8Array(hkdfSync('sha256', unb64u(KAT.secret), unb64u(v.salt), JSON.stringify(['of-seal-v2', label, KAT.ctx.noteId, KAT.nodeId]), 32));
      const ctx = v.parentId ? { ...KAT.ctx, parentId: v.parentId } : KAT.ctx;
      const ad = aadV2(blob.hdr, label, KAT.kid, KAT.nodeId, ctx);
      let pt: string;
      if (v.cipher === 'a256gcm') {
        const raw = Buffer.from(blob.ct);
        const d = createDecipheriv('aes-256-gcm', key, blob.nonce);
        d.setAAD(Buffer.from(ad));
        d.setAuthTag(raw.subarray(raw.length - 16));
        pt = Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString('utf8');
      } else {
        pt = new TextDecoder().decode(xchacha20poly1305(key, blob.nonce, ad).decrypt(blob.ct));
      }
      expect(pt).toBe(KAT.plaintext);
    });
  }

  it('the pinned XChaCha20-Poly1305 lib matches draft-irtf-cfrg-xchacha A.3.1', () => {
    const key = hexb('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f');
    const nonce = hexb('404142434445464748494a4b4c4d4e4f5051525354555657');
    const aad = hexb('50515253c0c1c2c3c4c5c6c7');
    const pt = new TextEncoder().encode("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.");
    const out = xchacha20poly1305(key, nonce, aad).encrypt(pt);
    const hex = Buffer.from(out).toString('hex');
    expect(hex.slice(0, 32)).toBe('bd6d179d3e83d43b9576579493c0e939');
    expect(hex.slice(-32)).toBe('c0875924c1c7987947deafd8780acf49');
  });
});

describe('of-seal-v2 binding and labels', () => {
  it('label mix-up: xc20p ciphertext with an a256gcm label (or share label) never opens', async () => {
    const doc = parse(SRC);
    const k = await createKey(doc, PASS);
    await sealBranch(doc, find(doc, 'a')!, k.kid, CTX, { cipher: 'xc20p' });
    const edit = (f: (h: string) => string) => {
      const d = parse(serialize(doc));
      const p = find(d, 'a')!.sealed!;
      const [h, ...rest] = p.ciphertext!.split('.');
      p.ciphertext = [b64u(new TextEncoder().encode(f(new TextDecoder().decode(unb64u(h!))))), ...rest].join('.');
      return d;
    };
    for (const f of [
      (h: string) => h.replace('label=of/xc20p/v1', 'label=of/a256gcm/v1'),
      (h: string) => h.replace('label=of/xc20p/v1', 'label=of/share/v1'),
      (h: string) => h.replace('c=xc20p&label=of/xc20p/v1', 'c=a256gcm&label=of/a256gcm/v1'),
    ]) {
      await expect(openSealedBranch(edit(f), 'a', CTX)).rejects.toBeInstanceOf(SealError);
    }
  });

  it('share key bits differ from both branch cipher keys and need an unlocked kid', async () => {
    const salt = new Uint8Array(16).fill(9);
    await expect(deriveShareKeyBits('nope', salt, 'n', 'x')).rejects.toBeInstanceOf(SealError);
    await __installSecretForKat('s1', new Uint8Array(32).fill(1));
    const share = b64u(await deriveShareKeyBits('s1', salt, 'n', 'x'));
    expect(share).not.toBe(b64u(await __branchKeyBitsForKat('s1', 'a256gcm', salt, 'n', 'x')));
    expect(share).not.toBe(b64u(await __branchKeyBitsForKat('s1', 'xc20p', salt, 'n', 'x')));
    expect(share).not.toBe(b64u(new Uint8Array(32).fill(1)));
  });
});

describe('of-seal-v2 ciphers per branch', () => {
  it('mixed ciphers in one map: both open, round trip byte-identical, cipher read from header', async () => {
    const doc = parse(SRC);
    const k = await createKey(doc, PASS);
    await sealBranch(doc, find(doc, 'a')!, k.kid, CTX, { cipher: 'a256gcm' });
    setSealCipher('xc20p');
    await sealBranch(doc, find(doc, 'b')!, k.kid, CTX);
    const text = serialize(doc);
    expect(text).not.toMatch(/secret/);
    expect(text).toMatch(/- Sealed branch <enc:k1> <id:a>/);
    clearKeys();
    const d = parse(text);
    expect(serialize(d)).toBe(text);
    expect(branchCipher(find(d, 'a')!.sealed)).toBe('a256gcm');
    expect(branchCipher(find(d, 'b')!.sealed)).toBe('xc20p');
    expect(validateSealedBranches(d)).toEqual([]);
    await unlockKeyring(d, PASS);
    expect((await openSealedBranch(d, 'a', CTX)).doc.nodes[0]!.title).toBe('A');
    const vb = await openSealedBranch(d, 'b', CTX);
    expect(vb.doc.nodes[0]!.children![0]!.title).toBe('b secret');
    vb.doc.nodes[0]!.title = 'B2';
    await vb.save();
    expect(branchCipher(find(d, 'b')!.sealed)).toBe('xc20p'); // re-seal keeps the branch's cipher
  });

  it('nonces and salts are unique across many seals for both ciphers', async () => {
    const doc = parse(SRC);
    const k = await createKey(doc, PASS);
    for (const cipher of ['a256gcm', 'xc20p'] as const) {
      const nonces = new Set<string>();
      const salts = new Set<string>();
      for (let i = 0; i < 40; i++) {
        const d = parse(SRC);
        d.keyring = doc.keyring;
        await sealBranch(d, find(d, 'a')!, k.kid, CTX, { cipher });
        const b = parseBranchCtV2(find(d, 'a')!.sealed!.ciphertext!);
        expect(b.nonce.length).toBe(cipher === 'a256gcm' ? 12 : 24);
        nonces.add(b64u(b.nonce));
        salts.add(b64u(b.salt));
      }
      expect(nonces.size).toBe(40);
      expect(salts.size).toBe(40);
    }
  });
});

describe('keyring', () => {
  it('passphrase change re-wraps only the keyring; ciphertexts are untouched', async () => {
    const doc = parse(SRC);
    const k = await createKey(doc, PASS);
    await sealBranch(doc, find(doc, 'a')!, k.kid, CTX);
    const before = serialize(doc);
    const ringBefore = JSON.stringify(doc.keyring);
    await expect(changeKeyringPassphrase(doc, 'wrong', 'new pass')).rejects.toBeInstanceOf(SealError);
    expect(JSON.stringify(doc.keyring)).toBe(ringBefore);
    await changeKeyringPassphrase(doc, PASS, 'new pass');
    const after = serialize(doc);
    expect(after.split('--- keyring ---')[0]).toBe(before.split('--- keyring ---')[0]);
    expect(after).not.toBe(before);
    clearKeys();
    const d = parse(after);
    await expect(unlockKey(d, k.kid, PASS)).rejects.toThrow("Can't unlock");
    await unlockKey(d, k.kid, 'new pass');
    expect((await openSealedBranch(d, 'a', CTX)).doc.nodes[0]!.title).toBe('A');
  });

  it('a keyring entry cannot be moved to another kid (kid is in the wrap AAD)', async () => {
    const doc = parse(SRC);
    await createKey(doc, PASS);
    const d = parse(serialize(doc).replace(/^k1:$/m, 'k7:'));
    clearKeys();
    await expect(unlockKey(d, 'k7', PASS)).rejects.toThrow("Can't unlock");
  });
});

describe('v1 → v2 migration', () => {
  it('v1 fixture still opens (decrypt-only), then migrates with nested branches', async () => {
    const doc = parse(V1.text);
    const legacy = doc.keys![0]!.kid;
    expect(find(doc, 'v')!.sealed!.alg).toBe('of-seal-v1');
    expect(validateSealedBranches(doc).join('\n')).toMatch(/v1|legacy/i);
    await unlockKey(doc, legacy, V1.passphrase);
    const view = await openSealedBranch(doc, 'v', V1.ctx);
    expect(view.doc.nodes[0]!.title).toBe('Vault');
    await expect(view.save()).rejects.toThrow();
    view.close();

    const r = await migrateSealedV1(doc, V1.ctx, { passphrase: PASS, cipher: 'xc20p' });
    expect(r.migrated).toBe(2);
    const text = serialize(doc);
    expect(text).not.toContain('of-seal-v1');
    expect(text).not.toContain('--- keys ---');
    expect(text).toContain('--- keyring ---');
    clearKeys();
    const d = parse(text);
    expect(validateSealedBranches(d)).toEqual([]);
    await unlockKeyring(d, PASS);
    const outer = await openSealedBranch(d, 'v', V1.ctx);
    expect(outer.doc.nodes[0]!.title).toBe('Vault');
    expect(Object.keys(r.kidMap)).toHaveLength(1);
    const inner = await outer.open('i');
    expect(inner.doc.nodes[0]!.title).toBe('Inner');
    expect(branchCipher(find(d, 'v')!.sealed)).toBe('xc20p');
  });

  it('migration without the legacy key unlocked is all-or-nothing', async () => {
    const doc = parse(V1.text);
    const before = serialize(doc);
    await expect(migrateSealedV1(doc, V1.ctx, { passphrase: PASS, cipher: 'a256gcm' })).rejects.toBeInstanceOf(SealError);
    expect(serialize(doc)).toBe(before);
  });
});
