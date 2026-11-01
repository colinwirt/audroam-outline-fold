// @vitest-environment happy-dom
import { it, beforeAll, afterEach, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher, createOutlineDoc, unlockKeyring } from '../src/index.js';
import { setArgon2Provider, stripAnchorId, __setLegacyInnerTextForTest, openSealedBranch } from '../src/sealedBranch.js';

beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>));
afterEach(() => __setLegacyInnerTextForTest(null));
const CTX = { noteId: '9', ownerId: '' };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
// Invented data. An old build wrote the anchor id into the payload's first line and a row.
const LEGACY = JSON.stringify({ v: 1, caption: 'Pantry box <id:4>', body: '- seeds <id:4>\n- jars <id:6>\n' });
async function legacySealed(): Promise<string> {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse(`- Garden <id:1>\n- Pantry box <id:4>\n  - seeds <id:5>\n`);
  const key = await createKey(d, 'pw', { kid: 'k1' });
  __setLegacyInnerTextForTest(() => LEGACY);
  await sealBranch(d, d.nodes.find((n) => n.id === '4')!, key.kid, CTX);
  __setLegacyInnerTextForTest(null);
  const t = serialize(d); clearKeys(); return t;
}
const ids = (l: any[] | undefined, out: string[] = []) => { l?.forEach((n) => { out.push(n.id); ids(n.children, out); }); return out; };

it('stripAnchorId (pure): removes the tag from the caption and the id from rows, nothing else', () => {
  const r = stripAnchorId('Box <id:4>', [{ id: '4', children: [{ id: '6' }] }, { id: '44' }], '4');
  expect(r.caption).toBe('Box');
  expect(r.nodes[0]!.id).toBeUndefined();
  expect(r.nodes[0]!.children![0]!.id).toBe('6');
  expect(r.nodes[1]!.id).toBe('44');
});

it('a legacy payload with the anchor id is clean on load', async () => {
  const t = await legacySealed();
  const d = createOutlineDoc({ text: t, ctx: () => CTX, wipeOnPagehide: false });
  await d.sessions.open(d.sessions.regionFor('4'), 'pw');
  const child = d.sessions.get(d.sessions.regionFor('4')).doc!;
  expect(child.nodes[0]!.title).toBe('Pantry box');
  expect(ids(child.nodes[0]!.children)).not.toContain('4');
  d.destroy();
});

it('the next re-seal writes a payload without the anchor id', async () => {
  const t = await legacySealed();
  const doc = parse(t);
  await unlockKeyring(doc, 'pw');
  const v = await openSealedBranch(doc, '4', CTX);
  // Load cleaned the view, so it differs from the legacy plaintext: the branch needs a re-seal.
  expect(v.isDirty()).toBe(true);
  await v.save();
  v.close();
  // Reopened: the decrypted payload equals the clean view (isDirty compares the two).
  const v2 = await openSealedBranch(doc, '4', CTX);
  expect(v2.isDirty()).toBe(false);
  expect(v2.doc.nodes[0]!.title).toBe('Pantry box');
  expect(ids(v2.doc.nodes[0]!.children)).not.toContain('4');
  v2.close();
});
