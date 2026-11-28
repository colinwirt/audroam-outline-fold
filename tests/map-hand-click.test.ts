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

/** Width-corner slop from `rightEdgeKey` (mouse, 18px). A press there resizes instead of panning. */
function onWidthCorner(host: HTMLElement, x: number, y: number): boolean {
  const slop = 18;
  return [...host.querySelectorAll('.map-pill, .map-region-body')].some((pill) => {
    const r = pill.getBoundingClientRect();
    return y >= r.bottom - 14 && y <= r.bottom + slop && x >= r.right - 12 && x <= r.right + slop;
  });
}

/** A point on the map surface, off every pill's width corner. */
function panPoint(host: HTMLElement): { x: number; y: number } {
  for (let y = 24; y <= 576; y += 24) {
    for (let x = 24; x <= 876; x += 24) {
      if (!onWidthCorner(host, x, y)) return { x, y };
    }
  }
  return { x: 24, y: 24 };
}

async function frames(): Promise<void> {
  // Pan is recognised on the first frame and applied on the next.
  await new Promise((r) => requestAnimationFrame(() => r(0)));
  await new Promise((r) => requestAnimationFrame(() => r(0)));
}

async function drift(host: HTMLElement, x: number, y: number, dx: number): Promise<{ x: number; y: number }> {
  host.dispatchEvent(ptr('pointerdown', x, y));
  host.dispatchEvent(ptr('pointermove', x + dx, y));
  await frames();
  const lift = { x: x + dx, y };
  host.dispatchEvent(ptr('pointerup', lift.x, lift.y));
  return lift;
}

function parentNode(host: HTMLElement): Element {
  const node = [...host.querySelectorAll('.map-node')].find((n) => (n.textContent || '').includes('Parent'));
  if (!node) throw new Error('Parent pill is not on the map');
  return node;
}

it('a fold click that drifts past the pan slop still folds', async () => {
  const { host } = mount('- Parent\n  - Child\n');
  expect(parentNode(host).getAttribute('aria-expanded')).toBe('true');
  const at = panPoint(host);
  const lift = await drift(host, at.x, at.y, 12);
  parentNode(host).querySelector('.map-fold-hit')!.dispatchEvent(
    new MouseEvent('click', { bubbles: true, clientX: lift.x, clientY: lift.y }),
  );
  const again = parentNode(host);
  expect(again.getAttribute('aria-expanded')).toBe('false');
  expect((host.textContent || '').includes('Child')).toBe(false);
});

it('a real pan still swallows the fold click', async () => {
  const { host } = mount('- Parent\n  - Child\n');
  const at = panPoint(host);
  const lift = await drift(host, at.x, at.y, 48);
  parentNode(host).querySelector('.map-fold-hit')!.dispatchEvent(
    new MouseEvent('click', { bubbles: true, clientX: lift.x, clientY: lift.y }),
  );
  expect(parentNode(host).getAttribute('aria-expanded')).toBe('true');
});

it('hand mode zooms on a double-click that drifted into a pan', async () => {
  const { host, mv } = mount('- Parent\n  - Child\n');
  const before = mv.cam.k;
  const at = panPoint(host);
  await drift(host, at.x, at.y, 8);
  await new Promise((r) => setTimeout(r, 30));
  await drift(host, at.x + 2, at.y + 1, 8);
  expect(mv.cam.k).toBeGreaterThan(before);
});
