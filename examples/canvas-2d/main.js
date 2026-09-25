/**
 * Minimal 2D map demo. Uses built dist when available; otherwise paste parse output.
 * Run after `npm run build` from package root, or open via a bundler.
 */
import {
  parse,
  serialize,
  toggleFold,
  isCollapsed,
} from '../../dist/index.js';

const SAMPLE = `---
fold-: design
collapsedMarker: "(+)"
---
- Designing updates for Markmap <id:design> (+)
  - Wire fold state <id:todo-1>
  - Payroll notes <private> <id:secret>
- Public site <kind:globe> <id:map>
- Schema <db:prod-pg> <id:db1>
`;

let doc = parse(SAMPLE);
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const out = document.getElementById('out');

const layout = [];

function layoutTree(nodes, x, y, gapY) {
  let cy = y;
  for (const n of nodes) {
    layout.push({ node: n, x, y: cy });
    const collapsed = n.id ? isCollapsed(doc, n.id) : false;
    if (!collapsed && n.children?.length) {
      cy = layoutTree(n.children, x + 160, cy + gapY, gapY);
    }
    cy += gapY;
  }
  return cy;
}

function draw() {
  layout.length = 0;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  layoutTree(doc.nodes, 40, 40, 36);
  for (const { node, x, y } of layout) {
    const collapsed = node.id ? isCollapsed(doc, node.id) : false;
    ctx.fillStyle = collapsed ? '#C9A227' : '#4a9';
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eee';
    ctx.font = '13px system-ui';
    const mark = collapsed ? ' (+)' : '';
    const flags = node.flags?.length ? ` [${node.flags.join(',')}]` : '';
    ctx.fillText(`${node.title}${mark}${flags}`, x + 16, y + 4);
  }
  out.textContent = serialize(doc);
}

canvas.addEventListener('click', (ev) => {
  const rect = canvas.getBoundingClientRect();
  const mx = ev.clientX - rect.left;
  const my = ev.clientY - rect.top;
  for (const { node, x, y } of layout) {
    if (Math.hypot(mx - x, my - y) < 12 && node.id) {
      doc = toggleFold(doc, node.id);
      draw();
      break;
    }
  }
});

draw();
