// @vitest-environment happy-dom
/**
 * A fold is a text edit on the doc that owns the note.
 * The map does not hand the host a tree to put back.
 * A fresh parse of the text the doc wrote still has the fold.
 */
import { describe, expect, it } from 'vitest';
import { createMapView, createOutlineDoc, parse } from '../src/index.js';

const timers = { set: () => 0, clear: () => {} };

function docOf(text: string) {
  return createOutlineDoc({ text, timers, wipeOnPagehide: false });
}

describe('fold is a text commit', () => {
  it('writes (+) on an id-less line, and a fresh parse stays folded', () => {
    const note = docOf('- SQL demo\n  - step\n- Kept <id:5>\n  - child\n');
    const sources: string[] = [];
    note.on('change', (e) => sources.push(e.source));
    const sql = note.root().nodes[0]!;
    const key = sql.sessionKey;
    expect(note.toggleFold('5')).toBeNull();
    expect(note.toggleFold(key)).toEqual({ collapsed: true });
    expect(note.getText()).toBe('- SQL demo (+)\n  - step\n- Kept <id:5>\n  - child\n');
    expect(sources).toEqual(['map']);
    expect(note.root().nodes[0]!.sessionKey).toBe(key);
    expect(note.root().nodes[0]!.collapsed).toBe(true);
    expect(note.root().nodes[1]!.collapsed).toBe(false);
    expect(note.root().nodes[1]!.writtenId).toBe('5');
    const again = parse(note.getText());
    expect(again.nodes[0]!.collapsed).toBe(true);
    expect(again.nodes[1]!.collapsed).toBe(false);
    expect(note.toggleFold(key)).toEqual({ collapsed: false });
    expect(note.getText()).toBe('- SQL demo\n  - step\n- Kept <id:5>\n  - child\n');
  });

  it('does not fold a leaf', () => {
    const note = docOf('- Parent\n  - Child\n');
    const child = note.root().nodes[0]!.children![0]!;
    expect(note.toggleFold(child.sessionKey)).toBeNull();
    expect(note.getText()).toBe('- Parent\n  - Child\n');
  });

  it('uses the note marker', () => {
    const note = docOf('---\ncollapsedMarker: "[folded]"\n---\n- Parent\n  - Child\n');
    note.toggleFold(note.root().nodes[0]!.sessionKey);
    expect(note.getText()).toBe('---\ncollapsedMarker: "[folded]"\n---\n- Parent [folded]\n  - Child\n');
    expect(parse(note.getText()).nodes[0]!.collapsed).toBe(true);
  });

  it('writes a level into the text', () => {
    const note = docOf('- A\n  - B\n    - C\n');
    const root = note.root().nodes[0]!.sessionKey;
    expect(note.setFoldLevel(2)).toBe(true);
    expect(note.getText()).toBe('- A\n  - B (+)\n    - C\n');
    expect(note.root().nodes[0]!.collapsed).toBe(false);
    expect(note.root().nodes[0]!.children![0]!.collapsed).toBe(true);
    expect(note.setFoldLevel(0, root)).toBe(true);
    expect(note.root().nodes[0]!.collapsed).toBe(true);
    expect(note.getText()).toBe('- A (+)\n  - B (+)\n    - C\n');
  });

  it('a handle click does not call setDoc or setFocusId', async () => {
    const note = docOf('- Parent\n  - Child\n');
    let setDocs = 0;
    const focused: string[] = [];
    document.body.innerHTML = '';
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 900 });
    Object.defineProperty(host, 'clientHeight', { value: 600 });
    host.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, x: 0, y: 0, toJSON() { return {}; } }) as DOMRect;
    document.body.appendChild(host);
    const layout = { version: 1, nodes: {} as Record<string, unknown>, _source: 'auto-pack' };
    const mv = createMapView(host, {
      getDoc: () => note.root(),
      setDoc: () => { setDocs += 1; },
      getLayout: () => layout as never,
      getFocusId: () => 'stay',
      setFocusId: (id) => { focused.push(id); },
      onChange: () => mv.paint(),
      ...note.mapOptions(),
    });
    mv.paint();
    const hit = [...host.querySelectorAll('.map-node')]
      .find((n) => (n.textContent || '').includes('Parent'))
      ?.querySelector('.map-fold-hit');
    expect(hit).toBeTruthy();
    hit!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await Promise.resolve();
    expect(setDocs).toBe(0);
    expect(focused).toEqual([]);
    expect(note.getText()).toBe('- Parent (+)\n  - Child\n');
    expect(note.root().nodes[0]!.collapsed).toBe(true);
    const again = [...host.querySelectorAll('.map-node')]
      .find((n) => (n.textContent || '').includes('Parent'))
      ?.querySelector('.map-fold-hit');
    again!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await Promise.resolve();
    expect(setDocs).toBe(0);
    expect(note.getText()).toBe('- Parent\n  - Child\n');
    expect(note.root().nodes[0]!.collapsed).toBe(false);
  });
});
