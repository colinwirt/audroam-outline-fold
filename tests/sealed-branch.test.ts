import { describe, it, expect, beforeEach } from 'vitest';
import { pbkdf2Sync, hkdfSync, createCipheriv } from 'node:crypto';
import {
  parse,
  serialize,
  toHtml,
  createKey,
  unlockKey,
  clearKeys,
  unlockedKids,
  exportKeyEntry,
  importKeyEntry,
  removeKey,
  sealBranch,
  openSealedBranch,
  validateSealedBranches,
  parseKdfHeader,
  SealError,
  SEALED_PLACEHOLDER,
  type OutlineFoldDoc,
  type OutlineNode,
} from '../src/index.js';
import { __subkeyBitsForKat, b64u, unb64u } from '../src/sealedBranch.js';

const PASS = 'correct horse battery staple';
const CTX = { noteId: 'note-1', ownerId: 'owner-1' };
const SRC = `- Root <id:r>
  - Vault <id:v>
    - Secret caption child <id:c1>
      - deeper <id:c2>
  - Public sibling <id:s>`;

function find(doc: OutlineFoldDoc, id: string): OutlineNode {
  let hit: OutlineNode | undefined;
  const walk = (l: OutlineNode[]) => l.forEach((n) => { if (n.id === id) hit = n; if (n.children) walk(n.children); });
  walk(doc.nodes);
  return hit!;
}

async function sealedDoc(pub?: string) {
  const doc = parse(SRC);
  const key = await createKey(doc, PASS, { pub: 'Work key' });
  await sealBranch(doc, find(doc, 'v'), key.kid, CTX, pub ? { pub } : {});
  return { doc, kid: key.kid, text: serialize(doc) };
}

/** Flip one character of a base64url segment of the ct field. */
function tamperCt(text: string, seg: number, at = 2): string {
  return text.replace(/ct: (\S+)/, (_m, ct: string) => {
    const parts = ct.split('.');
    const s = parts[seg]!;
    const ch = s[at] === 'A' ? 'B' : 'A';
    parts[seg] = s.slice(0, at) + ch + s.slice(at + 1);
    return `ct: ${parts.join('.')}`;
  });
}

beforeEach(() => clearKeys());

describe('sealed branches: format', () => {
  it('locked branch is a single neutral node; caption and children never serialized', async () => {
    const { text } = await sealedDoc();
    expect(text).not.toContain('Secret caption');
    expect(text).not.toContain('deeper');
    expect(text).toContain(`- ${SEALED_PLACEHOLDER}`);
    expect(text).toContain('--- payloads ---');
    expect(text).toContain('--- keys ---');
    expect(text).toContain('alg: of-seal-v1');
  });

  it('public label is explicit and shown instead of the placeholder', async () => {
    const { text } = await sealedDoc('Bank (public label)');
    expect(text).toContain('- Bank (public label)');
    expect(text).toContain('pub: "Bank (public label)"');
  });

  it('round trip of an untouched sealed doc is byte-identical', async () => {
    const { text } = await sealedDoc('L');
    expect(serialize(parse(text))).toBe(text);
    const doc = parse(text);
    expect(validateSealedBranches(doc)).toEqual([]);
  });

  it('key list holds no verifier: only kid, kdf, pub', async () => {
    const { text } = await sealedDoc();
    const block = text.split('--- keys ---')[1]!.split('\n---')[0]!;
    const fields = [...block.matchAll(/^ +(\w+):/gm)].map((m) => m[1]);
    expect(new Set(fields)).toEqual(new Set(['kdf', 'pub']));
    expect(block).not.toMatch(/check|verif|hash/i);
  });

  it('rejects weak or unknown KDF params', () => {
    const salt = 'A'.repeat(22);
    expect(() => parseKdfHeader(`kdf=pbkdf2-sha256&i=100000&salt=${salt}`)).toThrow(SealError);
    expect(() => parseKdfHeader(`kdf=argon2id&m=8192&t=3&p=1&salt=${salt}`)).toThrow(SealError);
    expect(() => parseKdfHeader(`kdf=scrypt&n=1&salt=${salt}`)).toThrow(SealError);
    expect(parseKdfHeader(`kdf=argon2id&m=19456&t=2&p=1&salt=${salt}`).kdf).toBe('argon2id');
  });
});

describe('sealed branches: unlock, re-lock, fail closed', () => {
  it('unlock opens a viewer; host keeps only the sealed line; edits never reach host text', async () => {
    const { text, kid } = await sealedDoc();
    clearKeys();
    const doc = parse(text);
    expect(await unlockKey(doc, kid, PASS)).toBe(1);
    const view = await openSealedBranch(doc, 'v', CTX);
    const root = view.doc.nodes[0]!;
    expect(root.title).toBe('Vault');
    expect(root.children![0]!.title).toBe('Secret caption child');
    expect(root.children![0]!.children![0]!.depth).toBe(2);
    root.children![0]!.title = 'edited secret';
    expect(serialize(doc)).toBe(text);
    expect(find(doc, 'v').children ?? []).toEqual([]);
    expect(toHtml(doc)).toContain('data-sealed-branch="locked"');
    expect(view.isDirty()).toBe(true);
    view.close();
    expect(view.doc.nodes).toEqual([]);
  });

  it('viewer save uses a fresh nonce; unchanged save is byte-identical', async () => {
    const { doc, text } = await sealedDoc();
    const v1 = await openSealedBranch(doc, 'v', CTX);
    await v1.save();
    expect(serialize(doc)).toBe(text);
    v1.doc.nodes[0]!.title = 'Vault 2';
    await v1.save();
    v1.close();
    const t2 = serialize(doc);
    expect(t2).not.toBe(text);
    expect(t2).not.toContain('Vault 2');
    const nonce = (t: string) => t.match(/ct: \S+?\.(\S+?)\./)![1];
    expect(nonce(t2)).not.toBe(nonce(text));
    const v2 = await openSealedBranch(doc, 'v', CTX);
    expect(v2.doc.nodes[0]!.title).toBe('Vault 2');
  });

  it('nonces are unique across many seals', async () => {
    const doc = parse(SRC);
    const key = await createKey(doc, PASS);
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const d = parse(SRC);
      d.keys = doc.keys;
      await sealBranch(d, find(d, 'v'), key.kid, CTX);
      seen.add(find(d, 'v').sealed!.ciphertext!.split('.')[1]!);
    }
    expect(seen.size).toBe(50);
  });

  it('wrong passphrase gives the uniform error', async () => {
    const { text, kid } = await sealedDoc();
    clearKeys();
    const doc = parse(text);
    await unlockKey(doc, kid, 'wrong');
    await expect(openSealedBranch(doc, 'v', CTX)).rejects.toThrow("Can't unlock");
  });

  it('clearKeys drops keys from memory', async () => {
    const { doc, kid } = await sealedDoc();
    expect(unlockedKids()).toEqual([kid]);
    clearKeys();
    expect(unlockedKids()).toEqual([]);
    await expect(openSealedBranch(doc, 'v', CTX)).rejects.toBeInstanceOf(SealError);
  });
});

describe('sealed branches: tamper and binding', () => {
  const cases: [string, (t: string) => string][] = [
    ['header (salt)', (t) => tamperCt(t, 0, 50)],
    ['header (version)', (t) => t.replace(/ct: (\S+?)\./, (_m, h) => `ct: ${b64u(new TextEncoder().encode(new TextDecoder().decode(unb64u(h)).replace('v=1', 'v=2')))}.`)],
    ['nonce', (t) => tamperCt(t, 1)],
    ['ciphertext', (t) => tamperCt(t, 2)],
    ['kid in payload', (t) => t.replace(/  kid: (\S+)/, '  kid: AAAAAAAAAAAAAAAAAAAAAA')],
    ['kdf params', (t) => t.replace(/i=600000/, 'i=600001')],
    ['kdf salt', (t) => t.replace(/(kdf: \S+salt=)(.)/, (_m, a, c) => a + (c === 'A' ? 'B' : 'A'))],
  ];
  for (const [name, mut] of cases) {
    it(`tampered ${name} fails closed`, async () => {
      const { text, kid } = await sealedDoc();
      const bad = mut(text);
      expect(bad).not.toBe(text);
      const doc = parse(bad);
      try { await unlockKey(doc, kid, PASS); } catch { /* bad kdf header */ }
      if (!doc.keys?.some((k) => k.kid === find(doc, 'v').sealed!.kid)) {
        // kid swapped to one not in the list: import a fresh entry under that kid with the same kdf
        doc.keys = [...(doc.keys ?? []), { kid: find(doc, 'v').sealed!.kid!, kdf: doc.keys![0]!.kdf }];
        await unlockKey(doc, find(doc, 'v').sealed!.kid!, PASS);
      }
      await expect(openSealedBranch(doc, 'v', CTX)).rejects.toThrow("Can't unlock");
    });
  }

  for (const [name, ctx] of [
    ['another note', { ...CTX, noteId: 'note-2' }],
    ['another owner', { ...CTX, ownerId: 'owner-2' }],
    ['regrafted under a sealed parent', { ...CTX, parentId: 'r' }],
  ] as const) {
    it(`blob moved to ${name} fails`, async () => {
      const { doc } = await sealedDoc();
      await expect(openSealedBranch(doc, 'v', ctx)).rejects.toThrow("Can't unlock");
    });
  }

  it('blob moved to another node id fails', async () => {
    const { text } = await sealedDoc();
    const doc = parse(text.replace(/<id:v>/, '<id:w>').replace(/^v:$/m, 'w:'));
    await expect(openSealedBranch(doc, 'w', CTX)).rejects.toThrow("Can't unlock");
  });
});

describe('key list: reuse across maps, remove guard', () => {
  it('exported entry has no secret; same passphrase unlocks in a second map; blob cannot move', async () => {
    const a = await sealedDoc();
    const entry = exportKeyEntry(a.doc, a.kid);
    expect(Object.keys(entry).sort()).toEqual(['kdf', 'kid', 'pub']);
    const b = parse(SRC);
    importKeyEntry(b, entry);
    clearKeys();
    await unlockKey(b, a.kid, PASS);
    await sealBranch(b, find(b, 'v'), a.kid, { ...CTX, noteId: 'note-2' });
    const bv = await openSealedBranch(b, 'v', { ...CTX, noteId: 'note-2' });
    expect(bv.doc.nodes[0]!.title).toBe('Vault');
    // Map A's blob pasted into map B fails.
    const moved = parse(a.text);
    await expect(openSealedBranch(moved, 'v', { ...CTX, noteId: 'note-2' })).rejects.toThrow("Can't unlock");
  });

  it('same kid gives different subkeys in two maps (HKDF info binds note id)', async () => {
    const { kid } = await sealedDoc();
    const salt = new Uint8Array(16);
    const k1 = await __subkeyBitsForKat(kid, salt, 'v', 'note-1');
    const k2 = await __subkeyBitsForKat(kid, salt, 'v', 'note-2');
    expect(b64u(k1)).not.toBe(b64u(k2));
  });

  it('removeKey is blocked while a branch references the kid', async () => {
    const { doc, kid } = await sealedDoc();
    expect(removeKey(doc, kid)).toEqual({ ok: false, reason: 'in-use' });
    const spare = await createKey(doc, PASS);
    // A locked branch could hide inner references to any kid.
    expect(removeKey(doc, spare.kid).ok).toBe(false);
    const d2 = parse('- a <id:a>');
    const k = await createKey(d2, PASS);
    expect(removeKey(d2, k.kid)).toEqual({ ok: true });
  });
});

describe('nested sealed branches (encrypt-then-embed)', () => {
  it('inner stays sealed when the outer opens; same-kid warns', async () => {
    const doc = parse(SRC);
    const k1 = await createKey(doc, PASS);
    const k2 = await createKey(doc, 'other pass');
    const c1 = find(doc, 'c1');
    await sealBranch(doc, c1, k2.kid, { ...CTX, parentId: 'v' });
    await sealBranch(doc, find(doc, 'v'), k1.kid, CTX);
    const text = serialize(doc);
    expect(text).not.toContain('Secret');
    clearKeys();
    const d = parse(text);
    await unlockKey(d, k1.kid, PASS);
    const outer = await openSealedBranch(d, 'v', CTX);
    const inner = find(outer.doc, 'c1');
    expect(inner.title).toBe(SEALED_PLACEHOLDER);
    expect(serialize(d)).toBe(text);
    await expect(outer.open('c1')).rejects.toThrow("Can't unlock");
    await unlockKey(d, k2.kid, 'other pass');
    const iv = await outer.open('c1');
    expect(iv.doc.nodes[0]!.title).toBe('Secret caption child');
    expect(inner.title).toBe(SEALED_PLACEHOLDER);
    expect(serialize(d)).toBe(text);
    outer.close();
    expect(iv.closed).toBe(true);

    const d3 = parse(SRC);
    d3.keys = doc.keys;
    await unlockKey(d3, k1.kid, PASS);
    await sealBranch(d3, find(d3, 'v'), k1.kid, CTX);
    const ov = await openSealedBranch(d3, 'v', CTX);
    const r = await sealBranch(ov.doc, find(ov.doc, 'c1'), k1.kid, { ...CTX, parentId: 'v', depth: 1 });
    expect(r.warnings[0]).toMatch(/no extra protection/);
  });
});

describe('KAT (independent reference via node:crypto)', () => {
  it('ciphertext matches a PBKDF2 → HKDF → AES-256-GCM reference', async () => {
    const kdfSalt = new Uint8Array(16).fill(1);
    const brSalt = new Uint8Array(16).fill(2);
    const nonce = new Uint8Array(12).fill(3);
    const kid = 'AAAAAAAAAAAAAAAAAAAAAA';
    const kdf = `kdf=pbkdf2-sha256&i=600000&salt=${b64u(kdfSalt)}`;
    const doc = parse('- Top <id:t>\n  - inner <id:i>');
    importKeyEntry(doc, { kid, kdf });
    await unlockKey(doc, kid, PASS);
    await sealBranch(doc, find(doc, 't'), kid, CTX, {}, { salt: brSalt, nonce });
    const ct = find(doc, 't').sealed!.ciphertext!;

    const master = pbkdf2Sync(PASS, kdfSalt, 600000, 32, 'sha256');
    const sub = Buffer.from(hkdfSync('sha256', master, brSalt, JSON.stringify(['of-seal-v1', 'note-1', 't']), 32));
    expect(b64u(await __subkeyBitsForKat(kid, brSalt, 't', 'note-1'))).toBe(b64u(sub));
    const hdr = `v=1&alg=A256GCM&kdf=hkdf-sha256&salt=${b64u(brSalt)}`;
    const aad = JSON.stringify(['of-seal-aad-1', hdr, kid, kdf, 'note-1', 'owner-1', 't', '']);
    const pt = JSON.stringify({ v: 1, caption: 'Top', body: '- inner <id:i>\n' });
    const c = createCipheriv('aes-256-gcm', sub, nonce);
    c.setAAD(Buffer.from(aad));
    const body = Buffer.concat([c.update(pt, 'utf8'), c.final(), c.getAuthTag()]);
    expect(ct).toBe(`${b64u(new TextEncoder().encode(hdr))}.${b64u(nonce)}.${b64u(new Uint8Array(body))}`);
    // Pinned vector (regression)
    expect(b64u(sub)).toMatchSnapshot();
  });
});
