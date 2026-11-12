// @vitest-environment happy-dom
/**
 * 0.7.1 host bug: the Map style toolbar (Cloud, Icon, Fill, Colour) stayed
 * disabled on a focused pill until the node menu opened. Focus emits the
 * session view key (`__sid-N`); a host that looks up `node.id === focusId`
 * gets null (id-less nodes have no authored id; authored ids live on
 * `node.id`, not the view key). The node menu already resolves via
 * `nodeForKey` / the session index. The toolbar must use that same lookup
 * (`focusedNode()` / `nodeForKey(getFocusId())`) on focus change.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parse,
  serialize,
  createMapView,
  setExpandLevel,
  isViewKey,
  type OutlineFoldDoc,
  type MapViewHandle,
} from '../src/index.js';

const TEXT = [
  '- Site notes',
  '  - Has an id <id:27>',
  '  - Q1.1 No id sibling',
  '  - Another id <id:3>',
  '    - Nested child',
  '',
].join('\n');

/** The host bug: walk `node.id` only, so a session key never hits. */
function findByAuthoredId(nodes: { id?: string; children?: unknown[]; title?: string }[], id: string): unknown {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const hit = findByAuthoredId(n.children as typeof nodes, id);
      if (hit) return hit;
    }
  }
  return null;
}

let lastFocusEmit = '';
const mounts: HTMLElement[] = [];

function mount(text = TEXT): {
  doc: () => OutlineFoldDoc;
  setDoc: (d: OutlineFoldDoc) => void;
  host: HTMLElement;
  mv: MapViewHandle;
  focus: () => string;
} {
  let doc = parse(text);
  let focus = '';
  lastFocusEmit = '';
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 800 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  document.body.appendChild(host);
  mounts.push(host);
  const layout: { version: number; nodes: Record<string, unknown>; _source: string } = {
    version: 1,
    nodes: {},
    _source: 'auto-pack',
  };
  const mv = createMapView(host, {
    getDoc: () => doc,
    setDoc: (d) => {
      doc = d;
    },
    getLayout: () => layout,
    getFocusId: () => focus,
    setFocusId: (id) => {
      focus = id;
    },
    onFocusChange: (id) => {
      lastFocusEmit = id;
    },
    onChange: () => mv.paint(),
    nodeMenu: true,
    nodeColours: true,
  });
  mv.paint();
  return {
    doc: () => doc,
    setDoc: (d) => {
      doc = d;
    },
    host,
    mv,
    focus: () => focus,
  };
}

afterEach(() => {
  for (const h of mounts) h.remove();
  mounts.length = 0;
});

function titles(doc: OutlineFoldDoc): string[] {
  const out: string[] = [];
  const walk = (list: OutlineFoldDoc['nodes']) => {
    for (const n of list) {
      out.push(n.title);
      if (n.children) walk(n.children);
    }
  };
  walk(doc.nodes);
  return out;
}

describe('style toolbar: resolve the focused node from the session key', () => {
  it('id-less node: focus is __sid-N; node.id lookup misses; focusedNode / nodeForKey hit', () => {
    const { mv, doc } = mount();
    const q = titles(doc()).indexOf('Q1.1 No id sibling');
    expect(q).toBeGreaterThanOrEqual(0);
    // Focus the id-less node by its view key from the index.
    const idx = mv.sessionIndex();
    const keys = idx.order();
    const key = keys[q];
    expect(isViewKey(key)).toBe(true);
    const node = idx.nodeOf(key)!;
    expect(node.title).toBe('Q1.1 No id sibling');
    expect(node.id).toBeFalsy();

    mv.setFocus(key);
    mv.paint();

    const focus = mv.sessionIndex().resolve(key) || key;
    // What the host sees from getFocusId / onFocusChange after 0.7.1:
    expect(isViewKey(lastFocusEmit) || isViewKey(focus)).toBe(true);
    // Legacy host styleNodeFor(findNode by node.id) fails — this is the bug.
    expect(findByAuthoredId(doc().nodes, lastFocusEmit || focus)).toBeNull();
    expect(findByAuthoredId(doc().nodes, key)).toBeNull();
    // Menu path / the fix: session-index lookup.
    const found = mv.focusedNode();
    expect(found).toBeTruthy();
    expect(found!.title).toBe('Q1.1 No id sibling');
    expect(mv.nodeForKey(key)).toBe(found);
    expect(mv.nodeForKey(lastFocusEmit || key)?.title).toBe('Q1.1 No id sibling');
  });

  it('authored-id node: session focus still needs nodeForKey, not node.id === __sid-N', () => {
    const { mv, doc } = mount();
    const key = mv.sessionIndex().resolve('27');
    expect(key && isViewKey(key)).toBeTruthy();
    mv.setFocus('27');
    mv.paint();
    const focusEmit = lastFocusEmit;
    expect(isViewKey(focusEmit)).toBe(true);
    expect(findByAuthoredId(doc().nodes, focusEmit)).toBeNull();
    // Authored lookup still works if the host happens to have '27', but
    // getFocusId() no longer returns '27'.
    expect(findByAuthoredId(doc().nodes, '27')).toBeTruthy();
    const found = mv.focusedNode();
    expect(found?.title).toBe('Has an id');
    expect(mv.nodeForKey(focusEmit)).toBe(found);
    expect(mv.nodeForKey('27')).toBe(found);
  });

  it('onFocusChange emits the session key; a toolbar can enable from focusedNode() alone, without opening the menu', () => {
    const { mv } = mount();
    const qKey = mv.sessionIndex().order().find((k) => mv.nodeForKey(k)?.title === 'Q1.1 No id sibling')!;
    mv.setFocus(qKey);
    mv.paint();
    expect(isViewKey(lastFocusEmit)).toBe(true);
    // Opening the menu is not required for enablement.
    expect(mv.focusedNode()?.title).toBe('Q1.1 No id sibling');
    expect(document.querySelector('.map-node-menu')).toBeNull();
  });

  it('after a remote serialize+reparse, session focus still resolves (id-less and authored)', () => {
    const h = mount();
    const qKey = h.mv.sessionIndex().order().find((k) => h.mv.nodeForKey(k)?.title === 'Q1.1 No id sibling')!;
    const aKey = h.mv.sessionIndex().resolve('27')!;
    h.mv.setFocus(qKey);
    h.mv.paint();
    expect(h.mv.focusedNode()?.title).toBe('Q1.1 No id sibling');

    const next = parse(serialize(h.doc()));
    h.setDoc(next);
    h.mv.paint();
    // Line-map carry keeps the view key on the new node objects.
    expect(h.mv.nodeForKey(qKey)?.title).toBe('Q1.1 No id sibling');
    expect(h.mv.nodeForKey(aKey)?.title).toBe('Has an id');
    expect(h.mv.focusedNode()?.title).toBe('Q1.1 No id sibling');
  });

  it('after expand/collapse, focusedNode still resolves the session key', () => {
    const h = mount();
    const parentKey = h.mv.sessionIndex().order().find((k) => h.mv.nodeForKey(k)?.title === 'Another id')!;
    const childKey = h.mv.sessionIndex().order().find((k) => h.mv.nodeForKey(k)?.title === 'Nested child')!;
    h.mv.setFocus(parentKey);
    h.mv.paint();
    expect(h.mv.focusedNode()?.title).toBe('Another id');

    const collapsed = setExpandLevel(h.doc(), 1);
    h.setDoc(collapsed);
    h.mv.paint();
    // Parent still focused; child is folded away on the map but the index still has it.
    expect(h.mv.focusedNode()?.title).toBe('Another id');
    expect(h.mv.nodeForKey(childKey)?.title).toBe('Nested child');

    const expanded = setExpandLevel(h.doc(), '*');
    h.setDoc(expanded);
    h.mv.paint();
    h.mv.setFocus(childKey);
    h.mv.paint();
    expect(h.mv.focusedNode()?.title).toBe('Nested child');
    expect(isViewKey(lastFocusEmit)).toBe(true);
    expect(findByAuthoredId(h.doc().nodes, lastFocusEmit)).toBeNull();
  });
});
