// @vitest-environment happy-dom
// 0.5.7. A main-Map tick must edit the clicked source line. The view id is a session id
// (not written on the line). `[]` is an open task. Invented fixtures only.
import { beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createMapView,
  createOutlineDoc,
  isCollapsed,
  parse,
  serialize,
  toggleTaskLine,
  createKey,
  sealBranch,
  clearKeys,
  setSealCipher,
} from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';

beforeAll(() => {
  setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>);
});

const TEXT = `- QA checkbox test 2026-11-02
  - [] QA task empty brackets
  - [ ] QA task space brackets
  - [x] QA task done
`;

const AFTER_EMPTY = `- QA checkbox test 2026-11-02
  - [-] QA task empty brackets
  - [ ] QA task space brackets
  - [x] QA task done
`;

function tick(ms = 20): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mount(text: string) {
  document.body.innerHTML = '';
  const doc = createOutlineDoc({ text, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 60000 });
  let view = parse(doc.getText(), { sessionIds: true });
  doc.on('change', () => {
    view = parse(doc.getText(), { sessionIds: true });
  });
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 800 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  document.body.appendChild(host);
  const layout: { version: number; nodes: Record<string, unknown>; _source: string } = { version: 1, nodes: {}, _source: 'auto-pack' };
  const mv = createMapView(host, {
    getDoc: () => view,
    setDoc: () => {
      throw new Error('a task tick must not replace the document');
    },
    getLayout: () => layout,
    getFocusId: () => '',
    setFocusId: () => {},
    ...doc.mapOptions(),
  });
  mv.paint();
  const hit = (label: string, nth = 0) => {
    const nodes = [...host.querySelectorAll('.map-node')].filter((g) => (g.textContent || '').includes(label));
    const g = nodes[nth];
    if (!g) throw new Error(`no map node ${label} #${nth}`);
    const box = g.querySelector('.map-task-hit');
    if (!box) throw new Error(`no task box on ${label} #${nth}`);
    return box;
  };
  const click = (label: string, nth = 0) => {
    hit(label, nth).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };
  return { doc, host, mv, click };
}

it('a checkbox without a dash toggles in place', () => {
  const { doc, mv, click } = mount('[] tst 1\n[ ] tst space\n  [] tst nested\n- [ ] tst dash\n');
  click('tst 1');
  click('tst space');
  click('tst nested');
  expect(doc.getText()).toBe('[-] tst 1\n[-] tst space\n  [-] tst nested\n- [ ] tst dash\n');
  mv.destroy?.();
});

it('a written [] marker toggles in place', () => {
  expect(toggleTaskLine('- [] Land the lamp <id:9>\n', '9')).toEqual({
    text: '- [-] Land the lamp <id:9>\n',
    from: 'open',
    to: 'pending',
  });
});

it('ticking [] in the Map edits that line and does not add one', () => {
  const { doc, host, mv, click } = mount(TEXT);
  click('QA task empty brackets');
  expect(doc.getText()).toBe(AFTER_EMPTY);
  const again = parse(doc.getText());
  expect(again.nodes).toHaveLength(1);
  expect(again.nodes[0]!.children).toHaveLength(3);
  expect(host.querySelectorAll('.map-node')).toHaveLength(4);
  mv.destroy?.();
});

it('duplicate labels: the clicked line toggles, and a second tick moves on', () => {
  const dup = `- root
  - [] same
  - [] same
`;
  const { doc, mv, click } = mount(dup);
  click('same', 1);
  expect(doc.getText()).toBe(`- root
  - [] same
  - [-] same
`);
  click('same', 1);
  expect(doc.getText()).toBe(`- root
  - [] same
  - [x] same
`);
  mv.destroy?.();
});

it('a line inserted above the root does not steal the tick', () => {
  const above = `- inserted
- QA checkbox test 2026-11-02
  - [] QA task empty brackets
  - [ ] QA task space brackets
`;
  const { doc, mv, click } = mount(above);
  click('QA task empty brackets');
  expect(doc.getText()).toBe(`- inserted
- QA checkbox test 2026-11-02
  - [-] QA task empty brackets
  - [ ] QA task space brackets
`);
  const roots = parse(doc.getText()).nodes;
  expect(roots.map((n) => n.title)).toEqual(['inserted', 'QA checkbox test 2026-11-02']);
  mv.destroy?.();
});

const CTX = { noteId: '9', ownerId: '' };

it('folding a branch inside a submap writes (+) and stays folded after reload', async () => {
  clearKeys();
  setSealCipher('a256gcm');
  const src = parse(`- Shelf <id:1>\n- Sealed branch <id:4>\n  - Week\n    - Monday\n`);
  const key = await createKey(src, 'pw', { kid: 'k1' });
  await sealBranch(src, src.nodes.find((n) => n.id === '4')!, key.kid, CTX);
  const sealed = serialize(src);
  clearKeys();
  const doc = createOutlineDoc({ text: sealed, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 60000 });
  const region = doc.regionFor('4');
  await doc.sessions.open(region, 'pw');
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 900 });
  Object.defineProperty(host, 'clientHeight', { value: 700 });
  document.body.appendChild(host);
  const layout: { version: number; nodes: Record<string, unknown>; _source: string } = { version: 1, nodes: {}, _source: 'auto-pack' };
  const mv = createMapView(host, {
    getDoc: () => parse(doc.getText()),
    setDoc: () => {},
    getLayout: () => layout,
    getFocusId: () => '',
    setFocusId: () => {},
    ...doc.mapOptions(),
  });
  mv.paint();
  await tick();
  const week = [...host.querySelectorAll('.map-region-node')].find(
    (g) => !g.classList.contains('map-region-root') && (g.textContent || '').includes('Week'),
  );
  expect(week, 'Week is drawn inside the open submap').toBeTruthy();
  week!.querySelector('.map-fold-hit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const saved = await doc.serialise();
  expect(saved.text).not.toContain('Monday');
  clearKeys();
  const again = createOutlineDoc({ text: saved.text, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 60000 });
  await again.sessions.open(again.regionFor('4'), 'pw');
  const view = again.sessions.get(again.regionFor('4')).doc!;
  const node = (function find(list: typeof view.nodes): (typeof view.nodes)[number] | null {
    for (const n of list || []) {
      if (n.title === 'Week') return n;
      const h = n.children ? find(n.children) : null;
      if (h) return h;
    }
    return null;
  })(view.nodes);
  expect(node?.id).toBeTruthy();
  expect(isCollapsed(view, node!.id!)).toBe(true);
  expect(serialize(view)).toContain('Week (+)');
  expect(serialize(view)).toContain('Monday');
  mv.destroy?.();
  doc.destroy();
  again.destroy();
});
