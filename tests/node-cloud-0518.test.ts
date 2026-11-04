import { describe, expect, it } from 'vitest';
import { parse, serialize, toHtml } from '../src/index.js';
import { cloudHull, cloudPath, cloudSvg, regionHull } from '../src/mapRegion.js';

const md = (s: string) => serialize(parse(s));

describe('0.5.18 cloud grammar (Q16 default: trailing <cloud> on the root line)', () => {
  it('round-trips <cloud> and <cloud:name>', () => {
    const src = '- Field notes <cloud> <id:fn>\n  - Survey <cloud:teal> <id:sv>\n  - Photos\n';
    const d = parse(src);
    expect(d.nodes[0]!.cloud).toBe('default');
    expect(d.nodes[0]!.title).toBe('Field notes');
    expect(d.nodes[0]!.children![0]!.cloud).toBe('teal');
    expect(serialize(d)).toBe(src);
  });
  it('set / clear writes the tag before <id:>', () => {
    const d = parse('- Field notes <id:fn>\n');
    d.nodes[0]!.cloud = 'default';
    expect(serialize(d)).toBe('- Field notes <cloud> <id:fn>\n');
    delete d.nodes[0]!.cloud;
    expect(serialize(d)).toBe('- Field notes <id:fn>\n');
  });
  it('mid-title <cloud> stays text', () => {
    expect(parse('- a <cloud> b\n').nodes[0]!.cloud).toBeUndefined();
    expect(md('- a <cloud> b\n')).toBe('- a <cloud> b\n');
  });
});

describe('0.5.18 angled cloud hull (EP-38)', () => {
  const parent = { x: 0, y: 40, w: 100, h: 30 };
  const kids = [
    { x: 160, y: 0, w: 80, h: 24 },
    { x: 160, y: 43, w: 80, h: 24 },
    { x: 160, y: 86, w: 80, h: 24 },
  ];
  const pts = cloudHull([parent, ...kids], 12)!;
  it('is a polygon (not a rectangle) that contains every box with margin', () => {
    expect(pts.length).toBeGreaterThan(4);
    const inside = (px: number, py: number) => {
      // convex, counter-clockwise or clockwise: all cross products share a sign
      let sign = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
        const c = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
        if (Math.abs(c) < 1e-6) continue;
        if (!sign) sign = Math.sign(c);
        else if (Math.sign(c) !== sign) return false;
      }
      return true;
    };
    for (const b of [parent, ...kids]) {
      for (const [x, y] of [[b.x - 4, b.y - 4], [b.x + b.w + 4, b.y - 4], [b.x - 4, b.y + b.h + 4], [b.x + b.w + 4, b.y + b.h + 4]]) {
        expect(inside(x!, y!)).toBe(true);
      }
    }
  });
  it('angled edges between parent and child column: few right angles', () => {
    let right = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length]!, b = pts[i]!, c = pts[(i + 1) % pts.length]!;
      const dot = (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y);
      const n = Math.hypot(a.x - b.x, a.y - b.y) * Math.hypot(c.x - b.x, c.y - b.y);
      if (Math.abs(dot / n) < 0.02) right++;
    }
    expect(right).toBeLessThanOrEqual(2);
    const diagonal = pts.some((p, i) => {
      const q = pts[(i + 1) % pts.length]!;
      return Math.abs(q.x - p.x) > 1 && Math.abs(q.y - p.y) > 1;
    });
    expect(diagonal).toBe(true);
  });
  it('rounded vertices (~6px) via quadratic corners; one box still gives a polygon', () => {
    const d = cloudPath(pts, 6);
    expect(d).toMatch(/^M/);
    expect(d).toMatch(/Q/);
    expect(d).toMatch(/Z$/);
    expect(cloudHull([parent], 12)!.length).toBeGreaterThanOrEqual(4);
    expect(cloudHull([], 12)).toBeNull();
  });
  it('cloudSvg: translucent fill, 1px stroke, class map-cloud, no security icon', () => {
    const s = cloudSvg({ rootId: 'fn', color: 'default', depth: 0 }, pts);
    expect(s).toContain('class="map-cloud');
    expect(s).toContain('data-cloud="fn"');
    expect(s).toContain('stroke-width="1"');
    expect(s).toContain('<path');
    expect(s).not.toContain('<rect');
    expect(s).not.toMatch(/stroke-dasharray/);
  });
  it('regionHull (sealed / record) is unchanged', () => {
    expect(regionHull([{ x: 0, y: 0, w: 10, h: 10 }], 14)).toEqual({ x: -14, y: -28, w: 38, h: 52 });
  });
});

describe('0.5.18 cloud in the Outline (EP-42)', () => {
  it('a cloud root row carries the bar class', () => {
    const h = toHtml(parse('- Field notes <cloud> <id:fn>\n  - Survey\n'));
    expect(h).toMatch(/class="of-node[^"]*of-cloud/);
    expect(h).toContain('data-cloud="default"');
  });
});
