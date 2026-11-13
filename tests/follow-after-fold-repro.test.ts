// @vitest-environment happy-dom
/**
 * Audroam's outline page keeps a parse({sessionIds}) tree for the Map and a
 * createOutlineDoc tree for the text. Folding installs toggleFold's clone, which
 * has no parsed lines, then the shared session index is synced onto that clone.
 * Follow must still resolve every view key to its source line.
 */
import { describe, it, expect } from 'vitest';
import { EditorView } from '@codemirror/view';
import {
  parse,
  serialize,
  toggleFold,
  createOutlineDoc,
  createMapView,
  wireFocus,
  parsedLineOf,
  type OutlineFoldDoc,
  type OutlineNode,
} from '../src/index.js';
import { mergeKeeping } from '../src/textMerge.js';
import { mountTextEditor } from '../src/editor/textEditor.js';

const TEXT = '- Parent\n  - Child\n- Sibling\n- Kept <id:9>\n';

function byTitle(nodes: OutlineNode[] | undefined, title: string): OutlineNode | undefined {
  for (const n of nodes ?? []) {
    if (n.title === title) return n;
    const hit = byTitle(n.children, title);
    if (hit) return hit;
  }
  return undefined;
}

function caretLine(): string {
  const el = document.querySelector('.of-text-editor .cm-editor') as HTMLElement | null;
  const v = el ? EditorView.findFromDOM(el) : null;
  if (!v) throw new Error('editor not mounted');
  return v.state.doc.lineAt(v.state.selection.main.head).text;
}

describe('host fold then follow', () => {
  it('lineOf stays on the text after the map syncs a fold clone', () => {
    const outline = createOutlineDoc({ text: TEXT, wipeOnPagehide: false, autoLockMs: 60_000, debounceMs: 60_000 });
    let host = parse(TEXT, { sessionIds: true });
    const idx = outline.sessionIndex();
    idx.sync(host);
    const sibling = byTitle(host.nodes, 'Sibling')!;
    const parent = byTitle(host.nodes, 'Parent')!;
    const sibKey = idx.keyOf(sibling);
    const parentKey = idx.keyOf(parent);
    expect(parsedLineOf(sibling)).toBe(2);
    expect(outline.lineOf(sibKey)).toBe(2);

    // Map paint reads the host tree again after lineOf pointed the index at the text.
    idx.sync(host);
    expect(outline.lineOf(sibKey)).toBe(2);

    parent.id = parentKey;
    parent.autoId = true;
    const folded = toggleFold(host, parentKey);
    host = folded;
    const cur = outline.getText();
    const next = serialize(folded);
    const norm = serialize(parse(cur));
    const merged = mergeKeeping(cur, norm, next);
    expect(merged).toContain('Parent (+)');
    outline.setText(merged, { source: 'map' });

    // What map paint does: sync the shared index onto the cloned host tree.
    idx.sync(host);
    const foldedParent = byTitle(host.nodes, 'Parent')!;
    const foldedSibling = byTitle(host.nodes, 'Sibling')!;
    expect(parsedLineOf(foldedParent), 'clone keeps no parsed line').toBeNull();
    expect(parsedLineOf(foldedSibling)).toBeNull();
    expect(outline.lineOf(sibKey), 'follow line after fold').toBe(2);
    expect(outline.lineOf(parentKey), 'folded line').toBe(0);
  });

  it('clicking another pill after a fold still moves the text caret', async () => {
    document.body.innerHTML = '';
    const outline = createOutlineDoc({ text: TEXT, wipeOnPagehide: false, autoLockMs: 60_000, debounceMs: 60_000 });
    let host: OutlineFoldDoc = parse(TEXT, { sessionIds: true });
    const mapHost = document.createElement('div');
    Object.defineProperty(mapHost, 'clientWidth', { value: 1200, configurable: true });
    Object.defineProperty(mapHost, 'clientHeight', { value: 800, configurable: true });
    const edHost = document.createElement('div');
    document.body.append(mapHost, edHost);
    const state = { focus: '' };
    const layout = { version: 1, nodes: {} as Record<string, unknown>, _source: 'auto-pack' };
    const w = wireFocus(outline.focusLink);
    mountTextEditor(edHost, outline, { followInText: () => true });
    const mv = createMapView(mapHost, {
      ...outline.mapOptions(),
      getDoc: () => host,
      setDoc: (next) => {
        host = next;
        const cur = outline.getText();
        const serialized = serialize(next);
        const norm = serialize(parse(cur));
        outline.setText(mergeKeeping(cur, norm, serialized), { source: 'map' });
      },
      getLayout: () => layout,
      getFocusId: () => state.focus,
      setFocusId: (id: string) => { state.focus = id; },
      onFocusChange: (id: string) => w.onMapFocus(id),
      onChange: () => mv.paint(),
    });
    w.attachMap(mv);
    mv.paint();
    await new Promise((r) => setTimeout(r, 30));

    const sib = [...mapHost.querySelectorAll('.map-node')].find((g) => (g.textContent || '').includes('Sibling'))!;
    sib.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    expect(caretLine()).toContain('Sibling');

    const parent = [...mapHost.querySelectorAll('.map-node')].find((g) => (g.textContent || '').includes('Parent'))!;
    parent.querySelector('.map-fold-hit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));

    const sibAgain = [...mapHost.querySelectorAll('.map-node')].find((g) => (g.textContent || '').includes('Sibling'))!;
    sibAgain.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    expect(caretLine()).toContain('Sibling');

    const kept = [...mapHost.querySelectorAll('.map-node')].find((g) => (g.textContent || '').includes('Kept'))!;
    kept.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    expect(caretLine()).toContain('Kept');
    expect(caretLine()).toContain('<id:9>');
    mv.destroy?.();
  });
});
