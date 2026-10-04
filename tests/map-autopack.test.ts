import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parse,
  isCollapsed,
  toggleFold,
  autoPackPositions,
  pillSize,
  FOLD_SLOT,
  displayCaption,
  resolveTask,
  resolveNoteLinks,
} from '../src/index.js';
import { captionWithoutLinks } from '../src/captionRich.js';

const md = readFileSync(
  join(__dirname, '../examples/aust-gov-cyber/aust-gov-cyber.md'),
  'utf8',
);

const PILL_H = 44;
const GAP_Y = 14;

function pack(d: ReturnType<typeof parse>) {
  return autoPackPositions(d, {
    isNodeCollapsed: (id) => isCollapsed(d, id),
    gapY: GAP_Y,
  });
}

function shortLabel(title: string): string {
  const parts = String(title).split(' · ');
  if (parts.length >= 2) return parts[0].trim();
  return title.length > 36 ? title.slice(0, 34) + '…' : title;
}

function findNodeById(
  nodes: ReturnType<typeof parse>['nodes'],
  id: string,
): (typeof nodes)[number] | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNodeById(n.children || [], id);
    if (hit) return hit;
  }
  return null;
}

function childIds(d: ReturnType<typeof parse>, id: string): string[] {
  const n = findNodeById(d.nodes, id);
  return (n?.children || []).filter((c) => c.id).map((c) => c.id!);
}

describe('autoPackPositions', () => {
  const doc = parse(md);

  it('places many visible nodes and grows viewBox with leaves', () => {
    const expanded = pack(doc);
    expect(Object.keys(expanded.nodes).length).toBeGreaterThan(10);
    expect(expanded.viewBox.h).toBeGreaterThan(960);
    expect(expanded.nodes.root).toBeTruthy();
    expect(expanded.nodes.root.x - 140).toBeGreaterThanOrEqual(0);
  });

  it('keeps near-column sibling gaps ≥ gapY (M2/M3)', () => {
    const expanded = pack(doc);
    const boxes = Object.keys(expanded.nodes).map((id) => {
      const p = expanded.nodes[id];
      return { id, top: p.y - PILL_H / 2, bot: p.y + PILL_H / 2, x: p.x, y: p.y };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (Math.abs(a.x - b.x) > 120) continue;
        const gap = a.y < b.y ? b.top - a.bot : a.top - b.bot;
        if (gap > GAP_Y * 3) continue;
        expect(gap).toBeGreaterThanOrEqual(GAP_Y - 0.01);
      }
    }
  });

  it('keeps a tall expanded pill clear of the sibling above', () => {
    const doc = parse(
      [
        '- Short above <id:above>',
        '- Tall parent with enough words to wrap onto two or three lines in the map pill <id:tall>',
        '  - Kid <id:kid>',
        '- Short below <id:below>',
      ].join('\n'),
    );
    const packed = autoPackPositions(doc, { isNodeCollapsed: () => false });
    function box(id: string) {
      const n = findNodeById(doc.nodes, id)!;
      const label = captionWithoutLinks(displayCaption(n.title));
      const size = pillSize(label, {
        reserveFold: !!(n.children && n.children.length),
      });
      const y = packed.nodes[id]!.y;
      return { top: y - size.h / 2, bot: y + size.h / 2, y, h: size.h };
    }
    const above = box('above');
    const tall = box('tall');
    const kid = box('kid');
    const below = box('below');
    expect(tall.h).toBeGreaterThan(kid.h);
    expect(tall.top - above.bot).toBeGreaterThanOrEqual(GAP_Y - 0.01);
    expect(below.top - tall.bot).toBeGreaterThanOrEqual(GAP_Y - 0.01);
    expect(Math.abs(tall.y - kid.y)).toBeLessThan(1);
  });

  it('centres parent on child stack midpoint (M9)', () => {
    const expanded = pack(doc);
    const e8Kids = childIds(doc, 'e8');
    expect(e8Kids.length).toBeGreaterThanOrEqual(8);
    // Variable-height pills (scrapbook wrap): midpoint is of the stack block
    // (first kid top → last kid bottom), not of kid centres.
    const edges = e8Kids.map((id) => {
      const n = findNodeById(doc.nodes, id)!;
      const { h } = pillSize(n.title, {
        reserveFold: !!(n.children?.length),
        reserveTask: !!n.task,
        wrapCh: 32,
        maxLines: 6,
      });
      const y = expanded.nodes[id].y;
      return { top: y - h / 2, bot: y + h / 2 };
    });
    const stackMid =
      (Math.min(...edges.map((e) => e.top)) +
        Math.max(...edges.map((e) => e.bot))) /
      2;
    expect(Math.abs(expanded.nodes.e8.y - stackMid)).toBeLessThan(1);
  });

  it('collapses omit kids and shrink height; re-expand restores (M10)', () => {
    const expanded = pack(doc);
    const collapsedDoc = toggleFold(doc, 'e8');
    expect(isCollapsed(collapsedDoc, 'e8')).toBe(true);
    const collapsed = pack(collapsedDoc);
    expect(collapsed.viewBox.h).toBeLessThan(expanded.viewBox.h - 100);
    expect(collapsed.nodes['e8-1']).toBeUndefined();
    expect(collapsed.nodes.e8).toBeTruthy();

    const reexpanded = pack(toggleFold(collapsedDoc, 'e8'));
    expect(Math.abs(reexpanded.viewBox.h - expanded.viewBox.h)).toBeLessThan(1);
    expect(Math.abs(reexpanded.nodes.e8.y - expanded.nodes.e8.y)).toBeLessThan(1);
  });

  it('reserves fold chrome end-cap without shrinking text (M12)', () => {
    const n = findNodeById(doc.nodes, 'e8');
    expect(n).toBeTruthy();
    const label = shortLabel(n!.title);
    const base = pillSize(label);
    const withFold = pillSize(label, { reserveFold: true });
    expect(base.foldSlot).toBe(0);
    expect(withFold.foldSlot).toBe(FOLD_SLOT);
    expect(withFold.textW).toBe(base.w);
    expect(withFold.w).toBe(base.w + FOLD_SLOT);
  });

  it('gives circle-+ ≥6px air inside FOLD_SLOT (end-cap air)', () => {
    const circleR = 9;
    const minClear = 6;
    expect(FOLD_SLOT).toBeGreaterThanOrEqual(2 * (circleR + minClear));
    // Preferred lock: ≥8px clear with gold focus → 2*(9+8)=34
    expect(FOLD_SLOT).toBe(34);
    const clear = FOLD_SLOT / 2 - circleR;
    expect(clear).toBeGreaterThanOrEqual(8);
  });

  it('keeps foldable pill width stable across expand/collapse (fold-slot-always)', () => {
    const n = findNodeById(doc.nodes, 'e8')!;
    const label = shortLabel(n.title);
    // Package always reserves when foldable — expanded w === collapsed w
    const expandedW = pillSize(label, { reserveFold: true }).w;
    const collapsedW = pillSize(label, { reserveFold: true }).w;
    expect(expandedW).toBe(collapsedW);
    expect(expandedW).toBe(pillSize(label).w + FOLD_SLOT);

    const expanded = pack(doc);
    const collapsedDoc = toggleFold(doc, 'e8');
    const collapsed = pack(collapsedDoc);
    // Same label → same reserved width; centres may shift with reflow but w measure is stable
    const wExp = pillSize(label, { reserveFold: !!(n.children?.length) }).w;
    const wCol = pillSize(label, {
      reserveFold: !!(findNodeById(collapsedDoc.nodes, 'e8')?.children?.length),
    }).w;
    expect(wExp).toBe(wCol);
    expect(expanded.nodes.e8).toBeTruthy();
    expect(collapsed.nodes.e8).toBeTruthy();
  });

  it('left-aligns siblings under the same parent only (M13)', () => {
    const expanded = pack(doc);

    function leftEdge(id: string): number {
      const n = findNodeById(doc.nodes, id)!;
      const pos = expanded.nodes[id];
      const label = captionWithoutLinks(displayCaption(n.title));
      const { w } = pillSize(label, {
        reserveFold: !!(n.children?.length),
        reserveTask: !!resolveTask(n),
        noteLinks: resolveNoteLinks(n),
      });
      return pos.x - w / 2;
    }

    let groups = 0;
    function walk(nodes: typeof doc.nodes) {
      for (const n of nodes) {
        if (!n?.id) continue;
        if (n.children?.length && !isCollapsed(doc, n.id)) {
          const kids = childIds(doc, n.id).filter((id) => expanded.nodes[id]);
          if (kids.length >= 2) {
            const ref = leftEdge(kids[0]);
            for (const id of kids) {
              expect(Math.abs(leftEdge(id) - ref)).toBeLessThan(0.01);
            }
            groups++;
          }
          walk(n.children);
        }
      }
    }
    walk(doc.nodes);
    expect(groups).toBeGreaterThanOrEqual(2);
  });
});
