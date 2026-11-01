// @vitest-environment happy-dom
// 0.4.7 (Colin QA, data loss): Save & re-seal in the Text zone must survive a reload, and a
// [ ] toggle on a row inside the unlocked cloud edits the zone plaintext and re-seals.
// Invented fixture only.
import { it, beforeAll, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { EditorView } from '@codemirror/view';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher, createSealSessions, scopeId } from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
// @ts-ignore host copy of Audroam's outlineFoldHost (imports rewritten to src)
import { mountOutlineFold } from './_host.mjs';

beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>));
const FIX = `- Garden list <id:1>\n- Sealed branch <id:4>\n  - seeds <id:5>\n    - [ ] tomato <id:6>\n- after <id:7>\n`;
const CTX = { noteId: '9', ownerId: '' };
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
async function sealed() {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse(FIX);
  const key = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes[1]!, key.kid, CTX);
  const txt = serialize(d); clearKeys();
  return txt;
}
/** Reload: a fresh parse of the saved text, a fresh key unlock, decrypt the branch. */
async function reopen(text: string): Promise<string> {
  clearKeys();
  const d = parse(text);
  const s = createSealSessions({ getDoc: () => d, ctx: CTX, autoLockMs: 60000, backoffMs: () => 0, wipeOnPagehide: false });
  await s.open(s.regionFor('4'), 'pw');
  const out = serialize(s.get(s.regionFor('4')).doc!);
  s.destroy();
  return out;
}
function mount(txt: string, writeOnSave: boolean) {
  let doc: any = parse(txt);
  document.body.innerHTML = '';
  const ta = document.createElement('textarea'); ta.value = txt; document.body.append(ta);
  // writeOnSave=false models Audroam <= 20261101-045: writeSource() skipped the save while the
  // caret was in Text (typingInText), so the textarea kept the pre-save ciphertext.
  const fh = mountOutlineFold({ getRootDoc: () => doc, ctx: () => CTX, onChange: () => {}, onSaved: () => { if (writeOnSave) ta.value = serialize(doc); }, onFocus: () => {} });
  const h = fh.mountEditor(ta, {});
  return { fh, h, ta, getDoc: () => doc };
}
function zoneView(): EditorView {
  const el = document.querySelector('.of-secure-zone-editor .cm-editor') as HTMLElement;
  const v = EditorView.findFromDOM(el);
  if (!v) throw new Error('no zone view');
  return v;
}
function typeLine(v: EditorView, line: string) {
  const end = v.state.doc.length;
  v.dispatch({ changes: { from: end, insert: '\n' + line } });
}

it('edit in zone → Save & re-seal → reload → decrypt: the typed rows are there', async () => {
  const txt = await sealed();
  const { fh, h, ta } = mount(txt, true);
  await fh.sessions.open(fh.regionFor('4'), 'pw');
  await tick();
  typeLine(zoneView(), '  - basil (typed)');
  expect(fh.sessions.get(fh.regionFor('4')).dirty).toBe(true);
  (document.querySelector('.of-sz-save') as HTMLButtonElement).click();
  await tick(40);
  expect(fh.sessions.get(fh.regionFor('4')).state).toBe('unlocked');
  expect(ta.value).not.toBe(txt);
  expect(ta.value).not.toContain('basil'); // plaintext never in the note text
  const back = await reopen(ta.value);
  expect(back).toContain('basil (typed)');
  expect(back).toContain('tomato');
  h.destroy();
});

it('the loss mechanism: a save hook that does not write the new ct loses the rows on reload', async () => {
  const txt = await sealed();
  const { fh, h, ta } = mount(txt, false);
  await fh.sessions.open(fh.regionFor('4'), 'pw');
  await tick();
  typeLine(zoneView(), '  - basil (typed)');
  (document.querySelector('.of-sz-save') as HTMLButtonElement).click();
  await tick(40);
  // The session reports saved and clean, so a later saveAll() skips it...
  expect(fh.sessions.get(fh.regionFor('4')).dirty).toBe(false);
  // ...but the note text still holds the old ciphertext.
  expect(ta.value).toBe(txt);
  expect(await reopen(ta.value)).not.toContain('basil');
  h.destroy();
});

it('[ ] toggle on a cloud row (Map) edits the zone plaintext, re-seals, survives reload', async () => {
  const txt = await sealed();
  const { fh, h, ta } = mount(txt, true);
  await fh.sessions.open(fh.regionFor('4'), 'pw');
  await tick();
  const region = fh.regionFor('4');
  const opts = fh.mapOptions(() => {}, () => {});
  expect(opts.onRegionTaskToggle(scopeId(region, '6'))).toBe(true);
  await tick();
  expect(fh.sessions.get(region).dirty).toBe(true);
  // The zone text followed the toggle (a keystroke there must not write the old box back).
  expect(zoneView().state.doc.toString()).not.toContain('[ ] tomato');
  typeLine(zoneView(), '  - basil');
  expect(serialize(fh.sessions.get(region).doc!)).not.toContain('[ ] tomato');
  await fh.saveAll();
  await tick(40);
  const back = await reopen(ta.value);
  expect(back).not.toContain('[ ] tomato');
  expect(back).toMatch(/\[[-x~\/]\] tomato|\[.\] tomato/);
  expect(back).toContain('basil');
  h.destroy();
});
