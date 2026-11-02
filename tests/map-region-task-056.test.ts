// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { parse, createMapView, TASK_LEAD, TASK_INSET, TASK_BOX, TASK_GAP, PILL_PAD_X } from '../src/index.js';

// Invented fixture. An open sealed cloud should pad a checkbox like a main pill, and a
// selected inner pill should show the same corner grip. Dragging that corner stores w.
async function mount() {
  const doc = parse(`- Test sealing <id:3>\n`);
  const sub = parse(`- header <id:3>\n  - [x] seems good <id:6>\n  - record <id:7>\n`);
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 800 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
  const widths: { id: string; w: number }[] = [];
  const mv: any = (createMapView as any)(host, {
    getDoc: () => doc,
    setDoc: () => {},
    getLayout: () => layout,
    getFocusId: () => '3',
    setFocusId: () => {},
    getRegionHosts: () => [{ id: 's:3', kind: 'sealed', anchor: '3', doc: sub, folded: false, kid: 'k1' }],
    onRegionWidth: (id: string, w: number) => { widths.push({ id, w }); },
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 20));
  return { host, mv, sub, widths };
}

const find = (host: HTMLElement, s: string) =>
  [...host.querySelectorAll('.map-region-node')].find((g) => (g.textContent || '').includes(s))!;

function num(el: Element, name: string): number {
  return Number(el.getAttribute(name));
}

it('a region task uses the main lead: 8px before the box, 6px before the caption', async () => {
  const { host, mv } = await mount();
  const task = find(host, 'seems good');
  const plain = find(host, 'record');
  const taskBody = task.querySelector('.map-region-body')!;
  const plainBody = plain.querySelector('.map-region-body')!;
  const taskText = task.querySelector('text')!;
  const plainText = plain.querySelector('text')!;
  const glyph = task.querySelector('.map-task-glyph')!;
  const gx = Number(glyph.getAttribute('transform')!.match(/translate\(([-\d.]+)/)![1]);
  expect(num(taskText, 'x') - num(taskBody, 'x')).toBe(TASK_LEAD);
  expect(gx - num(taskBody, 'x')).toBe(TASK_INSET + TASK_BOX / 2);
  expect(num(taskText, 'x') - (gx + TASK_BOX / 2)).toBe(TASK_GAP);
  expect(num(plainText, 'x') - num(plainBody, 'x')).toBe(PILL_PAD_X);
  expect(task.querySelector('.map-width-grip')!.getAttribute('opacity')).toBe('0');
  expect(plain.querySelector('.map-width-grip')).not.toBeNull();
  mv.destroy?.();
});

it('selecting an inner pill shows the corner grip, and a drag stores w', async () => {
  const { host, mv, sub, widths } = await mount();
  const task = find(host, 'seems good');
  task.querySelector('text')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(task.classList.contains('is-focused')).toBe(true);
  expect(task.querySelector('.map-width-grip')!.getAttribute('opacity')).toBe('1');
  expect(task.querySelector('.map-width-hit')!.getAttribute('pointer-events')).toBe('all');

  const body = task.querySelector('.map-region-body')!;
  const startW = Number(task.getAttribute('data-text-w'));
  body.getBoundingClientRect = () =>
    ({ left: 200, top: 200, right: 360, bottom: 244, width: 160, height: 44, x: 200, y: 200, toJSON() { return {}; } }) as DOMRect;
  mv.bindGestures();
  const down = new PointerEvent('pointerdown', { bubbles: true, clientX: 360, clientY: 244, button: 0, pointerId: 1, pointerType: 'mouse' });
  const before = num(body, 'x');
  const plainX = num(find(host, 'record').querySelector('.map-region-body')!, 'x');
  expect(before).toBeCloseTo(plainX, 0);
  host.dispatchEvent(down);
  host.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 420, clientY: 244, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse' }));
  const moved = find(host, 'seems good').querySelector('.map-region-body')!;
  const movedPlain = find(host, 'record').querySelector('.map-region-body')!;
  expect(num(moved, 'x')).toBeCloseTo(num(movedPlain, 'x'), 0);
  expect(num(moved, 'width')).toBeGreaterThan(num(body, 'width'));
  host.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 420, clientY: 244, button: 0, pointerId: 1, pointerType: 'mouse' }));

  const node = sub.nodes[0]!.children!.find((n) => n.id === '6')!;
  expect(node.layout?.w).toBe(widths[0]?.w);
  expect(node.layout?.w).toBeGreaterThanOrEqual(Math.max(120, startW));
  expect(widths[0]?.id).toBe(task.getAttribute('data-scoped-id'));
  mv.destroy?.();
});

it('a stored region width wraps the caption and stays on the column left edge', async () => {
  const doc = parse('- Test sealing <id:3>\n');
  const sub = parse('- record <id:7>\n- [x] Here is the sealed record that should wrap <id:6>\n');
  sub.nodes.find((n) => n.id === '6')!.layout = { w: 140 };
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 800 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
  const mv: any = (createMapView as any)(host, {
    getDoc: () => doc,
    setDoc: () => {},
    getLayout: () => layout,
    getFocusId: () => '3',
    setFocusId: () => {},
    getRegionHosts: () => [{ id: 's:3', kind: 'sealed', anchor: '3', doc: sub, folded: false, kid: 'k1' }],
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 20));
  const long = find(host, 'should wrap');
  const plain = find(host, 'record');
  const parts = [...long.querySelectorAll('tspan')].map((t) => t.textContent || '');
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.join(' ')).toContain('sealed');
  expect(num(long.querySelector('.map-region-body')!, 'x')).toBeCloseTo(num(plain.querySelector('.map-region-body')!, 'x'), 0);
  mv.destroy?.();
});

it('Fit, 1 line, siblings, Wide and Auto write the region child, not the host note', async () => {
  const doc = parse('- Test sealing <id:3>\n');
  const sub = parse('- header <id:3>\n  - [x] Here is the sealed record that should wrap onto more than one line <id:6>\n  - record <id:7>\n');
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 800 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
  const widths: { id: string; w: number | null; wAuto?: string | null }[] = [];
  let hostWrites = 0;
  const mv: any = (createMapView as any)(host, {
    getDoc: () => doc,
    setDoc: () => { hostWrites += 1; },
    getLayout: () => layout,
    getFocusId: () => '3',
    setFocusId: () => {},
    getRegionHosts: () => [{ id: 's:3', kind: 'sealed', anchor: '3', doc: sub, folded: false, kid: 'k1' }],
    onRegionWidth: (id: string, w: number | null, wAuto?: string | null) => { widths.push({ id, w, wAuto }); },
  });
  mv.paint();
  mv.bindGestures();
  await new Promise((r) => setTimeout(r, 20));
  const key = find(host, 'should wrap').getAttribute('data-scoped-id');
  expect(key).toBe('s:3:6');
  expect(mv.openWidthMenu(key)).toBe(true);
  expect(host.querySelector('.map-width-pop [data-choice="fit-text"]')).not.toBeNull();
  expect(host.querySelector('.map-width-pop [data-choice="auto"]')).not.toBeNull();
  const child = () => sub.nodes[0]!.children!.find((n) => n.id === '6')!;
  const sib = () => sub.nodes[0]!.children!.find((n) => n.id === '7')!;
  expect(mv.applyWidthPick(key, 'line')).toBe(true);
  expect(child().layout?.w).toBeGreaterThanOrEqual(120);
  expect(child().layout?.wAuto).toBe('single-line');
  expect(widths.at(-1)).toEqual({ id: 's:3:6', w: child().layout?.w, wAuto: 'single-line' });
  expect(mv.applyWidthPick(key, 'siblings')).toBe(true);
  expect(sib().layout?.wAuto).toBe('single-line');
  expect(widths.some((w) => w.id === 's:3:7' && w.wAuto === 'single-line')).toBe(true);
  expect(mv.applyWidthPick(key, 'level')).toBe(true);
  expect(sub.nodes[0]!.layout?.w).toBeUndefined();
  expect(mv.applyWidthPick(key, 'wide')).toBe(true);
  expect(child().layout?.w).toBeGreaterThanOrEqual(120);
  expect(child().layout?.wAuto).toBeUndefined();
  expect(mv.applyWidthPick(key, 'auto')).toBe(true);
  expect(child().layout?.w).toBeUndefined();
  expect(widths.at(-1)?.w).toBeNull();
  expect(mv.applyWidthPick(key, 'fit')).toBe(true);
  expect(child().layout?.w).toBeGreaterThan(120);
  expect(child().layout?.wAuto).toBeUndefined();
  expect(hostWrites).toBe(0);
  expect(doc.nodes[0]!.layout).toBeUndefined();
  mv.destroy?.();
  host.remove();
});
