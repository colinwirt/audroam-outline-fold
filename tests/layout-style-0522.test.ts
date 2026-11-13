// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { parse, createMapView } from '../src/index.js';
import { serialize } from '../src/serialize.js';

// 0.5.22 (Colin, 4 Nov): node colour, fill and icon live in the layout block by node id,
// like `w`. The layout block's canonical form (header keys, sorted ids) is what
// round-trips byte for byte, as it already did for widths. Layout wins; inline tags stay readable; a UI set migrates to layout.
const LAYOUT_DOC = [
  '- Root <id:r>',
  '  - Child <id:c>',
  '    - Grandchild <id:g>',
  '  - Own <id:o>',
  '- Legacy <color:ember> <id:l>',
  '  - 🌲 Legacy icon <id:li>',
  '- Plain',
  '',
  '--- layout ---',
  'fold-: ',
  'collapsedMarker: "(+)"',
  'c:',
  '  w: 200',
  'l:',
  '  colour: creek',
  'o:',
  '  colour: ember:fill',
  'r:',
  '  colour: moss',
  '  icon: :star:',
  '---',
  '',
].join('\n');

async function paint(text: string) {
  const doc = parse(text);
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 1000 });
  Object.defineProperty(host, 'clientHeight', { value: 800 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
  let focus = 'r';
  let cur = doc;
  const mv: any = (createMapView as any)(host, {
    getDoc: () => cur, setDoc: (d: any) => { cur = d; }, getLayout: () => layout, getFocusId: () => focus,
    setFocusId: (id: string) => { focus = id; }, nodeColours: true, nodeIcons: true, canPersistWidths: true,
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 20));
  const g = (id: string) => host.querySelector(`.map-node[data-id="${id}"]`) as Element | null;
  return { host, g, mv, doc: () => cur };
}

describe('0.5.22 colour + icon in the layout block', () => {
  it('parses layout colour, fill and icon onto the node', () => {
    const d = parse(LAYOUT_DOC);
    const [r, l] = d.nodes;
    expect(r!.color).toBe('moss');
    expect(r!.icon).toBe(':star:');
    expect(r!.children![1]!.color).toBe('ember');
    expect(r!.children![1]!.colorFill).toBe(true);
    expect(r!.children![0]!.layout?.w).toBe(200);
    expect(l!.color).toBe('creek'); // layout wins over <color:ember>
  });

  it('layout colour renders and inherits down the branch; layout icon renders', async () => {
    const { g, host, mv } = await paint(LAYOUT_DOC);
    for (const id of ['r', 'c', 'g']) expect(g(id)!.getAttribute('class'), id).toContain('has-colour colour-moss');
    expect(g('o')!.getAttribute('class')).toContain('colour-ember colour-fill');
    expect(g('r')!.textContent).toMatch(/Root/);
    expect(g('r')!.textContent).not.toBe('Root');
    expect(host.querySelector('.map-node[data-id="r"]')!.innerHTML).toMatch(/★|⭐|star/i);
    mv.destroy?.();
  });

  it('legacy inline tags still work alone', async () => {
    const { g, mv } = await paint('- A <color:ember> <id:a>\n  - 🌲 B <id:b>\n');
    expect(g('a')!.getAttribute('class')).toContain('colour-ember');
    expect(g('b')!.getAttribute('class')).toContain('colour-ember');
    expect(g('b')!.textContent).toContain('🌲');
    mv.destroy?.();
  });

  it('round-trip: unchanged text (layout + legacy tags) is byte-identical', () => {
    expect(serialize(parse(LAYOUT_DOC))).toBe(LAYOUT_DOC);
    const legacy = '- A <colour:ember:fill> <id:a>\n  - 🌲 B <id:b>\n';
    expect(serialize(parse(legacy))).toBe(legacy);
  });

  it('UI colour set writes the layout entry and drops the inline tag (keeps colour spelling)', async () => {
    const { mv, doc } = await paint('- A <colour:ember> <id:a>\n- B\n');
    mv.setNodeColour('a', 'moss');
    const out = serialize(doc());
    expect(out).toContain('- A <id:a>\n');
    expect(out).not.toContain('<colour:');
    expect(out).toMatch(/--- layout ---\n(?:.*\n)*?a:\n  colour: moss\n---/);
    mv.destroy?.();
  });

  it('UI set on a node without an id mints one; fill and icon go to layout', async () => {
    const { mv, doc } = await paint('- A <id:a>\n- B\n');
    // 0.6.6: an id-less line is addressed by its view key, never by its place.
    const keyB = mv.viewKey(doc().nodes[1]!) as string;
    expect(keyB).toMatch(/^__sid-/);
    mv.setNodeColour(keyB, 'creek');
    const b = doc().nodes[1]!;
    expect(b.id).toMatch(/^[A-Za-z0-9]/);
    expect(b.autoId).toBeFalsy();
    mv.setNodeColourFill(b.id!, true);
    mv.setNodeIcon('a', '🌲');
    const out = serialize(doc());
    expect(out).toContain('- A <id:a>\n');
    expect(out).toContain(`- B <id:${b.id}>`);
    expect(out).not.toMatch(/<colou?r:/);
    expect(out).not.toContain('- 🌲');
    expect(out).toContain(`a:\n  icon: 🌲`);
    expect(out).toContain(`${b.id}:\n  color: creek:fill`);
    // and it reads back the same
    const again = parse(out);
    expect(again.nodes[0]!.icon).toBe('🌲');
    expect(again.nodes[1]!.color).toBe('creek');
    expect(again.nodes[1]!.colorFill).toBe(true);
    expect(serialize(again)).toBe(out);
    mv.destroy?.();
  });

  it('UI icon set migrates a leading inline icon; removing clears the layout key', async () => {
    const { mv, doc } = await paint('- 🌲 A <id:a>\n');
    mv.setNodeIcon('a', ':star:');
    let out = serialize(doc());
    expect(out.startsWith('- A <id:a>\n')).toBe(true);
    expect(out).toContain('a:\n  icon: :star:');
    mv.setNodeIcon('a', undefined);
    out = serialize(doc());
    expect(out).toBe('- A <id:a>\n');
    mv.setNodeColour('a', 'moss');
    mv.setNodeColour('a', undefined);
    expect(serialize(doc())).toBe('- A <id:a>\n');
    mv.destroy?.();
  });

  it('width writes keep colour in the same entry', () => {
    const d = parse(LAYOUT_DOC);
    d.nodes[0]!.layout = { ...d.nodes[0]!.layout, w: 300 };
    expect(serialize(d)).toContain('r:\n  w: 300\n  colour: moss\n  icon: :star:');
  });
});
