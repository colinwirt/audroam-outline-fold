/**
 * Minimal 2D cafe ops map. Uses the built package for parsing and fold state.
 */
import { loadDoc } from '../_shared/parseDoc.js';
import { listSealed, loadDemoPassword, openAll, tryUnlock } from '../_shared/unlock.js';
import {
  serialize,
  toggleFold,
  isCollapsed,
} from '../../dist/index.js';

let { doc } = await loadDoc(new URL('../cafe-map.md', import.meta.url));
const revealed = {};
const sealedIds = listSealed(doc.nodes).map((n) => n.id);
const demoPassword = sealedIds.length ? await loadDemoPassword() : null;
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const out = document.getElementById('out');
// Canvas fallback content: the same labels as a list, for screen readers.
const list = document.getElementById('labels');

const layout = [];

function layoutTree(nodes, x, y, gapY) {
  let cy = y;
  for (const n of nodes) {
    layout.push({ node: n, x, y: cy });
    const collapsed = n.id ? isCollapsed(doc, n.id) : false;
    if (!collapsed && n.children?.length) {
      cy = layoutTree(n.children, x + 160, cy + gapY, gapY);
    } else {
      cy += gapY;
    }
  }
  return cy;
}

const isLocked = (n) => n.flags?.includes('private') || n.flags?.includes('encrypted');

function labelOf(node, collapsed) {
  if (isLocked(node)) return `${node.title} · ${revealed[node.id] ?? '🔒 locked'}`;
  return `${node.title}${collapsed ? ' (+)' : ''}`;
}

function draw() {
  layout.length = 0;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  layoutTree(doc.nodes, 40, 40, 36);
  list.replaceChildren();
  for (const { node, x, y } of layout) {
    const collapsed = node.id ? isCollapsed(doc, node.id) : false;
    const locked = isLocked(node) && revealed[node.id] == null;
    ctx.fillStyle = locked ? '#666' : collapsed ? '#C9A227' : '#4a9';
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eee';
    ctx.font = '13px system-ui';
    const text = labelOf(node, collapsed);
    ctx.fillText(text, x + 16, y + 4);
    const li = document.createElement('li');
    li.dataset.id = node.id;
    if (isLocked(node)) li.dataset.state = locked ? 'locked' : 'unlocked';
    li.textContent = text;
    list.append(li);
  }
  out.textContent = serialize(doc);
}

canvas.addEventListener('click', (ev) => {
  const rect = canvas.getBoundingClientRect();
  const mx = (ev.clientX - rect.left) * (canvas.width / rect.width);
  const my = (ev.clientY - rect.top) * (canvas.height / rect.height);
  for (const { node, x, y } of layout) {
    if (Math.hypot(mx - x, my - y) < 12 && node.id) {
      if (node.sealed && revealed[node.id] == null) {
        void tryUnlock({ getDoc: () => doc, setDoc: (d) => (doc = d), id: node.id, revealed, refresh: draw, demoPassword });
      } else {
        doc = toggleFold(doc, node.id);
        draw();
      }
      break;
    }
  }
});

if (demoPassword) {
  document.getElementById('demoPw').textContent = demoPassword;
  document.getElementById('demoUnlock').hidden = false;
  document.getElementById('btnUnlockAll').addEventListener('click', () => {
    void openAll({ getDoc: () => doc, setDoc: (d) => (doc = d), ids: sealedIds, revealed, refresh: draw, password: demoPassword });
  });
}

draw();
