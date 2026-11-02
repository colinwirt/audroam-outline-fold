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
it('the stored text with a re-captioned sealed line is refused by the strict guard (unchanged)', async () => {
  const t = await sealedText(); expect(() => serialize(parse(t))).toThrow(/caption is not its public label/);
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
  mv.paint(); await tick();
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
  v.nodes[0]!.title = 'renamed';
  expect(fh.commitView(v, 'map')).toBe(false);
  expect(String(held[0]?.message)).toMatch(/caption is not its public label/);
  expect(fh.getText()).toBe(text);
});
