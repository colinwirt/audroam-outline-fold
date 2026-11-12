/**
 * 0.6.6 session index: every node in a visualisation session has a fresh view key
 * (`__sid-N`), authored ids included. Fixed refs (`<id:N>`, `<r:N>` targets, host focus)
 * resolve through the index; lines are derived from keys, never keys themselves.
 * Invented data.
 */
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  parse, serialize, toHtml, createMapView, createOutlineDoc, createSessionIndex,
  isViewKey, isBlankNode, parsedLineOf,
} from '../src/index.js';
import type { OutlineFoldDoc, OutlineNode } from '../src/index.js';

const each = (l: OutlineNode[] | undefined, f: (n: OutlineNode) => void): void => { for (const n of l ?? []) { f(n); each(n.children, f); } };
const byTitle = (d: { nodes: OutlineNode[] }, t: string): OutlineNode => { let hit: OutlineNode | undefined; each(d.nodes, (n) => { if (!hit && n.title === t) hit = n; }); return hit!; };
const tick = () => new Promise((r) => setTimeout(r, 20));

function mount(getDoc: () => OutlineFoldDoc, extra: Record<string, unknown> = {}) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 1200 });
  Object.defineProperty(host, 'clientHeight', { value: 800 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
  const state = { focus: '' };
  let cur: OutlineFoldDoc | null = null;
  const mv: any = (createMapView as any)(host, {
    getDoc: () => cur ?? getDoc(),
    setDoc: (d: OutlineFoldDoc) => { cur = d; },
    getLayout: () => layout,
    getFocusId: () => state.focus,
    setFocusId: (id: string) => { state.focus = id; },
    nodeColours: true, nodeIcons: true, canPersistWidths: true, canMintIds: () => true,
    ...extra,
  });
  mv.paint();
  const pills = () => [...host.querySelectorAll('.map-node')] as Element[];
  const pill = (title: string) => pills().find((g) => (g.textContent || '').includes(title)) ?? null;
  return { host, mv, layout, state, pills, pill, cur: () => cur ?? getDoc() };
}

describe('session index', () => {
  it('gives every node a view key, authored ids included, and resolves fixed refs both ways', () => {
    const d = parse('- Alpha <id:7>\n  - beta\n  - Gamma <id:g>\n- delta\n');
    const idx = createSessionIndex();
    idx.sync(d);
    const keys = idx.order();
    expect(keys).toHaveLength(4);
    expect(keys.every(isViewKey)).toBe(true);
    expect(new Set(keys).size).toBe(4);
    const alpha = byTitle(d, 'Alpha');
    expect(idx.keyOf(alpha)).not.toBe('7');
    expect(idx.resolve('7')).toBe(idx.keyOf(alpha));
    expect(idx.nodeOf('7')).toBe(alpha);
    expect(idx.refOf(idx.keyOf(alpha))).toBe('7');
    expect(idx.fixedOf(idx.keyOf(alpha))).toBe('7');
    expect(idx.publicId(idx.keyOf(byTitle(d, 'beta')))).toBe(idx.keyOf(byTitle(d, 'beta')));
    // A place number is not a key: '2' names nothing here.
    expect(idx.resolve('2')).toBeNull();
    // Deterministic for the same text in a fresh session.
    const again = createSessionIndex();
    again.sync(parse('- Alpha <id:7>\n  - beta\n  - Gamma <id:g>\n- delta\n'));
    expect(again.order()).toEqual(keys);
  });

  it('a jump target (<r:N>) resolves to the view key of the line with <id:N>', () => {
    const d = parse('- Plants <id:plants>\n  - fern\n- Rota <r:plants>\n');
    const idx = createSessionIndex();
    idx.sync(d);
    const rota = byTitle(d, 'Rota');
    const target = rota.links!.find((l) => l.kind === 'jump')!.target;
    expect(idx.nodeOf(idx.resolve(target)!)!.title).toBe('Plants');
  });

  it('Map jump chip focuses the target pill by its view key; the host sees the fixed id', async () => {
    const d = parse('- Plants <id:plants>\n  - fern\n- Rota <r:plants> <id:rota>\n');
    const { host, mv, state } = mount(() => d);
    await tick();
    const chip = host.querySelector('.map-jump-hit[data-jump="plants"]')!;
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.focus).toBe('plants');
    expect(mv.viewKey('plants')).toBe(mv.viewKey(byTitle(d, 'Plants')));
    mv.destroy?.();
  });

  it('a duplicate authored id never shares a key: first line owns the ref, styles stay apart', async () => {
    const text = '- One <id:5>\n- Two <id:5>\n';
    const d = parse(text);
    const idx = createSessionIndex();
    idx.sync(d);
    const [one, two] = d.nodes;
    expect(idx.keyOf(one!)).not.toBe(idx.keyOf(two!));
    expect(idx.resolve('5')).toBe(idx.keyOf(one!));
    expect(idx.duplicates().get('5')).toEqual([idx.keyOf(one!), idx.keyOf(two!)]);
    expect(idx.publicId(idx.keyOf(two!))).toBe(idx.keyOf(two!));

    const { host, mv, cur } = mount(((d) => () => d)(parse(text)));
    await tick();
    const sids = [...host.querySelectorAll('.map-node')].map((g) => g.getAttribute('data-sid'));
    expect(sids).toHaveLength(2);
    expect(new Set(sids).size).toBe(2);
    // Style the second line by its own key: the first line is untouched.
    const twoKey = mv.viewKey(cur().nodes[1]!);
    mv.setNodeIcon(twoKey, '🌲');
    expect(cur().nodes[1]!.icon).toBe('🌲');
    expect(cur().nodes[0]!.icon).toBeUndefined();
    mv.destroy?.();
  });

  it('fold by view key lands on that line; serialize writes (+) and no temp id', async () => {
    const text = '- Root <id:r>\n  - Week\n    - Monday\n  - Month\n    - June\n';
    const { host, mv, cur } = mount(((d) => () => d)(parse(text)));
    await tick();
    const week = [...host.querySelectorAll('.map-node')].find((g) => (g.textContent || '').includes('Week'))!;
    week.querySelector('.map-fold-hit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const out = serialize(cur());
    expect(out).toContain('  - Week (+)\n');
    expect(out).toContain('  - Month\n');
    expect(out).not.toMatch(/__sid-|__tmp-|__pos-/);
    // Week's pill keeps its key; Monday is no longer drawn.
    mv.paint();
    await tick();
    const keys = [...host.querySelectorAll('.map-node')].map((g) => g.textContent || '');
    expect(keys.some((t) => t.includes('Monday'))).toBe(false);
    expect(keys.some((t) => t.includes('June'))).toBe(true);
    mv.destroy?.();
  });

  it('Levels… and openLevelMenu resolve a view key to the node id', async () => {
    const text = '- Root <id:r>\n  - Week\n    - Monday\n  - Month\n    - June\n';
    const { host, mv, cur } = mount(((d) => () => d)(parse(text)), { nodeMenu: true });
    await tick();
    const week = byTitle(cur(), 'Week');
    const key = mv.viewKey(week);
    expect(key).toMatch(/^__sid-/);
    expect(week.id).toBeUndefined();
    const labels = (mv.nodeMenuEntries(key) as { label: string }[]).map((e) => e.label);
    expect(labels).toContain('Levels…');
    expect(mv.openLevelMenu(key)).toBe(true);
    expect(host.querySelector('.map-level-menu')).not.toBeNull();
    // Apply "Fold" under Week via the resolved id; Monday hides, Month stays.
    const foldItem = [...host.querySelectorAll('.map-level-menu [data-level]')].find((b) => b.getAttribute('data-level') === '0');
    expect(foldItem).toBeTruthy();
    (foldItem as HTMLElement).click();
    await tick();
    const out = serialize(cur());
    expect(out).toContain('  - Week (+)\n');
    expect(out).toContain('  - Month\n');
    expect(out).not.toMatch(/__sid-|__tmp-|__pos-/);
    mv.destroy?.();
  });

  it('round trip: style and icon writes through the Map never serialize a view or session key', async () => {
    const text = '- A <id:a>\n  - b\n    - c\n- d\n';
    const { mv, cur } = mount(((d) => () => d)(parse(text)));
    await tick();
    const b = byTitle(cur(), 'b');
    mv.setNodeColour(mv.viewKey(b), 'creek');
    mv.setNodeIcon(mv.viewKey(byTitle(cur(), 'd')), '🌲');
    const out = serialize(cur());
    expect(out).not.toMatch(/__sid-|__tmp-|__pos-/);
    const re = parse(out);
    expect(byTitle(re, 'b').layout?.color).toBe('creek');
    expect(byTitle(re, 'd').icon ?? byTitle(re, 'd').layout?.icon).toBe('🌲');
    expect(byTitle(re, 'A').layout?.color).toBeUndefined();
    mv.destroy?.();
  });
});

describe('lines are derived from view keys', () => {
  it('parse records 0-based text lines (frontmatter counted); keyAtLine is the inverse', () => {
    const text = '---\nfold-: \n---\n- A\n\n  - B\n- C\n';
    const d = parse(text);
    expect(parsedLineOf(byTitle(d, 'A'))).toBe(3);
    expect(parsedLineOf(byTitle(d, 'B'))).toBe(5);
    expect(parsedLineOf(byTitle(d, 'C'))).toBe(6);
    const idx = createSessionIndex();
    idx.sync(d);
    expect(idx.keyAtLine(5)).toBe(idx.keyOf(byTitle(d, 'B')));
    expect(idx.lineOf(idx.keyOf(byTitle(d, 'C')))).toBe(6);
  });

  it('inserting a line above keeps every key on its node; the key → line map moves', () => {
    const idx = createSessionIndex();
    const a = parse('- one\n- two\n  - three\n');
    idx.sync(a);
    const k2 = idx.keyOf(byTitle(a, 'two'));
    const k3 = idx.keyOf(byTitle(a, 'three'));
    expect(idx.lineOf(k2)).toBe(1);
    const b = parse('- zero\n- one\n- two\n  - three\n');
    idx.sync(b);
    expect(idx.keyOf(byTitle(b, 'two'))).toBe(k2);
    expect(idx.keyOf(byTitle(b, 'three'))).toBe(k3);
    expect(idx.lineOf(k2)).toBe(2);
    expect(idx.keyAtLine(3)).toBe(k3);
    expect(isViewKey(idx.keyOf(byTitle(b, 'zero')))).toBe(true);
    expect(idx.order()).not.toContain(undefined);
  });

  it('editor → Map: a line inserted above keeps the Map selection and the style on the same node', async () => {
    const TEXT = '- Shelf\n  - lamp <color:moss>\n  - fern\n';
    const doc = createOutlineDoc({ text: TEXT, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 60000 });
    const { host, mv, state } = mount(() => doc.root(), { ...doc.mapOptions() });
    await tick();
    const lampKey = mv.viewKey(byTitle(doc.root(), 'lamp'));
    mv.setFocus(lampKey);
    expect(doc.lineOf(lampKey)).toBe(1);
    // The user types a new line above, in the text pane.
    doc.setText('- Notes\n' + TEXT, { source: 'text' });
    mv.paint();
    await tick();
    const lamp = byTitle(doc.root(), 'lamp');
    expect(mv.viewKey(lamp)).toBe(lampKey);
    expect(doc.lineOf(lampKey)).toBe(2);
    expect(doc.keyAtLine(2)).toBe(lampKey);
    // Selection: the host's focus id still names lamp, and lamp's pill is the focused one.
    expect(mv.viewKey(state.focus)).toBe(lampKey);
    const focused = host.querySelector('.map-node.is-focused')!;
    expect(focused.getAttribute('data-sid')).toBe(lampKey);
    expect(focused.textContent).toContain('lamp');
    // Style: the colour is still drawn on lamp, not on the line now at lamp's old place.
    const lampPill = host.querySelector(`.map-node[data-sid="${lampKey}"]`)!;
    expect(lampPill.getAttribute('class')).toContain('colour-moss');
    const shelf = [...host.querySelectorAll('.map-node')].find((g) => (g.textContent || '').includes('Shelf'))!;
    expect(shelf.getAttribute('class')).not.toContain('colour-moss');
    mv.destroy?.();
  });
});

describe('blank lines', () => {
  it('a blank `- ` line is not on the Map; typing into it shows the same node (same view key)', async () => {
    const TEXT = '- Root\n  - first\n  - \n  - last\n';
    const doc = createOutlineDoc({ text: TEXT, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 60000 });
    const { host, mv } = mount(() => doc.root(), { ...doc.mapOptions() });
    await tick();
    const blank = doc.root().nodes[0]!.children![1]!;
    expect(isBlankNode(blank)).toBe(true);
    const blankKey = mv.viewKey(blank);
    expect(host.querySelectorAll('.map-node')).toHaveLength(3);
    expect(host.querySelector(`.map-node[data-sid="${blankKey}"]`)).toBeNull();
    expect(doc.lineOf(blankKey)).toBe(2);
    // Text typed on that line in the editor.
    doc.setText(TEXT.replace('  - \n', '  - middle\n'), { source: 'text' });
    mv.paint();
    await tick();
    const middle = doc.root().nodes[0]!.children![1]!;
    expect(middle.title).toBe('middle');
    expect(mv.viewKey(middle)).toBe(blankKey);
    const pill = host.querySelector(`.map-node[data-sid="${blankKey}"]`)!;
    expect(pill).not.toBeNull();
    expect(pill.textContent).toContain('middle');
    expect(host.querySelectorAll('.map-node')).toHaveLength(4);
    mv.destroy?.();
  });

  it('a blank line is vertical space in the Outline: a spacer, not a tree row', () => {
    const html = toHtml(parse('- Root <id:r>\n  - first\n  - \n  - last\n'));
    const el = document.createElement('div');
    el.innerHTML = html;
    const spacer = el.querySelector('li.of-spacer')!;
    expect(spacer).not.toBeNull();
    expect(spacer.getAttribute('role')).toBe('none');
    expect(spacer.getAttribute('aria-hidden')).toBe('true');
    expect(spacer.textContent).toBe('');
    // It sits between its siblings, and is not a treeitem (keyboard and readers skip it).
    const kids = [...el.querySelectorAll('li')].map((li) => li.classList.contains('of-spacer') ? '·' : (li.textContent || '').trim().slice(0, 5));
    expect(kids.indexOf('·')).toBeGreaterThan(kids.findIndex((t) => t.startsWith('first')));
    expect(kids.indexOf('·')).toBeLessThan(kids.findIndex((t) => t.startsWith('last')));
    const items = [...el.querySelectorAll('[role="treeitem"]')].map((li) => li.getAttribute('data-blank'));
    expect(items.includes('true')).toBe(false);
    // The text keeps the blank line.
    expect(serialize(parse('- Root <id:r>\n  - first\n  - \n  - last\n'))).toContain('  - \n');
  });
});
