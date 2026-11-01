// @vitest-environment happy-dom
// 0.4.12: task glyphs are display only, one decoration for main and zone editors; stored text
// keeps [ ] / [x]; glyph markers typed or from old payloads normalise to ASCII. Invented data.
import { it, beforeAll, afterEach, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { EditorView } from '@codemirror/view';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher, createOutlineDoc, normalizeTaskMarkers } from '../src/index.js';
import { mountTextEditor } from '../src/editor/textEditor.js';
import { setArgon2Provider, __setLegacyInnerTextForTest } from '../src/sealedBranch.js';

beforeAll(() => {
  const orig = document.dispatchEvent.bind(document);
  document.dispatchEvent = (e: Event) => { if (e.type === 'selectionchange') return true; return orig(e); };
  setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>);
});
afterEach(() => __setLegacyInnerTextForTest(null));
const CTX = { noteId: '9', ownerId: '' };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function sealedWith(legacy?: string) {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse(`- [ ] main task <id:1>\n- Box <id:4>\n  - [x] inner done <id:5>\n`);
  const key = await createKey(d, 'pw', { kid: 'k1' });
  if (legacy) __setLegacyInnerTextForTest(() => legacy);
  await sealBranch(d, d.nodes.find((n) => n.id === '4')!, key.kid, CTX);
  __setLegacyInnerTextForTest(null);
  const t = serialize(d); clearKeys(); return t;
}

it('normalizeTaskMarkers (pure): leading ☑ / ☐ → [x] / [ ]; mid-caption glyphs stay', () => {
  const nodes = [{ title: '\u2611 todo getting there', children: [{ title: '\u2610 open' }] }, { title: 'keep \u2611 here' }];
  expect(normalizeTaskMarkers(nodes)).toBe(true);
  expect(nodes.map((n) => n.title)).toEqual(['[x] todo getting there', 'keep \u2611 here']);
  expect(nodes[0]!.children![0]!.title).toBe('[ ] open');
  expect(normalizeTaskMarkers([{ title: '[x] fine' }])).toBe(false);
});

it('main and zone editors use the same glyph decoration; stored text stays ASCII', async () => {
  document.body.innerHTML = '';
  const box = document.createElement('div'); document.body.append(box);
  const doc = createOutlineDoc({ text: await sealedWith(), ctx: () => CTX, wipeOnPagehide: false });
  const ed = mountTextEditor(box, doc, {});
  await doc.sessions.open(doc.sessions.regionFor('4'), 'pw');
  await tick();
  const main = EditorView.findFromDOM(box.querySelector('.cm-editor') as HTMLElement)!;
  const zone = EditorView.findFromDOM(document.querySelector('.of-secure-zone-editor .cm-editor') as HTMLElement)!;
  const mainGlyph = [...main.contentDOM.querySelectorAll('.of-zone-task')].filter((e) => !e.closest('.of-secure-zone-editor')).map((e) => e.outerHTML);
  const zoneGlyph = [...zone.contentDOM.querySelectorAll('.of-zone-task')].map((e) => e.outerHTML);
  expect(mainGlyph).toEqual(['<span class="of-zone-task">\u2610</span>']);
  expect(zoneGlyph).toEqual(['<span class="of-zone-task">\u2611</span>']);
  expect(main.state.doc.toString()).toContain('[ ] main task');
  expect(zone.state.doc.toString()).toContain('[x] inner done');
  // Typing a glyph in the zone stores ASCII in the region doc.
  const line = zone.state.doc.toString();
  zone.dispatch({ changes: { from: 0, to: line.length, insert: line.replace('[x] inner done', '\u2611 typed glyph') } });
  const child = doc.sessions.get(doc.sessions.regionFor('4')).doc!;
  expect(serialize(child)).toContain('[x] typed glyph');
  expect(serialize(child)).not.toContain('\u2611');
  ed.destroy(); doc.destroy();
});

it('an old payload with ☑ / ☐ written into the plaintext loads as [x] / [ ]', async () => {
  const t = await sealedWith(JSON.stringify({ v: 1, caption: 'Box', body: '- \u2611 todo getting there <id:5>\n- \u2610 later <id:6>\n' }));
  const d = createOutlineDoc({ text: t, ctx: () => CTX, wipeOnPagehide: false });
  await d.sessions.open(d.sessions.regionFor('4'), 'pw');
  const s = serialize(d.sessions.get(d.sessions.regionFor('4')).doc!);
  expect(s).toContain('[x] todo getting there');
  expect(s).toContain('[ ] later');
  expect(s).not.toMatch(/[\u2610\u2611]/);
  d.destroy();
});
