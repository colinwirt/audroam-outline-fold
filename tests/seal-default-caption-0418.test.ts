// 0.4.18: sealing a node keeps its title as the caption (public label) by default; an
// explicit opts.pub still wins; a blank title falls back to the placeholder. The caption stays
// editable while locked and the edit saves without the key (ct untouched, still decrypts). Invented data.
import { it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher } from '../src/index.js';
// @ts-ignore host copy of Audroam's outlineFoldHost
import { mountOutlineFold } from './_host.mjs';
import { setArgon2Provider, SEALED_PLACEHOLDER } from '../src/sealedBranch.js';

beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>));
const CTX = { noteId: '9', ownerId: '' };
async function sealed(fix: string, id: string, opts: { pub?: string } = {}) {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse(fix);
  const k = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes.find((n) => n.id === id)!, k.kid, CTX, opts);
  return d;
}

it('caption defaults to the node title', async () => {
  const d = await sealed('- Pantry box <id:4>\n  - seeds <id:5>\n', '4');
  const n = d.nodes[0];
  expect(n.title).toBe('Pantry box');
  expect(n.sealed!.pub).toBe('Pantry box');
  const t = serialize(d);
  expect(t).toMatch(/^- Pantry box <enc:k1> <id:4>/m);
  expect(t).not.toMatch(/seeds/);
});

it('explicit pub wins; a leaf keeps its title too', async () => {
  expect((await sealed('- Pantry <id:4>\n  - a <id:5>\n', '4', { pub: 'Box' })).nodes[0].title).toBe('Box');
  expect((await sealed('- Lonely leaf <id:4>\n', '4')).nodes[0].sealed!.pub).toBe('Lonely leaf');
});

it('blank title falls back to the placeholder with no pub', async () => {
  const d = await sealed('- <id:4>\n  - a <id:5>\n', '4');
  expect(d.nodes[0].title).toBe(SEALED_PLACEHOLDER);
  expect(d.nodes[0].sealed!.pub).toBeUndefined();
});

it('caption edit while locked saves without the key; ct untouched and still decrypts', async () => {
  const d = await sealed('- Pantry box <id:4>\n  - seeds <id:5>\n', '4');
  const t0 = serialize(d); clearKeys();
  const ct0 = d.nodes[0].sealed!.ciphertext;
  const t1 = t0.replace('- Pantry box <enc:k1>', '- Larder <enc:k1>');
  const d1 = parse(t1);
  expect(d1.nodes[0].sealed!.pub).toBe('Larder');
  expect(d1.nodes[0].sealed!.ciphertext).toBe(ct0);
  const t2 = serialize(d1); // no key loaded: must not throw
  expect(t2).toMatch(/^- Larder <enc:k1> <id:4>/m);
  clearKeys();
  const fh = mountOutlineFold({ text: t2, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 10 });
  await fh.sessions.open(fh.regionFor('4'), 'pw');
  expect(serialize(fh.regionHosts()[0].doc)).toMatch(/seeds/);
  await fh.lock('all'); clearKeys();
});
