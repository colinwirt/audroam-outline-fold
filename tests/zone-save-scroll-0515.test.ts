// @vitest-environment happy-dom
// 0.4.7 (Colin QA, data loss): Save & re-seal in the Text zone must survive a reload, and a
// [ ] toggle on a row inside the unlocked cloud edits the zone plaintext and re-seals.
// Invented fixture only.
import { it, beforeAll, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { EditorView } from '@codemirror/view';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher, createSealSessions, scopeId } from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
// @ts-ignore host copy of Audroam's outlineFoldHost (imports rewritten to src)
import { mountOutlineFold } from './_host.mjs';

beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>));
const FIX = `- Garden list <id:1>\n- Sealed branch <id:4>\n  - seeds <id:5>\n    - [ ] tomato <id:6>\n- after <id:7>\n`;
const CTX = { noteId: '9', ownerId: '' };
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
async function sealed() {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse(FIX);
  const key = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes[1]!, key.kid, CTX);
  const txt = serialize(d); clearKeys();
  return txt;
}
/** Reload: a fresh parse of the saved text, a fresh key unlock, decrypt the branch. */
async function reopen(text: string): Promise<string> {
  clearKeys();
  const d = parse(text);
  const s = createSealSessions({ getDoc: () => d, ctx: CTX, autoLockMs: 60000, backoffMs: () => 0, wipeOnPagehide: false });
  await s.open(s.regionFor('4'), 'pw');
  const out = serialize(s.get(s.regionFor('4')).doc!);
  s.destroy();
  return out;
}
function mount(txt: string) {
  document.body.innerHTML = '';
  const box = document.createElement('div'); document.body.append(box);
  // 0.4.8: the doc owns the text; a zone re-seal writes it there whatever pane has the caret.
  const fh = mountOutlineFold({ text: txt, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000 });
  const h = fh.mountEditor(box, {});
  const ta = { get value() { return fh.getText() as string; } };
  return { fh, h, ta };
}
function zoneView(): EditorView {
  const el = document.querySelector('.of-secure-zone-editor .cm-editor') as HTMLElement;
  const v = EditorView.findFromDOM(el);
  if (!v) throw new Error('no zone view');
  return v;
}
function typeLine(v: EditorView, line: string) {
  const end = v.state.doc.length;
  v.dispatch({ changes: { from: end, insert: '\n' + line } });
}

// 0.5.15 (Colin, large sealed maps): Save inside an unlocked zone must not move the text pane,
// must not rebuild the zone editor, and must leave the caret where it was.
for (const [name, how] of [['Save & re-seal button', 'button'], ['note autosave (serialise)', 'auto']] as const) it(`${name}: keeps the zone editor, its caret and the text pane scroll`, async () => {
  const txt = await sealed();
  const { fh, h } = mount(txt);
  const save = async () => { if (how === 'button') (document.querySelector('.of-sz-save') as HTMLButtonElement).click(); else await fh.doc.serialise(); };
  await fh.sessions.open(fh.regionFor('4'), 'pw');
  await tick();
  const before = zoneView();
  typeLine(before, '  - basil (typed)');
  const caret = before.state.doc.line(2).from + 3;

  before.dispatch({ selection: { anchor: caret } });
  const pane = document.querySelector('.cm-host .cm-scroller') as HTMLElement;
  pane.scrollTop = 120;
  const seen: number[] = [];
  pane.addEventListener('scroll', () => seen.push(pane.scrollTop));
  Object.defineProperty(before, 'hasFocus', { get: () => true });
  await save();
  await tick(60);
  const after = zoneView();
  expect(after === before, 'zone editor was rebuilt on save').toBe(true);
  expect(after.state.selection.main.head).toBe(caret);
  expect(pane.scrollTop).toBe(120);
  expect(seen.filter((y) => y !== 120)).toEqual([]);
  h.destroy();
});

// The real jump needs layout (happy-dom has none), so the scroll rule is tested directly.
// Root cause: Save blurs the zone (the Save button, or the autosave's re-render), so the zone's
// layout pass ran untracked and CodeMirror's pin of the outer pane to the widget's bottom was
// kept (flash to the bottom). The caret snap then scrolled "nearest", leaving the caret row at
// the top edge of the pane.
import { zoneScrollAfterMeasure } from '../src/editor/index.js';
it('a zone layout pass that moved the pane without the user is put back, even unfocused', () => {
  expect(zoneScrollAfterMeasure({ before: 120, after: 900, focused: false, userScrollAt: 0, now: 10_000 })).toBe(120);
});
it('after a save the caret row returns to the same place on screen, not to the pane edge', () => {
  // Caret was 300px down the pane; after the pass it sits 40px down (pane moved by 260).
  expect(zoneScrollAfterMeasure({ before: 500, after: 500, focused: true, userScrollAt: 0, now: 10_000, caretTop: 40, caretBottom: 60, viewTop: 0, viewHeight: 600, caretAnchor: 300 })).toBe(500 - 260);
});
