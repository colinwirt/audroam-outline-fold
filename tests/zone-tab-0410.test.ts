// @vitest-environment happy-dom
// 0.4.10: Tab / Shift+Tab inside the zone always indent / outdent with the zone's own unit and
// never leave the zone, even with no host onTab or a host that declines. Invented data.
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
  fh.mountEditor(box, extra);
  await fh.sessions.open(fh.regionFor('4'), 'pw');
  await tick();
  const zone = () => EditorView.findFromDOM(document.querySelector('.of-secure-zone-editor .cm-editor') as HTMLElement)!;
  return { fh, zone };
}
const press = (v: EditorView, shift: boolean) => {
  const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
  v.contentDOM.dispatchEvent(e);
  return e.defaultPrevented;
};

it('detectIndentUnit (pure)', () => {
  expect(detectIndentUnit('- a\n    - b\n        - c')).toBe('    ');
  expect(detectIndentUnit('- a')).toBe('  ');
});

for (const [name, extra] of [
  ['no host onTab', {}],
  ['host onTab declines (null)', { onTab: () => null }],
] as const) {
  it(`Tab / Shift+Tab indent with the zone unit and keep focus: ${name}`, async () => {
    const fix = `- Garden <id:1>\n- Pantry box <id:4>\n  - seeds <id:5>\n  - jars <id:6>\n- after <id:7>\n`;
    const { fh, zone } = await mount(fix, extra);
    const z = zone();
    const ln = z.state.doc.line(3);
    const unit = detectIndentUnit(z.state.doc.toString()).length;
    const lead = /^ */.exec(ln.text)![0].length;
    expect(ln.text.trimStart().startsWith('- jars')).toBe(true);
    const at = (n: number) => /^ */.exec(zone().state.doc.line(3).text)![0].length === n;
    z.focus();
    z.dispatch({ selection: { anchor: ln.from + 6 } });
    expect(press(z, false)).toBe(true);
    expect(at(lead + unit)).toBe(true);
    expect(zone().hasFocus || document.activeElement === zone().contentDOM || zone().dom.contains(document.activeElement)).toBe(true);
    expect(press(zone(), true)).toBe(true);
    expect(at(lead)).toBe(true);
    // Shift+Tab on the root line (nothing to outdent) is still handled: focus does not leave.
    const z2 = zone();
    z2.dispatch({ selection: { anchor: 1 } });
    expect(press(z2, true)).toBe(true);
    expect(zone().state.doc.line(1).text).toBe('- Pantry box');
    fh.unmount();
  });
}
