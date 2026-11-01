// @vitest-environment happy-dom
// 0.4.11 (bugs D/E): what the user typed survives Enter, structural write-backs, autosave and
// reload byte for byte: an empty `- ` node, trailing whitespace and an earlier edit. Invented data.
import { it, beforeAll, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { EditorView } from '@codemirror/view';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher, mergeKeeping } from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
// @ts-ignore host copy of Audroam's outlineFoldHost
import { mountOutlineFold } from './_host.mjs';

beforeAll(() => {
  const orig = document.dispatchEvent.bind(document);
  document.dispatchEvent = (e: Event) => { if (e.type === 'selectionchange') return true; return orig(e); };
});
beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>));
const CTX = { noteId: '9', ownerId: '' };
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

it('mergeKeeping replaces only the changed lines (pure)', () => {
  const prev = '- a <id:1>  \n- \n\n- b <id:2>\n';
  const norm = '- a <id:1>\n- b <id:2>\n';
  expect(mergeKeeping(prev, norm, norm)).toBe(prev);
  expect(mergeKeeping(prev, norm, '- a <id:1>\n- B <id:2>\n')).toBe('- a <id:1>  \n- \n\n- B <id:2>\n');
  expect(mergeKeeping(prev, norm, '- a <id:1>\n- b <id:2>\n- c <id:3>\n')).toBe('- a <id:1>  \n- \n\n- b <id:2>\n- c <id:3>\n');
});

// Audroam's Enter: a new sibling item at the same indent.
const onEnter = (text: string, from: number, to: number) => {
  const ls = text.lastIndexOf('\n', from - 1) + 1;
  const indent = /^[ \t]*/.exec(text.slice(ls))![0];
  const ins = '\n' + indent + '- ';
  return { start: from, end: to, text: ins, selStart: from + ins.length };
};
const enter = (v: EditorView) => v.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
const type = (v: EditorView, at: number, s: string) => v.dispatch({ changes: { from: at, insert: s }, selection: { anchor: at + s.length }, userEvent: 'input.type' });

it('edit, Enter at end of another line, type, trailing spaces, zone dirty: autosave + reload keep every byte', async () => {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse('- Garden <id:1>\n  - node 2 <id:2>\n- another node <id:3>\n- Pantry box <id:4>\n  - seeds <id:5>\n- after <id:7>\n');
  const k = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes.find((n) => n.id === '4')!, k.kid, CTX);
  const text0 = serialize(d); clearKeys();
  document.body.innerHTML = '';
  const box = document.createElement('div'); document.body.append(box);
  const fh = mountOutlineFold({ text: text0, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 10 });
  fh.mountEditor(box, { onEnter });
  const main = () => EditorView.findFromDOM(box.querySelector('.cm-editor') as HTMLElement)!;
  // 1. edit 'node 2' -> 'node 2 (+)'
  let t = main().state.doc.toString();
  type(main(), t.indexOf('node 2') + 6, ' (+)');
  // 2. Enter at the end of 'another node', then a second Enter: one typed node, one empty node.
  t = main().state.doc.toString();
  const eol = t.indexOf('\n', t.indexOf('another node'));
  main().focus(); main().dispatch({ selection: { anchor: eol } });
  enter(main());
  expect(main().state.selection.main.head).toBe(eol + 3);
  type(main(), eol + 3, 'fresh');
  enter(main());
  // 3. trailing whitespace on 'after'
  t = main().state.doc.toString();
  type(main(), t.indexOf('\n', t.indexOf('- after')), '   ');
  const typed = main().state.doc.toString();
  expect(typed).toContain('node 2 (+) <id:2>');
  expect(typed).toContain('- another node <id:3>\n- fresh\n- \n');
  // 4. a dirty open zone: autosave re-seals it and writes the root back.
  await fh.sessions.open(fh.regionFor('4'), 'pw');
  await tick();
  const zone = EditorView.findFromDOM(document.querySelector('.of-secure-zone-editor .cm-editor') as HTMLElement)!;
  type(zone, zone.state.doc.line(2).to, ' x');
  await tick();
  const snap = await fh.serialise();
  const body = (s: string) => s.slice(0, s.indexOf('--- payloads ---'));
  expect(body(snap.text)).toBe(body(typed));
  expect(snap.text).not.toBe(typed); // the zone ct changed
  expect(main().state.doc.toString()).toBe(snap.text); // the editor shows exactly the saved text
  await tick();
  expect(fh.getText()).toBe(snap.text); // no later write-back strips anything
  fh.unmount();
  // 5. reload
  const fh2 = mountOutlineFold({ text: snap.text, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 10 });
  document.body.innerHTML = ''; const box2 = document.createElement('div'); document.body.append(box2);
  fh2.mountEditor(box2, { onEnter });
  await tick();
  expect(fh2.getText()).toBe(snap.text);
  expect(EditorView.findFromDOM(box2.querySelector('.cm-editor') as HTMLElement)!.state.doc.toString()).toBe(snap.text);
  fh2.unmount();
});

it('a Map write keeps typed empty nodes and whitespace; a view parsed before typing is refused', () => {
  const text = '- a <id:1>  \n- [ ] b <id:2>\n- \n- c <id:3>\n';
  const fh = mountOutlineFold({ text, ctx: () => CTX, wipeOnPagehide: false, debounceMs: 10 });
  const view = parse(fh.getText()); fh.markView();
  view.nodes.find((n) => n.id === '2')!.title = 'B';
  expect(fh.commitView(view, 'map')).toBe(true);
  expect(fh.getText()).toBe('- a <id:1>  \n- [ ] B <id:2>\n- \n- c <id:3>\n');
  const old = parse(fh.getText()); fh.markView();
  fh.setText(fh.getText().replace('- c', '- c typed'), 'text');
  old.nodes.find((n) => n.id === '1')!.title = 'stale';
  expect(fh.commitView(old, 'map')).toBe(false);
  expect(fh.getText()).toContain('- c typed <id:3>');
  fh.unmount();
});
