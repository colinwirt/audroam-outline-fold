// @vitest-environment happy-dom
// 0.4.18: Follow in text is one-way (Map -> Text). A caret move, typing or a click in the main
// text or a zone never sets FocusLink focus (so never Map focus) and never moves DOM focus. Invented data.
import { it, beforeAll, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { EditorView } from '@codemirror/view';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher } from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
import { detectIndentUnit } from '../src/editor/outlineKeys.js';
// @ts-ignore host copy of Audroam's outlineFoldHost
import { mountOutlineFold } from './_host.mjs';

beforeAll(() => {
  const orig = document.dispatchEvent.bind(document);
  document.dispatchEvent = (e: Event) => { if (e.type === 'selectionchange') return true; return orig(e); };
});
beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>));
const CTX = { noteId: '9', ownerId: '' };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function mount(fix: string, extra: Record<string, unknown>) {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse(fix);
  const k = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes.find((n) => n.id === '4')!, k.kid, CTX);
  const text = serialize(d); clearKeys();
  document.body.innerHTML = '';
  const box = document.createElement('div'); document.body.append(box);
  const fh = mountOutlineFold({ text, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 10 });
  const ed = fh.mountEditor(box, extra);
  await fh.sessions.open(fh.regionFor('4'), 'pw');
  await tick();
  const zone = () => EditorView.findFromDOM(document.querySelector('.of-secure-zone-editor .cm-editor') as HTMLElement)!;
  return { fh, zone, ed };
}
const FIX = `- Garden <id:1>\n  - beans <id:2>\n- Pantry box <id:4>\n  - seeds <id:5>\n  - jars <id:6>\n- after <id:7>\n`;
const main = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
const key = (v: EditorView, k: string) => { for (const type of ['keydown', 'keyup']) v.contentDOM.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true })); };

it.skip('caret moves, typing and clicks in the text or a zone never set Map focus', async () => {
  const { fh, zone } = await mount(FIX, { followInText: () => true });
  const sets: unknown[] = [];
  fh.focusLink.subscribe((id: string, src: string) => sets.push([id, src]));
  const before = fh.focusLink.get();
  const m = main();
  m.focus();
  for (const line of [1, 2, 6]) { m.dispatch({ selection: { anchor: m.state.doc.line(Math.min(line, m.state.doc.lines)).from }, userEvent: 'select' }); key(m, 'ArrowDown'); }
  m.dispatch({ changes: { from: m.state.doc.line(1).to, insert: 's' }, userEvent: 'input.type' }); key(m, 's');
  m.contentDOM.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  const z = zone();
  z.focus();
  z.dispatch({ selection: { anchor: z.state.doc.line(2).from }, userEvent: 'select' }); key(z, 'ArrowUp');
  z.dispatch({ changes: { from: z.state.doc.line(2).to, insert: 'x' }, userEvent: 'input.type' }); key(z, 'x');
  await tick(1700); // past the 1.5 s typing pause and the debounced save
  expect(sets).toEqual([]);
  expect(fh.focusLink.get()).toBe(before);
  expect(z.contentDOM.contains(document.activeElement)).toBe(true);
});

it('Map -> Text still follows (FocusLink set from the map moves the text caret only)', async () => {
  const { fh } = await mount(FIX, { followInText: () => true });
  await tick(1600);
  fh.focusLink.set('7', 'map');
  await tick(50);
  const m = main();
  expect(m.state.doc.lineAt(m.state.selection.main.head).text).toMatch(/after <id:7>/);
});
