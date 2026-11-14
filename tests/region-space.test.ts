import { describe, expect, it } from 'vitest';
import { parse, autoPackPositions, wrapLines, captionToHtml, pillSize } from '../src/index.js';
import { captionStyleRuns } from '../src/captionRich.js';
import { CLOUD_OUTER, CLOUD_PAD, cloudHull, cloudPad } from '../src/mapRegion.js';
import { REGION_OUTER, REGION_PAD, placeRegions, type RegionHostSpec } from '../src/regionLayout.js';

describe('space around regions', () => {
  it('keeps cloud outlines off the pills and off each other', () => {
    const doc = parse('- Input <cloud:lemon> <id:in>\n- Charging <cloud:green> <id:ch>\n');
    const packed = autoPackPositions(doc, { gapY: 14 });
    const box = (id: string, title: string) => {
      const s = pillSize(title, { semibold: false });
      const p = packed.nodes[id]!;
      return { x: p.x - s.w / 2, y: p.y - s.h / 2, w: s.w, h: s.h };
    };
    const lemon = box('in', 'Input');
    const green = box('ch', 'Charging');
    const gap = green.y - (lemon.y + lemon.h);
    expect(gap).toBeGreaterThanOrEqual(CLOUD_PAD * 2 + CLOUD_OUTER - 0.5);
    const hull = cloudHull([lemon], cloudPad(0))!;
    const top = Math.min(...hull.map((p) => p.y));
    const left = Math.min(...hull.map((p) => p.x));
    expect(top).toBeLessThanOrEqual(lemon.y - CLOUD_PAD + 1);
    expect(left).toBeLessThanOrEqual(lemon.x - CLOUD_PAD + 1);
  });

  it('pads a sealed region inside and outside the hull', () => {
    const anchor = { x: 0, y: 0, w: 80, h: 44 };
    const boxes = new Map([['a', anchor]]);
    const host: RegionHostSpec = {
      id: 's:a',
      kind: 'sealed',
      anchor: 'a',
      doc: parse('- 13 Nov 2026 <id:d>\n  - note <id:n>\n'),
      folded: false,
    };
    const placed = placeRegions(boxes, () => [], '', [host], {
      pack: () => ({ d: { x: 40, y: 22 }, n: { x: 200, y: 22 } }),
      size: () => ({ w: 80, h: 44 }),
      visible: () => [
        { n: host.doc!.nodes[0]!, key: 'd', parentKey: null },
        { n: host.doc!.nodes[0]!.children![0]!, key: 'n', parentKey: 'd' },
      ],
    });
    const hull = placed[0]!.hull;
    const inner = placed[0]!.boxes;
    for (const b of inner) {
      expect(b.x).toBeGreaterThanOrEqual(hull.x + REGION_PAD - 0.5);
      expect(b.y).toBeGreaterThanOrEqual(hull.y + REGION_PAD - 0.5);
      expect(b.x + b.w).toBeLessThanOrEqual(hull.x + hull.w - REGION_PAD + 0.5);
      expect(b.y + b.h).toBeLessThanOrEqual(hull.y + hull.h - REGION_PAD + 0.5);
    }
    expect(hull.y).toBeGreaterThanOrEqual(anchor.y + anchor.h + REGION_OUTER - 0.5);
  });
});

describe('code strings stay literal', () => {
  it('does not treat a backslash-n or a br inside backticks as a break', () => {
    const runs = captionStyleRuns('Say `a\\nb<br>c` now');
    const code = runs.find((r) => r.code);
    expect(code?.text).toBe('a\\nb<br>c');
    expect(captionToHtml('Say `a\\nb` now')).toBe('Say <code class="of-code">a\\nb</code> now');
  });

  it('keeps a backslash-n inside a fenced block as the two characters', () => {
    const runs = captionStyleRuns('```js\\nconst s = "a\\n"\\n```');
    const code = runs.find((r) => r.code);
    expect(code?.text).toBe('const s = "a\\n"');
    expect(code?.text.includes('\n')).toBe(false);
    expect(captionToHtml('```js\\nconst s = "a\\n"\\n```')).toBe(
      '<code class="of-code">const s = &quot;a\\n&quot;</code>',
    );
    const lines = captionStyleRuns('```\\nline1\\nline2\\n```');
    expect(lines.find((r) => r.code)?.text).toBe('line1\\nline2');
    expect(captionStyleRuns('```\\nconst x = 1\\n```').some((r) => r.code && r.text === 'const x = 1')).toBe(true);
  });

  it('leaves a one-line chip inline', () => {
    const { lines, richLines } = wrapLines('Use `npm t` now', 40, null);
    expect(lines).toEqual(['Use npm t now']);
    expect(richLines[0]!.some((r) => r.code && r.text === 'npm t')).toBe(true);
  });
});
