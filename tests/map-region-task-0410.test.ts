// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { parse, createMapView } from '../src/index.js';

// Invented data. A region (unlocked sealed branch) with task rows renders the main Map's
// task glyph and toggles through onRegionTaskToggle (the re-seal path).
it('0.4.10: unlocked region rows draw task glyphs and toggle by scoped id', async () => {
  const doc = parse(`- Garden <id:1>\n  - Seeds <id:2>\n`);
  const sub = parse(`- [ ] tomato <id:6>\n- [x] basil <id:7>\n- plain <id:8>\n`);
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 800 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' }; let focus = '1';
  const toggled: string[] = [];
  const mv: any = (createMapView as any)(host, {
    getDoc: () => doc, setDoc: () => {}, getLayout: () => layout, getFocusId: () => focus, setFocusId: (id: string) => { focus = id; },
    getRegionHosts: () => [{ id: 's:2', kind: 'sealed', anchor: '2', doc: sub, folded: false, kid: 'k1' }],
    onRegionTaskToggle: (id: string) => { toggled.push(id); return true; },
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 20));
  const nodes = [...host.querySelectorAll('.map-region-node')];
  const byText = (s: string) => nodes.find((g) => (g.textContent || '').includes(s));
  const tomato = byText('tomato')!, basil = byText('basil')!, plain = byText('plain')!;
  expect(tomato.querySelector('.map-task-glyph')).not.toBeNull();
  expect(tomato.querySelector('.map-task-hit')!.getAttribute('aria-checked')).toBe('false');
  expect(basil.querySelector('.map-task-hit')!.getAttribute('aria-checked')).toBe('true');
  expect(plain.querySelector('.map-task-glyph')).toBeNull();
  expect(tomato.textContent).not.toContain('[ ]');
  const hit = host.querySelector(`.map-region-node[data-scoped-id="${tomato.getAttribute('data-scoped-id')}"] .map-task-hit`)!;
  hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(toggled[0]).toBe(tomato.getAttribute('data-scoped-id'));
  mv.destroy?.();
});
