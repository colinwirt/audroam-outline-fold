/**
 * Headless smoke for Map auto-pack (M2–M4, M9–M10).
 * Run: node scripts/smoke-autopack.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, isCollapsed, toggleFold } from '../dist/index.js';
import { autoPackPositions } from '../examples/_shared/mapView.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const md = readFileSync(
  join(root, 'examples/aust-gov-cyber/aust-gov-cyber.md'),
  'utf8',
);
const doc = parse(md);
const PILL_H = 44;
const GAP_Y = 14;

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

function pack(d) {
  return autoPackPositions(d, {
    isNodeCollapsed: (id) => isCollapsed(d, id),
    gapY: GAP_Y,
  });
}

const expanded = pack(doc);
const ids = Object.keys(expanded.nodes);
assert(ids.length > 10, 'expected many visible nodes when expanded');
assert(expanded.viewBox.h > 960, `viewBox height should grow with leaves (got ${expanded.viewBox.h})`);

// M2/M3: no vertical overlap between any two pills (AABB)
const boxes = ids.map((id) => {
  const p = expanded.nodes[id];
  return { id, top: p.y - PILL_H / 2, bot: p.y + PILL_H / 2, x: p.x, y: p.y };
});
for (let i = 0; i < boxes.length; i++) {
  for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i];
    const b = boxes[j];
    // Only check same-column-ish siblings (near x) for vertical overlap
    if (Math.abs(a.x - b.x) > 1) continue;
    const overlap = !(a.bot + GAP_Y - 0.5 <= b.top || b.bot + GAP_Y - 0.5 <= a.top);
    // Allow touching through gap: edges must be >= gap apart
    const gap = a.y < b.y ? b.top - a.bot : a.top - b.bot;
    assert(gap >= GAP_Y - 0.01, `sibling gap ${a.id}/${b.id} = ${gap}, need ≥ ${GAP_Y}`);
    assert(!overlap || gap >= GAP_Y - 0.01, `overlap ${a.id} vs ${b.id}`);
  }
}

// M4: root left edge not clipped (x - halfW >= margin-ish; margin=40, max half≤140)
const rootPos = expanded.nodes.root;
assert(rootPos, 'root positioned');
assert(rootPos.x - 140 >= 0, `root left may clip: x=${rootPos.x}`);

// M9: parent e8 centres on midpoint of its visible child stack
function childIds(d, id) {
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.id === id) return (n.children || []).filter((c) => c.id).map((c) => c.id);
      const hit = walk(n.children || []);
      if (hit) return hit;
    }
    return null;
  };
  return walk(d.nodes) || [];
}
const e8Kids = childIds(doc, 'e8');
assert(e8Kids.length >= 8, 'e8 should have many kids');
const kidYs = e8Kids.map((id) => expanded.nodes[id].y);
const stackMid = (Math.min(...kidYs) + Math.max(...kidYs)) / 2;
// Parent centre equals midpoint of child *centres* of first/last in stack —
// algorithm uses midpoint of block (top+stackH/2) which equals mid of first/last centres for equal-height leaves.
const e8y = expanded.nodes.e8.y;
assert(
  Math.abs(e8y - stackMid) < 1,
  `e8 parent y ${e8y} should centre on kids mid ${stackMid}`,
);

// M10: collapse e8 → height shrinks; expand again → restores
const collapsedDoc = toggleFold(doc, 'e8');
assert(isCollapsed(collapsedDoc, 'e8'), 'e8 collapsed');
const collapsed = pack(collapsedDoc);
assert(
  collapsed.viewBox.h < expanded.viewBox.h - 100,
  `collapse should shrink height (${collapsed.viewBox.h} vs ${expanded.viewBox.h})`,
);
assert(!collapsed.nodes['e8-1'], 'collapsed kids omitted from pack');
assert(collapsed.nodes.e8, 'collapsed parent still placed');

const reexpanded = pack(toggleFold(collapsedDoc, 'e8'));
assert(
  Math.abs(reexpanded.viewBox.h - expanded.viewBox.h) < 1,
  're-expand restores height',
);
assert(
  Math.abs(reexpanded.nodes.e8.y - expanded.nodes.e8.y) < 1,
  're-expand restores parent centre',
);

console.log('smoke-autopack OK', {
  nodes: ids.length,
  viewBox: expanded.viewBox,
  collapsedH: collapsed.viewBox.h,
  e8y,
  stackMid,
});
