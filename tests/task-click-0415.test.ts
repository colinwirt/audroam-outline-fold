// @vitest-environment happy-dom
// 0.4.15 regression: clicking the ☐ glyph in the text editor (main and an unlocked zone) did nothing.
import { it, beforeAll, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { EditorView } from '@codemirror/view';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher } from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
// @ts-ignore
import { mountOutlineFold } from './_host.mjs';
beforeAll(() => {
  const orig = document.dispatchEvent.bind(document);
  document.dispatchEvent = (e: Event) => (e.type === 'selectionchange' ? true : orig(e));
  setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as any);
});
const CTX = { noteId: '9', ownerId: '' };
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const press = (el: Element) => {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
};
async function setup() {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse(`- [ ] main task <id:1>\n- box <id:4>\n  - [ ] secret task <id:5>\n- end <id:9>\n`);
  const k = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes.find((n) => n.id === '4')!, k.kid, CTX);
  const text = serialize(d); clearKeys();
  const box = document.createElement('div'); document.body.append(box);
  const fh = mountOutlineFold({ text, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 10 });
  fh.mountEditor(box, {});
  const region = fh.regionFor('4');
  await fh.sessions.open(region, 'pw');
  await tick();
  const main = EditorView.findFromDOM(box.querySelector('.cm-editor') as HTMLElement)!;
  const zone = () => EditorView.findFromDOM(document.querySelector('.of-secure-zone-editor .cm-editor') as HTMLElement)!;
  return { fh, box, main, zone, region };
}
it('main editor: clicking ☐ cycles the task open → pending → done → open and saves to the doc', async () => {
  const { fh, box, main } = await setup();
  const glyph = () => box.querySelector('.cm-content > .cm-line .of-zone-task')!;
  expect(glyph().textContent).toBe('\u2610');
  for (const want of ['[-]', '[x]', '[ ]']) {
    press(glyph()); await tick();
    expect(main.state.doc.line(1).text).toBe(`- ${want} main task <id:1>`);
    expect(fh.getText().split('\n').find((l: string) => l.includes('main task'))).toBe(`- ${want} main task <id:1>`);
  }
  box.remove(); clearKeys();
});
it('unlocked zone: clicking ☐ cycles the zone task and marks the session dirty', async () => {
  const { fh, box, zone, region } = await setup();
  const glyph = document.querySelector('.of-secure-zone-editor .of-zone-task')!;
  expect(glyph).toBeTruthy();
  press(glyph); await tick(60);
  expect(zone().state.doc.toString()).toContain('- [-] secret task');
  expect(fh.sessions.get(region).dirty).toBe(true);
  expect(serialize(fh.regionHosts()[0].doc)).toContain('[-] secret task');
  box.remove(); clearKeys();
});
