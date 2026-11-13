// @vitest-environment happy-dom
/**
 * Alt+Up / Alt+Down is a same-size line swap. The session key stays on the
 * words, so Follow lands on the pill that was clicked. Typing a new caption
 * on a line still keeps that line's key.
 */
import { describe, it, expect } from 'vitest';
import { EditorView } from '@codemirror/view';
import { moveLineUp } from '@codemirror/commands';
import { createOutlineDoc, createMapView, createSessionIndex, wireFocus, parse } from '../src/index.js';
import { mountTextEditor } from '../src/editor/textEditor.js';
import type { OutlineNode } from '../src/index.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const each = (l: OutlineNode[] | undefined, f: (n: OutlineNode) => void): void => {
  for (const n of l ?? []) { f(n); each(n.children, f); }
};
const byTitle = (d: { nodes: OutlineNode[] }, t: string): OutlineNode => {
  let hit: OutlineNode | undefined;
  each(d.nodes, (n) => { if (!hit && n.title === t) hit = n; });
  return hit!;
};

function caretLine(): string {
  const el = document.querySelector('.of-text-editor .cm-editor') as HTMLElement;
  const v = EditorView.findFromDOM(el);
  return v.state.doc.lineAt(v.state.selection.main.head).text;
}

describe('a line swap keeps the view key on the words', () => {
  it('id-less siblings keep their keys; editing a caption does not', () => {
    const idx = createSessionIndex();
    const a = parse('- Alpha\n- Beta\n- Gamma\n');
    idx.sync(a);
    const kA = idx.keyOf(byTitle(a, 'Alpha'));
    const kB = idx.keyOf(byTitle(a, 'Beta'));
    const swapped = parse('- Beta\n- Alpha\n- Gamma\n');
    idx.sync(swapped);
    expect(idx.keyOf(byTitle(swapped, 'Beta'))).toBe(kB);
    expect(idx.keyOf(byTitle(swapped, 'Alpha'))).toBe(kA);
    expect(idx.lineOf(kB)).toBe(0);
    expect(idx.lineOf(kA)).toBe(1);
    const edited = parse('- Beta\n- Alpha!\n- Gamma\n');
    idx.sync(edited);
    expect(idx.keyOf(byTitle(edited, 'Alpha!'))).toBe(kA);
    expect(idx.lineOf(kA)).toBe(1);
    expect(idx.keyOf(byTitle(edited, 'Beta'))).toBe(kB);
  });

  it('a fresh session-id reparse, as the host does, still keeps the key on the words', () => {
    const doc = createOutlineDoc({
      text: '- Alpha\n- Beta\n- Gamma\n',
      wipeOnPagehide: false,
      autoLockMs: 60_000,
      debounceMs: 60_000,
    });
    const idx = doc.sessionIndex();
    const kB = idx.keyOf(byTitle(doc.root(), 'Beta'));
    doc.on('change', () => { idx.sync(parse(doc.getText(), { sessionIds: true })); });
    doc.setText('- Beta\n- Alpha\n- Gamma\n', { source: 'text' });
    expect(idx.keyOf(byTitle(doc.root(), 'Beta'))).toBe(kB);
    expect(doc.lineOf(kB)).toBe(0);
    expect(idx.keyOf(byTitle(doc.root(), 'Alpha'))).not.toBe(kB);
  });

  it('a parent line swapped with its child keeps both keys on their text', () => {
    const idx = createSessionIndex();
    const a = parse('- Parent\n  - Child\n- Sibling\n');
    idx.sync(a);
    const kP = idx.keyOf(byTitle(a, 'Parent'));
    const kC = idx.keyOf(byTitle(a, 'Child'));
    const swapped = parse('  - Child\n- Parent\n- Sibling\n');
    idx.sync(swapped);
    expect(idx.keyOf(byTitle(swapped, 'Parent'))).toBe(kP);
    expect(idx.keyOf(byTitle(swapped, 'Child'))).toBe(kC);
    expect(idx.lineOf(kC)).toBe(0);
    expect(idx.lineOf(kP)).toBe(1);
  });

  it('clicking the moved pill follows the words', async () => {
    document.body.innerHTML = '';
    const doc = createOutlineDoc({
      text: '- Alpha\n- Beta\n- Gamma\n',
      wipeOnPagehide: false,
      autoLockMs: 60_000,
      debounceMs: 60_000,
    });
    const mapHost = document.createElement('div');
    Object.defineProperty(mapHost, 'clientWidth', { value: 1200, configurable: true });
    Object.defineProperty(mapHost, 'clientHeight', { value: 800, configurable: true });
    const edHost = document.createElement('div');
    document.body.append(mapHost, edHost);
    const layout = { version: 1, nodes: {} as Record<string, unknown>, _source: 'auto-pack' };
    const state = { focus: '' };
    const w = wireFocus(doc.focusLink);
    mountTextEditor(edHost, doc, { followInText: () => true });
    const mv = createMapView(mapHost, {
      ...doc.mapOptions(),
      getDoc: () => doc.root(),
      setDoc: () => {},
      getLayout: () => layout,
      getFocusId: () => state.focus,
      setFocusId: (id: string) => { state.focus = id; },
      onFocusChange: (id: string) => w.onMapFocus(id),
      onChange: () => mv.paint(),
    });
    w.attachMap(mv);
    mv.paint();
    await tick();
    const pill = (title: string) => {
      const hit = [...mapHost.querySelectorAll<HTMLElement>('.map-node')].find((n) => (n.textContent || '').includes(title));
      if (!hit) throw new Error('no pill ' + title);
      return hit;
    };
    pill('Beta').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    const key = state.focus;
    expect(caretLine()).toContain('Beta');
    const view = EditorView.findFromDOM(document.querySelector('.of-text-editor .cm-editor') as HTMLElement);
    const beta = view.state.doc.line(2);
    view.dispatch({ selection: { anchor: beta.from } });
    expect(moveLineUp(view)).toBe(true);
    expect(doc.getText().split('\n')[0]).toContain('Beta');
    mv.paint();
    await tick();
    expect(mapHost.querySelector('.map-node.is-focused')!.textContent).toContain('Beta');
    expect(doc.lineOf(key)).toBe(0);
    pill('Alpha').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(caretLine()).toContain('Alpha');
    expect(caretLine()).not.toContain('Beta');
    pill('Beta').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(caretLine()).toContain('Beta');
    expect(state.focus).toBe(key);
  });

  it('clicking the focused pill again follows, and does nothing when the caret is already there', async () => {
    document.body.innerHTML = '';
    const doc = createOutlineDoc({
      text: '- Alpha\n- Beta\n- Gamma\n',
      wipeOnPagehide: false,
      autoLockMs: 60_000,
      debounceMs: 60_000,
    });
    const mapHost = document.createElement('div');
    Object.defineProperty(mapHost, 'clientWidth', { value: 1200, configurable: true });
    Object.defineProperty(mapHost, 'clientHeight', { value: 800, configurable: true });
    const edHost = document.createElement('div');
    document.body.append(mapHost, edHost);
    const layout = { version: 1, nodes: {} as Record<string, unknown>, _source: 'auto-pack' };
    const state = { focus: '' };
    const link = doc.focusLink;
    const w = wireFocus(link);
    mountTextEditor(edHost, doc, { followInText: () => true });
    const mv = createMapView(mapHost, {
      ...doc.mapOptions(),
      getDoc: () => doc.root(),
      setDoc: () => {},
      getLayout: () => layout,
      getFocusId: () => state.focus,
      setFocusId: (id: string) => {
        const again = state.focus === id;
        state.focus = id;
        if (!link.set(id, 'map') && again) link.again();
      },
      onFocusChange: (id: string) => w.onMapFocus(id),
      onChange: () => mv.paint(),
    });
    w.attachMap(mv);
    mv.paint();
    await tick();
    const pill = (title: string) => {
      const hit = [...mapHost.querySelectorAll<HTMLElement>('.map-node')].find((n) => (n.textContent || '').includes(title));
      if (!hit) throw new Error('no pill ' + title);
      return hit;
    };
    const view = () => EditorView.findFromDOM(document.querySelector('.of-text-editor .cm-editor') as HTMLElement);
    pill('Beta').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(caretLine()).toContain('Beta');
    view().dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    view().dispatch({ selection: { anchor: view().state.doc.line(3).from } });
    expect(caretLine()).toContain('Gamma');
    pill('Beta').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(caretLine()).toContain('Beta');
    const head = view().state.selection.main.head;
    pill('Beta').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(view().state.selection.main.head).toBe(head);
    expect(caretLine()).toContain('Beta');
  });
});
