// @vitest-environment happy-dom
// 0.4.17 (zone focus): the debounced save after a typing pause (serialise -> autosave -> change)
// must never blur the zone. Hosts gate focus moves on handle.hasFocus(), so it must count the zone. Invented data.
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
const FIX = `- Garden <id:1>\n- Pantry box <id:4>\n  - seeds <id:5>\n  - jars <id:6>\n- after <id:7>\n`;

it('handle.hasFocus() is true while the caret is in the zone editor', async () => {
  const { zone, ed } = await mount(FIX, {});
  zone().focus();
  expect(zone().contentDOM.contains(document.activeElement)).toBe(true);
  expect(ed.hasFocus()).toBe(true);
});

it('Audroam glue: type, Tab, pause (save) -> focus stays in the zone, zone editor not recreated', async () => {
  const { fh, zone, ed } = await mount(FIX, {});
  const other = document.createElement('button'); document.body.append(other);
  const sources: string[] = [];
  // outline-view.js: change (source != map) -> tryRenderSource -> if (!editingSource()) focusCurrent()
  fh.doc.on('change', (e: { source: string }) => { sources.push(e.source); if (e.source !== 'map' && !ed.hasFocus()) other.focus(); });
  const z = zone();
  z.focus();
  const end = z.state.doc.line(3).to;
  z.dispatch({ selection: { anchor: end } });
  z.dispatch(z.state.replaceSelection('\n  - new'), { userEvent: 'input.type' } as never);
  await tick(80);
  const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  zone().contentDOM.dispatchEvent(e);
  await tick(80); // the debounced save-needed -> serialise -> change fires in here
  expect(sources.length).toBeGreaterThan(0);
  expect(zone()).toBe(z);
  expect(zone().contentDOM.contains(document.activeElement)).toBe(true);
  expect(zone().state.doc.toString()).toMatch(/\n {4}- new/);
});
