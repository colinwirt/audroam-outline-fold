// @vitest-environment happy-dom
// 0.5.14. Map tick on a nested row two levels down, and on rows added since the last save
// (no <id:N> written yet). Invented fixtures only.
import { expect, it } from 'vitest';
import { createMapView, createOutlineDoc, parse } from '../src/index.js';
import type { OutlineFoldDoc, OutlineNode } from '../src/index.js';

const each = (l: OutlineNode[] | undefined, f: (n: OutlineNode) => void): void => {
  for (const n of l ?? []) { f(n); each(n.children, f); }
};
/** A live host keeps a row's session id between edits; a row added since load gets the next
 *  unused number, not its position. So session ids are not positional after an insert. */
function stableView() {
  const seen = new Map<string, string>();
  let next = 1;
  return (text: string): OutlineFoldDoc => {
    const d = parse(text, { sessionIds: true });
    each(d.nodes, (n) => {
      if (!n.autoId) return;
      const k = n.title;
      if (!seen.has(k)) seen.set(k, `__tmp-${next++}`);
      n.id = seen.get(k)!;
    });
    return d;
  };
}

function mount(text: string, insert?: (t: string) => string) {
  document.body.innerHTML = '';
  const doc = createOutlineDoc({ text, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 60000 });
  const viewOf = stableView();
  let view = viewOf(doc.getText());
  doc.on('change', () => { view = viewOf(doc.getText()); });
  // Rows typed since the last save: inserted after the view first loaded.
  if (insert) doc.setText(insert(doc.getText()), { source: 'host' });
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 800 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  document.body.appendChild(host);
  const layout = { version: 1, nodes: {}, _source: 'auto-pack' };
  const mv = createMapView(host, {
    getDoc: () => view,
    setDoc: () => { throw new Error('a task tick must not replace the document'); },
    getLayout: () => layout as never,
    getFocusId: () => '',
    setFocusId: () => {},
    ...doc.mapOptions(),
  });
  mv.paint();
  const click = (label: string) => {
    const g = [...host.querySelectorAll('.map-node')].find((x) => (x.textContent || '').includes(label));
    const box = g?.querySelector('.map-task-hit');
    if (!box) throw new Error(`no task box on ${label}`);
    box.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };
  return { doc, mv, click };
}

const LOADED = `- Garden plan
  - [ ] Beds
    - [ ] Water the beans
- Kitchen
  - [ ] Sharpen knives
`;
const addNew = (t: string) =>
  t.replace('- Garden plan\n', '- Garden plan\n  - [ ] Map check new parent\n    - [ ] Mid new\n      - [ ] Test at this level\n');

it('host-kept session ids: a new nested row two levels down toggles its own line', () => {
  const { doc, mv, click } = mount(LOADED, addNew);
  const start = doc.getText();
  click('Test at this level');
  expect(doc.getText()).toBe(start.replace('[ ] Test at', '[-] Test at'));
  mv.destroy?.();
});

it('host-kept session ids: a new parent toggles, old rows below still hit their own line', () => {
  const { doc, mv, click } = mount(LOADED, addNew);
  const start = doc.getText();
  click('Map check new parent');
  const a = start.replace('[ ] Map check', '[-] Map check');
  expect(doc.getText()).toBe(a);
  click('Water the beans');
  expect(doc.getText()).toBe(a.replace('[ ] Water', '[-] Water'));
  expect(doc.getText().split('\n')).toHaveLength(start.split('\n').length);
  mv.destroy?.();
});

// Saved doc: lines carry <id:N>. The new rows below have no tag yet.
const SAVED = `- Garden plan <id:1>
  - [ ] Beds <id:2>
    - [ ] Water the beans <id:3>
- Kitchen <id:4>
  - [ ] Sharpen knives <id:5>
`;

it('a nested row two levels down toggles its own line', () => {
  const { doc, mv, click } = mount(SAVED);
  click('Water the beans');
  expect(doc.getText()).toBe(SAVED.replace('[ ] Water', '[-] Water'));
  mv.destroy?.();
});

it('a newly inserted (unsaved) row toggles in place', () => {
  const text = SAVED.replace('- Kitchen <id:4>\n', '- Kitchen <id:4>\n  - [ ] Buy new pan\n');
  const { doc, mv, click } = mount(text);
  click('Buy new pan');
  expect(doc.getText()).toBe(text.replace('[ ] Buy', '[-] Buy'));
  click('Buy new pan');
  expect(doc.getText()).toBe(text.replace('[ ] Buy', '[x] Buy'));
  mv.destroy?.();
});

it('a new parent with a new nested child two levels down: both tick in place', () => {
  const text = SAVED.replace(
    '- Kitchen <id:4>\n',
    '- Kitchen <id:4>\n  - [ ] New shelf parent\n    - [ ] Middle\n      - [ ] Deep new child\n',
  );
  const { doc, mv, click } = mount(text);
  click('Deep new child');
  const a = text.replace('[ ] Deep', '[-] Deep');
  expect(doc.getText()).toBe(a);
  click('New shelf parent');
  expect(doc.getText()).toBe(a.replace('[ ] New shelf', '[-] New shelf'));
  expect(doc.getText().split('\n')).toHaveLength(text.split('\n').length);
  mv.destroy?.();
});
