// @vitest-environment happy-dom
/**
 * The fold handle folds on one click. Focus is a different control.
 * The host writes the editor text back when focus changes, and that text
 * is whatever the editor still has. A handle click must not ask for focus,
 * or that write-back puts the open note back and the fold is ignored.
 */
import { describe, expect, it } from 'vitest';
import { createMapView, parse, serialize } from '../src/index.js';

const OPEN = '- Parent\n  - Child\n';

function mount(onFocus: (id: string) => void) {
  document.body.innerHTML = '';
  let editor = OPEN;
  let doc = parse(editor, { sessionIds: true });
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 900 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  host.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, x: 0, y: 0, toJSON() { return {}; } }) as DOMRect;
  document.body.appendChild(host);
  const layout = { version: 1, nodes: {} as Record<string, unknown>, _source: 'auto-pack' };
  const mv = createMapView(host, {
    getDoc: () => doc,
    setDoc: (d) => {
      doc = d;
      editor = serialize(d);
    },
    getLayout: () => layout as never,
    getFocusId: () => 'stay',
    setFocusId: (id) => {
      onFocus(id);
      // The editor reports its current text after the click that moved focus.
      const reported = editor;
      queueMicrotask(() => {
        doc = parse(reported, { sessionIds: true });
      });
    },
    onChange: () => mv.paint(),
  });
  mv.paint();
  return {
    host,
    read: () => doc,
    editor: () => editor,
  };
}

function handle(host: HTMLElement): Element {
  const hit = [...host.querySelectorAll('.map-node')]
    .find((n) => (n.textContent || '').includes('Parent'))
    ?.querySelector('.map-fold-hit');
  if (!hit) throw new Error('fold handle is not on the map');
  return hit;
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
}

describe('fold handle', () => {
  it('one click folds, and a focus write-back cannot restore the open text', async () => {
    const focused: string[] = [];
    const view = mount((id) => focused.push(id));
    click(handle(view.host));
    await Promise.resolve();
    const folded = view.read();
    expect(folded.nodes[0]!.collapsed).toBe(true);
    expect(view.editor()).toBe('- Parent (+)\n  - Child\n');
    expect(focused).toEqual([]);
    click(handle(view.host));
    await Promise.resolve();
    expect(view.read().nodes[0]!.collapsed).toBe(false);
    expect(view.editor()).toBe(OPEN);
    expect(focused).toEqual([]);
  });

  it('a pill click focuses and does not fold', async () => {
    const focused: string[] = [];
    const view = mount((id) => focused.push(id));
    const pill = [...view.host.querySelectorAll('.map-node')]
      .find((n) => (n.textContent || '').includes('Parent'))
      ?.querySelector('.map-pill');
    if (!pill) throw new Error('pill is not on the map');
    click(pill);
    await Promise.resolve();
    expect(view.read().nodes[0]!.collapsed).toBe(false);
    expect(view.editor()).toBe(OPEN);
    expect(focused).toHaveLength(1);
    expect(focused[0]).toMatch(/^__sid-/);
  });
});
