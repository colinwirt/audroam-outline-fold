// @vitest-environment happy-dom
// Handoff #42394: a tick must not open authored (+) branches, and only a
// primary click on the fold handle folds. Id-less lines (session ids).
import { expect, it } from 'vitest';
import { createMapView, parse, serialize, type OutlineFoldDoc, type OutlineNode } from '../src/index.js';
// @ts-ignore
import { mountOutlineFold } from './_host.mjs';

const TEXT = [
  '- Section',
  '  - [ ] Q3.1 (+)',
  '    - [ ] Hidden',
  '  - [ ] Q3.3',
  '    - [ ] Evidence',
  '    - [ ] Notes',
  '  - [ ] Q3.2 (+)',
  '    - [ ] Screenshots',
].join('\n');

/** Pre-order identity: session id, task, and whether a parent is collapsed. */
function identity(doc: OutlineFoldDoc): string {
  const lines: string[] = [];
  const walk = (list?: OutlineNode[]) => {
    for (const n of list ?? []) {
      const fold = n.children?.length ? (n.id && doc.fold.ids.includes(n.id) ? 'c' : 'o') : '-';
      lines.push(`${n.id ?? ''}|${n.autoId ? 's' : 'a'}|${n.task ?? ''}|${fold}|${n.title}`);
      walk(n.children);
    }
  };
  walk(doc.nodes);
  return lines.join('\n');
}

function mount(text = TEXT) {
  document.body.innerHTML = '';
  const fh = mountOutlineFold({ text, debounceMs: 60_000, wipeOnPagehide: false });
  let view = parse(fh.getText(), { sessionIds: true });
  const sources: string[] = [];
  fh.doc.on('change', (e: { source: string }) => {
    sources.push(e.source);
    // Host re-parses every edit that is not a map edit (keepViewAfterParse).
    if (e.source !== 'map') view = parse(fh.getText(), { sessionIds: true });
  });
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 900 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  host.getBoundingClientRect = () =>
    ({
      left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, x: 0, y: 0,
      toJSON() { return {}; },
    }) as DOMRect;
  document.body.appendChild(host);
  const layout = { version: 1, nodes: {} as Record<string, unknown>, _source: 'auto-pack' };
  let focus = '';
  const mv = createMapView(host, {
    ...fh.mapOptions(),
    getDoc: () => view,
    setDoc: (d) => { view = d; },
    getLayout: () => layout as never,
    getFocusId: () => focus,
    setFocusId: (id) => { focus = id; },
    onChange: () => mv.paint(),
    gestures: { labelTextSelect: () => false },
  });
  mv.paint();
  mv.bindGestures();
  mv.bindKeyboard();
  const node = (title: string) =>
    [...host.querySelectorAll('.map-node')].find((n) => (n.textContent || '').includes(title)) ?? null;
  const pillX = (title: string) => Number(node(title)?.querySelector('.map-pill')?.getAttribute('x'));
  return { host, mv, fh, sources, node, pillX, getView: () => view };
}

const WITH_LAYOUT_LIST = [
  '- Section <cloud> <id:s3>',
  '  - Setup <id:setup>',
  '    - Colab link',
  '  - Q3.1 <id:q31> (+)',
  '    - Evidence <id:34>',
  '  - Q3.2 <id:q32> (+)',
  '    - Screenshots <id:39>',
  '  - Q3.3 <id:q33>',
  '    - child',
  '',
  '--- layout ---',
  'fold+: s3, q32',
  '---',
].join('\n');

it('a fold+: list does not open a line that is marked (+)', () => {
  const doc = parse(WITH_LAYOUT_LIST, { sessionIds: true });
  expect(doc.fold.mode).toBe('-');
  expect(doc.fold.ids).toEqual(['q31', 'q32']);
  const { node } = mount(WITH_LAYOUT_LIST);
  expect(node('Setup')?.getAttribute('aria-expanded')).toBe('true');
  expect(node('Colab link')).toBeTruthy();
  expect(node('Q3.1')?.getAttribute('aria-expanded')).toBe('false');
  expect(node('Evidence')).toBeNull();
  expect(node('Q3.2')?.getAttribute('aria-expanded')).toBe('false');
  expect(node('Screenshots')).toBeNull();
  expect(node('Q3.3')?.getAttribute('aria-expanded')).toBe('true');
  expect(node('child')).toBeTruthy();
});

it('a fresh parse of the same text mints the same session ids and folds', () => {
  const a = parse(TEXT, { sessionIds: true });
  const b = parse(TEXT, { sessionIds: true });
  expect(identity(b)).toBe(identity(a));
  expect(a.fold.ids.length).toBeGreaterThan(0);
  expect(identity(a)).toContain('Q3.1');
  expect(identity(a).split('\n').find((l) => l.includes('Q3.1'))).toMatch(/\|c\|/);
});

function row(sig: string, title: string): string | undefined {
  return sig.split('\n').find((l) => l.endsWith(`|${title}`));
}

it('a checkbox tick keeps authored (+) folds collapsed in the map and the text', () => {
  const { fh, sources, node, getView } = mount();
  expect(node('Q3.1')?.getAttribute('aria-expanded')).toBe('false');
  expect(node('Hidden')).toBeNull();
  expect(node('Q3.2')?.getAttribute('aria-expanded')).toBe('false');
  const before = identity(parse(fh.getText(), { sessionIds: true }));
  const evidence = node('Evidence')!.querySelector('.map-task-hit')!;
  expect(evidence.getAttribute('aria-checked')).toBe('false');
  fh.markView();
  evidence.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  expect(sources).toContain('map');
  expect(sources.every((s) => s === 'map')).toBe(true);
  expect(node('Q3.1')?.getAttribute('aria-expanded')).toBe('false');
  expect(node('Q3.2')?.getAttribute('aria-expanded')).toBe('false');
  expect(node('Hidden')).toBeNull();
  expect(node('Screenshots')).toBeNull();
  expect(node('Evidence')!.querySelector('.map-task-hit')!.getAttribute('aria-checked')).toBe('mixed');
  const text = fh.getText();
  expect(text).toContain('- [ ] Q3.1 (+)');
  expect(text).toContain('- [ ] Q3.2 (+)');
  expect(text).toContain('- [-] Evidence');
  expect(node('Q3.3')?.getAttribute('aria-expanded')).toBe('true');
  // Host write-back (commitView) then a reload parse. Session ids are not stored.
  // Two fresh parses of the written text must agree, and Q3.1 / Q3.2 keep the
  // same session id and collapsed mark they had before the tick.
  fh.commitView(getView());
  const written = fh.getText();
  expect(written).toContain('Q3.1 (+)');
  expect(written).toContain('Q3.2 (+)');
  expect(written).toContain('[-] Evidence');
  const once = parse(written, { sessionIds: true });
  const twice = parse(written, { sessionIds: true });
  expect(identity(twice)).toBe(identity(once));
  expect(row(identity(once), 'Q3.1')).toBe(row(before, 'Q3.1'));
  expect(row(identity(once), 'Q3.2')).toBe(row(before, 'Q3.2'));
  expect(row(identity(once), 'Evidence')).toContain('|pending|');
});

it('first paint already shares a column, and a tick does not move it', () => {
  const { node, pillX } = mount();
  const x1 = pillX('Q3.1');
  const x3 = pillX('Q3.3');
  const x2 = pillX('Q3.2');
  expect(x1).toBeGreaterThan(0);
  expect(x3).toBe(x1);
  expect(x2).toBe(x1);
  const evidence = node('Evidence')!.querySelector('.map-task-hit')!;
  evidence.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  expect(pillX('Q3.1')).toBe(x1);
  expect(pillX('Q3.3')).toBe(x1);
  expect(pillX('Q3.2')).toBe(x1);
  for (const g of document.querySelectorAll<SVGGElement>('.map-node')) {
    expect(g.style.transform || '').toBe('');
  }
});

it('only a primary fold click toggles; right-click and the click after the menu do not', () => {
  const { host, node } = mount();
  const hit = () => node('Q3.3')!.querySelector('.map-fold-hit')!;
  expect(node('Q3.3')!.getAttribute('aria-expanded')).toBe('true');
  hit().dispatchEvent(new MouseEvent('click', { bubbles: true, button: 2, clientX: 20, clientY: 20 }));
  expect(node('Q3.3')!.getAttribute('aria-expanded')).toBe('true');
  hit().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2, clientX: 20, clientY: 20 }));
  expect(host.querySelector('.map-level-menu')).toBeTruthy();
  expect(node('Q3.3')!.getAttribute('aria-expanded')).toBe('true');
  hit().dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, clientX: 20, clientY: 20 }));
  expect(node('Q3.3')!.getAttribute('aria-expanded')).toBe('true');
  hit().dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, clientX: 20, clientY: 20 }));
  expect(node('Q3.3')!.getAttribute('aria-expanded')).toBe('false');
  expect(node('Evidence')).toBeNull();
  hit().dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, clientX: 20, clientY: 20 }));
  expect(node('Q3.3')!.getAttribute('aria-expanded')).toBe('true');
  expect(node('Evidence')).toBeTruthy();
});

it('a hold that opens the level menu does not fold on the following click', async () => {
  const { host, node } = mount();
  const hit = node('Q3.3')!.querySelector('.map-fold-hit')!;
  const down = new PointerEvent('pointerdown', {
    bubbles: true, clientX: 30, clientY: 40, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse',
  });
  hit.dispatchEvent(down);
  await new Promise((r) => setTimeout(r, 520));
  expect(host.querySelector('.map-level-menu')).toBeTruthy();
  hit.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, clientX: 30, clientY: 40, button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse',
  }));
  hit.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, clientX: 30, clientY: 40 }));
  expect(node('Q3.3')!.getAttribute('aria-expanded')).toBe('true');
  expect(node('Evidence')).toBeTruthy();
});

it('level 1 under the root shows exactly one level, and the text (+) matches', () => {
  const { host, node, getView } = mount();
  host.tabIndex = 0;
  host.focus();
  node('Section')!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  host.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
  expect(node('Section')!.getAttribute('aria-expanded')).toBe('true');
  expect(node('Q3.1')!.getAttribute('aria-expanded')).toBe('false');
  expect(node('Q3.3')!.getAttribute('aria-expanded')).toBe('false');
  expect(node('Q3.2')!.getAttribute('aria-expanded')).toBe('false');
  expect(node('Evidence')).toBeNull();
  expect(node('Hidden')).toBeNull();
  expect(node('Screenshots')).toBeNull();
  const text = serialize(getView());
  expect(text).toContain('Q3.1 (+)');
  expect(text).toContain('Q3.3 (+)');
  expect(text).toContain('Q3.2 (+)');
  expect(text).not.toMatch(/^-\s+Section.*\(\+\)/m);
});
