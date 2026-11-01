// @vitest-environment happy-dom
// 0.4.13 (Colin): zone hang after Tab, ↑ across the zone, Tab below it, Backspace on an empty
// item. Everything goes through the real mountTextEditor(container, doc) path (via the host
// copy) with Audroam's own Enter / Tab hooks (tests/_audroamText.cjs). Invented fixtures only.
import { it, beforeAll, expect, describe } from 'vitest';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { EditorView } from '@codemirror/view';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher } from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
import { settleWithin } from '../src/sealSession.js';
import { parseZoneText, oneZoneRoot } from '../src/zoneText.js';
import { zoneIndentChanges, indentBreaksTree } from '../src/editor/zoneIndent.js';
import { emptyItemBackspace } from '../src/editor/emptyItem.js';
// @ts-ignore host copy of Audroam's outlineFoldHost
import { mountOutlineFold } from './_host.mjs';
const Text = createRequire(import.meta.url)('./_audroamText.cjs');

beforeAll(() => {
  const orig = document.dispatchEvent.bind(document);
  document.dispatchEvent = (e: Event) => (e.type === 'selectionchange' ? true : orig(e));
});
beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>));
const CTX = { noteId: '9', ownerId: '' };
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const FIX = `- top <id:1>\n- note 3 header <id:4>\n  - [x] todo getting there\n  - Test sealed\n  - [x] t\n  - Experiments\n    - e1\n- after <id:10>\n  - child of after <id:11>\n- last <id:12>\n`;

async function mount(fix = FIX) {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse(fix);
  const k = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes.find((n) => n.id === '4')!, k.kid, CTX);
  const text = serialize(d); clearKeys();
  document.body.innerHTML = '';
  const box = document.createElement('div'); document.body.append(box);
  const fh = mountOutlineFold({ text, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 10 });
  fh.mountEditor(box, { onTab: Text.indentEdit, onEnter: Text.enterEdit });
  await fh.sessions.open(fh.regionFor('4'), 'pw');
  await tick();
  const main = EditorView.findFromDOM(box.querySelector('.cm-editor') as HTMLElement)!;
  const zone = () => EditorView.findFromDOM(document.querySelector('.of-secure-zone-editor .cm-editor') as HTMLElement)!;
  return { fh, main, zone, region: fh.regionFor('4') };
}
const key = (v: EditorView, k: string, shift = false) => {
  const e = new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true });
  v.contentDOM.dispatchEvent(e);
  return e.defaultPrevented;
};
const lineOf = (v: EditorView, s: string | RegExp) => {
  for (let i = 1; i <= v.state.doc.lines; i++) {
    const t = v.state.doc.line(i).text;
    if (typeof s === 'string' ? t.includes(s) : s.test(t)) return v.state.doc.line(i);
  }
  throw new Error('no line ' + s);
};
const caretLine = (v: EditorView) => v.state.doc.lineAt(v.state.selection.main.head);
const T_LINE = /\] t( <id:\w+>)?$/;
const race = <T,>(p: Promise<T>, ms = 2000) => Promise.race([p.then(() => 'settled', () => 'rejected'), tick(ms).then(() => 'HANG')]);

describe('bug 1: zone Tab never breaks the tree, Save / Lock always settle', () => {
  it('parseZoneText: one root, malformed indents nest under it, every row keyed, ids stable', () => {
    const a = parseZoneText('- head\n  - a\n- shallow\n    - deep\n  - b', '4');
    expect(a.nodes).toHaveLength(1);
    expect(a.nodes[0]!.id).toBe('4');
    expect(a.nodes[0]!.children!.map((n) => n.title)).toEqual(['a', 'shallow']);
    expect(a.nodes[0]!.children![1]!.children!.map((n) => n.title)).toEqual(['deep', 'b']); // nearest shallower line
    const ids: string[] = [];
    const walk = (l: typeof a.nodes) => l.forEach((n) => { ids.push(n.id!); if (n.children) walk(n.children); });
    walk(a.nodes);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(1).every((i) => /^z\d+$/.test(i) && i !== '4')).toBe(true);
    const b = parseZoneText('- head\n  - a!\n- shallow\n    - deep\n  - b', '4', a);
    expect(b.nodes[0]!.children![0]!.id).toBe(a.nodes[0]!.children![0]!.id); // carried while typing
    expect(oneZoneRoot(parse('')).nodes).toHaveLength(1);
    expect(parseZoneText('\n\n- head\n  - x', '4').nodes[0]!.id).toBe('4');
  });

  it("Tab on '- ☑ t' indents one unit under its sibling; Map keeps the header; Save and Lock settle", async () => {
    const { fh, zone, region } = await mount();
    const z = zone();
    const t = lineOf(z, T_LINE);
    z.focus(); z.dispatch({ selection: { anchor: t.to } });
    expect(key(z, 'Tab')).toBe(true);
    expect(lineOf(zone(), T_LINE).text).toMatch(/^ {4}- \[x\] t/);
    expect(key(zone(), 'Tab')).toBe(true); // already Test sealed's child: clamped
    expect(lineOf(zone(), T_LINE).text).toMatch(/^ {4}- /);
    await tick();
    const d = fh.sessions.get(region).doc!;
    expect(d.nodes).toHaveLength(1);
    expect(d.nodes[0]!.id).toBe('4');
    const sealed = d.nodes[0]!.children!.find((n) => n.title.includes('Test sealed'))!;
    expect(sealed.children![0]!.title).toContain('t');
    const all: string[] = [];
    const walk = (l: typeof d.nodes) => l.forEach((n) => { all.push(String(n.id)); if (n.children) walk(n.children); });
    walk(d.nodes);
    expect(all.filter((i) => i === '4')).toHaveLength(1); // no positional key can collide with 4
    expect(all.every(Boolean)).toBe(true);
    expect(await race(fh.sessions.save(region))).toBe('settled');
    expect(fh.sessions.get(region).state).toBe('unlocked');
    expect(await race(fh.sessions.lock(region))).toBe('settled');
    expect(fh.sessions.get(region).locked).toBe(true);
  });

  it('a malformed zone (line shallower than the root, leading blanks) still saves', async () => {
    const { fh, zone, region } = await mount();
    const z = zone();
    z.dispatch({ changes: { from: 0, insert: '\n\n' }, userEvent: 'input' });
    z.dispatch({ changes: { from: z.state.doc.length, insert: '\n- stray root' }, userEvent: 'input' });
    await tick();
    expect(fh.sessions.get(region).doc!.nodes).toHaveLength(1);
    expect(await race(fh.sessions.save(region))).toBe('settled');
    expect(fh.sessions.get(region).state).toBe('unlocked');
  });

  it('a viewer that cannot snapshot fails visibly and keeps the draft (no hang, no throw)', async () => {
    const { fh, region } = await mount();
    const d = fh.sessions.get(region).doc!;
    d.nodes.push({ title: 'second root', depth: 0, id: 'q1' }); // what made isDirty() throw
    expect(fh.sessions.get(region).dirty).toBe(true); // snap() no longer throws
    expect(await race(fh.sessions.save(region))).toBe('settled');
    expect(fh.sessions.get(region).state).toBe('error');
    expect(fh.sessions.get(region).error).toBeTruthy();
    expect(await race(fh.sessions.lock(region))).toBe('settled');
    expect(fh.sessions.get(region).locked).toBe(false); // edits kept open
    expect(fh.sessions.get(region).doc!.nodes.map((n) => n.title)).toContain('second root');
  });

  it('settleWithin: a stuck promise rejects after the timeout', async () => {
    expect(await race(settleWithin(new Promise(() => {}), 20), 500)).toBe('rejected');
    await expect(settleWithin(Promise.resolve(3), 20)).resolves.toBe(3);
  });

  it('zoneIndentChanges: one unit, ≤ previous line + 1 unit, root never moves', () => {
    const t = '- r\n  - a\n  - b\n    - c';
    expect(zoneIndentChanges(t, 12, 12, false)).toEqual([{ from: 10, to: 10, insert: '  ' }]);
    expect(zoneIndentChanges(t, 20, 20, false)).toEqual([]);
    expect(zoneIndentChanges(t, 1, 1, false)).toEqual([]);
  });
});

describe('bug 2: ↑ across the zone', () => {
  it('↑ on the first line below the zone enters its last line; ↑ on its first line goes to the anchor', async () => {
    const { main, zone } = await mount();
    const after = lineOf(main, 'after <id:10>');
    main.focus(); main.dispatch({ selection: { anchor: after.from + 3 } });
    expect(key(main, 'ArrowUp')).toBe(true);
    const z = zone();
    expect(z.hasFocus).toBe(true);
    expect(caretLine(z).number).toBe(z.state.doc.lines);
    z.dispatch({ selection: { anchor: 3 } });
    expect(key(z, 'ArrowUp')).toBe(true);
    expect(main.hasFocus).toBe(true);
    expect(caretLine(main).text).toContain('<enc:');
  });
});

describe('bug 5: Tab below the zone', () => {
  it('indents one unit, keeps the caret and focus, never deeper than previous sibling + 1', async () => {
    const { main } = await mount();
    const last = lineOf(main, 'last <id:12>');
    main.focus(); main.dispatch({ selection: { anchor: last.from + 4 } });
    expect(key(main, 'Tab')).toBe(true);
    expect(caretLine(main).text).toBe('  - last <id:12>');
    expect(main.state.selection.main.head - caretLine(main).from).toBe(6);
    expect(key(main, 'Tab')).toBe(true);
    expect(caretLine(main).text).toBe('    - last <id:12>'); // child of 'child of after'
    expect(key(main, 'Tab')).toBe(true);
    expect(caretLine(main).text).toBe('    - last <id:12>'); // clamped
    expect(main.hasFocus).toBe(true);
  });

  it('the first line below the zone does not nest under the sealed line; focus stays put', async () => {
    const { main, fh } = await mount();
    const after = lineOf(main, 'after <id:10>');
    main.focus(); main.dispatch({ selection: { anchor: after.from + 4 } });
    const before = main.state.doc.toString();
    expect(key(main, 'Tab')).toBe(true);
    expect(main.state.doc.toString()).toBe(before);
    expect(main.hasFocus).toBe(true);
    expect(caretLine(main).text).toBe('- after <id:10>');
    void fh;
  });

  it('indentBreaksTree (pure)', () => {
    const sealed = (l: string) => l.includes('<enc:');
    expect(indentBreaksTree('- a\n  - b', '- a\n    - b', 7, 7, sealed)).toBe(true);
    expect(indentBreaksTree('- a\n- b', '- a\n  - b', 5, 5, sealed)).toBe(false);
    expect(indentBreaksTree('- a <enc:k>\n- b', '- a <enc:k>\n  - b', 13, 13, sealed)).toBe(true);
  });
});

describe('bug 4: Backspace on an empty item', () => {
  it('Enter at end → empty sibling → Backspace ×N → caret at the end of the previous line', async () => {
    const { main } = await mount();
    const ln = lineOf(main, 'child of after');
    main.focus(); main.dispatch({ selection: { anchor: ln.to } });
    key(main, 'Enter'); await tick();
    expect(caretLine(main).text).toBe('  - ');
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) { expect(key(main, 'Backspace')).toBe(true); await tick(); seen.push(caretLine(main).text); }
    expect(seen).toEqual(['  ', '', '  - child of after <id:11>']);
    expect(main.state.selection.main.head).toBe(caretLine(main).to);
  });

  it('emptyItemBackspace (pure): marker → outdent → join, null for a normal line', () => {
    expect(emptyItemBackspace('- a\n    - ', 10)).toEqual({ from: 8, to: 10, caret: 8 });
    expect(emptyItemBackspace('- a\n    ', 8)).toEqual({ from: 6, to: 8, caret: 6 });
    expect(emptyItemBackspace('- a\n', 4)).toEqual({ from: 3, to: 4, caret: 3 });
    expect(emptyItemBackspace('- a\n  - [ ] ', 12)).toEqual({ from: 6, to: 12, caret: 6 });
    expect(emptyItemBackspace('- a\n  - b', 9)).toBeNull();
    expect(emptyItemBackspace('', 0)).toBeNull();
  });
});

describe('bug 3: no catch-all rect rule paints a region task hit square', () => {
  it('every region `rect` selector in the shipped CSS (src + dist) names its rect or excludes .map-task-hit', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['src/outline-fold.css', 'dist/outline-fold.css']) {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const bad: string[] = [];
      for (const m of css.matchAll(/([^{}]+)\{/g)) {
        for (const sel of m[1]!.split(',').map((x) => x.trim())) {
          if (!/map-region/.test(sel)) continue;
          for (const r of sel.matchAll(/(?:^|[\s>])rect(?![\w-])([^\s>]*)/g)) {
            const tail = r[1] || '';
            if (tail.startsWith('.')) continue;
            if (/map-task-hit/.test(tail)) continue;
            if (/map-region-(tool|kid)|map-fold-count/.test(sel)) continue; // chrome groups, no task rows
            bad.push(`${file}: ${sel}`);
          }
        }
      }
      expect(bad).toEqual([]);
    }
  });
});
