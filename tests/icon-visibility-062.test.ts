// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { parse, createMapView } from '../src/index.js';

// 0.6.2 (Colin, 5 Nov): "icons don't hide at all even when disabled on toolbar".
const TEXT = ['- ⭐ Star node <id:s>', '- Plain <id:p>', ''].join('\n');

async function paint(opts: any = {}) {
  const doc = parse(TEXT);
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 1000 });
  Object.defineProperty(host, 'clientHeight', { value: 800 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
  const mv: any = (createMapView as any)(host, {
    getDoc: () => doc, setDoc: () => {}, getLayout: () => layout, getFocusId: () => 's', setFocusId: () => {}, nodeIcons: true, ...opts,
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 20));
  const text = (id: string) => host.querySelector(`.map-node[data-id="${id}"]`)!.textContent || '';
  return { mv, text };
}

describe('0.6.2 node icon visibility', () => {
  it('icons show by default', async () => {
    const { text, mv } = await paint();
    expect(text('s')).toContain('⭐');
    expect(mv.nodeIconsVisible()).toBe(true);
  });
  it('setNodeIconsVisible(false) hides every node icon on the next paint; true brings them back', async () => {
    const { text, mv } = await paint();
    mv.setNodeIconsVisible(false);
    expect(mv.nodeIconsVisible()).toBe(false);
    expect(text('s')).not.toContain('⭐');
    expect(text('s')).toContain('Star node');
    mv.setNodeIconsVisible(true);
    expect(text('s')).toContain('⭐');
  });
  it('showNodeIcons:false host option starts hidden', async () => {
    const { text } = await paint({ showNodeIcons: false });
    expect(text('s')).not.toContain('⭐');
  });
});
