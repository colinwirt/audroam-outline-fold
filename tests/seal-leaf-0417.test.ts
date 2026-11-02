// @vitest-environment happy-dom
// Colin: any node can be sealed, even a leaf. The sealed submap starts empty; children are typed
// straight into the secure editor and never exist in plain text. Invented data only.
import { it, beforeAll, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher } from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
// @ts-ignore
import { mountOutlineFold } from './_host.mjs';
beforeAll(() => {
  setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as any);
});
const CTX = { noteId: '9', ownerId: '' };
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
it('seal a leaf, unlock, add children in the secure editor, save: no plaintext, decrypts', async () => {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse(`- shop <id:1>\n- Locker codes <id:4>\n- water <id:7>\n`);
  const k = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes.find((n) => n.id === '4')!, k.kid, CTX, { pub: 'Locker codes' });
  const text = serialize(d); clearKeys();
  expect(text).toContain('- Locker codes <enc:k1> <id:4>');
  expect(text.split('\n--- ')[0]).toBe('- shop <id:1>\n- Locker codes <enc:k1> <id:4>\n- water <id:7>\n');
  document.body.innerHTML = '';
  const box = document.createElement('div'); document.body.append(box);
  const fh = mountOutlineFold({ text, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 10 });
  fh.mountEditor(box, {});
  const region = fh.regionFor('4');
  await fh.sessions.open(region, 'pw');
  await tick();
  const { EditorView } = await import('@codemirror/view');
  const z = EditorView.findFromDOM(document.querySelector('.of-secure-zone-editor .cm-editor') as HTMLElement)!;
  expect(z).toBeTruthy();
  // Type children straight into the secure editor.
  z.dispatch({ changes: { from: z.state.doc.length, insert: '\n  - gym 4411\n  - bike 9020' }, userEvent: 'input.type' });
  await fh.saveRegion(region); await tick(60);
  const saved = fh.getText();
  expect(saved.split('\n--- ')[0]).toBe('- shop <id:1>\n- Locker codes <enc:k1> <id:4>\n- water <id:7>\n');
  expect(saved).not.toMatch(/gym|bike|4411|9020/);
  expect(() => serialize(parse(saved))).not.toThrow();
  await fh.lock('all'); clearKeys(); fh.unmount?.();
  const fh2 = mountOutlineFold({ text: saved, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 10 });
  await fh2.sessions.open(fh2.regionFor('4'), 'pw');
  const inner = serialize(fh2.regionHosts()[0].doc);
  expect(inner).toContain('gym 4411'); expect(inner).toContain('bike 9020');
});
