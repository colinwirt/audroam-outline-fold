import { describe, it, expect, beforeEach } from 'vitest';
import { createDecipheriv, hkdfSync } from 'node:crypto';
import {
  parse,
  serialize,
  createKey,
  unlockKey,
  clearKeys,
  setSealCipher,
  sealBranch,
  openSealedBranch,
  cleanCopy,
  portableCopy,
  SealError,
  DamagedSealError,
  type OutlineFoldDoc,
  type OutlineNode,
} from '../src/index.js';
import { __encryptForKat, __installSecretForKat, inspectSealV3, parseKdfHeader } from '../src/sealedBranch.js';
import { armorSeal, crc32Hex, openSealArmor, packSealV3, parseSealV3 } from '../src/sealEnvelope.js';

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

function ivLen(alg: string): number {
  if (alg === 'xc20p') return 24;
  if (alg === 'a256gcm') return 12;
  throw new Error(alg);
}

async function sealed() {
  const doc = parse(SRC);
  const key = await createKey(doc, PASS);
  await sealBranch(doc, find(doc, 'v'), key.kid, CTX, { pub: 'Vault' });
  return { doc, kid: key.kid, text: serialize(doc) };
}

beforeEach(() => { clearKeys(); setSealCipher('a256gcm'); });

describe('of-seal-v3 envelope', () => {
  it('crc32 of 123456789 is the ISO-HDLC check value', () => {
    expect(crc32Hex(new TextEncoder().encode('123456789'))).toBe('cbf43926');
  });

  it('opens after a move, a copy into another note, and a caption edit', async () => {
    const { text, kid } = await sealed();
    const moved = parse(text.replace(/<id:v>/g, '<id:w>').replace(/^v:$/m, 'w:'));
    clearKeys();
    await unlockKey(moved, kid, PASS);
    expect((await openSealedBranch(moved, 'w', { noteId: 'other', ownerId: 'someone', parentId: 'r' })).doc.nodes[0]!.title).toBe('Vault');

    const copied = parse(text);
    copied.nodes[0]!.title = 'Pasted elsewhere';
    clearKeys();
    await unlockKey(copied, kid, PASS);
    expect((await openSealedBranch(copied, 'v', { noteId: 'note-9', ownerId: 'owner-9' })).doc.nodes[0]!.children![0]!.title).toBe('Secret caption child');

    const doc = parse(text);
    find(doc, 'v').title = 'Renamed';
    const out = serialize(doc);
    expect(out).toContain('pub: "Renamed"');
    expect(out).toContain('-----BEGIN OUTLINE-FOLD SEAL-----');
    const ct = (s: string) => s.match(/ct: (-----BEGIN OUTLINE-FOLD SEAL-----[\s\S]*?-----END OUTLINE-FOLD SEAL-----)/)![1];
    expect(ct(out)).toBe(ct(text));
    clearKeys();
    await unlockKey(doc, kid, PASS);
    expect((await openSealedBranch(doc, 'v', CTX)).doc.nodes[0]!.title).toBe('Vault');
  }, 20_000);

  it('a v2 payload still fails when the note id changes', async () => {
    const doc = parse('- Vault <id:v>\n  - hidden <id:c>');
    const key = await createKey(doc, PASS);
    const secret = new Uint8Array(32).fill(9);
    await __installSecretForKat(key.kid, secret);
    const inner = JSON.stringify({ v: 1, caption: 'Vault', body: '- hidden <id:c>\n' });
    const ct = await __encryptForKat(key.kid, 'a256gcm', 'v', CTX, inner, {
      salt: new Uint8Array(16).fill(2),
      nonce: new Uint8Array(12).fill(3),
    });
    const node = find(doc, 'v');
    node.sealed = { kid: key.kid, alg: 'of-seal-v2', ciphertext: ct };
    node.children = [];
    node.title = 'Vault';
    await expect(openSealedBranch(doc, 'v', { ...CTX, noteId: 'note-2' })).rejects.toBeInstanceOf(SealError);
    expect((await openSealedBranch(doc, 'v', CTX)).doc.nodes[0]!.title).toBe('Vault');
  });

  it('survives wrapping, CRLF, indentation, quotes, and prose around the block', async () => {
    const { doc } = await sealed();
    const ct = find(doc, 'v').sealed!.ciphertext!;
    const raw = openSealArmor(ct);
    const wrapped = ct.split('\n').map((l) => (l.length > 40 ? l.replace(/(.{20})/g, '$1\n') : l)).join('\n');
    const quoted = wrapped.split('\n').map((l) => `> ${l}`).join('\r\n');
    const pasted = `An assistant said:\n\n${quoted}\n\nEnd of quote.`;
    expect(Buffer.from(openSealArmor(pasted)).equals(Buffer.from(raw))).toBe(true);
    find(doc, 'v').sealed!.ciphertext = pasted;
    expect((await openSealedBranch(doc, 'v', CTX)).doc.nodes[0]!.title).toBe('Vault');
    const written = ct.split('\n');
    expect(written).toHaveLength(4);
    expect(written[0]).toBe('-----BEGIN OUTLINE-FOLD SEAL-----');
    expect(written[2]).toMatch(/^[0-9a-f]{8}$/);
    expect(written[3]).toBe('-----END OUTLINE-FOLD SEAL-----');
  });

  it('a changed character is damaged, and a header byte with a rebuilt checksum is a wrong key', async () => {
    const { doc } = await sealed();
    const ct = find(doc, 'v').sealed!.ciphertext!;
    const lines = ct.split('\n');
    const body = lines.findIndex((l) => /^[A-Za-z0-9_-]+$/.test(l) && l.length > 8);
    const flip = lines[body]!;
    const at = 3;
    lines[body] = flip.slice(0, at) + (flip[at] === 'A' ? 'B' : 'A') + flip.slice(at + 1);
    find(doc, 'v').sealed!.ciphertext = lines.join('\n');
    await expect(openSealedBranch(doc, 'v', CTX)).rejects.toBeInstanceOf(DamagedSealError);

    const raw = openSealArmor(ct);
    raw[10] ^= 0x1;
    find(doc, 'v').sealed!.ciphertext = armorSeal(raw);
    await expect(openSealedBranch(doc, 'v', CTX)).rejects.toBeInstanceOf(SealError);
  });

  it('rejects a KDF below the floor and a salt under 16 bytes', () => {
    const salt16 = 'A'.repeat(22);
    const salt8 = 'AAAAAAAAAAA'; // 8 bytes, base64url
    expect(() => parseKdfHeader(`kdf=argon2id&m=19456&t=2&p=1&salt=${salt16}`)).toThrow(SealError);
    expect(() => parseKdfHeader(`$argon2id$v=19$m=8192,t=3,p=1$${salt16}`)).toThrow(SealError);
    expect(() => parseKdfHeader(`$argon2id$v=19$m=65536,t=3,p=1$${salt8}`)).toThrow(SealError);
    expect(() => parseKdfHeader(`kdf=pbkdf2-sha256&i=600000&salt=${salt8}`)).toThrow(SealError);
  });

  it('swapped payload bodies fail, and a second seal does not reuse the iv', async () => {
    const doc = parse(SRC);
    const key = await createKey(doc, PASS);
    await sealBranch(doc, find(doc, 'v'), key.kid, CTX, { pub: '' });
    await sealBranch(doc, find(doc, 's'), key.kid, CTX, { pub: '' });
    const a = parseSealV3(openSealArmor(find(doc, 'v').sealed!.ciphertext!), ivLen);
    const b = parseSealV3(openSealArmor(find(doc, 's').sealed!.ciphertext!), ivLen);
    expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false);
    expect(Buffer.from(a.sid).equals(Buffer.from(b.sid))).toBe(false);
    find(doc, 'v').sealed!.ciphertext = armorSeal(packSealV3({ ...a, ct: b.ct }));
    await expect(openSealedBranch(doc, 'v', CTX)).rejects.toBeInstanceOf(SealError);
    expect(inspectSealV3(find(doc, 's').sealed!.ciphertext!).role).toBe('0:body');
  });

  it('portable copy keeps the payload and the keyring; clean copy is plaintext only', async () => {
    const { doc, text } = await sealed();
    expect(portableCopy(doc)).toBe(text);
    expect(portableCopy(doc)).toContain('-----BEGIN OUTLINE-FOLD SEAL-----');
    expect(portableCopy(doc)).toContain('--- keyring ---');
    const clean = cleanCopy(doc);
    expect(clean).not.toContain('BEGIN OUTLINE-FOLD SEAL');
    expect(clean).not.toContain('--- keyring ---');
    expect(clean).not.toContain('Secret caption');
    expect(clean).toContain('- Vault');
    expect(clean).not.toContain('<enc:');
  });

  it('a fixed seal matches an independent HKDF and AES-GCM implementation', async () => {
    const secret = Uint8Array.from({ length: 32 }, (_, i) => i);
    const salt = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
    const sid = Uint8Array.from({ length: 16 }, (_, i) => 32 + i);
    const dek = Uint8Array.from({ length: 32 }, (_, i) => 64 + i);
    const dekIv = Uint8Array.from({ length: 12 }, (_, i) => 96 + i);
    const iv = Uint8Array.from({ length: 12 }, (_, i) => 128 + i);
    const doc = parse('- Top <id:t>\n  - inner <id:i>');
    await createKey(doc, PASS, { kid: 'kx' });
    doc.keyring!.push({ ...doc.keyring![0]!, kid: 'k1' });
    await __installSecretForKat('k1', secret);
    await sealBranch(doc, find(doc, 't'), 'k1', CTX, { pub: '' }, { salt, sid, dek, dekIv, iv });
    const ct = find(doc, 't').sealed!.ciphertext!;
    const parts = parseSealV3(openSealArmor(ct), ivLen);
    expect(parts.role).toBe('0:body');
    expect(parts.kid).toBe('k1');
    const info = Buffer.from('of-seal-v3/wrap');
    const wrapKey = Buffer.from(hkdfSync('sha256', secret, salt, info, 32));
    const dekRaw = gcmOpen(wrapKey, Buffer.from(parts.dekIv), Buffer.from(parts.dekCt), Buffer.from(parts.aad));
    expect(Buffer.from(dekRaw).equals(Buffer.from(dek))).toBe(true);
    const pt = gcmOpen(Buffer.from(dekRaw), Buffer.from(parts.iv), Buffer.from(parts.ct), Buffer.from(parts.aad));
    expect(JSON.parse(pt.toString('utf8'))).toEqual({ v: 1, caption: 'Top', body: '- inner <id:i>\n' });
    expect((await openSealedBranch(doc, 't', { noteId: 'elsewhere', ownerId: 'no-one' })).doc.nodes[0]!.title).toBe('Top');
  });
});

function gcmOpen(key: Buffer, iv: Buffer, data: Buffer, aad: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(aad);
  d.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
}
