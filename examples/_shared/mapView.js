/**
 * Shared map renderer: doc + fold + layoutSidecar → SVG L→R pills.
 * All Pages map demos use this — no per-page map builders.
 * Sealed nodes: omitted until unlocked (no gray stubs) — caller filters doc if needed.
 *
 * Auto-pack (`layout._source === 'auto-pack'`): recursive L→R tidy layout.
 * Parent Y centres on the midpoint of its visible child stack; tree height grows
 * with leaf/sibling count (no fixed short column). Recomputed on every paint so
 * fold expand/collapse reflows without overlap.
 */
import {
  toggleFold,
  isCollapsed,
  setExpandLevel,
} from '../../dist/index.js';

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

function prefersReducedMotion() {
  try {
    return (
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

/**
 * Deterministic L→R auto-pack for the *visible* (non-collapsed) tree.
 * Parent centres vertically on the midpoint of its child stack; height grows
 * with siblings/leaves. Column X uses max pill width per depth so roots are
 * not clipped on the left.
 *
 * @param {{ nodes: object[] }} doc
 * @param {object} [opts]
 * @param {(id: string) => boolean} [opts.isNodeCollapsed]
 * @param {number} [opts.gapY] min vertical gap between sibling pill edges
 * @param {number} [opts.gapX] horizontal gap between adjacent column pill edges
 * @param {number} [opts.margin] canvas padding
 * @returns {{ nodes: Record<string, {x:number,y:number}>, viewBox: {w:number,h:number} }}
 */
export function autoPackPositions(doc, opts = {}) {
  const isNodeCollapsed = opts.isNodeCollapsed || (() => false);
  const gapY = opts.gapY ?? 14;
  const gapX = opts.gapX ?? 56;
  const margin = opts.margin ?? 40;

  /** @type {{ n: object, depth: number }[]} */
  const visible = [];
  function walkVis(n, depth) {
    if (!n?.id) return;
    visible.push({ n, depth });
    if (hasKids(n) && !isNodeCollapsed(n.id)) {
      for (const c of n.children) walkVis(c, depth + 1);
    }
  }
  for (const root of doc.nodes || []) walkVis(root, 0);

  /** @type {Map<number, number>} */
  const maxWAtDepth = new Map();
  for (const { n, depth } of visible) {
    const { w } = pillSize(shortLabel(n.title));
    maxWAtDepth.set(depth, Math.max(maxWAtDepth.get(depth) || 0, w));
  }
  const depths = [...maxWAtDepth.keys()];
  const maxDepth = depths.length ? Math.max(...depths) : 0;

  /** @type {Map<number, number>} */
  const colX = new Map();
  let xCursor = margin;
  for (let d = 0; d <= maxDepth; d++) {
    const w = maxWAtDepth.get(d) || 88;
    xCursor += w / 2;
    colX.set(d, xCursor);
    xCursor += w / 2 + gapX;
  }

  /** @type {Record<string, {x:number,y:number}>} */
  const positions = {};

  /**
   * @param {object} n
   * @param {number} depth
   * @param {number} top
   * @returns {number} subtree block height
   */
  function layoutSubtree(n, depth, top) {
    const { h } = pillSize(shortLabel(n.title));
    const x = colX.get(depth) ?? margin + 44;
    const kids =
      hasKids(n) && !isNodeCollapsed(n.id)
        ? n.children.filter((c) => c?.id)
        : [];

    if (kids.length === 0) {
      positions[n.id] = { x, y: top + h / 2 };
      return h;
    }

    let y = top;
    for (let i = 0; i < kids.length; i++) {
      const ch = layoutSubtree(kids[i], depth + 1, y);
      y += ch;
      if (i < kids.length - 1) y += gapY;
    }
    const stackH = y - top;
    // Parent pill centres on midpoint of visible child stack (M9).
    positions[n.id] = { x, y: top + stackH / 2 };
    return Math.max(stackH, h);
  }

  let top = margin;
  const roots = (doc.nodes || []).filter((r) => r?.id);
  for (let i = 0; i < roots.length; i++) {
    const h = layoutSubtree(roots[i], 0, top);
    top += h;
    if (i < roots.length - 1) top += gapY * 2;
  }

  let maxX = margin;
  let maxY = margin;
  for (const { n } of visible) {
    const pos = positions[n.id];
    if (!pos) continue;
    const { w, h } = pillSize(shortLabel(n.title));
    maxX = Math.max(maxX, pos.x + w / 2);
    maxY = Math.max(maxY, pos.y + h / 2);
  }

  return {
    nodes: positions,
    viewBox: {
      w: Math.max(400, Math.ceil(maxX + margin)),
      h: Math.max(300, Math.ceil(maxY + margin)),
    },
  };
}

/**
 * @typedef {object} MapViewOptions
 * @property {() => import('../../dist/index.js').OutlineFoldDoc} getDoc
 * @property {(d: import('../../dist/index.js').OutlineFoldDoc) => void} setDoc
 * @property {() => object} getLayout mutable layout { viewBox, nodes: {id:{x,y}} }
 * @property {() => string} getFocusId
 * @property {(id: string) => void} setFocusId
 * @property {() => void} [onChange] after fold / focus paint
 * @property {string} [ariaLabel]
 * @property {() => boolean} [isActive] whether map mode is showing (gestures/keyboard)
 */

/**
 * @param {HTMLElement} host
 * @param {MapViewOptions} opts
 */
export function createMapView(host, opts) {
  const {
    getDoc,
    setDoc,
    getLayout,
    getFocusId,
    setFocusId,
    onChange,
    ariaLabel = 'Outline mind map, left to right. Pan and zoom enabled.',
    isActive = () => true,
  } = opts;

  const CAM_MIN = 0.35;
  const CAM_MAX = 3.5;
  const cam = { x: 0, y: 0, k: 1 };
  const ANIM_MS = 280;

  function applyCam() {
    const g = host.querySelector('#mapViewport');
    if (!g) return;
    g.setAttribute(
      'transform',
      `translate(${cam.x} ${cam.y}) scale(${cam.k})`,
    );
  }

  function resetCam() {
    const layout = getLayout();
    const vb = layout.viewBox || { w: 1200, h: 960 };
    const rect = host.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const k = Math.min(w / vb.w, h / vb.h) * 0.92;
    cam.k = Math.max(CAM_MIN, Math.min(CAM_MAX, k || 1));
    cam.x = (w - vb.w * cam.k) / 2;
    cam.y = (h - vb.h * cam.k) / 2;
    applyCam();
  }

  function zoomAt(clientX, clientY, factor) {
    const rect = host.getBoundingClientRect();
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

  function isAutoPack(layout) {
    return layout?._source === 'auto-pack';
  }

  /**
   * Auto-pack: full recompute from fold-visible tree every call.
   * Sidecar: fill only missing ids (authored positions kept).
   */
  function ensurePositions() {
    const layout = getLayout();
    const doc = getDoc();
    if (!layout.nodes) layout.nodes = {};

    if (isAutoPack(layout)) {
      const packed = autoPackPositions(doc, {
        isNodeCollapsed: (id) => isCollapsed(doc, id),
      });
      layout.nodes = packed.nodes;
      layout.viewBox = packed.viewBox;
      return;
    }

    const vb = layout.viewBox || { w: 1200, h: 960 };
    layout.viewBox = vb;

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

  function visibleList(nodes, out = []) {
    const doc = getDoc();
    const roots = nodes ?? doc.nodes;
    for (const n of roots) {
      out.push(n);
      if (hasKids(n) && n.id && !isCollapsed(doc, n.id)) {
        visibleList(n.children, out);
      }
    }
    return out;
  }

  /** Snapshot centres before paint for FLIP relocate (M11). */
  function snapshotPositions() {
    /** @type {Record<string, {x:number,y:number}>} */
    const snap = {};
    const layout = getLayout();
    if (!layout?.nodes) return snap;
    for (const [id, pos] of Object.entries(layout.nodes)) {
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
        snap[id] = { x: pos.x, y: pos.y };
      }
    }
    return snap;
  }

  function runFlipAnimation(prev) {
    if (!prev || prefersReducedMotion()) return;
    const layout = getLayout();
    const nodes = host.querySelectorAll('.map-node');
    if (!nodes.length) return;

    /** @type {SVGElement[]} */
    const movers = [];
    nodes.forEach((g) => {
      const id = g.getAttribute('data-id');
      if (!id || !prev[id] || !layout.nodes[id]) return;
      const dx = prev[id].x - layout.nodes[id].x;
      const dy = prev[id].y - layout.nodes[id].y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      g.style.transition = 'none';
      g.style.transform = `translate(${dx}px, ${dy}px)`;
      movers.push(g);
    });
    if (!movers.length) return;

    // Soft: fade edges while nodes ease (avoids connector teleport jank).
    host.querySelectorAll('.map-edge').forEach((el) => {
      el.style.transition = 'none';
      el.style.opacity = '0.25';
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        movers.forEach((g) => {
          g.style.transition = `transform ${ANIM_MS}ms ease`;
          g.style.transform = '';
        });
        host.querySelectorAll('.map-edge').forEach((el) => {
          el.style.transition = `opacity ${ANIM_MS}ms ease`;
          el.style.opacity = '';
        });
        window.setTimeout(() => {
          movers.forEach((g) => {
            g.style.transition = '';
            g.style.transform = '';
          });
          host.querySelectorAll('.map-edge').forEach((el) => {
            el.style.transition = '';
            el.style.opacity = '';
          });
        }, ANIM_MS + 40);
      });
    });
  }

  function paint() {
    const prev = snapshotPositions();
    const hadViewport = !!host.querySelector('#mapViewport');

    ensurePositions();
    const doc = getDoc();
    const layout = getLayout();
    const vb = layout.viewBox;
    const focusId = getFocusId();
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
        // Native SVG tooltip for truncated labels (M5 soft).
        return `<g class="${cls}" data-id="${esc(n.id)}" tabindex="${n.id === focusId ? 0 : -1}"
      role="button" aria-label="${esc(label)}${foldable ? (col ? ', collapsed' : ', expanded') : ''}"
      ${foldable ? `aria-expanded="${col ? 'false' : 'true'}"` : ''}>
      <title>${esc(n.title)}</title>
      <rect class="map-pill" x="${x}" y="${y}" width="${w}" height="${h}" rx="18" ry="18"/>
      <text class="map-label" x="${pos.x}" y="${pos.y + 4}" text-anchor="middle">${esc(label)}</text>
      ${marker}
    </g>`;
      })
      .join('');

    host.innerHTML = `<svg class="map-svg" viewBox="0 0 ${Math.max(1, host.clientWidth || 1180)} ${Math.max(1, host.clientHeight || 520)}"
      preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="${esc(ariaLabel)}">
      <rect width="100%" height="100%" fill="var(--map-bg)"/>
      <g id="mapViewport">
        <rect x="0" y="0" width="${vb.w}" height="${vb.h}" fill="var(--map-bg)" opacity="0"/>
        ${edgeSvg}
        ${nodeSvg}
      </g>
    </svg>`;

    if (!hadViewport) resetCam();
    else applyCam();

    if (hadViewport && isAutoPack(layout)) {
      runFlipAnimation(prev);
    }

    host.querySelectorAll('.map-node').forEach((g) => {
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = g.getAttribute('data-id');
        setFocusId(id);
        const n = findNode(getDoc().nodes, id);
        if (n && hasKids(n)) {
          setDoc(toggleFold(getDoc(), id));
        }
        onChange?.();
      });
    });

    const focused = host.querySelector(
      `[data-id="${CSS.escape(getFocusId())}"]`,
    );
    if (focused && isActive()) focused.focus({ preventScroll: true });
  }

  function moveFocus(delta) {
    const list = visibleList();
    const i = list.findIndex((n) => n.id === getFocusId());
    const j = Math.max(0, Math.min(list.length - 1, (i < 0 ? 0 : i) + delta));
    setFocusId(list[j].id);
    onChange?.();
  }

  function bindGestures() {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    /** @type {Map<number, {x:number,y:number}>} */
    const pointers = new Map();
    let pinchStartDist = 0;
    let pinchStartK = 1;

    host.addEventListener(
      'wheel',
      (e) => {
        if (!isActive()) return;
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        zoomAt(e.clientX, e.clientY, factor);
      },
      { passive: false },
    );

    host.addEventListener('pointerdown', (e) => {
      if (!isActive()) return;
      if (e.target.closest?.('.map-node')) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      host.setPointerCapture?.(e.pointerId);
      if (pointers.size === 1) {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        host.classList.add('panning');
      } else if (pointers.size === 2) {
        dragging = false;
        const pts = [...pointers.values()];
        pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        pinchStartK = cam.k;
      }
    });

    host.addEventListener('pointermove', (e) => {
      if (!isActive()) return;
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
        host.classList.remove('panning');
      }
    };
    host.addEventListener('pointerup', endPointer);
    host.addEventListener('pointercancel', endPointer);

    window.addEventListener('resize', () => {
      if (!isActive()) return;
      const svg = host.querySelector('svg');
      if (svg) {
        svg.setAttribute(
          'viewBox',
          `0 0 ${Math.max(1, host.clientWidth)} ${Math.max(1, host.clientHeight)}`,
        );
      }
    });
  }

  /**
   * Map-mode keyboard (Outline uses attachOutlineTree).
   * @param {object} [wire]
   * @param {HTMLElement} [wire.panel]
   * @param {HTMLElement} [wire.modeButton]
   */
  function bindKeyboard(wire = {}) {
    document.addEventListener('keydown', (e) => {
      if (!isActive()) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const panel = wire.panel;
      const inMap =
        host.contains(document.activeElement) ||
        document.activeElement === document.body ||
        (wire.modeButton && document.activeElement === wire.modeButton) ||
        (panel && panel.contains(document.activeElement));
      if (!inMap) return;

      const doc = getDoc();
      const n = findNode(doc.nodes, getFocusId());
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveFocus(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveFocus(-1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setFocusId(visibleList()[0]?.id || 'root');
        onChange?.();
      } else if (e.key === 'End') {
        e.preventDefault();
        const v = visibleList();
        setFocusId(v[v.length - 1]?.id || 'root');
        onChange?.();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (n && hasKids(n) && isCollapsed(doc, n.id)) {
          setDoc(toggleFold(doc, n.id));
          onChange?.();
        } else if (n && hasKids(n) && n.children[0]?.id) {
          setFocusId(n.children[0].id);
          onChange?.();
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (n && hasKids(n) && !isCollapsed(doc, n.id)) {
          setDoc(toggleFold(doc, n.id));
          onChange?.();
        } else {
          const p = parentOf(doc.nodes, getFocusId());
          if (p?.id) {
            setFocusId(p.id);
            onChange?.();
          }
        }
      } else if (e.key === 'Enter' || e.key === ' ' || e.key === '.') {
        if (n && hasKids(n)) {
          e.preventDefault();
          setDoc(toggleFold(doc, n.id));
          onChange?.();
        }
      } else if (e.key === '*') {
        e.preventDefault();
        setDoc(setExpandLevel(doc, '*'));
        onChange?.();
      } else if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        setDoc(setExpandLevel(doc, Number(e.key)));
        onChange?.();
      }
    });
  }

  return {
    paint,
    ensurePositions,
    resetCam,
    zoomAt,
    applyCam,
    cam,
    bindGestures,
    bindKeyboard,
    visibleList,
    findNode,
  };
}
