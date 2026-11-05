// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { parse, createMapView } from '../src/index.js';
import { serialize } from '../src/serialize.js';
import { toHtml } from '../src/toHtml.js';

// 0.6.2 (Colin, 5 Nov): "I can't set fill to none on a child node of a filled node".
const TEXT = ['- Washed <color:creek:fill> <id:w>', '  - Kid <id:k>', '    - Grandkid <id:gk>', '- Plain <id:p>', ''].join('\n');

async function paint(text = TEXT) {
  let doc = parse(text);
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 1000 });
  Object.defineProperty(host, 'clientHeight', { value: 800 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
  let focus = 'w';
  const mv: any = (createMapView as any)(host, {
    getDoc: () => doc, setDoc: (d: any) => { doc = d; }, getLayout: () => layout, getFocusId: () => focus,
    setFocusId: (id: string) => { focus = id; }, nodeColours: true,
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 20));
  const cls = (id: string) => host.querySelector(`.map-node[data-id="${id}"]`)!.getAttribute('class')!;
  return { mv, cls, doc: () => doc };
}

describe('0.6.2 Fill none on a child of a filled node', () => {
  it('a child inherits the parent fill (baseline)', async () => {
    const { cls } = await paint();
    expect(cls('k')).toContain('colour-fill');
  });
  it('colour None on the child writes an explicit no-fill that overrides the inherited fill', async () => {
    const { mv, cls, doc } = await paint();
    mv.setNodeColour('k', undefined);
    mv.paint();
    expect(cls('k')).not.toContain('colour-fill');
    expect(cls('k')).toContain('colour-creek'); // border colour still inherited
    expect(cls('gk')).not.toContain('colour-fill'); // the override covers its sub-branch
    expect(cls('w')).toContain('colour-fill');
    const text = serialize(doc());
    expect(text).toMatch(/^k:\n {2}fill: none$/m);
    // round-trips
    const again = parse(text);
    const k = again.nodes[0]!.children![0]!;
    expect(k.noFill).toBe(true);
    expect(toHtml(again)).not.toMatch(/data-id="k"[^>]*of-colour-fill|of-colour-fill[^>]*data-id="k"/);
  });
  it('Fill off on the child does the same (was a silent no-op)', async () => {
    const { mv, cls } = await paint();
    expect(mv.setNodeColourFill('k', false)).toBe(true);
    mv.paint();
    expect(cls('k')).not.toContain('colour-fill');
  });
  it('Fill on again clears the no-fill marker', async () => {
    const { mv, cls, doc } = await paint();
    mv.setNodeColourFill('k', false);
    mv.setNodeColourFill('k', true);
    mv.paint();
    expect(cls('k')).toContain('colour-fill');
    expect(serialize(doc())).not.toMatch(/fill: none/);
  });
  it('None on a node with no inherited fill just clears (no marker written)', async () => {
    const { mv, doc } = await paint(['- Plain <color:moss> <id:p>', '  - Kid <id:k>', ''].join('\n'));
    mv.setNodeColour('k', undefined);
    mv.setNodeColour('p', undefined);
    expect(serialize(doc())).not.toMatch(/fill: none|color/);
  });
});
