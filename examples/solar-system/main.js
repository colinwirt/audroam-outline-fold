/**
 * Solar System Outline | Map demo.
 * Uses @audroam/outline-fold dist for parse / toHtml / fold / attachOutlineTree.
 * Layout sidecar: layoutSidecar: frontmatter pointer AND sibling *.layout.json
 * (pointer wins if both). Map first ship: pan/zoom. No unlock UI.
 */
import {
  parse,
  toggleFold,
  isCollapsed,
  setExpandLevel,
  toHtml,
  attachOutlineTree,
} from '../../dist/index.js';

const MD_URL = new URL('./solar-system.md', import.meta.url);
const SIBLING_LAYOUT_URL = new URL('./solar-system.layout.json', import.meta.url);

const outlineHost = document.getElementById('outlineHost');
const mapHost = document.getElementById('mapHost');
const panel = document.getElementById('panel');
const btnOutline = document.getElementById('btnOutline');
const btnMap = document.getElementById('btnMap');
const mapTools = document.getElementById('mapTools');
const loadErr = document.getElementById('loadErr');
const btnZoomIn = document.getElementById('btnZoomIn');
const btnZoomOut = document.getElementById('btnZoomOut');
const btnResetView = document.getElementById('btnResetView');

/** @type {import('../../dist/index.js').OutlineFoldDoc} */
let doc;
/** @type {{ version?: number, layout?: string, viewBox?: { w: number, h: number }, nodes: Record<string, { x: number, y: number }> }} */
let layout;
let mode = 'outline';
let focusId = 'root';
let treeApi = null;

/** Pan/zoom camera in SVG user units. */
const cam = { x: 0, y: 0, k: 1 };
const CAM_MIN = 0.35;
const CAM_MAX = 3.5;

function showError(msg) {
  loadErr.hidden = false;
  loadErr.textContent = msg;
}

function extractLayoutSidecarPointer(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  for (const line of m[1].split(/\r?\n/)) {
    const hit = line.match(/^layoutSidecar\s*:\s*(.+)$/i);
    if (hit) {
      return hit[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

async function resolveLayout(rawMd) {
  const pointer = extractLayoutSidecarPointer(rawMd);
  let pointerLayout = null;
  let siblingLayout = null;

  if (pointer) {
    try {
      const url = new URL(pointer, MD_URL);
      const res = await fetch(url);
      if (res.ok) pointerLayout = await res.json();
    } catch {
      /* fall through */
    }
  }

  try {
    const res = await fetch(SIBLING_LAYOUT_URL);
    if (res.ok) siblingLayout = await res.json();
  } catch {
    /* fall through */
  }

  // Pointer wins when both resolve.
  const chosen = pointerLayout || siblingLayout;
  if (!chosen || !chosen.nodes) {
    return {
      version: 1,
      layout: 'ithoughts-lr',
      viewBox: { w: 1200, h: 960 },
      nodes: {},
      _source: 'auto-pack',
    };
  }
  return {
    ...chosen,
    _source: pointerLayout ? `pointer:${pointer}` : 'sibling',
  };
}

function walkNodes(nodes, fn, depth = 0) {
  for (const n of nodes) {
    fn(n, depth);
    if (n.children?.length) walkNodes(n.children, fn, depth + 1);
  }
}

function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

function parentOf(nodes, id, parent = null) {
  for (const n of nodes) {
    if (n.id === id) return parent;
    if (n.children?.length) {
      const hit = parentOf(n.children, id, n);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

function hasKids(n) {
  return !!(n.children && n.children.length > 0);
}

function isCue(n) {
  if (!n) return false;
  if (n.id && /^cue/i.test(n.id)) return true;
  return /^\s*cue\s*:/i.test(n.title || '');
}

function shortLabel(title) {
  const parts = String(title).split(' · ');
  if (parts.length >= 2) return parts[0].trim();
  return title.length > 36 ? title.slice(0, 34) + '…' : title;
}

function visibleList(nodes = doc.nodes, out = []) {
  for (const n of nodes) {
    out.push(n);
    if (hasKids(n) && n.id && !isCollapsed(doc, n.id)) {
      visibleList(n.children, out);
    }
  }
  return out;
}

/** Deterministic L→R pack for ids missing from sidecar. */
function ensurePositions() {
  const vb = layout.viewBox || { w: 1200, h: 960 };
  layout.viewBox = vb;
  if (!layout.nodes) layout.nodes = {};

  const missing = [];
  walkNodes(doc.nodes, (n) => {
    if (n.id && !layout.nodes[n.id]) missing.push(n);
  });
  if (!missing.length) return;

  // Column by depth; stack vertically within depth.
  const byDepth = new Map();
  walkNodes(doc.nodes, (n, depth) => {
    if (!n.id || layout.nodes[n.id]) return;
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth).push(n);
  });
  for (const [depth, list] of byDepth) {
    const x = 72 + depth * 280;
    const gap = Math.min(70, (vb.h - 80) / Math.max(1, list.length));
    list.forEach((n, i) => {
      layout.nodes[n.id] = {
        x,
        y: 60 + i * gap + gap / 2,
      };
    });
  }
}

function pillSize(label) {
  const w = Math.max(88, Math.min(280, 18 + label.length * 7.2));
  return { w, h: 44 };
}

function connectorPath(px, py, pw, cx, cy, cw) {
  const x1 = px + pw / 2;
  const y1 = py;
  const x2 = cx - cw / 2;
  const y2 = cy;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function applyCam() {
  const g = mapHost.querySelector('#mapViewport');
  if (!g) return;
  g.setAttribute(
    'transform',
    `translate(${cam.x} ${cam.y}) scale(${cam.k})`,
  );
}

function resetCam() {
  const vb = layout.viewBox || { w: 1200, h: 960 };
  const rect = mapHost.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  const k = Math.min(w / vb.w, h / vb.h) * 0.92;
  cam.k = Math.max(CAM_MIN, Math.min(CAM_MAX, k || 1));
  cam.x = (w - vb.w * cam.k) / 2;
  cam.y = (h - vb.h * cam.k) / 2;
  applyCam();
}

function zoomAt(clientX, clientY, factor) {
  const rect = mapHost.getBoundingClientRect();
  const mx = clientX - rect.left;
  const my = clientY - rect.top;
  const next = Math.max(CAM_MIN, Math.min(CAM_MAX, cam.k * factor));
  const wx = (mx - cam.x) / cam.k;
  const wy = (my - cam.y) / cam.k;
  cam.k = next;
  cam.x = mx - wx * cam.k;
  cam.y = my - wy * cam.k;
  applyCam();
}

function paintOutline() {
  outlineHost.innerHTML = toHtml(doc, {
    ariaLabel: 'Solar System outline',
    lockedChrome: false,
  });
  // Soft cue tint when title/id looks like a Cue node.
  outlineHost.querySelectorAll('[role="treeitem"]').forEach((li) => {
    const id = li.getAttribute('data-id') || '';
    const title = li.querySelector('.of-title')?.textContent || '';
    if (/^cue/i.test(id) || /^\s*cue\s*:/i.test(title)) {
      li.classList.add('of-cue');
    }
  });
}

function renderMap() {
  ensurePositions();
  const vb = layout.viewBox;
  const edges = [];
  const nodes = [];

  function walk(n) {
    if (!n.id) return;
    const pos = layout.nodes[n.id] || { x: 100, y: 100 };
    const label = shortLabel(n.title);
    const { w, h } = pillSize(label);
    const foldable = hasKids(n);
    const col = foldable && isCollapsed(doc, n.id);
    const cue = isCue(n);
    nodes.push({ n, pos, label, w, h, foldable, col, cue });

    if (foldable && !col) {
      for (const c of n.children) {
        if (!c.id) continue;
        const cpos = layout.nodes[c.id] || { x: pos.x + 200, y: pos.y };
        const clabel = shortLabel(c.title);
        const cs = pillSize(clabel);
        edges.push({
          d: connectorPath(pos.x, pos.y, w, cpos.x, cpos.y, cs.w),
        });
        walk(c);
      }
    }
  }
  for (const root of doc.nodes) walk(root);

  const edgeSvg = edges
    .map((e) => `<path class="map-edge" d="${e.d}"/>`)
    .join('');
  const nodeSvg = nodes
    .map(({ n, pos, label, w, h, foldable, col, cue }) => {
      const x = pos.x - w / 2;
      const y = pos.y - h / 2;
      const cls = [
        'map-node',
        foldable ? '' : 'leaf',
        col ? 'collapsed' : '',
        cue ? 'cue' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const marker =
        foldable && col
          ? `<g class="map-fold-indicator" transform="translate(${pos.x + w / 2 - 14} ${pos.y})" aria-hidden="true">
          <circle r="9"/>
          <path d="M -4 0 H 4 M 0 -4 V 4"/>
        </g>`
          : '';
      return `<g class="${cls}" data-id="${esc(n.id)}" tabindex="${n.id === focusId ? 0 : -1}"
      role="button" aria-label="${esc(label)}${foldable ? (col ? ', collapsed' : ', expanded') : ''}"
      ${foldable ? `aria-expanded="${col ? 'false' : 'true'}"` : ''}>
      <rect class="map-pill" x="${x}" y="${y}" width="${w}" height="${h}" rx="18" ry="18"/>
      <text class="map-label" x="${pos.x}" y="${pos.y + 4}" text-anchor="middle">${esc(label)}</text>
      ${marker}
    </g>`;
    })
    .join('');

  const keepCam = !!mapHost.querySelector('#mapViewport');
  mapHost.innerHTML = `<svg class="map-svg" viewBox="0 0 ${Math.max(1, mapHost.clientWidth || 1180)} ${Math.max(1, mapHost.clientHeight || 520)}"
      preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="Solar System mind map, left to right. Pan and zoom enabled.">
      <rect width="100%" height="100%" fill="var(--map-bg)"/>
      <g id="mapViewport">
        <rect x="0" y="0" width="${vb.w}" height="${vb.h}" fill="var(--map-bg)" opacity="0"/>
        ${edgeSvg}
        ${nodeSvg}
      </g>
    </svg>`;

  if (!keepCam) resetCam();
  else applyCam();

  mapHost.querySelectorAll('.map-node').forEach((g) => {
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = g.getAttribute('data-id');
      focusId = id;
      const n = findNode(doc.nodes, id);
      if (n && hasKids(n)) {
        doc = toggleFold(doc, id);
      }
      paint();
    });
  });

  const focused = mapHost.querySelector(`[data-id="${CSS.escape(focusId)}"]`);
  if (focused && mode === 'map') focused.focus({ preventScroll: true });
}

function paint() {
  if (mode === 'outline') {
    outlineHost.hidden = false;
    mapHost.hidden = true;
    mapTools.hidden = true;
    panel.classList.remove('map-mode');
    panel.dataset.mode = 'outline';
    paintOutline();
    if (treeApi) treeApi.refresh(focusId);
  } else {
    outlineHost.hidden = true;
    mapHost.hidden = false;
    mapTools.hidden = false;
    panel.classList.add('map-mode');
    panel.dataset.mode = 'map';
    renderMap();
  }
}

function setMode(next) {
  mode = next;
  btnOutline.setAttribute('aria-pressed', mode === 'outline' ? 'true' : 'false');
  btnMap.setAttribute('aria-pressed', mode === 'map' ? 'true' : 'false');
  paint();
}

btnOutline.addEventListener('click', () => setMode('outline'));
btnMap.addEventListener('click', () => setMode('map'));

btnZoomIn.addEventListener('click', () => {
  const r = mapHost.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2);
});
btnZoomOut.addEventListener('click', () => {
  const r = mapHost.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.2);
});
btnResetView.addEventListener('click', () => resetCam());

/* Pan / zoom gestures on mapHost */
{
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  /** @type {Map<number, {x:number,y:number}>} */
  const pointers = new Map();
  let pinchStartDist = 0;
  let pinchStartK = 1;

  mapHost.addEventListener(
    'wheel',
    (e) => {
      if (mode !== 'map') return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomAt(e.clientX, e.clientY, factor);
    },
    { passive: false },
  );

  mapHost.addEventListener('pointerdown', (e) => {
    if (mode !== 'map') return;
    if (e.target.closest?.('.map-node')) return; // fold click, not pan
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    mapHost.setPointerCapture?.(e.pointerId);
    if (pointers.size === 1) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      mapHost.classList.add('panning');
    } else if (pointers.size === 2) {
      dragging = false;
      const pts = [...pointers.values()];
      pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchStartK = cam.k;
    }
  });

  mapHost.addEventListener('pointermove', (e) => {
    if (mode !== 'map') return;
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinchStartDist > 0) {
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        const target = pinchStartK * (dist / pinchStartDist);
        const factor = target / cam.k;
        zoomAt(midX, midY, factor);
      }
      return;
    }
    if (!dragging) return;
    cam.x += e.clientX - lastX;
    cam.y += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    applyCam();
  });

  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStartDist = 0;
    if (pointers.size === 0) {
      dragging = false;
      mapHost.classList.remove('panning');
    }
  };
  mapHost.addEventListener('pointerup', endPointer);
  mapHost.addEventListener('pointercancel', endPointer);
}

function moveFocus(delta) {
  const list = visibleList();
  const i = list.findIndex((n) => n.id === focusId);
  const j = Math.max(0, Math.min(list.length - 1, (i < 0 ? 0 : i) + delta));
  focusId = list[j].id;
  paint();
}

/** Map-mode keyboard (Outline uses attachOutlineTree). */
document.addEventListener('keydown', (e) => {
  if (mode !== 'map') return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const inMap =
    mapHost.contains(document.activeElement) ||
    document.activeElement === document.body ||
    document.activeElement === btnMap ||
    panel.contains(document.activeElement);
  if (!inMap) return;

  const n = findNode(doc.nodes, focusId);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveFocus(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveFocus(-1);
  } else if (e.key === 'Home') {
    e.preventDefault();
    focusId = visibleList()[0]?.id || 'root';
    paint();
  } else if (e.key === 'End') {
    e.preventDefault();
    const v = visibleList();
    focusId = v[v.length - 1]?.id || 'root';
    paint();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (n && hasKids(n) && isCollapsed(doc, n.id)) {
      doc = toggleFold(doc, n.id);
      paint();
    } else if (n && hasKids(n) && n.children[0]?.id) {
      focusId = n.children[0].id;
      paint();
    }
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (n && hasKids(n) && !isCollapsed(doc, n.id)) {
      doc = toggleFold(doc, n.id);
      paint();
    } else {
      const p = parentOf(doc.nodes, focusId);
      if (p?.id) {
        focusId = p.id;
        paint();
      }
    }
  } else if (e.key === 'Enter' || e.key === ' ' || e.key === '.') {
    if (n && hasKids(n)) {
      e.preventDefault();
      doc = toggleFold(doc, n.id);
      paint();
    }
  } else if (e.key === '*') {
    e.preventDefault();
    doc = setExpandLevel(doc, '*');
    paint();
  } else if (e.key >= '0' && e.key <= '9') {
    e.preventDefault();
    doc = setExpandLevel(doc, Number(e.key));
    paint();
  }
});

window.addEventListener('resize', () => {
  if (mode === 'map') {
    // Keep camera; refresh svg sizing.
    const svg = mapHost.querySelector('svg');
    if (svg) {
      svg.setAttribute('viewBox', `0 0 ${Math.max(1, mapHost.clientWidth)} ${Math.max(1, mapHost.clientHeight)}`);
    }
  }
});

async function boot() {
  let raw;
  try {
    const res = await fetch(MD_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.text();
  } catch (err) {
    showError(
      'Could not load solar-system.md — open via a static server (Pages / npx serve), not file://. ' +
        (err instanceof Error ? err.message : String(err)),
    );
    return;
  }

  doc = parse(raw);
  layout = await resolveLayout(raw);
  ensurePositions();

  if (!findNode(doc.nodes, 'root') && doc.nodes[0]?.id) {
    focusId = doc.nodes[0].id;
  }

  treeApi = attachOutlineTree(outlineHost, {
    getDoc: () => doc,
    setDoc: (d) => {
      doc = d;
    },
    render: () => {
      paintOutline();
    },
    // No unlock / decrypt — solar is chrome-free.
  });

  // Capture focus id from outline clicks for shared map focus.
  outlineHost.addEventListener('click', (e) => {
    const li = e.target.closest?.('[role="treeitem"]');
    if (li?.getAttribute('data-id')) focusId = li.getAttribute('data-id');
  });

  setMode('outline');
}

boot();
