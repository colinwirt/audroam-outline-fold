// @vitest-environment happy-dom
// Repro (uncommitted): `:` typeahead / `:name:` inside an unlocked secure zone. Invented fixture.
import { it, beforeAll, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { EditorView } from '@codemirror/view';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher } from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
import { loadEmojiData, resolveTypedShortcode } from '../src/emoji/icons.js';
// @ts-ignore
import { mountOutlineFold } from './_host.mjs';
beforeAll(async () => { setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>); await loadEmojiData(); });
const FIX = `- top <id:1>\n- Vault <id:4>\n  - Coffee ☕ plan <id:5>\n- after <id:8>\n`;
const CTX = { noteId: '9', ownerId: '' };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function setup() {
  clearKeys(); setSealCipher('a256gcm'); const d = parse(FIX); const k = await createKey(d, 'pw', { kid: 'k1' }); await sealBranch(d, d.nodes[1]!, k.kid, CTX); const txt = serialize(d); clearKeys();
  document.body.innerHTML = ''; const box = document.createElement('div'); document.body.append(box);
  const fh = mountOutlineFold({ text: txt, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000 }); const h = fh.mountEditor(box, {});
  await fh.sessions.open(fh.regionFor('4'), 'pw'); await tick();
  const zone = EditorView.findFromDOM(document.querySelector('.of-secure-zone-editor .cm-editor') as HTMLElement)!;
  const main = EditorView.findFromDOM(document.querySelector('.cm-host > .cm-editor, .cm-host .cm-editor') as HTMLElement)!;
  return { fh, h, zone, main };
}
async function typeAtEnd(v: EditorView, s: string, atLine1 = false) { let e = atLine1 ? v.state.doc.line(1).to : v.state.doc.length; for (const ch of s) { v.dispatch({ changes: { from: e, insert: ch }, selection: { anchor: e + 1 }, userEvent: 'input.type' }); await tick(2); e = v.state.selection.main.head; } }
it('control: `:lock` in the MAIN text opens the typeahead', async () => {
  const { main, h } = await setup();
  await typeAtEnd(main, '\n- :lock', true); await tick();
  expect(document.querySelector('[data-testid="of-ta"]')).not.toBeNull(); h.destroy();
});
it('BUG: `:lock` in the ZONE editor opens the typeahead', async () => {
  const { zone, h } = await setup();
  await typeAtEnd(zone, '\n  - :lock'); await tick();
  expect(document.querySelector('[data-testid="of-ta"]')).not.toBeNull(); h.destroy();
});
it('BUG: typing `:locked:` + space in the ZONE becomes 🔒 (EP-29)', async () => {
  const { zone, h } = await setup();
  await typeAtEnd(zone, '\n  - :locked: '); await tick();
  expect(zone.state.doc.toString()).toContain('🔒');
  h.destroy();
});
it('fact: resolveTypedShortcode knows :locked:', () => { expect(resolveTypedShortcode(':locked:', 8)?.insert).toBe('🔒'); });
it('fact: stored `:locked:` text is NOT an icon on parse (anywhere)', () => {
  const n = parse('- :locked: encryption at rest\n').nodes[0]!;
  console.log('PARSED', JSON.stringify({ icon: (n as any).icon, title: n.title }));
});
it('control: typing `:locked:` in the MAIN text becomes 🔒 (EP-29)', async () => {
  const { main, h } = await setup();
  console.log('MAINCLS', main.dom.parentElement?.className, main.dom.closest('.of-secure-zone-editor') ? 'ZONE!' : 'main');
  await typeAtEnd(main, '\n- :locked: x', true); await tick();
  console.log('MAIN', JSON.stringify(main.state.doc.toString().slice(0,60)));
  expect(main.state.doc.toString()).toContain('🔒'); h.destroy();
});
