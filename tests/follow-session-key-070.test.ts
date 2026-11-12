// @vitest-environment happy-dom
/**
 * Map → text follow (and Map↔text focus) must ALWAYS key on session view keys
 * (`__sid-N`). An authored `<id:>` is resolved once through the fixed-ref index
 * and is never itself a focus or follow key. Using the authored id as the key
 * was the prod 0.7.0 (5d138ee) off-by-one: focusing `1.1 Written Discussion
 * <id:27>` highlighted the id-less sibling above it (`1 at Building 14…`) —
 * and the wrapped id-less rows under a folded `Lab notes (+)` above that.
 * Removing `<id:27>` made follow land correctly; adding an icon (which mints a
 * persistent `<id:>`) broke it again. Same class as QA 42314 (`<id:21>`
 * highlighting the line above).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { EditorView } from '@codemirror/view';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parse,
  serialize,
  createOutlineDoc,
  createMapView,
  wireFocus,
  isViewKey,
  parsedLineOf,
} from '../src/index.js';
import { mountTextEditor } from '../src/editor/textEditor.js';
import type { OutlineFoldDoc, OutlineNode } from '../src/index.js';

const WRAP =
  'asc; select * from tasks where [Task Owner] is a very long id-less wrap that continues with more words so the editor wraps it across several visual lines without starting a new outline node, building notes and room details included';

/** Frontmatter, a folded parent, wrapped id-less children, an id-less sibling, then the authored-id target. */
const REPRO = [
  '---',
  'fold-: lab',
  'collapsedMarker: "(+)"',
  '---',
  '# Site notes',
  '',
  `- Lab notes (+) <id:lab>`,
  `  - ${WRAP}`,
  '  - more id-less notes under the folded lab',
  '- 1 at Building 14, Level 11, Room 16',
  '- 1.1 Written Discussion <id:27>',
  '',
].join('\n');

const each = (l: OutlineNode[] | undefined, f: (n: OutlineNode) => void): void => {
  for (const n of l ?? []) {
    f(n);
    each(n.children, f);
  }
};
const byTitle = (d: { nodes: OutlineNode[] }, t: string): OutlineNode => {
  let hit: OutlineNode | undefined;
  each(d.nodes, (n) => {
    if (!hit && n.title === t) hit = n;
  });
  return hit!;
};
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function sourceLine(text: string, needle: string): number {
  const i = text.split(/\n/).findIndex((l) => l.includes(needle));
  if (i < 0) throw new Error(`no line contains ${needle}`);
  return i;
}

function caretLine(view: EditorView): string {
  return view.state.doc.lineAt(view.state.selection.main.head).text;
}

function mainView(): EditorView {
  const el = document.querySelector('.of-text-editor .cm-editor') as HTMLElement | null;
  const v = el ? EditorView.findFromDOM(el) : null;
  if (!v) throw new Error('editor not mounted');
  return v;
}

function mountAll(text: string) {
  document.body.innerHTML = '';
  const doc = createOutlineDoc({ text, wipeOnPagehide: false, autoLockMs: 60_000, debounceMs: 60_000 });
  const mapHost = document.createElement('div');
  Object.defineProperty(mapHost, 'clientWidth', { value: 1200, configurable: true });
  Object.defineProperty(mapHost, 'clientHeight', { value: 800, configurable: true });
  const edHost = document.createElement('div');
  document.body.append(mapHost, edHost);
  const layout: { version: number; nodes: Record<string, unknown>; _source: string } = {
    version: 1,
    nodes: {},
    _source: 'auto-pack',
  };
  const state = { focus: '' };
  const w = wireFocus(doc.focusLink);
  const ed = mountTextEditor(edHost, doc, { followInText: () => true });
  const mv = createMapView(mapHost, {
    ...doc.mapOptions(),
    getDoc: () => doc.root(),
    setDoc: (d: OutlineFoldDoc) => {
      // Host write-back: serialize + reparse, as Audroam does on style mint.
      doc.setText(serialize(d), { source: 'host' });
    },
    getLayout: () => layout,
    getFocusId: () => state.focus,
    setFocusId: (id: string) => {
      state.focus = id;
    },
    onFocusChange: (id: string) => w.onMapFocus(id),
    onChange: () => mv.paint(),
    nodeIcons: true,
    nodeColours: true,
    nodeMenu: true,
    canMintIds: () => true,
    canPersistWidths: true,
  });
  w.attachMap(mv);
  mv.paint();
  return { doc, mv, ed, state, w, mapHost };
}

describe('source line index around id-less siblings, folds, wraps, frontmatter', () => {
  it('parsedLineOf and lineOf(view key) name the Written Discussion source line, not the sibling above', () => {
    const d = parse(REPRO);
    const target = byTitle(d, '1.1 Written Discussion');
    const above = byTitle(d, '1 at Building 14, Level 11, Room 16');
    const want = sourceLine(REPRO, '1.1 Written Discussion');
    const aboveLine = sourceLine(REPRO, '1 at Building 14');
    expect(want).toBeGreaterThan(aboveLine);
    expect(parsedLineOf(target)).toBe(want);
    expect(parsedLineOf(above)).toBe(aboveLine);
    const doc = createOutlineDoc({ text: REPRO, wipeOnPagehide: false, autoLockMs: 60_000, debounceMs: 60_000 });
    const key = doc.sessionIndex().keyOf(byTitle(doc.root(), '1.1 Written Discussion'));
    expect(isViewKey(key)).toBe(true);
    expect(doc.lineOf(key)).toBe(want);
    // Resolving the authored id once must land on the same session key and the same line.
    expect(doc.sessionIndex().resolve('27')).toBe(key);
    expect(doc.lineOf('27')).toBe(want);
    expect(doc.lineOf('27')).not.toBe(aboveLine);
  });
});

describe('follow keys on session ids, never authored ids (Colin, prod 0.7.0)', () => {
  let bag: ReturnType<typeof mountAll> | null = null;
  afterEach(() => {
    bag?.mv.destroy?.();
    bag?.ed.destroy?.();
    bag?.w.destroy();
    bag?.doc.destroy?.();
    document.body.innerHTML = '';
    bag = null;
  });

  it('Map focus on <id:27> follows the Written Discussion line, not the id-less sibling above, and the focus key is a session id', async () => {
    bag = mountAll(REPRO);
    const { doc, mv, state } = bag;
    await tick();
    const want = sourceLine(doc.getText(), '1.1 Written Discussion');
    const key = doc.sessionIndex().resolve('27')!;
    expect(isViewKey(key)).toBe(true);
    const reached = mv.setFocus('27');
    await tick(50);
    // The key on the host, the FocusLink, and setFocus's return is the session view key — never "27".
    expect(isViewKey(reached), 'setFocus returns a session view key').toBe(true);
    expect(reached).toBe(key);
    expect(isViewKey(state.focus), 'host focus id is a session view key, not the authored id').toBe(true);
    expect(state.focus).toBe(key);
    expect(state.focus).not.toBe('27');
    expect(doc.focusLink.get()).toBe(key);
    expect(doc.focusLink.get()).not.toBe('27');
    const line = caretLine(mainView());
    expect(line).toContain('1.1 Written Discussion');
    expect(line).toContain('<id:27>');
    expect(line).not.toContain('Building 14');
    expect(line).not.toContain('Lab notes');
    expect(line).not.toContain('Task Owner');
    expect(doc.lineOf(doc.focusLink.get()!)).toBe(want);
  });

  it('removing the authored id keeps follow on the same session key and the same source line', async () => {
    bag = mountAll(REPRO);
    await tick();
    const { doc, mv } = bag;
    const key = doc.sessionIndex().resolve('27')!;
    mv.setFocus(key);
    await tick(50);
    const stripped = doc.getText().replace(' <id:27>', '');
    expect(stripped).not.toContain('<id:27>');
    doc.setText(stripped, { source: 'text' });
    mv.paint();
    await tick(50);
    // The same session key still names Written Discussion (carry by line / caption).
    const node = byTitle(doc.root(), '1.1 Written Discussion');
    expect(node.id && !node.autoId).toBeFalsy();
    expect(doc.sessionIndex().keyOf(node)).toBe(key);
    mv.setFocus(key);
    await tick(50);
    expect(doc.focusLink.get()).toBe(key);
    expect(isViewKey(doc.focusLink.get()!)).toBe(true);
    expect(caretLine(mainView())).toContain('1.1 Written Discussion');
    expect(caretLine(mainView())).not.toContain('Building 14');
  });

  it('adding an icon (auto-assigns a persistent <id:>) does not change the session key or the followed line', async () => {
    // Start from the id-less form, as Colin did after removing <id:27>, then add an icon.
    const stripped = REPRO.replace(' <id:27>', '');
    bag = mountAll(stripped);
    const { doc, mv, state } = bag;
    await tick();
    const node0 = byTitle(doc.root(), '1.1 Written Discussion');
    expect(node0.id && !node0.autoId).toBeFalsy();
    const key = doc.sessionIndex().keyOf(node0);
    expect(isViewKey(key)).toBe(true);
    mv.setFocus(key);
    await tick(50);
    expect(caretLine(mainView())).toContain('1.1 Written Discussion');
    expect(doc.focusLink.get()).toBe(key);

    mv.setNodeIcon(key, '🌲');
    mv.paint();
    await tick(50);
    const node = byTitle(doc.root(), '1.1 Written Discussion');
    const minted = node.id && !node.autoId ? node.id : null;
    expect(minted, 'adding an icon mints a persistent authored id').toBeTruthy();
    expect(/^\d+$/.test(minted!)).toBe(true);
    // The session key is unchanged; the authored id is not used as the focus key.
    expect(doc.sessionIndex().keyOf(node)).toBe(key);
    expect(doc.sessionIndex().resolve(minted!)).toBe(key);
    expect(isViewKey(state.focus)).toBe(true);
    expect(state.focus).toBe(key);
    expect(state.focus).not.toBe(minted);
    expect(doc.focusLink.get()).toBe(key);
    expect(doc.focusLink.get()).not.toBe(minted);
    // Product path: the mint rewrite must re-follow the same session key without
    // a second setFocus (FocusLink is a no-op when the id is unchanged).
    expect(caretLine(mainView())).toContain('1.1 Written Discussion');
    expect(caretLine(mainView())).not.toContain('Building 14');
    mv.setFocus(key);
    await tick(50);
    const line = caretLine(mainView());
    expect(line).toContain('1.1 Written Discussion');
    expect(line).not.toContain('Building 14');
    expect(doc.lineOf(key)).toBe(sourceLine(doc.getText(), '1.1 Written Discussion'));
  });

  it('QA 42314 class: an authored-id node under wrapped id-less rows follows its own line, keyed by session id', async () => {
    const text = [
      '---',
      'fold-:',
      '---',
      '- rest to 3.70',
      '- on charge 3.85-6-7-3.88 <id:21>',
      '',
    ].join('\n');
    bag = mountAll(text);
    const { doc, mv } = bag;
    await tick();
    const key = doc.sessionIndex().resolve('21')!;
    expect(isViewKey(key)).toBe(true);
    mv.setFocus('21');
    await tick(50);
    expect(doc.focusLink.get()).toBe(key);
    expect(caretLine(mainView())).toContain('on charge 3.85-6-7-3.88');
    expect(caretLine(mainView())).not.toContain('rest to 3.70');
    expect(doc.lineOf(key)).toBe(sourceLine(text, 'on charge'));
  });

  it('no-id → id, id → no-id, and no-id → no-id follow the new line; both old and new keys are session ids', async () => {
    bag = mountAll(REPRO);
    const { doc, mv, state } = bag;
    await tick();
    const idless = doc.sessionIndex().keyOf(byTitle(doc.root(), '1 at Building 14, Level 11, Room 16'));
    const otherIdless = doc.sessionIndex().keyOf(byTitle(doc.root(), 'more id-less notes under the folded lab'));
    const idd = doc.sessionIndex().resolve('27')!;
    expect(isViewKey(idless)).toBe(true);
    expect(isViewKey(otherIdless)).toBe(true);
    expect(isViewKey(idd)).toBe(true);
    expect(idless).not.toBe(idd);
    expect(idless).not.toBe(otherIdless);
    // Neither id-less node is stored under a place-number or authored id.
    expect(idless).not.toMatch(/^[1-9]\d*$/);
    expect(otherIdless).not.toMatch(/^[1-9]\d*$/);

    // no-id → id (Colin's decisive case: previous focus was an id-less sibling).
    mv.setFocus(idless);
    await tick(50);
    expect(isViewKey(state.focus)).toBe(true);
    expect(state.focus).toBe(idless);
    expect(doc.focusLink.get()).toBe(idless);
    expect(caretLine(mainView())).toContain('Building 14');
    expect(caretLine(mainView())).not.toContain('1.1 Written Discussion');

    mv.setFocus(idd);
    await tick(50);
    expect(isViewKey(state.focus)).toBe(true);
    expect(state.focus).toBe(idd);
    expect(state.focus).not.toBe(idless);
    expect(state.focus).not.toBe('27');
    expect(doc.focusLink.get()).toBe(idd);
    expect(caretLine(mainView())).toContain('1.1 Written Discussion');
    expect(caretLine(mainView())).not.toContain('Building 14');
    expect(caretLine(mainView())).not.toContain('Lab notes');

    // id → no-id
    mv.setFocus(idless);
    await tick(50);
    expect(state.focus).toBe(idless);
    expect(doc.focusLink.get()).toBe(idless);
    expect(caretLine(mainView())).toContain('Building 14');
    expect(caretLine(mainView())).not.toContain('1.1 Written Discussion');

    // no-id → no-id (a different id-less row, including one under the folded parent).
    mv.setFocus(otherIdless);
    await tick(50);
    expect(state.focus).toBe(otherIdless);
    expect(state.focus).not.toBe(idless);
    expect(doc.focusLink.get()).toBe(otherIdless);
    expect(isViewKey(state.focus)).toBe(true);
    expect(caretLine(mainView())).toContain('more id-less notes under the folded lab');
    expect(caretLine(mainView())).not.toContain('Building 14');
    expect(caretLine(mainView())).not.toContain('1.1 Written Discussion');
  });

  it('FocusLink is always a session key: Outline authored data-id is resolved once; Map→Outline looks up via hostId', async () => {
    bag = mountAll(REPRO);
    const { doc, mv, w, state } = bag;
    await tick();
    const key = doc.sessionIndex().resolve('27')!;
    expect(isViewKey(key)).toBe(true);
    expect(mv.hostId(key)).toBe('27');
    const looks: string[] = [];
    w.attachOutline({ focus: (id: string) => looks.push(id) });

    // Map → Outline: the Outline DOM is asked for the authored data-id, not the session key.
    mv.setFocus('27');
    await tick(50);
    expect(doc.focusLink.get()).toBe(key);
    expect(isViewKey(doc.focusLink.get()!)).toBe(true);
    expect(looks).toContain('27');
    expect(looks).not.toContain(key);
    expect(state.focus).toBe(key);
    expect(caretLine(mainView())).toContain('1.1 Written Discussion');

    // Outline click publishes the authored data-id; wireFocus resolves it once.
    // If that resolve were skipped, FocusLink would switch to "27".
    w.onOutlineFocus('27');
    await tick(30);
    expect(doc.focusLink.get()).toBe(key);
    expect(doc.focusLink.get()).not.toBe('27');
    expect(isViewKey(doc.focusLink.get()!)).toBe(true);
    expect(state.focus).toBe(key);
    expect(state.focus).not.toBe('27');
  });
});

describe('source: focus / follow paths key on session ids, not publicId or position', () => {
  const mapSrc = readFileSync(join(__dirname, '../src/mapView.ts'), 'utf8');
  const edSrc = readFileSync(join(__dirname, '../src/editor/textEditor.ts'), 'utf8');
  const followSrc = readFileSync(join(__dirname, '../src/editor/index.ts'), 'utf8');

  it('setFocusId and emitFocus resolve to a view key (toKey), never publicId / toRef', () => {
    const set = mapSrc.slice(mapSrc.indexOf('const setFocusId ='), mapSrc.indexOf('const getFocusId'));
    expect(set).toMatch(/setFocusIdRaw\(\s*sessionFocus\(/);
    expect(set).not.toMatch(/setFocusIdRaw\(\s*toRef\(/);
    // Live emitFocus is an assignment (placeholder `let emitFocus` is earlier).
    const emit = mapSrc.slice(mapSrc.indexOf('emitFocus = ()'), mapSrc.indexOf('const setFocusId'));
    // emitted id is the session view key (sessionFocus wraps toKey)
    expect(emit).toMatch(/sessionFocus\(/);
    expect(emit).not.toMatch(/publicId\(/);
    expect(emit).not.toMatch(/toRef\(/);
    const helper = mapSrc.slice(mapSrc.indexOf('const sessionFocus ='), mapSrc.indexOf('emitFocus = ()'));
    expect(helper).toMatch(/return toKey\(/);
    expect(helper).not.toMatch(/toRef\(/);
    expect(helper).not.toMatch(/publicId\(/);
  });

  it('mountTextEditor defaults lineOf to the doc session-index line map', () => {
    expect(edSrc).toMatch(/lineOf:\s*o\.lineOf\s*\?\?\s*\(\(?id(?::\s*string)?\)?\s*=>\s*doc\.lineOf/);
  });

  it('editor follow uses lineOf (session index) first, not the raw authored id as a line or position', () => {
    const follow = followSrc.slice(followSrc.indexOf('const follow = ViewPlugin'), followSrc.indexOf('const unlockClick'));
    expect(follow).toMatch(/opts\.lineOf\?\.\(id\)/);
    expect(follow).not.toMatch(/parseInt\(\s*id/);
    expect(follow).not.toMatch(/Number\(\s*id/);
    expect(follow).not.toMatch(/doc\.line\(\s*id/);
    expect(follow).toMatch(/Transaction\.remote/);
    expect(follow).toMatch(/placeFollow/);
    expect(follow).toMatch(/requestAnimationFrame/);
  });

  it('camera expand-follow keys on the session focus id (vkey / getFocusId), never n.id or c.id', () => {
    expect(mapSrc).not.toMatch(/kind:\s*'expand',\s*focusId:\s*n!/);
    expect(mapSrc).toMatch(/kind:\s*'expand',\s*focusId\s*[,}]/);
    const kids = mapSrc.slice(mapSrc.indexOf('function collectExpandKids'), mapSrc.indexOf('function ensureEditVisible'));
    expect(kids).toMatch(/vkey\(c\)/);
    expect(kids).toMatch(/byId\.has\(ck\)/);
    expect(kids).not.toMatch(/byId\.has\(c\.id\)/);
    expect(kids).not.toMatch(/byId\.get\(c\.id\)/);
  });

  it('wireFocus keeps the FocusLink on a session key; Outline DOM lookup uses hostId only', () => {
    const src = readFileSync(join(__dirname, '../src/focusWiring.ts'), 'utf8');
    expect(src).toMatch(/toSession/);
    expect(src).toMatch(/sessionIndex\?\.\(\)\.resolve/);
    expect(src).toMatch(/toOutlineLook/);
    expect(src).toMatch(/hostId\?\.\(id\)/);
    expect(src).toMatch(/link\.set\(toSession\(id\)/);
  });
});
