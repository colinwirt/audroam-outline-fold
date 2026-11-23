// @vitest-environment happy-dom
// Toolbar Level 2. One root, two sections, questions under them. Two of those
// questions had a stale node.depth of 0, so they stayed open and their children
// drew a column the shut siblings did not have. A cloud keeps its own fold
// store; Level 2 has to set that store too, or one branch inside stays open.
import { expect, it } from 'vitest';
import { createMapView, createRegionFoldStore, parse } from '../src/index.js';

const TEXT = [
  '- Course <id:course>',
  '  - A3 <id:a3>',
  '    - SQL demo <id:sql>',
  '      - bring id <id:bring>',
  '    - Q1.1 <id:q11>',
  '      - discussion <id:disc>',
  '    - Lab notes <id:lab>',
  '      - see note <id:see>',
  '  - Q2 <id:q2>',
  '    - Q2.1 <id:q21>',
  '      - alert <id:alert>',
  '    - Q2.2 <id:q22>',
  '      - Screenshot <id:shot>',
  '    - Q2.3 <id:q23>',
  '      - worm <id:worm>',
].join('\n');

function mount(doc: ReturnType<typeof parse>) {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 900 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  document.body.appendChild(host);
  const layout = { version: 1, nodes: {} as Record<string, unknown>, _source: 'auto-pack' as const };
  let current = doc;
  const mv = createMapView(host, {
    getDoc: () => current,
    setDoc: (d) => { current = d; },
    getLayout: () => layout as never,
    getFocusId: () => '',
    setFocusId: () => {},
  });
  const node = (title: string) =>
    [...host.querySelectorAll('.map-node')].find((n) => (n.textContent || '').includes(title));
  return { host, mv, node, getDoc: () => current };
}

it('level 2 shuts every question, including one whose node.depth is 0', () => {
  document.body.innerHTML = '';
  const doc = parse(TEXT, { sessionIds: true });
  const a3 = doc.nodes[0]!.children![0]!.children!;
  const q2 = doc.nodes[0]!.children![1]!.children!;
  a3[0]!.depth = 0;
  a3[1]!.depth = 9;
  q2[1]!.depth = 0;
  doc.fold = { mode: '-', ids: ['q11', 'lab', 'q21', 'q23'] };
  const { mv, node } = mount(doc);
  mv.paint();
  expect(node('SQL demo')?.getAttribute('aria-expanded')).toBe('true');
  expect(node('bring id')).toBeTruthy();
  expect(node('Q1.1')?.getAttribute('aria-expanded')).toBe('false');
  mv.setWholeMapLevel(2);
  mv.paint();
  expect(mv.currentWholeMapLevel()).toBe(2);
  expect(node('A3')?.getAttribute('aria-expanded')).toBe('true');
  expect(node('Q2')?.getAttribute('aria-expanded')).toBe('true');
  for (const title of ['SQL demo', 'Q1.1', 'Lab notes', 'Q2.1', 'Q2.2', 'Q2.3']) {
    expect(node(title)?.getAttribute('aria-expanded')).toBe('false');
  }
  expect(node('bring id')).toBeUndefined();
  expect(node('discussion')).toBeUndefined();
  expect(node('Screenshot')).toBeUndefined();
  expect(node('alert')).toBeUndefined();
  expect(node('worm')).toBeUndefined();
});

it('level 2 shuts an id-less question with its siblings', () => {
  document.body.innerHTML = '';
  const doc = parse([
    '- Course',
    '  - A3',
    '    - SQL demo',
    '      - bring id',
    '    - Q1.1',
    '      - discussion',
  ].join('\n'));
  const { mv, node } = mount(doc);
  mv.setWholeMapLevel(2);
  mv.paint();
  expect(node('A3')?.getAttribute('aria-expanded')).toBe('true');
  expect(node('SQL demo')?.getAttribute('aria-expanded')).toBe('false');
  expect(node('Q1.1')?.getAttribute('aria-expanded')).toBe('false');
  expect(node('bring id')).toBeUndefined();
  expect(node('discussion')).toBeUndefined();
});

it('level 2 folds a cloud at one depth', () => {
  document.body.innerHTML = '';
  const doc = parse('- Section <id:sec>\n  - anchor <id:2>\n');
  const sub = parse([
    '- Branch <id:branch>',
    '  - SQL demo <id:a>',
    '    - bring id <id:a1>',
    '  - Q1.1 <id:b>',
    '    - discussion <id:b1>',
    '  - Q2.2 <id:c>',
    '    - Screenshot <id:c1>',
  ].join('\n'));
  const store = createRegionFoldStore();
  store.setNodeCollapsed('s:2', 'a', false);
  store.setNodeCollapsed('s:2', 'b', true);
  store.setNodeCollapsed('s:2', 'c', false);
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 900 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  document.body.appendChild(host);
  const layout = { version: 1, nodes: {} as Record<string, unknown>, _source: 'auto-pack' as const };
  const mv = createMapView(host, {
    getDoc: () => doc,
    setDoc: () => {},
    getLayout: () => layout as never,
    getFocusId: () => '',
    setFocusId: () => {},
    getRegionHosts: () => [{ id: 's:2', kind: 'sealed', anchor: '2', doc: sub, folded: false, kid: 'k1' }],
    regionFold: store,
  });
  mv.paint();
  mv.setWholeMapLevel(2);
  mv.paint();
  const nodes = [...host.querySelectorAll('.map-region-node')];
  const node = (title: string) => nodes.find((n) => (n.textContent || '').includes(title));
  expect(node('SQL demo')?.getAttribute('aria-expanded')).toBe('false');
  expect(node('Q1.1')?.getAttribute('aria-expanded')).toBe('false');
  expect(node('Q2.2')?.getAttribute('aria-expanded')).toBe('false');
  expect(node('bring id')).toBeUndefined();
  expect(node('discussion')).toBeUndefined();
  expect(node('Screenshot')).toBeUndefined();
  expect(store.isNodeCollapsed('s:2', sub, 'a')).toBe(true);
  expect(store.isNodeCollapsed('s:2', sub, 'b')).toBe(true);
  expect(store.isNodeCollapsed('s:2', sub, 'c')).toBe(true);
});
