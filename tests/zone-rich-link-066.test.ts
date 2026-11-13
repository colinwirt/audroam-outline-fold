// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse, createMapView } from '../src/index.js';
import { parseZoneText } from '../src/zoneText.js';

// Invented data. Colin t2560u: `code` in a secure zone paints as code; t2552u: a URL in a zone
// node (same line, or the next line as its own child) reaches the globe.
const URL = 'https://b.audroam.com/outline-view?id=40242&map=1&focus=3';
async function mount(zoneText: string) {
  const doc = parse(`- main \`code\` <id:1>\n- Box <id:3>\n`);
  const sub = parseZoneText(zoneText, '3');
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 800 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' }; let focus = '1';
  const mv: any = (createMapView as any)(host, {
    getDoc: () => doc, setDoc: () => {}, getLayout: () => layout, getFocusId: () => focus, setFocusId: (id: string) => { focus = id; },
    getRegionHosts: () => [{ id: 's:3', kind: 'sealed', anchor: '3', doc: sub, folded: false, kid: 'k1' }],
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 20));
  return { host, mv };
}
const find = (host: HTMLElement, s: string) => [...host.querySelectorAll('.map-region-node')].find((g) => (g.textContent || '').includes(s));

it('inline code inside an unlocked zone paints as code, like a main pill', async () => {
  const { host, mv } = await mount('- header\n  - `Method = OIDC` via `entra`\n');
  const g = find(host, 'Method = OIDC')!;
  expect(g).toBeTruthy();
  const codes = [...g.querySelectorAll('tspan.map-code')].map((t) => t.textContent);
  expect(codes).toEqual(['Method = OIDC', 'entra']);
  expect(g.querySelector('.map-code-bg')).not.toBeNull();
  expect(g.textContent).not.toContain('`');
  mv.destroy?.();
});

it('a zone node with a trailing URL shows its caption and the globe', async () => {
  const { host, mv } = await mount(`- header\n  - setup ${URL}\n`);
  const g = find(host, 'setup')!;
  expect(g.textContent).not.toContain('b.audroam.com');
  expect(g.querySelector('.map-link-hit')).not.toBeNull();
  mv.destroy?.();
});

it('a URL on the next line in a zone is a child whose pill has the globe', async () => {
  const { host, mv } = await mount(`- header\n  - setup\n    ${URL}\n`);
  const child = find(host, 'b.audroam.com')!;
  expect(child).toBeTruthy();
  expect(child.querySelector('.map-link-hit')).not.toBeNull();
  mv.destroy?.();
});

it('zone globe click opens the Links popover', async () => {
  const { host, mv } = await mount(`- header\n  - setup ${URL}\n`);
  const hit = find(host, 'setup')!.querySelector('.map-link-hit')!;
  hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  expect(document.querySelector('.map-link-pop') ?? host.querySelector('.map-link-pop')).not.toBeNull();
  mv.destroy?.();
});

it('an id-less zone row paints its own caption once', async () => {
  const { host, mv } = await mount('- header\n  - `Alpha note`\n  - `Beta note` <id:14>\n    - `Gamma note`\n');
  const pills = [...host.querySelectorAll('.map-region-node')].filter((g) => (g.textContent || '').includes('note'));
  const texts = pills.map((g) => (g.textContent || '').replace(/\s+/g, ' ').trim());
  expect(texts.filter((t) => t.includes('Alpha note'))).toHaveLength(1);
  expect(texts.filter((t) => t.includes('Gamma note'))).toHaveLength(1);
  const alpha = pills.find((g) => (g.textContent || '').includes('Alpha note'))!;
  const gamma = pills.find((g) => (g.textContent || '').includes('Gamma note'))!;
  expect(alpha).not.toBe(gamma);
  expect(alpha.textContent).not.toContain('Gamma');
  expect(gamma.textContent).not.toContain('Alpha');
  expect(alpha.textContent).not.toContain('`');
  expect(alpha.querySelector('.map-code')).not.toBeNull();
  mv.destroy?.();
});

it('zone code ink rule covers region nodes', () => {
  expect(readFileSync('src/outline-fold.css', 'utf8')).toMatch(/\.map-region-node \.map-label tspan\.map-code/);
});
