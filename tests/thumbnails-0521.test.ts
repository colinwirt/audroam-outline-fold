// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { parse, createMapView } from '../src/index.js';
import { serialize } from '../src/serialize.js';
import {
  parseAssetsBlock, formatAssetsBlock, safeAssetSrc, sanitizeSvg, clampThumbWidth, thumbBox,
  defaultImageAdd, assetKeyFor, THUMB_MIN_W, THUMB_MAX_W,
} from '../src/thumbnails.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const TEXT = [
  '- Trip <id:t>',
  '  - Dusk <img:dusk-w6> <id:dusk>',
  '  - Tall <img:tall> <id:tall>',
  '',
  '--- assets ---',
  '# photos',
  'dusk-w6:',
  '  src: att:01HZX',
  '  type: image/jpeg',
  '  w: 1600',
  '  h: 1067',
  '  alt: "Dusk over the bay"',
  'tall:',
  `  src: ${PNG}`,
  '  w: 100',
  '  h: 300',
  '---',
  '',
].join('\n');

describe('0.5.21 <img:key> and --- assets --- grammar', () => {
  it('parses the tag and the block', () => {
    const doc: any = parse(TEXT);
    const dusk = doc.nodes[0].children[0];
    expect(dusk.title).toBe('Dusk');
    expect(dusk.img).toBe('dusk-w6');
    expect(doc.assets.map((a: any) => a.key)).toEqual(['dusk-w6', 'tall']);
    expect(doc.assets[0]).toMatchObject({ src: 'att:01HZX', w: 1600, h: 1067, alt: 'Dusk over the bay', extra: { type: 'image/jpeg' } });
  });
  it('round-trips byte-exact (comments, unknown fields, key order)', () => {
    expect(serialize(parse(TEXT))).toBe(TEXT);
  });
  it('writes <img:> before <id:>, after <color:> and <cloud>', () => {
    const doc: any = parse('- A <img:k> <cloud> <color:moss> <id:a>\n');
    expect(doc.nodes[0].img).toBe('k');
    expect(serialize(doc).split('\n')[0]).toBe('- A <color:moss> <cloud> <img:k> <id:a>');
  });
  it('an edited entry is written canonically; new entries append', () => {
    const doc: any = parse(TEXT);
    doc.assets[1].w = 200;
    doc.assets.push({ key: 'new', src: 'https://example.org/a.png', w: 10, h: 20 });
    const out = serialize(doc);
    expect(out).toContain('tall:\n  src: ' + PNG + '\n  w: 200\n  h: 300\nnew:\n  src: https://example.org/a.png\n  w: 10\n  h: 20\n---');
    expect(out).toContain('# photos\ndusk-w6:\n  src: att:01HZX\n  type: image/jpeg');
  });
  it('creates the block at the end (before --- layout ---) when missing', () => {
    const doc: any = parse('- A <id:a>\n');
    doc.assets = [{ key: 'k', src: 'att:x', w: 1, h: 1 }];
    doc.nodes[0].layout = { w: 200 };
    const out = serialize(doc);
    expect(out.indexOf('--- assets ---')).toBeGreaterThan(out.indexOf('- A'));
    expect(out.indexOf('--- assets ---')).toBeLessThan(out.indexOf('--- layout ---'));
    expect(serialize(parse(out))).toBe(out);
  });
  it('the block is peeled, never shown as outline lines', () => {
    const doc: any = parse(TEXT);
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0].children).toHaveLength(2);
  });
  it('parseAssetsBlock / formatAssetsBlock', () => {
    const e = parseAssetsBlock('k:\n  src: att:a\n  w: 4\n  h: 3');
    expect(formatAssetsBlock(e)).toBe('--- assets ---\nk:\n  src: att:a\n  w: 4\n  h: 3\n---');
  });
  it('assetKeyFor makes kebab keys with a suffix when taken', () => {
    expect(assetKeyFor('My Photo.JPG', [])).toBe('my-photo');
    expect(assetKeyFor('My Photo.JPG', ['my-photo'])).toBe('my-photo-2');
  });
});

describe('0.5.21 source safety (T4, T16)', () => {
  it('allows att:, https:, raster data in assets', () => {
    expect(safeAssetSrc('att:01HZX')).toBe('att:01HZX');
    expect(safeAssetSrc('https://example.org/a.png')).toBe('https://example.org/a.png');
    expect(safeAssetSrc(PNG)).toBe(PNG);
  });
  it('refuses javascript:, http:, //, user-info, other data, data outside assets', () => {
    for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'http://x.org/a.png', '//x.org/a.png',
      'https://u@x.org/a', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:x', 'file:///etc/passwd', ' ', 'blob:x']) {
      expect(safeAssetSrc(bad), bad).toBeNull();
    }
    expect(safeAssetSrc(PNG, false)).toBeNull();
  });
  it('sanitises SVG: keeps the allowlist, fails closed on anything else', () => {
    const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><!-- c --><path d="M0 0H10" stroke="currentColor"/><use href="#a"/></svg>';
    expect(sanitizeSvg(ok)).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0H10" stroke="currentColor"/><use href="#a"/></svg>');
    for (const bad of [
      '<svg><script>alert(1)</script></svg>',
      '<svg onload="alert(1)"></svg>',
      '<svg><foreignObject/></svg>',
      '<svg><style>@import url(x)</style></svg>',
      '<svg><rect style="fill:red"/></svg>',
      '<svg><use href="https://x.org/a.svg#b"/></svg>',
      '<svg><a href="javascript:alert(1)"><rect/></a></svg>',
      '<svg><rect fill="url(https://x.org/p)"/></svg>',
      '<svg><animate attributeName="href" to="javascript:alert(1)"/></svg>',
      '<!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>',
      '<?xml-stylesheet href="x"?><svg/>',
      '<svg><image href="x.png"/></svg>',
    ]) expect(sanitizeSvg(bad), bad).toBeNull();
    const enc = `data:image/svg+xml,${encodeURIComponent(ok)}`;
    expect(safeAssetSrc(enc)).toContain('data:image/svg+xml,');
    expect(safeAssetSrc(`data:image/svg+xml,${encodeURIComponent('<svg onload="x()"/>')}`)).toBeNull();
  });
});

describe('0.5.21 size: clamp, aspect, 1.25× cap', () => {
  it('clamps the handle width to 120–480', () => {
    expect(THUMB_MIN_W).toBe(120);
    expect(THUMB_MAX_W).toBe(480);
    expect(clampThumbWidth(40)).toBe(120);
    expect(clampThumbWidth(300.4)).toBe(300);
    expect(clampThumbWidth(9000)).toBe(480);
  });
  it('height follows the aspect ratio, capped at 1.25× width with a crop', () => {
    expect(thumbBox(240, 1600, 1067)).toEqual({ w: 240, h: 160, crop: false });
    expect(thumbBox(240, 100, 300)).toEqual({ w: 240, h: 300, crop: true });
    expect(thumbBox(240, 100, 125)).toEqual({ w: 240, h: 300, crop: false });
  });
});

async function paintMap(extra: any = {}, text = TEXT) {
  const doc: any = parse(text);
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 1000 });
  Object.defineProperty(host, 'clientHeight', { value: 800 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
  let focus = 'dusk';
  const mv: any = (createMapView as any)(host, {
    getDoc: () => doc, setDoc: () => {}, getLayout: () => layout, getFocusId: () => focus,
    setFocusId: (id: string) => { focus = id; }, nodeMenu: true, ...extra,
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 20));
  const g = (id: string) => host.querySelector(`.map-node[data-id="${id}"]`) as Element | null;
  return { host, g, mv, doc, layout, setFocus: (id: string) => { focus = id; mv.paint(); } };
}

describe('0.5.21 Map thumbnails', () => {
  it('draws the image filling the node width (8px inset, 11px radius), above the caption', async () => {
    const { g, mv } = await paintMap({ resolveImageSrc: (s: string) => (s === 'att:01HZX' ? '/attachment/01HZX?w=640' : null) });
    const img = g('dusk')!.querySelector('image.map-thumb')!;
    expect(img).toBeTruthy();
    expect(img.getAttribute('href')).toBe('/attachment/01HZX?w=640');
    const pill = g('dusk')!.querySelector('rect.map-pill')!;
    const pw = Number(pill.getAttribute('width'));
    expect(Number(img.getAttribute('width'))).toBe(pw - 16);
    expect(Number(img.getAttribute('x'))).toBe(Number(pill.getAttribute('x')) + 8);
    expect(Number(img.getAttribute('y'))).toBe(Number(pill.getAttribute('y')) + 8);
    expect(g('dusk')!.querySelector('.map-thumb-clip rect')!.getAttribute('rx')).toBe('11');
    // Default width 264 when no layout w.
    expect(Number(g('dusk')!.getAttribute('data-text-w'))).toBe(264);
    mv.destroy?.();
  });
  it('caps a tall image at 1.25× width and centre-crops it', async () => {
    const { g, mv } = await paintMap();
    const img = g('tall')!.querySelector('image.map-thumb')!;
    const w = Number(img.getAttribute('width'));
    expect(Number(img.getAttribute('height'))).toBe(Math.round(w * 1.25));
    expect(img.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');
    mv.destroy?.();
  });
  it('an unresolved att: source draws a placeholder, never a URL', async () => {
    const { g, mv } = await paintMap();
    expect(g('dusk')!.querySelector('image')).toBeNull();
    expect(g('dusk')!.querySelector('.map-thumb-ph')).toBeTruthy();
    mv.destroy?.();
  });
  it('an unsafe source is never rendered', async () => {
    const bad = TEXT.replace('src: att:01HZX', 'src: javascript:alert(1)');
    const { host, mv } = await paintMap({}, bad);
    expect(host.innerHTML).not.toContain('javascript:');
    mv.destroy?.();
  });
  it('editors: selected thumbnail gets a dashed frame and ONE square handle (the width grip)', async () => {
    const { g, mv } = await paintMap({ nodeImages: true });
    const node = g('dusk')!;
    expect(node.querySelector('.map-thumb-frame')!.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(node.querySelectorAll('.map-thumb-handle')).toHaveLength(1);
    expect(node.querySelectorAll('.map-width-grip')).toHaveLength(0);
    expect(node.querySelectorAll('.map-width-hit')).toHaveLength(1);
    expect(g('tall')!.querySelector('.map-thumb-frame')).toBeNull();
    mv.destroy?.();
  });
  it('read-only: no frame, no handle, no Image… entry, no add hook', async () => {
    const { g, mv, doc } = await paintMap({});
    expect(g('dusk')!.querySelector('.map-thumb-frame')).toBeNull();
    expect(g('dusk')!.querySelector('.map-thumb-handle')).toBeNull();
    expect(mv.nodeMenuEntries?.('dusk')?.some((e: any) => e.key === 'image') ?? false).toBe(false);
    const f = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    expect(await mv.addImage('t', f)).toBeNull();
    expect(doc.assets).toHaveLength(2);
    mv.destroy?.();
  });
  it('editors: Create › Image… is in the node menu', async () => {
    const { mv } = await paintMap({ nodeImages: true });
    const e = mv.nodeMenuEntries('t').find((x: any) => x.key === 'image');
    expect(e).toMatchObject({ label: 'Image…', group: 'Create' });
    mv.destroy?.();
  });
  it('addImage creates a thumbnail CHILD with an asset via the host hook', async () => {
    const calls: any[] = [];
    const { mv, doc } = await paintMap({
      nodeImages: true,
      onImageAdd: async (file: File, node: any) => { calls.push([file.name, node.key]); return { src: 'att:new1', w: 400, h: 300 }; },
    });
    const f = new File([new Uint8Array([1])], 'Beach Day.png', { type: 'image/png' });
    const key = await mv.addImage('t', f);
    expect(calls).toEqual([['Beach Day.png', 't']]);
    const kids = doc.nodes[0].children;
    expect(kids).toHaveLength(3);
    expect(kids[2]).toMatchObject({ title: 'Beach Day', img: 'beach-day' });
    expect(key).toBeTruthy();
    expect(doc.assets[2]).toMatchObject({ key: 'beach-day', src: 'att:new1', w: 400, h: 300 });
    expect(serialize(doc)).toContain('  - Beach Day <img:beach-day>');
    mv.destroy?.();
  });
  it('a hook result with an unsafe src is refused', async () => {
    const { mv, doc } = await paintMap({ nodeImages: true, onImageAdd: async () => ({ src: 'javascript:x', w: 1, h: 1 }) });
    const f = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
    expect(await mv.addImage('t', f)).toBeNull();
    expect(doc.assets).toHaveLength(2);
    mv.destroy?.();
  });
  it('the default hook embeds a data URL', async () => {
    const f = new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' });
    const r = await defaultImageAdd(f, { key: 't' });
    expect(r.src.startsWith('data:image/png;base64,')).toBe(true);
    const { mv, doc } = await paintMap({ nodeImages: true });
    await mv.addImage('t', f);
    expect(doc.assets[2].src.startsWith('data:image/png;base64,')).toBe(true);
    mv.destroy?.();
  });
  it('the handle width is clamped 120–480 and the height follows the aspect', async () => {
    const { mv, layout, g } = await paintMap({ nodeImages: true });
    mv.setThumbWidth('dusk', 9000);
    expect(layout.nodes.dusk.w).toBe(480);
    mv.paint();
    const img = g('dusk')!.querySelector('.map-thumb-ph, image.map-thumb')!;
    const w = Number(img.getAttribute('width'));
    expect(Number(img.getAttribute('height'))).toBe(Math.round(w * 1067 / 1600));
    mv.setThumbWidth('dusk', 10);
    expect(layout.nodes.dusk.w).toBe(120);
    mv.destroy?.();
  });
});
