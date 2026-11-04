// @vitest-environment happy-dom
// Repro (uncommitted): emoji inside the secure zone. Invented fixture.
import { it, beforeAll, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { EditorView } from '@codemirror/view';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher, createSealSessions } from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
// @ts-ignore
import { mountOutlineFold } from './_host.mjs';
beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>));
const FIX = `- top <id:1>\n- Vault <id:4>\n  - Coffee ☕ plan <id:5>\n  - 🔑 key <id:6>\n  - family 👨‍👩‍👧 <id:7>\n- after <id:8>\n`;
const CTX = { noteId: '9', ownerId: '' };
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
async function sealed() { clearKeys(); setSealCipher('a256gcm'); const d = parse(FIX); const k = await createKey(d, 'pw', { kid: 'k1' }); await sealBranch(d, d.nodes[1]!, k.kid, CTX); const t = serialize(d); clearKeys(); return t; }
async function reopen(text: string) { clearKeys(); const d = parse(text); const s = createSealSessions({ getDoc: () => d, ctx: CTX, autoLockMs: 60000, backoffMs: () => 0, wipeOnPagehide: false }); await s.open(s.regionFor('4'), 'pw'); const o = serialize(s.get(s.regionFor('4')).doc!); s.destroy(); return o; }
it('parse/serialize plain', () => { const o = serialize(parse(FIX)); console.log('PLAIN', JSON.stringify(o)); expect(o).toContain('☕'); expect(o).toContain('🔑 key'); expect(o).toContain('👨‍👩‍👧'); });
it('seal → reopen keeps emoji', async () => { const o = await reopen(await sealed()); console.log('REOPEN', JSON.stringify(o)); expect(o).toContain('Coffee ☕ plan'); expect(o).toContain('🔑 key'); expect(o).toContain('family 👨‍👩‍👧'); });
it('zone editor shows, edit+save+reopen keeps emoji', async () => {
  const txt = await sealed();
  document.body.innerHTML = ''; const box = document.createElement('div'); document.body.append(box);
  const fh = mountOutlineFold({ text: txt, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000 }); const h = fh.mountEditor(box, {});
  await fh.sessions.open(fh.regionFor('4'), 'pw'); await tick();
  const v = EditorView.findFromDOM(document.querySelector('.of-secure-zone-editor .cm-editor') as HTMLElement)!;
  console.log('ZONE', JSON.stringify(v.state.doc.toString()));
  expect(v.state.doc.toString()).toContain('Coffee ☕ plan');
  expect(v.state.doc.toString()).toContain('🔑 key');
  v.dispatch({ changes: { from: v.state.doc.length, insert: '\n  - tea 🍵 typed' } }); await tick();
  (document.querySelector('.of-sz-save') as HTMLButtonElement).click(); await tick(60);
  const back = await reopen(fh.getText()); console.log('BACK', JSON.stringify(back));
  expect(back).toContain('tea 🍵 typed'); expect(back).toContain('🔑 key'); expect(back).toContain('family 👨‍👩‍👧');
  h.destroy();
});
