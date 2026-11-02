// @vitest-environment happy-dom
// 0.4.18: a sealed caption edited while LOCKED, in the text or the Map, reaches the saved pub
// line and the mounted editor (the tag guard must not drop a host write); payload ct untouched.
import { it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { EditorView } from '@codemirror/view';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher } from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
import { mountOutlineFold } from './_host.mjs';
beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as any));
const CTX = { noteId: '9', ownerId: '' };
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const pub = (t: string) => t.match(/pub: (.*)/)?.[1];
const ct = (t: string) => t.match(/ct: (.*)/)?.[1];
async function setup() {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse('- a <id:1>\n- vault <id:4>\n  - s <id:5>\n');
  const k = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes[1]!, k.kid, CTX);
  const text = serialize(d); clearKeys();
  const fh: any = mountOutlineFold({ text, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 10 });
  const box = document.createElement('div'); document.body.appendChild(box); fh.mountEditor(box, {});
  const ed = () => EditorView.findFromDOM(box.querySelector('.cm-editor') as HTMLElement)!.state.doc.toString();
  return { fh, ed, ct0: ct(text)! };
}
it('text caption edit while locked: saved text carries the new pub, ct unchanged', async () => {
  const { fh, ct0 } = await setup();
  fh.doc.setText(fh.getText().replace('- vault <enc', '- Larder <enc'), 'text'); await tick();
  const s = await fh.serialise();
  expect(pub(s.text)).toBe('"Larder"');
  expect(ct(s.text)).toBe(ct0);
});
it('Map caption rename while locked reaches the mounted editor (not dropped by the tag guard)', async () => {
  const { fh, ed, ct0 } = await setup();
  const v = parse(fh.getText()); v.nodes[1]!.title = 'Garden'; fh.commitView(v, 'map'); await tick();
  expect(ed()).toBe(fh.getText());
  expect(ed()).toContain('- Garden <enc:k1>');
  expect(pub(ed())).toBe('"Garden"');
  expect(ct(fh.getText())).toBe(ct0);
  await fh.sessions.open(fh.regionFor('4'), 'pw'); await tick();
  expect(fh.getText()).toContain('- Garden <enc:k1>');
});
