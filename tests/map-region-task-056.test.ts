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
  host.dispatchEvent(down);
  host.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 420, clientY: 244, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse' }));
  host.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 420, clientY: 244, button: 0, pointerId: 1, pointerType: 'mouse' }));

  const node = sub.nodes[0]!.children!.find((n) => n.id === '6')!;
  expect(node.layout?.w).toBe(widths[0]?.w);
  expect(node.layout?.w).toBeGreaterThanOrEqual(Math.max(120, startW));
  expect(widths[0]?.id).toBe(task.getAttribute('data-scoped-id'));
  mv.destroy?.();
});
