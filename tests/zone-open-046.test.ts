// @vitest-environment happy-dom
// 0.4.6 (Colin QA, top priority): Text zone opens whenever the Map unlocks; a zone that
// cannot render shows a recoverable error, reports itself, and never alters the payload.
// Invented fixture only.
import { it, beforeAll, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher, createSealSessions } from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
import { mountTextEditor, ZONE_ERROR_EVENT } from '../src/editor/textEditor.js';
// @ts-ignore host copy of Audroam's outlineFoldHost (imports rewritten to src)
import { mountOutlineFold } from './_host.mjs';

beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>));
const FIX = `- Garden list <id:1>\n  - beds <id:2>\n- Sealed branch <id:4>\n  - seeds <id:5>\n    - tomato <id:6>\n- after <id:7>\n`;
async function sealed() {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse(FIX);
  const key = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes[1]!, key.kid, { noteId: '9', ownerId: '' });
  const txt = serialize(d); clearKeys();
  return txt;
}
const tick = () => new Promise((r) => setTimeout(r, 15));

for (const hidden of [false, true]) it(`Map-style unlock opens the Text zone (host flow, hidden=${hidden})`, async () => {
  const txt = await sealed();
  document.body.innerHTML = '';
  const wrap = document.createElement('div'); document.body.append(wrap);
  if (hidden) wrap.style.display = 'none';
  const fh = mountOutlineFold({ text: txt, ctx: () => ({ noteId: '9', ownerId: '' }), wipeOnPagehide: false });
  const h = fh.mountEditor(wrap, {});
  await fh.sessions.open(fh.regionFor('4'), 'pw');
  await tick();
  expect(document.querySelector('.of-secure-zone:not(.of-secure-zone-error)')).not.toBeNull();
  expect(document.querySelector('.of-cm-sealed-line')).toBeNull();
  expect(h.zoneProblems()).toEqual([]);
  expect(fh.getText()).toBe(txt); // payload untouched by opening
  expect(document.querySelector('textarea')).toBeNull();
  h.destroy();
  fh.unmount();
});

it('a zone that fails to render: recoverable error, event, zoneProblems, payload unchanged', async () => {
  const txt = await sealed();
  const doc = parse(txt);
  const s = createSealSessions({ getDoc: () => doc, ctx: { noteId: '9', ownerId: '' }, autoLockMs: 60000, backoffMs: () => 0, wipeOnPagehide: false });
  document.body.innerHTML = '';
  const ta = document.createElement('textarea'); ta.value = txt; document.body.append(ta);
  const events: string[] = [];
  document.body.addEventListener(ZONE_ERROR_EVENT, (e) => events.push((e as CustomEvent).detail.region));
  // An invalid child extension makes the nested editor throw inside toDOM.
  const h = mountTextEditor(ta, { sessions: s, childExtensions: [{} as never] });
  await s.open(s.regionFor('4'), 'pw');
  await tick();
  expect(s.get(s.regionFor('4')).state).toBe('unlocked');
  const err = document.querySelector('.of-secure-zone-error');
  expect(err?.textContent).toContain('encrypted text is unchanged');
  expect(err?.querySelector('.of-sz-retry')).not.toBeNull();
  expect(events).toEqual([s.regionFor('4')]);
  expect(h.zoneProblems()).toEqual([s.regionFor('4')]);
  expect(ta.value).toBe(txt);
  expect(serialize(doc)).toBe(txt);
  h.destroy();
});
