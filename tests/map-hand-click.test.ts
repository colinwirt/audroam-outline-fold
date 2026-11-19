// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { createMapView, parse } from '../src/index.js';

function mount(text: string) {
  document.body.innerHTML = '';
  let doc = parse(text, { sessionIds: true });
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 900 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  host.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, x: 0, y: 0, toJSON() { return {}; } }) as DOMRect;
  document.body.appendChild(host);
  const layout = { version: 1, nodes: {} as Record<string, unknown>, _source: 'auto-pack' };
  let focus = '';
  const mv = createMapView(host, {
    getDoc: () => doc,
    setDoc: (d) => { doc = d; },
    getLayout: () => layout as never,
    getFocusId: () => focus,
    setFocusId: (id) => { focus = id; },
    onChange: () => mv.paint(),
    gestures: { labelTextSelect: () => false },
  });
  mv.paint();
  mv.bindGestures();
  return { host, mv };
}

function ptr(type: string, x: number, y: number, extra: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    pointerId: 1,
    pointerType: 'mouse',
    ...extra,
  });
}

async function drift(host: HTMLElement, x: number, y: number, dx: number): Promise<void> {
  host.dispatchEvent(ptr('pointerdown', x, y));
  host.dispatchEvent(ptr('pointermove', x + dx, y));
  await new Promise((r) => requestAnimationFrame(() => r(0)));
  host.dispatchEvent(ptr('pointerup', x + dx, y));
}

it('a fold click that drifts past the pan slop still folds', async () => {
  const { host } = mount('- Parent\n  - Child\n');
  const parent = [...host.querySelectorAll('.map-node')].find((n) => (n.textContent || '').includes('Parent'))!;
  expect(parent.getAttribute('aria-expanded')).toBe('true');
  const hit = parent.querySelector('.map-fold-hit')!;
  await drift(host, 40, 40, 12);
  hit.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 52, clientY: 40 }));
  const again = [...host.querySelectorAll('.map-node')].find((n) => (n.textContent || '').includes('Parent'))!;
  expect(again.getAttribute('aria-expanded')).toBe('false');
  expect((host.textContent || '').includes('Child')).toBe(false);
});

it('a real pan still swallows the fold click', async () => {
  const { host } = mount('- Parent\n  - Child\n');
  const parent = [...host.querySelectorAll('.map-node')].find((n) => (n.textContent || '').includes('Parent'))!;
  const hit = parent.querySelector('.map-fold-hit')!;
  await drift(host, 40, 40, 48);
  hit.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 88, clientY: 40 }));
  const again = [...host.querySelectorAll('.map-node')].find((n) => (n.textContent || '').includes('Parent'))!;
  expect(again.getAttribute('aria-expanded')).toBe('true');
});

it('hand mode zooms on a double-click that drifted into a pan', async () => {
  const { host, mv } = mount('- Parent\n  - Child\n');
  const before = mv.cam.k;
  await drift(host, 30, 30, 8);
  await new Promise((r) => setTimeout(r, 30));
  await drift(host, 32, 31, 8);
  expect(mv.cam.k).toBeGreaterThan(before);
});
