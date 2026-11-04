// @vitest-environment happy-dom
// The zone caret is the scroll target while the secure zone is focused. The outer
// sealed-line caret stays where it is, and a row already on screen does not move.
import { it, beforeAll, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { EditorView } from '@codemirror/view';
import { keyboardClientBand, visiblePaneBox } from '../src/editor/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
// @ts-ignore host copy of Audroam's outlineFoldHost (imports rewritten to src)
import { mountOutlineFold } from './_host.mjs';

beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>));

const FIX = `- Garden list <id:1>\n- Sealed branch <id:4>\n  - seeds <id:5>\n    - [ ] tomato <id:6>\n- after <id:7>\n`;
const CTX = { noteId: '9', ownerId: '' };

it('clips the pane to the band above a soft keyboard', () => {
  expect(keyboardClientBand(800, null, null)).toBeNull();
  expect(keyboardClientBand(800, { offsetTop: 0, height: 790 }, null)).toBeNull();
  expect(keyboardClientBand(800, { offsetTop: 0, height: 400 }, 0)).toEqual({ top: 0, bottom: 400 });
  expect(keyboardClientBand(800, { offsetTop: 160, height: 360 }, -160)).toEqual({ top: 160, bottom: 520 });
  expect(keyboardClientBand(800, { offsetTop: 160, height: 360 }, 0)).toEqual({ top: 0, bottom: 360 });
  expect(visiblePaneBox(80, 800, 0, 420)).toEqual({ viewTop: 80, viewHeight: 340 });
  expect(visiblePaneBox(80, 800, null, null)).toEqual({ viewTop: 80, viewHeight: 720 });
});

it('markLine while the zone is focused does not move the outer caret', async () => {
  const { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher } = await import('../src/index.js');
  clearKeys();
  setSealCipher('a256gcm');
  const d = parse(FIX);
  const key = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes[1]!, key.kid, CTX);
  const txt = serialize(d);
  clearKeys();
  document.body.innerHTML = '';
  const box = document.createElement('div');
  document.body.append(box);
  const fh = mountOutlineFold({ text: txt, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000 });
  const h = fh.mountEditor(box, {});
  await fh.sessions.open(fh.regionFor('4'), 'pw');
  await new Promise((r) => setTimeout(r, 20));
  const zoneEl = document.querySelector('.of-secure-zone-editor .cm-editor') as HTMLElement;
  const zone = EditorView.findFromDOM(zoneEl)!;
  const outer = EditorView.findFromDOM(document.querySelector('.cm-host .cm-editor') as HTMLElement)!;
  outer.dispatch({ selection: { anchor: 3 } });
  const before = outer.state.selection.main.head;
  zone.focus();
  expect(document.activeElement && zone.dom.contains(document.activeElement)).toBe(true);
  h.markLine(0, 0);
  expect(outer.state.selection.main.head).toBe(before);
  h.destroy();
});
