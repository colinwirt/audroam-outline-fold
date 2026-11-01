// @vitest-environment happy-dom
// 0.4.9 regressions on the real mount path (createOutlineDoc + mountTextEditor via the host
// adapter, an unlocked zone). The 0.4.5 tests only grepped the source and never mounted a
// zone, which is how B1–B4 slipped through. Invented fixtures only.
import { it, beforeAll, expect, describe } from 'vitest';
import { createHash } from 'node:crypto';
import { EditorView } from '@codemirror/view';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher, createOutlineDoc } from '../src/index.js';
import { mountTextEditor } from '../src/editor/textEditor.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
import { zoneTaskMarks, zoneShowRoot, refreshZones } from '../src/editor/index.js';
// @ts-ignore host copy of Audroam's outlineFoldHost
import { mountOutlineFold } from './_host.mjs';

// happy-dom fires selectionchange synchronously inside CM's own selection write (browsers
// queue it), which CM rejects. The tests drive selection through the views, so drop it.
beforeAll(() => {
  const orig = document.dispatchEvent.bind(document);
  document.dispatchEvent = (e: Event) => { if (e.type === 'selectionchange') return true; return orig(e); };
});
beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>));
const CTX = { noteId: '9', ownerId: '' };
const FIX = `- Garden list <id:1>\n- Pantry box <id:4>\n  - seeds <id:5>\n    - [ ] tomato <id:6>\n    - [x] bean <id:8>\n- after <id:7>\n`;
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function sealed(fix = FIX) {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse(fix);
  const key = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes.find((n) => n.id === '4')!, key.kid, CTX);
  const t = serialize(d); clearKeys(); return t;
}
// Same indent rule shape as the host's Text.indentEdit: Tab adds two spaces at line start.
const onTab = (text: string, from: number, _to: number, shift: boolean) => {
  const ls = text.lastIndexOf('\n', from - 1) + 1;
  if (shift) return text.startsWith('  ', ls) ? { start: ls, end: ls + 2, text: '', selStart: Math.max(ls, from - 2) } : null;
  return { start: ls, end: ls, text: '  ', selStart: from + 2 };
};
async function mountZone(extra: Record<string, unknown> = {}) {
  document.body.innerHTML = '';
  const box = document.createElement('div'); document.body.append(box);
  const fh = mountOutlineFold({ text: await sealed(), ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 10 });
  const h = fh.mountEditor(box, { onTab, ...extra });
  await fh.sessions.open(fh.regionFor('4'), 'pw');
  await tick();
  const zone = () => EditorView.findFromDOM(document.querySelector('.of-secure-zone-editor .cm-editor') as HTMLElement)!;
  const main = () => EditorView.findFromDOM(box.querySelector('.cm-editor') as HTMLElement)!;
  return { fh, h, box, zone, main };
}
const key = (v: EditorView, k: string, shift = false) =>
  v.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true }));

describe('secure zone in Text (0.4.9)', () => {
  it('B1: the zone draws its own caret, and keeps caret + focus across a re-render', async () => {
    const { zone, main, fh } = await mountZone();
    const z = zone();
    expect(z.dom.querySelector('.cm-cursorLayer')).not.toBeNull();
    z.focus();
    z.dispatch({ selection: { anchor: 5 } });
    // A width change rebuilds the widget (new view); the caret must survive it.
    main().dispatch({ effects: refreshZones.of(null) });
    fh.sessions.markChanged(fh.regionFor('4'));
    await tick();
    expect(zone().state.selection.main.head).toBe(5);
    fh.unmount();
  });

  it('B1: a re-rendered zone view takes the old view’s caret and focus', async () => {
    let ch = 30;
    document.body.innerHTML = '';
    const box = document.createElement('div'); document.body.append(box);
    const doc = createOutlineDoc({ text: await sealed(), ctx: () => CTX, wipeOnPagehide: false });
    const ed = mountTextEditor(box, doc, { textWidthCh: () => ch });
    await doc.sessions.open(doc.sessions.regionFor('4'), 'pw');
    await tick();
    const zone = () => EditorView.findFromDOM(document.querySelector('.of-secure-zone-editor .cm-editor') as HTMLElement)!;
    const z0 = zone();
    z0.focus();
    z0.dispatch({ selection: { anchor: 7 } });
    ch = 31; // eq() false → new SecureZone DOM
    ed.view.dispatch({ effects: refreshZones.of(null) });
    await tick();
    const z1 = zone();
    expect(z1).not.toBe(z0);
    expect(z1.state.selection.main.head).toBe(7);
    expect(z1.hasFocus || z1.contentDOM.contains(document.activeElement)).toBe(true);
    ed.destroy(); doc.destroy();
  });

  it('B2: task markers in the zone render as ☐ / ☑ glyphs; the text stays [ ] / [x]', async () => {
    const { zone, fh } = await mountZone();
    const z = zone();
    const glyphs = [...z.contentDOM.querySelectorAll('.of-zone-task')].map((e) => e.textContent);
    expect(glyphs).toEqual(['\u2610', '\u2611']);
    expect(z.contentDOM.textContent).not.toContain('[ ]');
    expect(z.state.doc.toString()).toContain('[ ] tomato');
    expect(zoneTaskMarks('  - [x] bean')).toEqual({ from: 4, to: 7, glyph: '\u2611' });
    expect(zoneTaskMarks('  - plain')).toBeNull();
    fh.unmount();
  });

  it('B3: no keyring, payloads or layout block in the zone, before and after a save', async () => {
    const { zone, fh } = await mountZone();
    const bad = /---\s*(keyring|payloads|layout|keys)\s*---|wrap:|kdf/i;
    expect(zone().state.doc.toString()).not.toMatch(bad);
    expect(document.querySelector('.of-secure-zone')!.textContent).not.toMatch(bad);
    const z = zone();
    z.dispatch({ changes: { from: z.state.doc.length, insert: '\n    - [ ] pea' }, userEvent: 'input.type' });
    await fh.sessions.save(fh.regionFor('4'));
    await tick();
    expect(zone().state.doc.toString()).not.toMatch(bad);
    expect(zone().state.doc.toString()).toContain('pea');
    fh.unmount();
  });

  it('B4: Tab / Shift-Tab in the zone indent the zone line (0.4.13: never deeper than parent + 1)', async () => {
    const { zone, fh } = await mountZone();
    const z = zone();
    const ln = z.state.doc.line(3); // "    - [ ] tomato" — already seeds' child: Tab is clamped
    z.focus();
    z.dispatch({ selection: { anchor: ln.from + 6 } });
    key(z, 'Tab');
    expect(zone().state.doc.line(3).text).toBe('    - [ ] tomato <id:6>');
    key(zone(), 'Tab', true);
    expect(zone().state.doc.line(3).text).toBe('  - [ ] tomato <id:6>');
    key(zone(), 'Tab');
    expect(zone().state.doc.line(3).text).toBe('    - [ ] tomato <id:6>');
    // The child doc follows (the edit went through the zone, not the main text): bean → under tomato.
    const z2 = zone();
    z2.dispatch({ selection: { anchor: z2.state.doc.line(4).from + 6 } });
    key(z2, 'Tab');
    const seeds = fh.sessions.get(fh.regionFor('4')).doc!.nodes[0]!.children![0]!;
    expect(seeds.children![0]!.children![0]!.id).toBe('8');
    fh.unmount();
  });

  it('C: the zone root line is the anchor row and shows no <id:N>', async () => {
    const { zone, fh } = await mountZone();
    expect(zone().state.doc.line(1).text).toBe('- Pantry box');
    expect(zoneShowRoot('- Pantry box <id:4>\n  - a <id:5>', '4')).toBe('- Pantry box\n  - a <id:5>');
    const z = zone();
    z.dispatch({ changes: { from: z.state.doc.line(1).to, insert: '!' }, userEvent: 'input.type' });
    await tick();
    const d = fh.sessions.get(fh.regionFor('4')).doc!;
    expect(d.nodes[0]!.id).toBe('4');
    expect(d.nodes[0]!.title).toBe('Pantry box!');
    fh.unmount();
  });
});
