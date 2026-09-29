/**
 * Headless smoke for Map auto-pack (M2–M4, M9–M10, M12–M13).
 * Run: node scripts/smoke-autopack.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parse,
  isCollapsed,
  toggleFold,
  autoPackPositions,
  pillSize,
  FOLD_SLOT,
  displayCaption,
} from '../dist/index.js';

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

// M2/M3: vertical gap for near-column pills (centres or left edges close)
const boxes = ids.map((id) => {
  const p = expanded.nodes[id];
  return { id, top: p.y - PILL_H / 2, bot: p.y + PILL_H / 2, x: p.x, y: p.y };
});
for (let i = 0; i < boxes.length; i++) {
  for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i];
    const b = boxes[j];
    // Left-aligned siblings share left edge but centres may differ by width/2
    if (Math.abs(a.x - b.x) > 120) continue;
    const gap = a.y < b.y ? b.top - a.bot : a.top - b.bot;
    // Only enforce when they could collide vertically in a stack (gap small or overlapping)
    if (gap > GAP_Y * 3) continue;
    assert(gap >= GAP_Y - 0.01, `sibling gap ${a.id}/${b.id} = ${gap}, need ≥ ${GAP_Y}`);
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
// Variable-height scrapbook pills: midpoint of stack block (first top → last bot).
function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children || [], id);
    if (hit) return hit;
  }
  return null;
}
const edges = e8Kids.map((id) => {
  const n = findNode(doc.nodes, id);
  const label = displayCaption(n.title);
  const { h } = pillSize(label, {
    reserveFold: !!(n.children && n.children.length),
    wrapCh: 32,
    maxLines: 6,
  });
  const y = expanded.nodes[id].y;
  return { top: y - h / 2, bot: y + h / 2 };
});
const stackMid =
  (Math.min(...edges.map((e) => e.top)) + Math.max(...edges.map((e) => e.bot))) /
  2;
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

// M12: fold chrome reserves an end-cap — text measure unchanged vs no-chrome
function shortLabel(title) {
  const parts = String(title).split(' · ');
  if (parts.length >= 2) return parts[0].trim();
  return title.length > 36 ? title.slice(0, 34) + '…' : title;
}
function findTitle(d, id) {
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.id === id) return n.title;
      const hit = walk(n.children || []);
      if (hit != null) return hit;
    }
    return null;
  };
  return walk(d.nodes);
}
for (const id of ['howto', 'ism', 'e8']) {
  const label = shortLabel(findTitle(doc, id));
  const base = pillSize(label);
  const withFold = pillSize(label, { reserveFold: true });
  assert(base.foldSlot === 0, `${id} base foldSlot`);
  assert(withFold.foldSlot === FOLD_SLOT, `${id} fold slot = ${FOLD_SLOT}`);
  assert(withFold.textW === base.w, `${id} textW must equal no-chrome pill width`);
  assert(withFold.w === base.w + FOLD_SLOT, `${id} total w = text + fold chrome`);
}
// End-cap air: FOLD_SLOT ≥ 2*(r+6); preferred 34 = 2*(9+8)
{
  const circleR = 9;
  assert(FOLD_SLOT >= 2 * (circleR + 6), `FOLD_SLOT ${FOLD_SLOT} needs ≥6px clear`);
  assert(FOLD_SLOT === 34, `FOLD_SLOT preferred lock is 34 (got ${FOLD_SLOT})`);
  assert(FOLD_SLOT / 2 - circleR >= 8, '≥8px clear each side of centred circle');
}
// Fold-slot-always: foldable expanded w === collapsed w (same reserve)
{
  const label = shortLabel(findTitle(doc, 'e8'));
  const baseW = pillSize(label).w;
  const foldableW = pillSize(label, { reserveFold: true }).w;
  assert(foldableW === baseW + FOLD_SLOT, 'foldable e8 pill reserves fold slot');
  assert(
    pillSize(label, { reserveFold: true }).w === foldableW,
    'expanded/collapsed foldable width identical',
  );
}

// M13: siblings under the *same parent* share a common left edge (not tree-wide depth)
function findNodeById(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNodeById(n.children || [], id);
    if (hit) return hit;
  }
  return null;
}
function leftEdge(packed, d, id) {
  const n = findNodeById(d.nodes, id);
  const pos = packed.nodes[id];
  assert(n && pos, `missing node/pos ${id}`);
  const reserveFold = !!(n.children?.length);
  const { w } = pillSize(shortLabel(n.title), { reserveFold });
  return pos.x - w / 2;
}
function assertSiblingLeftAlign(packed, d, parentId) {
  const kids = childIds(d, parentId).filter((id) => packed.nodes[id]);
  if (kids.length < 2) return 0;
  const ref = leftEdge(packed, d, kids[0]);
  for (const id of kids) {
    const left = leftEdge(packed, d, id);
    assert(
      Math.abs(left - ref) < 0.01,
      `M13 siblings of ${parentId}: ${id} left ${left} ≠ ${ref}`,
    );
  }
  return kids.length;
}
let siblingGroupsChecked = 0;
function walkParents(nodes) {
  for (const n of nodes) {
    if (!n?.id) continue;
    if (n.children?.length && !isCollapsed(doc, n.id)) {
      if (assertSiblingLeftAlign(expanded, doc, n.id) >= 2) siblingGroupsChecked++;
      walkParents(n.children);
    }
  }
}
walkParents(doc.nodes);
assert(siblingGroupsChecked >= 2, 'expected multiple sibling groups checked for M13');

// e8 kids (variable widths) share one left; howto kids share another — may differ
const e8Left = leftEdge(expanded, doc, e8Kids[0]);
const howtoKids = childIds(doc, 'howto').filter((id) => expanded.nodes[id]);
assert(howtoKids.length >= 2, 'howto should have kids');
const howtoLeft = leftEdge(expanded, doc, howtoKids[0]);
// Both groups are depth-2 under different L1 parents with different widths, so
// kidLeft = parentLeft + parentW + gapX can differ — that is correct M13.
assert(
  Number.isFinite(e8Left) && Number.isFinite(howtoLeft),
  'sibling group lefts computed',
);

console.log('smoke-autopack OK', {
  nodes: ids.length,
  viewBox: expanded.viewBox,
  collapsedH: collapsed.viewBox.h,
  e8y,
  stackMid,
  foldSlot: FOLD_SLOT,
  siblingGroupsChecked,
  e8Left,
  howtoLeft,
});
