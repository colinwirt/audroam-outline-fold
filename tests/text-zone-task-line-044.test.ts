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
  // the 🔓 mark is part of the caption pillSize measures (pill width includes it), not a DOM patch
  expect(src).not.toContain('data-of-unlock-mark');
  expect(src).toMatch(/const label = anchorCaption\(key, captionWithoutLinks/);
  expect(src).toMatch(/const label = anchorCaption\(key, captionWithoutLinks\(displayCaption\(n\.title\)\)\);\n    const sz = pillSize\(label/);
});

it('0.4.4: region pill text uses the node font size, not a fixed 13px', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync('src/outline-fold.css', 'utf8');
  expect(css).not.toMatch(/\.map-region-node > text \{[^}]*font-size/);
  const src = readFileSync('src/mapView.ts', 'utf8');
  expect(src).toMatch(/const fa = `font-size="\$\{fpx\}"/);
});

it('0.4.4: pillSize width grows with the unlock mark', async () => {
  const { pillSize, UNLOCK_MARK } = await import('../src/mapView.js');
  const o = { reserveFold: true, reserveTask: true, semibold: false, wrapCh: 40 };
  expect(pillSize(UNLOCK_MARK + 'Sealed branch', o).w).toBeGreaterThan(pillSize('Sealed branch', o).w);
});
