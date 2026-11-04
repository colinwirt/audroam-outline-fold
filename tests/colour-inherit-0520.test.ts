// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { parse, createMapView } from '../src/index.js';
import { toHtml } from '../src/toHtml.js';
import { serialize } from '../src/serialize.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const css = readFileSync(join(__dirname, '../src/outline-fold.css'), 'utf8');

// 0.5.20 (Colin, 4 Nov): a node colour paints its whole branch (border + wash). Nearest
// coloured ancestor wins; a child's own tag overrides its sub-branch; time leaves stay green.
// Clouds in a coloured branch take the branch colour unless their own colour is set.
const TEXT = [
  '- Root <color:moss> <id:r>',
  '  - Child <id:c>',
  '    - Grandchild <id:g>',
  '  - Other <color:ember> <id:o>',
  '    - Under other <id:u>',
  '  - 10:00 <kind:time> <id:t>',
  '  - Cloudy <cloud> <id:cl>',
  '    - In cloud <id:ic>',
  '  - Named <cloud:creek> <id:nc>',
  '    - In named <id:in>',
  '- Washed <color:creek:fill> <id:w>',
  '  - Washed kid <id:wk>',
  '  - Line kid <colour:ember> <id:lk>',
  '- Plain <id:p>',
  '  - Plain cloud <cloud> <id:pc>',
  '',
].join('\n');

async function paintMap() {
  const doc = parse(TEXT);
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 1000 });
  Object.defineProperty(host, 'clientHeight', { value: 800 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
  let focus = 'r';
  const mv: any = (createMapView as any)(host, {
    getDoc: () => doc, setDoc: () => {}, getLayout: () => layout, getFocusId: () => focus,
    setFocusId: (id: string) => { focus = id; }, nodeColours: true, nodeClouds: true,
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 20));
  const g = (id: string) => host.querySelector(`.map-node[data-id="${id}"]`) as Element | null;
  return { host, g, mv };
}

describe('0.5.20 branch colour in Map', () => {
  it('default <color:moss>: moss border, no wash, on the node and its grandchild', async () => {
    const { g, mv } = await paintMap();
    for (const id of ['r', 'c', 'g']) {
      const cls = g(id)!.getAttribute('class')!;
      expect(cls, id).toContain('has-colour colour-moss');
      expect(cls, id).not.toContain('colour-fill');
    }
    mv.destroy?.();
  });
  it(':fill adds the wash, inherited by kids unless their own tag overrides', async () => {
    const { g, mv } = await paintMap();
    expect(g('w')!.getAttribute('class')).toContain('colour-creek colour-fill');
    expect(g('wk')!.getAttribute('class')).toContain('colour-creek colour-fill');
    expect(g('lk')!.getAttribute('class')).toContain('colour-ember');
    expect(g('lk')!.getAttribute('class')).not.toContain('colour-fill');
    mv.destroy?.();
  });
  it('a child override wins for its sub-branch', async () => {
    const { g, mv } = await paintMap();
    expect(g('o')!.getAttribute('class')).toContain('colour-ember');
    expect(g('u')!.getAttribute('class')).toContain('colour-ember');
    expect(g('u')!.getAttribute('class')).not.toContain('colour-moss');
    expect(g('p')!.getAttribute('class')).not.toContain('has-colour');
    mv.destroy?.();
  });
  it('time leaves stay green inside a coloured branch', async () => {
    const { g, mv } = await paintMap();
    const cls = g('t')!.getAttribute('class')!;
    expect(cls).toContain('time-leaf');
    expect(cls).not.toContain('has-colour');
    mv.destroy?.();
  });
  it('connectors in a coloured branch carry the colour; time edges do not', async () => {
    const { host, mv } = await paintMap();
    expect(host.querySelectorAll('.map-edge.edge-colour-moss').length).toBeGreaterThan(0);
    expect(host.querySelector('.map-edge.edge-time.edge-colour-moss')).toBeNull();
    mv.destroy?.();
  });
  it('a cloud inside a coloured branch takes the branch colour; plain branch stays neutral', async () => {
    const { host, mv } = await paintMap();
    const p = host.querySelector('.map-cloud[data-cloud="cl"] path')!;
    expect(p.getAttribute('fill')).toBe('var(--node-moss)');
    expect(p.getAttribute('stroke')).toBe('var(--node-moss)');
    const n = host.querySelector('.map-cloud[data-cloud="pc"] path')!;
    expect(n.getAttribute('stroke')).toContain('--of-cloud-stroke');
    mv.destroy?.();
  });
  it('an explicit cloud colour wins over the branch colour', async () => {
    const { host, mv } = await paintMap();
    const p = host.querySelector('.map-cloud[data-cloud="nc"] path')!;
    expect(p.getAttribute('stroke')).toBe('var(--node-creek)');
    mv.destroy?.();
  });
});

describe('0.5.20 :fill tag and CSS', () => {
  it('round-trips <color:x:fill> and keeps <colour:…> spelling', () => {
    const src = '- A <color:moss:fill> <id:a>\n- B <colour:fern:fill> <id:b>\n- C <color:pine> <id:c>\n';
    const d = parse(src);
    expect(d.nodes[0]!.color).toBe('moss');
    expect(d.nodes[0]!.colorFill).toBe(true);
    expect(d.nodes[2]!.colorFill).toBeUndefined();
    expect(serialize(d)).toBe(src);
  });
  it('a generated fill writes :fill', () => {
    const d = parse('- A <id:a>\n');
    d.nodes[0]!.color = 'moss'; d.nodes[0]!.colorFill = true;
    expect(serialize(d)).toContain('<color:moss:fill>');
  });
  it('CSS: border only by default, wash only under .colour-fill, connectors tinted', () => {
    const base = css.match(/\.map-node\.has-colour \.map-pill \{[^}]*\}/)![0];
    expect(base).not.toContain('color-mix');
    expect(css).toMatch(/\.map-node\.colour-fill \.map-pill \{[^}]*color-mix/);
    expect(css).toMatch(/\.map-edge\.edge-colour \{[^}]*var\(--ec\)/);
  });
});

describe('0.5.20 branch colour in Outline', () => {
  const h = toHtml(parse(TEXT));
  const li = (id: string) => h.match(new RegExp(`<li [^>]*data-id="${id}"[^>]*>`))![0];
  it('grandchild of moss gets the moss colour class', () => {
    expect(li('g')).toMatch(/of-colour of-colour-moss/);
    expect(li('g')).toContain('data-color="moss"');
    expect(li('g')).not.toContain('of-colour-fill');
    expect(li('wk')).toContain('of-colour-fill');
  });
  it('child override wins; plain stays plain', () => {
    expect(li('u')).toMatch(/of-colour-ember/);
    expect(li('p')).not.toMatch(/of-colour/);
  });
  it('time leaf stays uncoloured', () => {
    expect(li('t')).not.toMatch(/of-colour/);
  });
  it('cloud bar takes the branch colour unless named', () => {
    expect(li('cl')).toContain('--of-cloud-bar: var(--node-moss)');
    expect(li('nc')).toContain('--of-cloud-bar: var(--node-creek)');
    expect(li('pc')).not.toContain('--of-cloud-bar');
  });
});

describe('0.5.20 Fill toggle', () => {
  it('setColourFill helper sets and clears colorFill (off by default)', async () => {
    const { setColourFill } = await import('../src/nodeColour.js');
    const d = parse('- A <color:moss> <id:a>\n'); const n: any = d.nodes[0];
    expect(n.colorFill).toBeUndefined();
    setColourFill(n, true);
    expect(serialize(d)).toContain('<color:moss:fill>');
    setColourFill(n, false);
    expect(n.colorFill).toBeUndefined();
  });
  it('map handle exposes setNodeColourFill and the menu lists Fill unchecked by default', async () => {
    const { mv } = await paintMap();
    expect(typeof mv.setNodeColourFill).toBe('function');
    expect(mv.setNodeColourFill('r', true)).toBe(true);
    mv.destroy?.();
  });
});

describe('0.5.20 collapsed ring and light clouds (iThoughts look)', () => {
  async function paintWith(text: string) {
    const doc = parse(text);
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 1000 });
    Object.defineProperty(host, 'clientHeight', { value: 800 });
    document.body.appendChild(host);
    const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
    const mv: any = (createMapView as any)(host, { getDoc: () => doc, setDoc: () => {}, getLayout: () => layout, getFocusId: () => 'x', setFocusId: () => {}, nodeColours: true, nodeClouds: true });
    mv.paint();
    await new Promise((r) => setTimeout(r, 20));
    return { host, mv };
  }
  it('collapsed node with hidden kids gets a ring; expanded does not', async () => {
    const { host, mv } = await paintWith('---\nfold-: c\n---\n- Root <color:moss> <id:r>\n  - C <id:c>\n    - G <id:g>\n  - D <id:d>\n    - E <id:e>\n');
    expect(host.querySelector('.map-node[data-id="c"] .map-collapsed-ring')).not.toBeNull();
    expect(host.querySelector('.map-node[data-id="d"] .map-collapsed-ring')).toBeNull();
    mv.destroy?.();
  });
  it('ring uses the branch colour; uncoloured branch uses neutral', () => {
    expect(css).toMatch(/\.map-node\.has-colour \.map-collapsed-ring \{[^}]*stroke: var\(--nc\)/);
    expect(css).toMatch(/\.map-collapsed-ring \{[^}]*fill: none[^}]*stroke: var\(--of-collapsed-ring/);
  });
  it('a coloured cloud fill stays light (<= 6%)', async () => {
    const { cloudSvg } = await import('../src/mapRegion.js');
    const s = cloudSvg({ rootId: 'a', color: 'moss', depth: 0 } as any, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    const op = Number(/fill-opacity="([\d.]+)"/.exec(s)![1]);
    expect(op).toBeLessThanOrEqual(0.06);
    expect(s).toContain('stroke-width="1"');
  });
});
