// @vitest-environment happy-dom
import { it, beforeAll, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher, createSealSessions } from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
import { mountTextEditor } from '../src/editor/textEditor.js';
beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>));
it('0.4.4: task-marker sealed line gets a secure zone after unlock (no removeChild throw)', async () => {
  clearKeys(); setSealCipher('a256gcm');
  let doc = parse(`- Root <id:1>\n  - [-] Sealed branch <id:16>\n    - child <id:17>\n`);
  const key = await createKey(doc, 'pw', { kid: 'k1' });
  const f = (ns:any[],id:string):any => { for (const n of ns) { if (n.id===id) return n; const h=f(n.children??[],id); if (h) return h; } };
  await sealBranch(doc, f(doc.nodes,'16'), key.kid, { noteId: 'n', ownerId: 'o' });
  const txt = serialize(doc); doc = parse(txt); clearKeys();
  const s = createSealSessions({ getDoc: () => doc, ctx: { noteId: 'n', ownerId: 'o' }, autoLockMs: 60000, backoffMs: () => 0, wipeOnPagehide: false });
  const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta);
  const h = mountTextEditor(ta, { sessions: s });
  await s.open(s.regionFor('16'), 'pw');
  await new Promise((r) => setTimeout(r, 10));
  expect(s.get(s.regionFor('16')).state).toBe('unlocked');
  expect(document.querySelector('.of-secure-zone')).not.toBeNull();
  expect(document.querySelector('.of-cm-sealed-line')).toBeNull();
  expect(document.querySelectorAll('.of-sz-more-btn').length).toBe(1);
  h.destroy?.();
});

it('0.4.4: unlocked anchor CSS tints only the pill, never every rect', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync('src/outline-fold.css', 'utf8');
  expect(css).not.toMatch(/is-unlocked-anchor\s*>\s*rect/);
  expect(css).toMatch(/\.map-node\.is-unlocked-anchor \.map-pill \{ fill: var\(--pill-fill/);
  const src = readFileSync('src/mapView.ts', 'utf8');
  expect(src).toContain("data-of-unlock-mark");
});
