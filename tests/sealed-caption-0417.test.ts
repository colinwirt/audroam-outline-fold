// @vitest-environment happy-dom
// 0.4.17 (Colin): a sealed line's visible caption IS its public label (plain-text description).
// Renaming it (text or Map) is never refused: fold, tick, drag and rename all save, show the new
// caption, and the branch still decrypts the same (pub is outside the AEAD). Invented data only.
import { it, beforeAll, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher, toggleFold, toggleTask } from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
// @ts-ignore
import { mountOutlineFold } from './_host.mjs';
beforeAll(() => {
  setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as any);
});
const CTX = { noteId: '9', ownerId: '' };
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function sealed(): Promise<string> {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse(`- [ ] buy seeds <id:1>\n  - packets <id:2>\n- vault <id:4>\n  - hidden pin <id:5>\n  - [x] hidden task <id:6>\n- water <id:7>\n`);
  const k = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes.find((n) => n.id === '4')!, k.kid, CTX, { pub: "" });
  const t = serialize(d); clearKeys();
  return t;
}
async function contents(text: string): Promise<string> {
  clearKeys();
  const fh = mountOutlineFold({ text, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 10 });
  await fh.sessions.open(fh.regionFor('4'), 'pw');
  const out = serialize(fh.regionHosts()[0].doc).split('\n--- ')[0]!;
  await fh.lock('all'); clearKeys();
  return out;
}
const ops: [string, (v: any) => any][] = [
  ['fold', (v) => toggleFold(v, '1')],
  ['tick', (v) => toggleTask(v, '1')!.doc],
  ['drag', (v) => ({ ...v, nodes: [v.nodes[2], v.nodes[0], v.nodes[1]] })],
  ['rename', (v) => { v.nodes[2].title = 'water daily'; return v; }],
  ['rename sealed caption in the Map', (v) => { v.nodes.find((n: any) => n.id === '4').title = 'Garden safe'; return v; }],
];
for (const [name, op] of ops) {
  it(`caption renamed in the text, then Map ${name}: saves, caption saved as label, ciphertext decrypts the same`, async () => {
    const base = await sealed();
    const before = await contents(base);
    expect(before).toContain('hidden pin');
    const held: unknown[] = [];
    const fh = mountOutlineFold({ text: base, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 10, onHold: (e: unknown) => held.push(e) });
    fh.doc.setText(base.replace('- Sealed branch <enc:', '- My vault <enc:'), { source: 'text' });
    await tick();
    const v = parse(fh.getText()); fh.markView();
    let ok = false;
    expect(() => { ok = fh.commitView(op(v), 'map'); }).not.toThrow();
    expect(held).toEqual([]);
    expect(ok).toBe(true);
    const out = fh.getText();
    const caption = name.includes('sealed caption') ? 'Garden safe' : 'My vault';
    expect(out).toContain(`- ${caption} <enc:k1> <id:4>`);
    expect(out).toContain(`pub: ${JSON.stringify(caption)}`);
    expect(parse(out).nodes.find((n) => n.id === '4')!.title).toBe(caption); // shown on the node
    expect(() => serialize(parse(out))).not.toThrow();
    // Ciphertext untouched by a label change (pub is not in the AEAD) and decrypts the same.
    const ct = (s: string) => /\n4:\n(?:  .*\n)*?  ct: (\S+)/.exec(s)![1];
    expect(ct(out)).toBe(ct(base));
    expect(await contents(out)).toBe(before);
  });
}
it('the guard stays strict for real leaks: plaintext children under a sealed line', async () => {
  const d = parse(await sealed());
  d.nodes.find((n) => n.id === '4')!.children = [{ title: 'leak', id: '99' } as any];
  expect(() => serialize(d)).toThrow(/children/);
});
it('a blank caption shows the placeholder and drops pub', async () => {
  const d = parse((await sealed()).replace('- Sealed branch <enc:', '-  <enc:'));
  expect(d.nodes.find((n) => n.id === '4')!.title).toBe('Sealed branch');
  expect(serialize(d)).not.toMatch(/\n  pub:/);
});
it('a re-captioned line with a stale pub saves; the caption wins, ct kept', async () => {
  const base = await sealed();
  const odd = base.replace('- Sealed branch <enc:', '- My vault <enc:').replace('\n4:\n', '\n4:\n  pub: "Old label"\n');
  const out = serialize(parse(odd));
  expect(out).toContain('pub: "My vault"'); expect(out).not.toContain('Old label');
  expect(await contents(out)).toBe(await contents(base));
});
