// @vitest-environment happy-dom
// 0.5.15: Map edits resolve their row by a certain reference against the whole note, and
// refuse (with a 'refused' event) when the row cannot be found for certain. Invented fixtures.
import { expect, it } from 'vitest';
import { createMapView, createOutlineDoc, parse, resolveMapRef, mapRefOf } from '../src/index.js';
import type { OutlineFoldDoc, OutlineNode } from '../src/index.js';

const TEXT = `- Shelf <id:7>
  - [ ] dust the lamp
- Projects
  - [ ] paint the gate
    - notes on paint
    - [ ] buy primer

- Later (+)
  - [x] old job <id:12>
`;

const mk = (text: string) => createOutlineDoc({ text, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 60000 });
function mount(doc: ReturnType<typeof mk>, view: () => OutlineFoldDoc) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 1000 });
  Object.defineProperty(host, 'clientHeight', { value: 800 });
  document.body.appendChild(host);
  const layout = { version: 1, nodes: {}, _source: 'auto-pack' };
  const mv = createMapView(host, {
    getDoc: view, setDoc: () => {}, getLayout: () => layout as never,
    getFocusId: () => '', setFocusId: () => {}, ...doc.mapOptions(),
  });
  mv.paint();
  const click = (label: string) => {
    const g = [...host.querySelectorAll('.map-node')].find((x) => (x.textContent || '').includes(label));
    g!.querySelector('.map-task-hit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };
  return { doc, mv, click };
}

const each = (l: OutlineNode[] | undefined, f: (n: OutlineNode) => void): void => { for (const n of l ?? []) { f(n); each(n.children, f); } };

it('page/library agreement: every row of a __tmp view resolves by its id in the whole text', () => {
  const view = parse(TEXT, { sessionIds: true });
  let n = 0;
  each(view.nodes, (node) => {
    const ref = mapRefOf(view, node)!;
    const hit = resolveMapRef(TEXT, ref);
    expect(hit.ok && hit.via === 'id' && hit.node.title === node.title, node.title).toBe(true);
    n += 1;
  });
  expect(n).toBe(8);
});

it('View from here: a branch shown alone resolves by its top row id, not its place in the subset', () => {
  const full = parse(TEXT, { sessionIds: true });
  const branch = full.nodes[1]!;
  const shown = { ...full, nodes: [branch] };
  const primer = branch.children![0]!.children![1]!;
  const ref = mapRefOf(shown, primer)!;
  // A ref with a dead id still lands on the right row through the path from the shown top row.
  const hit = resolveMapRef(TEXT, { ...ref, id: 'gone' });
  expect(hit.ok && hit.via === 'path' && hit.node.title === primer.title).toBe(true);
  const doc = mk(TEXT);
  const { mv, click } = mount(doc, () => { const d = parse(doc.getText(), { sessionIds: true }); return { ...d, nodes: [d.nodes[1]!] }; });
  click('buy primer');
  expect(doc.getText()).toBe(TEXT.replace('[ ] buy primer', '[-] buy primer'));
  mv.destroy?.();
});

it('title mismatch: a stale Map row is refused, the text is not touched, and a refused event fires', () => {
  const stale = parse(TEXT, { sessionIds: true });
  const doc = mk(TEXT);
  const events: unknown[] = [];
  doc.on('refused', (e) => events.push(e));
  // The text changed under the Map: the row the Map shows as "dust the lamp" is now another line.
  const edited = TEXT.replace('  - [ ] dust the lamp\n', '  - [ ] water the fern\n');
  doc.setText(edited, { source: 'text' });
  const { mv, click } = mount(doc, () => stale);
  click('dust the lamp');
  expect(doc.getText()).toBe(edited);
  expect(events).toEqual([{ action: 'tick', id: '__tmp-1', reason: 'title-mismatch', title: 'dust the lamp' }]);
  mv.destroy?.();
});
