// @vitest-environment happy-dom
// 0.4.15 regression (Colin, console): ticking a Map checkbox threw SealedSaveError
// "sealed line caption is not its public label" and the tick was lost. The note held a sealed
// line whose caption is not its public label; the Map toggle re-serialised the whole doc.
// Invented data only.
import { it, beforeAll, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher, createMapView } from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
// @ts-ignore
import { mountOutlineFold } from './_host.mjs';
beforeAll(() => {
  setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as any);
});
const CTX = { noteId: '9', ownerId: '' };
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function sealedText(): Promise<string> {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse(`- [ ] buy seeds <id:1>\n- vault <id:4>\n  - hidden <id:5>\n- [x] water <id:7>\n`);
  const k = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes.find((n) => n.id === '4')!, k.kid, CTX);
  const text = serialize(d).replace('- Sealed branch <enc:', '- My vault <enc:'); // caption ≠ public label
  clearKeys();
  return text;
}
function mountMap(fh: any) {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 800 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  document.body.appendChild(host);
  let view = parse(fh.getText()); fh.markView();
  fh.doc.on('change', (e: any) => { if (e.source !== 'map') { view = parse(fh.getText()); fh.markView(); } });
  let focus = '1'; const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
  const errors: unknown[] = [];
  const mv: any = (createMapView as any)(host, {
    getDoc: () => view,
    setDoc: (n: any) => { view = n; try { fh.commitView(n, 'map'); } catch (e) { errors.push(e); } },
    getLayout: () => layout, getFocusId: () => focus, setFocusId: (id: string) => { focus = id; },
    ...fh.mapOptions(),
  });
  mv.paint();
  return { host, mv, errors };
}
it('the stored text with a re-captioned sealed line saves; the caption becomes its public label (0.4.17)', async () => {
  const t = await sealedText(); const out = serialize(parse(t)); expect(out).toContain('- My vault <enc:'); expect(out).toContain('pub: "My vault"');
});
it('Map ☐ tick on another row edits only that task line and never trips the seal guard', async () => {
  const text = await sealedText();
  const fh = mountOutlineFold({ text, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 10 });
  const { host, mv, errors } = mountMap(fh);
  await tick();
  const hit = () => [...host.querySelectorAll('.map-node')].find((g) => (g.textContent || '').includes('buy seeds'))!.querySelector('.map-task-hit')!;
  hit().dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await tick();
  expect(errors).toEqual([]);
  const out = fh.getText();
  expect(out.split('\n')[0]).toBe('- [-] buy seeds <id:1>');
  // Only that line changed: the sealed line, payloads and keyring are byte-identical.
  expect(out.split('\n').slice(1)).toEqual(text.split('\n').slice(1));
  // Colin: the tick only showed after a pane resize. It must repaint at once (no resize, no manual paint).
  expect(hit().getAttribute('aria-checked')).toBe('mixed');
  hit().dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await tick();
  expect(fh.getText().split('\n')[0]).toBe('- [x] buy seeds <id:1>');
  mv.destroy?.(); host.remove();
});
it('host commitView reports a refused whole-doc save through onHold instead of throwing', async () => {
  const text = await sealedText();
  const held: any[] = [];
  const fh = mountOutlineFold({ text, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 10, onHold: (e: any) => held.push(e) });
  const v = parse(fh.getText()); fh.markView();
  // A real leak: plaintext children under the locked sealed line.
  const sn = v.nodes.find((n) => n.sealed)!; sn.children = [{ title: 'leak', id: '98', depth: 1 } as any];
  expect(fh.commitView(v, 'map')).toBe(false);
  expect(String(held[0]?.message)).toMatch(/children/);
  expect(fh.getText()).toBe(text);
});
it('Map tick ↔ editor text, both ways, after editing the sealed caption; no throw, Map keeps repainting', async () => {
  const orig = document.dispatchEvent.bind(document);
  document.dispatchEvent = (e: Event) => (e.type === 'selectionchange' ? true : orig(e));
  clearKeys(); setSealCipher('a256gcm');
  const d = parse(`- [ ] buy seeds <id:1>\n- vault <id:4>\n  - hidden <id:5>\n- [x] water <id:7>\n`);
  const k = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes.find((n) => n.id === '4')!, k.kid, CTX);
  const text = serialize(d); clearKeys();
  const held: any[] = []; const saves: any[] = [];
  const fh = mountOutlineFold({ text, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 10, onHold: (e: any) => held.push(e) });
  fh.doc.on('save-needed', (e: any) => saves.push(e));
  const box = document.createElement('div'); document.body.append(box);
  fh.mountEditor(box, {});
  const { EditorView } = await import('@codemirror/view');
  const ed = EditorView.findFromDOM(box.querySelector('.cm-editor') as HTMLElement)!;
  const { host, mv, errors } = mountMap(fh);
  fh.doc.on('change', (e: any) => { if (e.source !== 'map') mv.paint(); }); // host re-renders on text change
  // 1. The user edits the sealed line's caption in the text (the guard will refuse a whole-doc save).
  const sealed = ed.state.doc.toString().indexOf('Sealed branch');
  if (sealed >= 0) ed.dispatch({ changes: { from: sealed, to: sealed + 13, insert: 'My vault' }, userEvent: 'input' });
  else fh.doc.setText(fh.getText().replace('- Sealed branch <enc:', '- My vault <enc:'), { source: 'text' });
  await tick();
  expect(fh.getText()).toContain('- My vault <enc:');
  const row = (s: string) => [...host.querySelectorAll('.map-node')].find((g) => (g.textContent || '').includes(s))!;
  // 2. Map tick → editor text, Map repaints at once.
  expect(() => row('buy seeds').querySelector('.map-task-hit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
  await tick();
  expect(ed.state.doc.line(1).text).toBe('- [-] buy seeds <id:1>');
  expect(row('buy seeds').querySelector('.map-task-hit')!.getAttribute('aria-checked')).toBe('mixed');
  // 3. Editor ☐ click → Map.
  const g = [...box.querySelectorAll('.cm-content > .cm-line')].find((l) => (l.textContent || '').includes('water'))!.querySelector('.of-zone-task')!;
  g.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  await tick();
  expect(fh.getText()).toContain('- [ ] water <id:7>');
  expect(row('water').querySelector('.map-task-hit')!.getAttribute('aria-checked')).toBe('false');
  // 4. A whole-doc Map commit now saves (0.4.17): the caption is kept as the public label.
  await tick(30);
  expect(saves.length).toBeGreaterThan(0); // the ticks are queued for the server save
  expect(errors).toEqual([]);
  const v = parse(fh.getText()); v.nodes[0]!.title = '[-] buy seeds renamed';
  expect(() => fh.commitView(v, 'map')).not.toThrow();
  expect(held).toEqual([]);
  expect(() => mv.paint()).not.toThrow();
  expect(fh.getText()).toContain('- My vault <enc:'); // the user's caption is kept
  expect(fh.getText()).toContain('buy seeds renamed');
  mv.destroy?.(); host.remove(); box.remove();
});
