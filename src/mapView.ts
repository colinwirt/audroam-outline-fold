/**
 * Map renderer: doc + fold + layout → SVG L→R pills.
 * Auto-pack (`layout._source === 'auto-pack'`): recursive L→R tidy layout.
 * Parent Y centres on the midpoint of its visible child stack; tree height grows
 * with leaf/sibling count. Recomputed on every paint so fold expand/collapse
 * reflows without overlap.
 *
 * Scrapbook (0.2.8+): multi-line wrap, task lead SVG, text click ≠ fold; label text selectable (0.2.10); pan clears selection (0.2.11); keyboard only when Map focused (0.2.12); rich caption breaks+HTML + focus-on-click + camera follow/clamp (0.2.13); proportion follow + cameraRecentre + edit ensure (0.2.14).
 * Sealed nodes: omitted until unlocked (no gray stubs) — caller filters doc if needed.
 */
import {
  toggleFold,
  isCollapsed,
  setExpandLevel,
} from './fold.js';
import type { OutlineFoldDoc, OutlineNode } from './types.js';
import {
  measurePill,
  DEFAULT_WRAP_CH,
  DEFAULT_MAX_LINES,
  SOFT_SAFETY_MAX_LINES,
  SOFT_SAFETY_MAX_CHARS,
  TASK_LEAD,
  LINE_H,
  PILL_PAD_Y,
  MORE_AFFORDANCE_H,
} from './mapLabel.js';
import {
  displayCaption,
  resolveTask,
  resolveAction,
  resolveThread,
  toggleTaskMarker,
  type TaskState,
  type TaskToggleEvent,
} from './taskChrome.js';
import {
  captionRunToTspanInner,
  type CaptionStyleRun,
} from './captionRich.js';
import {
  clampCamToContent,
  minKForContent,
  camToEnsureVisible,
  camToFrameRects,
  followActionForFocus,
  followActionForExpand,
  pillWorldRect,
  unionWorldRects,
  lerpCam,
  easeOutCubic,
  DEFAULT_FOLLOW_EASE_MS,
  DEFAULT_CAM_PADDING_PX,
  DEFAULT_KEEP_VISIBLE_FRAC,
  DEFAULT_RECENTRE_FRAC,
  type CamState,
  type WorldRect,
} from './mapCamera.js';
import { toggleTask, shouldFireAction } from './task.js';

export interface MapPoint {
  x: number;
  y: number;
  wrapCh?: number;
  /** Product clip; null = unlimited (soft safety). Default ~30 when omitted. */
  maxLines?: number | null;
  /** more/less body reveal — orthogonal to child fold. */
  bodyExpanded?: boolean;
}

export interface MapViewBox {
  w: number;
  h: number;
}

/** Mutable layout: authored sidecar positions or auto-pack. */
export interface MapLayout {
  viewBox?: MapViewBox;
  nodes?: Record<string, MapPoint>;
  /** `'auto-pack'` triggers full recompute each paint; other values keep sidecar coords. */
  _source?: string;
  version?: number;
  layout?: string;
  [key: string]: unknown;
}

export interface AutoPackOptions {
  isNodeCollapsed?: (id: string) => boolean;
  gapY?: number;
  gapX?: number;
  margin?: number;
  /** Default wrapCh when node layout omits it. */
  wrapCh?: number;
  /** Default maxLines; omit/null = full body. */
  maxLines?: number | null;
  /** Optional per-id layout nudges (wrapCh/maxLines). */
  nodeLayout?: Record<string, MapPoint>;
}

export interface AutoPackResult {
  nodes: Record<string, MapPoint>;
  viewBox: MapViewBox;
}

export interface PillSizeOptions {
  reserveFold?: boolean;
  reserveTask?: boolean;
  wrapCh?: number;
  maxLines?: number | null;
  bodyExpanded?: boolean;
}

export interface PillSize {
  w: number;
  h: number;
  textW: number;
  foldSlot: number;
  taskLead: number;
  lines: string[];
  richLines: CaptionStyleRun[][];
  truncated: boolean;
  fullText: string;
  softSafetyHit?: boolean;
  totalLines: number;
  showMore: boolean;
  showLess: boolean;
  bodyExpanded: boolean;
  effectiveMaxLines: number | null;
}

export interface MapViewOptions {
  getDoc: () => OutlineFoldDoc;
  setDoc: (d: OutlineFoldDoc) => void;
  getLayout: () => MapLayout;
  getFocusId: () => string;
  setFocusId: (id: string) => void;
  onChange?: () => void;
  ariaLabel?: string;
  /** Whether map mode is showing (gestures/keyboard). */
  isActive?: () => boolean;
  /** Task checkbox toggle — host owns persist / side effects. */
  onTaskToggle?: (ev: TaskToggleEvent) => void;
  /** Optional: open→done action hook (`<action:…>`). */
  onAction?: (ev: { id: string; action: string; node: OutlineNode }) => void;
  /** Optional: thread chip navigate (`<thread:…>`). */
  onThread?: (ev: { id: string; thread: string; node: OutlineNode }) => void;
  /**
   * When true (default), expand/focus may recentre the group.
   * When false, only gentle ensure-visible runs (edit ensure still on).
   * Boolean or live getter.
   */
  cameraRecentre?: boolean | (() => boolean);
  /**
   * Edit mode: when true, always gentle-ensure the edit node (+ optional region)
   * stays visible — even if cameraRecentre is off. Prefer ensure over recentre.
   */
  isEditing?: () => boolean;
  /** Optional world rect for caret/typing region while editing (else focus pill). */
  getEditRegion?: () => WorldRect | null | undefined;
}

export interface MapKeyboardWire {
  /** @deprecated Ignored for key gating since 0.2.12 (host/modeButton only). Kept for call-site compat. */
  panel?: HTMLElement | null;
  /** When focused (e.g. after clicking Map), digit/fold/arrow keys still apply. */
  modeButton?: HTMLElement | null;
}

export interface MapViewHandle {
  paint: () => void;
  ensurePositions: () => void;
  resetCam: () => void;
  zoomAt: (clientX: number, clientY: number, factor: number) => void;
  applyCam: () => void;
  cam: { x: number; y: number; k: number };
  bindGestures: () => void;
  bindKeyboard: (wire?: MapKeyboardWire) => void;
  visibleList: (nodes?: OutlineNode[], out?: OutlineNode[]) => OutlineNode[];
  findNode: (nodes: OutlineNode[], id: string) => OutlineNode | null;
  /** Gentle ensure edit node / caret region visible (host may call while typing). */
  ensureEditVisible: () => void;
}

function walkNodes(
  nodes: OutlineNode[],
  fn: (n: OutlineNode, depth: number) => void,
  depth = 0,
): void {
  for (const n of nodes) {
    fn(n, depth);
    if (n.children?.length) walkNodes(n.children, fn, depth + 1);
  }
}

function findNode(nodes: OutlineNode[], id: string): OutlineNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

function parentOf(
  nodes: OutlineNode[],
  id: string,
  parent: OutlineNode | null = null,
): OutlineNode | null | undefined {
  for (const n of nodes) {
    if (n.id === id) return parent;
    if (n.children?.length) {
      const hit = parentOf(n.children, id, n);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

function hasKids(n: OutlineNode): boolean {
  return !!(n.children && n.children.length > 0);
}

function isCue(n: OutlineNode | null | undefined): boolean {
  if (!n) return false;
  if (n.id && /^cue/i.test(n.id)) return true;
  return /^\s*cue\s*:/i.test(n.title || '');
}

/**
 * Short single-line label (legacy / Outline). Map scrapbook uses displayCaption + wrap.
 * Kept for tests that assert on · split.
 */
function shortLabel(title: string): string {
  const parts = String(title).split(' · ');
  if (parts.length >= 2) return parts[0].trim();
  return title.length > 36 ? title.slice(0, 34) + '…' : title;
}

/** Reserved end-cap on every foldable pill; circle-+ painted only when collapsed (M12 / fold-slot-always).
 * 34 = 2*(r+clear) with r≈9 and ≥8px clear for gold focus stroke (Design UX 2026-09-29 end-cap air). */
export const FOLD_SLOT = 34;

export { DEFAULT_WRAP_CH, DEFAULT_MAX_LINES, SOFT_SAFETY_MAX_LINES, SOFT_SAFETY_MAX_CHARS, TASK_LEAD };

/**
 * Measure pill dimensions; optionally reserve fold chrome end-cap and task lead.
 * Multi-line: wrapCh default 32; maxLines omit/null = full body (soft safety only).
 */
export function pillSize(label: string, opts: PillSizeOptions = {}): PillSize {
  const measured = measurePill(label, {
    wrapCh: opts.wrapCh ?? DEFAULT_WRAP_CH,
    maxLines: opts.maxLines,
    bodyExpanded: opts.bodyExpanded,
    reserveFold: opts.reserveFold,
    reserveTask: opts.reserveTask,
    foldSlot: FOLD_SLOT,
    taskLead: TASK_LEAD,
  });
  return measured;
}

function nodePillOpts(
  n: OutlineNode,
  nodeLayout?: Record<string, MapPoint>,
  defaults?: { wrapCh?: number; maxLines?: number | null },
): PillSizeOptions {
  const lay = n.id && nodeLayout ? nodeLayout[n.id] : undefined;
  const maxLines =
    lay?.maxLines !== undefined
      ? lay.maxLines
      : defaults?.maxLines !== undefined
        ? defaults.maxLines
        : undefined;
  return {
    reserveFold: hasKids(n),
    reserveTask: !!resolveTask(n),
    wrapCh: lay?.wrapCh ?? defaults?.wrapCh ?? DEFAULT_WRAP_CH,
    maxLines,
    bodyExpanded: !!lay?.bodyExpanded,
  };
}

function connectorPath(
  px: number,
  py: number,
  pw: number,
  cx: number,
  cy: number,
  cw: number,
): string {
  const x1 = px + pw / 2;
  const y1 = py;
  const x2 = cx - cw / 2;
  const y2 = cy;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function prefersReducedMotion(): boolean {
  try {
    return (
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

function taskGlyphSvg(state: TaskState, x: number, y: number): string {
  const stroke = state === 'done' ? '#C9A227' : '#8b9bab';
  const check =
    state === 'done'
      ? `<path d="M-4 0.5 l2.5 2.5 L4 -3" fill="none" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>`
      : '';
  return `<g class="map-task-glyph" transform="translate(${x} ${y})" aria-hidden="true">
    <rect x="-7" y="-7" width="14" height="14" rx="3" fill="none" stroke="${stroke}" stroke-width="1.75"/>
    ${check}
  </g>`;
}

function multiLineText(
  lines: string[],
  textX: number,
  centreY: number,
  _textW: number,
  richLines?: CaptionStyleRun[][],
): string {
  const n = Math.max(1, lines.length);
  const blockH = n * LINE_H;
  const top = centreY - blockH / 2 + LINE_H * 0.75;
  const tspans = lines
    .map((line, i) => {
      const dy = i === 0 ? 0 : LINE_H;
      const runs = richLines?.[i];
      if (runs && runs.length) {
        const inner = runs
          .map((r) => {
            const text =
              r.text === '' && runs.length === 1 ? '\u00a0' : r.text;
            return captionRunToTspanInner({ ...r, text });
          })
          .join('');
        return `<tspan x="${textX}" dy="${dy}">${inner || '\u00a0'}</tspan>`;
      }
      const show = line === '' ? '\u00a0' : esc(line);
      return `<tspan x="${textX}" dy="${dy}">${show}</tspan>`;
    })
    .join('');
  return `<text class="map-label" x="${textX}" y="${top}" text-anchor="middle">${tspans}</text>`;
}

/**
 * Deterministic L→R auto-pack for the *visible* (non-collapsed) tree.
 * Parent centres vertically on the midpoint of its child stack; height grows
 * with siblings/leaves. Siblings under the *same parent* share a common left
 * edge (M13) — not a tree-wide depth column. Each parent's child group starts
 * at parentRight + gapX, so different parents' kids may sit at different X.
 */
export function autoPackPositions(
  doc: OutlineFoldDoc,
  opts: AutoPackOptions = {},
): AutoPackResult {
  const isNodeCollapsed = opts.isNodeCollapsed || (() => false);
  const gapY = opts.gapY ?? 14;
  const gapX = opts.gapX ?? 56;
  const margin = opts.margin ?? 40;
  const defaults = { wrapCh: opts.wrapCh, maxLines: opts.maxLines };
  const nodeLayout = opts.nodeLayout;

  const visible: { n: OutlineNode; depth: number }[] = [];
  function walkVis(n: OutlineNode, depth: number): void {
    if (!n?.id) return;
    visible.push({ n, depth });
    if (hasKids(n) && !isNodeCollapsed(n.id)) {
      for (const c of n.children!) walkVis(c, depth + 1);
    }
  }
  for (const root of doc.nodes || []) walkVis(root, 0);

  const positions: Record<string, MapPoint> = {};

  function layoutSubtree(n: OutlineNode, left: number, top: number): number {
    const label = displayCaption(n.title);
    const { w, h } = pillSize(label, nodePillOpts(n, nodeLayout, defaults));
    const x = left + w / 2;
    const kids =
      hasKids(n) && !isNodeCollapsed(n.id!)
        ? n.children!.filter((c) => c?.id)
        : [];

    if (kids.length === 0) {
      positions[n.id!] = { x, y: top + h / 2 };
      return h;
    }

    const kidLeft = left + w + gapX;
    let y = top;
    for (let i = 0; i < kids.length; i++) {
      const ch = layoutSubtree(kids[i], kidLeft, y);
      y += ch;
      if (i < kids.length - 1) y += gapY;
    }
    const stackH = y - top;
    positions[n.id!] = { x, y: top + stackH / 2 };
    return Math.max(stackH, h);
  }

  let top = margin;
  const roots = (doc.nodes || []).filter((r) => r?.id);
  for (let i = 0; i < roots.length; i++) {
    const h = layoutSubtree(roots[i], margin, top);
    top += h;
    if (i < roots.length - 1) top += gapY * 2;
  }

  let maxX = margin;
  let maxY = margin;
  for (const { n } of visible) {
    const pos = positions[n.id!];
    if (!pos) continue;
    const label = displayCaption(n.title);
    const { w, h } = pillSize(label, nodePillOpts(n, nodeLayout, defaults));
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

export type MapFocusDirection =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'home'
  | 'end';

export interface ResolveMapFocusOptions {
  isNodeCollapsed?: (id: string) => boolean;
  positions?: Record<string, MapPoint>;
}

/**
 * Map L→R orientation focus resolver (v1). Fold is never implied by a direction.
 * Returns the next focus id, or `null` for a soft no-op.
 */
export function resolveMapFocus(
  doc: OutlineFoldDoc,
  focusId: string,
  direction: MapFocusDirection,
  opts: ResolveMapFocusOptions = {},
): string | null {
  const isNodeCollapsed = opts.isNodeCollapsed || (() => false);
  const positions = opts.positions;
  const focused = findNode(doc.nodes, focusId);
  if (!focused?.id) return null;

  function siblingSet(id: string): OutlineNode[] {
    const p = parentOf(doc.nodes, id);
    if (p === undefined) return [];
    const list = p === null ? doc.nodes || [] : p.children || [];
    return list.filter((n) => n?.id);
  }

  function sortSiblings(sibs: OutlineNode[]): OutlineNode[] {
    const indexed = sibs.map((n, i) => ({ n, i }));
    indexed.sort((a, b) => {
      if (positions) {
        const ay = positions[a.n.id!]?.y;
        const by = positions[b.n.id!]?.y;
        if (typeof ay === 'number' && typeof by === 'number' && ay !== by) {
          return ay - by;
        }
      }
      return a.i - b.i;
    });
    return indexed.map((x) => x.n);
  }

  if (
    direction === 'up' ||
    direction === 'down' ||
    direction === 'home' ||
    direction === 'end'
  ) {
    const sibs = sortSiblings(siblingSet(focusId));
    if (!sibs.length) return null;
    const i = sibs.findIndex((n) => n.id === focusId);
    if (direction === 'home') return sibs[0]?.id || null;
    if (direction === 'end') return sibs[sibs.length - 1]?.id || null;
    if (i < 0) return sibs[0]?.id || null;
    if (direction === 'down') {
      if (i >= sibs.length - 1) return null;
      return sibs[i + 1]?.id || null;
    }
    if (i <= 0) return null;
    return sibs[i - 1]?.id || null;
  }

  if (direction === 'right') {
    if (!hasKids(focused) || isNodeCollapsed(focused.id)) return null;
    const first = (focused.children || []).find((c) => c?.id);
    return first?.id || null;
  }

  if (direction === 'left') {
    const p = parentOf(doc.nodes, focusId);
    if (p?.id) return p.id;
    return null;
  }

  return null;
}

function patchNodeTitle(
  nodes: OutlineNode[],
  id: string,
  title: string,
): boolean {
  for (const n of nodes) {
    if (n.id === id) {
      n.title = title;
      return true;
    }
    if (n.children?.length && patchNodeTitle(n.children, id, title)) {
      return true;
    }
  }
  return false;
}

/**
 * Mount an interactive SVG mind-map into `host`.
 */

/**
 * True when a non-collapsed browser Selection intersects `nodeEl`
 * (used so label text-drag can copy without a paint wiping the range).
 */
export function mapNodeKeepsTextSelection(
  nodeEl: Element,
  sel: { isCollapsed: boolean; anchorNode: Node | null; focusNode: Node | null } | null,
): boolean {
  if (!sel || sel.isCollapsed) return false;
  const a = sel.anchorNode;
  const f = sel.focusNode;
  return (!!a && nodeEl.contains(a)) || (!!f && nodeEl.contains(f));
}

/**
 * Clear the browser Selection when a map pan/pinch gesture starts so
 * background drag does not paint a huge text range. Label drag-select
 * never hits this path (`pointerdown` on `.map-node` returns early).
 */
export function clearSelectionForMapPan(
  sel: { removeAllRanges: () => void } | null | undefined,
): void {
  try {
    sel?.removeAllRanges();
  } catch {
    /* Selection API can throw in odd contexts */
  }
}

/**
 * True when paint may re-focus the selected map node. Only when focus is
 * already inside the map host — never steal from a textarea/editor.
 */
export function mapPaintShouldRestoreFocus(
  host: { contains: (node: Node | null) => boolean },
  activeElement: Node | null,
): boolean {
  return !!(activeElement && host.contains(activeElement));
}

type MapKbTarget = {
  tagName?: string;
  isContentEditable?: boolean;
} | null;

/**
 * Gate for Map document keydown: digits / fold / arrows only when Map (or its
 * mode button) owns focus/target — not while typing in INPUT/TEXTAREA/SELECT
 * or contenteditable.
 */
export function mapKeyboardShouldHandle(opts: {
  isActive: boolean;
  target: MapKbTarget;
  activeElement: Node | null;
  host: { contains: (node: Node | null) => boolean };
  modeButton?: Node | null;
}): boolean {
  if (!opts.isActive) return false;
  const tag = (opts.target?.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
  if (opts.target?.isContentEditable) return false;
  const ae = opts.activeElement;
  if (opts.modeButton && ae === opts.modeButton) return true;
  if (ae && opts.host.contains(ae)) return true;
  if (opts.target && opts.host.contains(opts.target as unknown as Node)) {
    return true;
  }
  return false;
}

export function createMapView(
  host: HTMLElement,
  opts: MapViewOptions,
): MapViewHandle {
  const {
    getDoc,
    setDoc,
    getLayout,
    getFocusId,
    setFocusId,
    onChange,
    ariaLabel = 'Outline mind map, left to right. Pan and zoom enabled.',
    isActive = () => true,
    onTaskToggle,
    onAction,
    onThread,
    cameraRecentre: cameraRecentreOpt = true,
    isEditing = () => false,
    getEditRegion,
  } = opts;

  function recentreEnabled(): boolean {
    return typeof cameraRecentreOpt === 'function'
      ? !!cameraRecentreOpt()
      : cameraRecentreOpt !== false;
  }

  if (!host.hasAttribute('tabindex')) host.setAttribute('tabindex', '-1');

  const CAM_MIN = 0.35;
  const CAM_MAX = 3.5;
  const cam = { x: 0, y: 0, k: 1 };
  const ANIM_MS = 280;
  /** User pan/wheel wins until next follow trigger. */
  let userCamGesture = false;
  let followAnim: { raf: number; start: number; from: CamState; to: CamState } | null =
    null;
  type PendingFollow =
    | { kind: 'focus' }
    | { kind: 'expand'; focusId: string }
    | { kind: 'edit' }
    | null;
  let pendingFollow: PendingFollow = null;

  function hostViewport(): { w: number; h: number } {
    const rect = host.getBoundingClientRect();
    return {
      w: Math.max(1, rect.width || host.clientWidth || 1180),
      h: Math.max(1, rect.height || host.clientHeight || 520),
    };
  }

  function cancelFollowAnim(): void {
    if (followAnim) {
      cancelAnimationFrame(followAnim.raf);
      followAnim = null;
    }
  }

  function collectVisiblePillRects(): {
    rects: WorldRect[];
    byId: Map<string, WorldRect>;
  } {
    const doc = getDoc();
    const layout = getLayout();
    const rects: WorldRect[] = [];
    const byId = new Map<string, WorldRect>();
    const defaults = { wrapCh: DEFAULT_WRAP_CH, maxLines: DEFAULT_MAX_LINES };
    function walk(n: OutlineNode): void {
      if (!n.id || !layout.nodes?.[n.id]) return;
      const pos = layout.nodes[n.id]!;
      const label = displayCaption(n.title);
      const foldable = hasKids(n);
      const size = pillSize(label, {
        reserveFold: foldable,
        reserveTask: !!resolveTask(n),
        wrapCh: pos.wrapCh ?? defaults.wrapCh,
        maxLines: pos.maxLines,
        bodyExpanded: !!pos.bodyExpanded,
      });
      const r = pillWorldRect(pos.x, pos.y, size.w, size.h);
      rects.push(r);
      byId.set(n.id, r);
      if (foldable && !isCollapsed(doc, n.id)) {
        for (const c of n.children || []) walk(c);
      }
    }
    for (const root of doc.nodes || []) walk(root);
    return { rects, byId };
  }

  function clampCamNow(): void {
    const { rects } = collectVisiblePillRects();
    const content = unionWorldRects(rects);
    if (!content) return;
    const next = clampCamToContent(cam, hostViewport(), content, {
      paddingPx: DEFAULT_CAM_PADDING_PX,
      minK: CAM_MIN,
      maxK: CAM_MAX,
    });
    cam.x = next.x;
    cam.y = next.y;
    cam.k = next.k;
  }

  function easeCamTo(target: CamState, ms = DEFAULT_FOLLOW_EASE_MS): void {
    cancelFollowAnim();
    const from: CamState = { x: cam.x, y: cam.y, k: cam.k };
    if (
      Math.abs(from.x - target.x) < 0.5 &&
      Math.abs(from.y - target.y) < 0.5 &&
      Math.abs(from.k - target.k) < 0.001
    ) {
      cam.x = target.x;
      cam.y = target.y;
      cam.k = target.k;
      applyCam();
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      if (userCamGesture) {
        followAnim = null;
        return;
      }
      const t = Math.min(1, (now - start) / ms);
      const eased = easeOutCubic(t);
      const cur = lerpCam(from, target, eased);
      cam.x = cur.x;
      cam.y = cur.y;
      cam.k = cur.k;
      applyCam();
      if (t < 1) {
        followAnim = {
          raf: requestAnimationFrame(step),
          start,
          from,
          to: target,
        };
      } else {
        followAnim = null;
        clampCamNow();
        applyCam();
      }
    };
    followAnim = {
      raf: requestAnimationFrame(step),
      start,
      from,
      to: target,
    };
  }

  function collectExpandKids(
    focusId: string | undefined,
    focusRect: WorldRect,
    byId: Map<string, WorldRect>,
  ): { group: WorldRect[]; kids: WorldRect[] } {
    const group: WorldRect[] = [focusRect];
    const kids: WorldRect[] = [];
    if (!focusId) return { group, kids };
    const doc = getDoc();
    const focusNode = findNode(doc.nodes, focusId);
    if (focusNode?.children && !isCollapsed(doc, focusId)) {
      for (const c of focusNode.children) {
        if (c.id && byId.has(c.id)) {
          const r = byId.get(c.id)!;
          group.push(r);
          kids.push(r);
        }
      }
    }
    return { group, kids };
  }

  function runPendingFollow(): void {
    const pending = pendingFollow;
    pendingFollow = null;
    if (!pending || userCamGesture) return;
    const vp = hostViewport();
    const { byId } = collectVisiblePillRects();
    const recentre = recentreEnabled();
    const followOpts = {
      keepFrac: DEFAULT_KEEP_VISIBLE_FRAC,
      recentreFrac: DEFAULT_RECENTRE_FRAC,
      recentre,
    };

    if (pending.kind === 'edit') {
      const focusId = getFocusId();
      const region =
        (typeof getEditRegion === 'function' ? getEditRegion() : null) ||
        (focusId ? byId.get(focusId) : undefined);
      if (!region) return;
      const target = camToEnsureVisible(cam, vp, region, {
        paddingPx: DEFAULT_CAM_PADDING_PX,
        minK: CAM_MIN,
        maxK: CAM_MAX,
        force: true,
      });
      easeCamTo(target);
      return;
    }

    const focusId = pending.kind === 'expand' ? pending.focusId : getFocusId();
    const focusRect = focusId ? byId.get(focusId) : undefined;
    if (!focusRect) return;

    if (pending.kind === 'focus') {
      const action = followActionForFocus(cam, vp, focusRect, followOpts);
      if (action === 'noop') return;
      if (action === 'recentre') {
        easeCamTo(
          camToFrameRects(cam, vp, [focusRect], {
            paddingPx: DEFAULT_CAM_PADDING_PX,
            focus: focusRect,
            focusBias: 1,
            minK: CAM_MIN,
            maxK: CAM_MAX,
            allowZoomOut: true,
          }),
        );
        return;
      }
      easeCamTo(
        camToEnsureVisible(cam, vp, focusRect, {
          paddingPx: DEFAULT_CAM_PADDING_PX,
          minK: CAM_MIN,
          maxK: CAM_MAX,
        }),
      );
      return;
    }

    // expand: recentre hint when kids mostly off-screen (if recentre on)
    const { group, kids } = collectExpandKids(focusId, focusRect, byId);
    const action = followActionForExpand(cam, vp, focusRect, kids, followOpts);
    if (action === 'noop') return;
    if (action === 'recentre') {
      easeCamTo(
        camToFrameRects(cam, vp, group, {
          paddingPx: DEFAULT_CAM_PADDING_PX,
          focus: focusRect,
          focusBias: 0.6,
          minK: CAM_MIN,
          maxK: CAM_MAX,
          allowZoomOut: true,
        }),
      );
      return;
    }
    easeCamTo(
      camToEnsureVisible(cam, vp, focusRect, {
        paddingPx: DEFAULT_CAM_PADDING_PX,
        minK: CAM_MIN,
        maxK: CAM_MAX,
      }),
    );
  }

  function ensureEditVisible(): void {
    if (userCamGesture) return;
    pendingFollow = { kind: 'edit' };
    runPendingFollow();
  }


  /** Ensure Map owns focus so digits/arrows/fold keys work after a node click.
   * Prefer the focused pill; fall back to host. Never steal from textarea on paint
   * alone — mapPaintShouldRestoreFocus still gates paint restore.
   */
  function focusMapForKeys(prefer?: Element | null): void {
    try {
      if (!host.hasAttribute('tabindex')) {
        host.setAttribute('tabindex', '-1');
      }
      if (prefer && typeof (prefer as HTMLElement).focus === 'function') {
        (prefer as HTMLElement).focus({ preventScroll: true });
        if (
          typeof document !== 'undefined' &&
          document.activeElement &&
          host.contains(document.activeElement)
        ) {
          return;
        }
      }
      host.focus({ preventScroll: true });
    } catch {
      /* focus not available */
    }
  }

  function applyCam(): void {
    const g = host.querySelector('#mapViewport');
    if (!g) return;
    g.setAttribute(
      'transform',
      `translate(${cam.x} ${cam.y}) scale(${cam.k})`,
    );
  }

  function resetCam(): void {
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

  function zoomAt(clientX: number, clientY: number, factor: number): void {
    userCamGesture = true;
    cancelFollowAnim();
    const rect = host.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    let next = Math.max(CAM_MIN, Math.min(CAM_MAX, cam.k * factor));
    const { rects } = collectVisiblePillRects();
    const content = unionWorldRects(rects);
    if (content && factor < 1) {
      next = Math.max(
        next,
        minKForContent(hostViewport(), content, {
          minK: CAM_MIN,
          maxK: CAM_MAX,
        }),
      );
    }
    const wx = (mx - cam.x) / cam.k;
    const wy = (my - cam.y) / cam.k;
    cam.k = next;
    cam.x = mx - wx * cam.k;
    cam.y = my - wy * cam.k;
    clampCamNow();
    applyCam();
  }

  function isAutoPack(layout: MapLayout): boolean {
    return layout?._source === 'auto-pack';
  }

  function ensurePositions(): void {
    const layout = getLayout();
    const doc = getDoc();
    if (!layout.nodes) layout.nodes = {};

    if (isAutoPack(layout)) {
      // Preserve wrapCh/maxLines nudges across recompute
      const prior = layout.nodes;
      const packed = autoPackPositions(doc, {
        isNodeCollapsed: (id) => isCollapsed(doc, id),
        nodeLayout: prior,
      });
      const merged: Record<string, MapPoint> = {};
      for (const [id, pos] of Object.entries(packed.nodes)) {
        const prev = prior[id];
        merged[id] = {
          x: pos.x,
          y: pos.y,
          wrapCh: prev?.wrapCh,
          maxLines: prev?.maxLines,
          bodyExpanded: prev?.bodyExpanded,
        };
      }
      layout.nodes = merged;
      layout.viewBox = packed.viewBox;
      return;
    }

    const vb = layout.viewBox || { w: 1200, h: 960 };
    layout.viewBox = vb;

    const byDepth = new Map<number, OutlineNode[]>();
    walkNodes(doc.nodes, (n, depth) => {
      if (!n.id || layout.nodes![n.id]) return;
      if (!byDepth.has(depth)) byDepth.set(depth, []);
      byDepth.get(depth)!.push(n);
    });
    for (const [depth, list] of byDepth) {
      const x = 72 + depth * 280;
      const gap = Math.min(70, (vb.h - 80) / Math.max(1, list.length));
      list.forEach((n, i) => {
        layout.nodes![n.id!] = {
          x,
          y: 60 + i * gap + gap / 2,
        };
      });
    }
  }

  function visibleList(
    nodes?: OutlineNode[],
    out: OutlineNode[] = [],
  ): OutlineNode[] {
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

  function snapshotPositions(): Record<string, MapPoint> {
    const snap: Record<string, MapPoint> = {};
    const layout = getLayout();
    if (!layout?.nodes) return snap;
    for (const [id, pos] of Object.entries(layout.nodes)) {
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
        snap[id] = { x: pos.x, y: pos.y };
      }
    }
    return snap;
  }

  function runFlipAnimation(prev: Record<string, MapPoint>): void {
    if (!prev || prefersReducedMotion()) return;
    const layout = getLayout();
    const nodes = host.querySelectorAll<SVGGElement>('.map-node');
    if (!nodes.length) return;

    const movers: SVGGElement[] = [];
    nodes.forEach((g) => {
      const id = g.getAttribute('data-id');
      if (!id || !prev[id] || !layout.nodes?.[id]) return;
      const dx = prev[id].x - layout.nodes[id].x;
      const dy = prev[id].y - layout.nodes[id].y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      g.style.transition = 'none';
      g.style.transform = `translate(${dx}px, ${dy}px)`;
      movers.push(g);
    });
    if (!movers.length) return;

    host.querySelectorAll<SVGElement>('.map-edge').forEach((el) => {
      el.style.transition = 'none';
      el.style.opacity = '0.25';
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        movers.forEach((g) => {
          g.style.transition = `transform ${ANIM_MS}ms ease`;
          g.style.transform = '';
        });
        host.querySelectorAll<SVGElement>('.map-edge').forEach((el) => {
          el.style.transition = `opacity ${ANIM_MS}ms ease`;
          el.style.opacity = '';
        });
        window.setTimeout(() => {
          movers.forEach((g) => {
            g.style.transition = '';
            g.style.transform = '';
          });
          host.querySelectorAll<SVGElement>('.map-edge').forEach((el) => {
            el.style.transition = '';
            el.style.opacity = '';
          });
        }, ANIM_MS + 40);
      });
    });
  }

  function applyTaskToggle(id: string): void {
    const doc = getDoc();
    const n = findNode(doc.nodes, id);
    if (!n) return;
    // Prefer structured node.task; fall back to title marker rewrite.
    if (n.task) {
      const result = toggleTask(doc, id);
      if (!result) return;
      setDoc(result.doc);
      onTaskToggle?.({
        id,
        from: result.from,
        to: result.to,
        node: result.node,
      });
      if (shouldFireAction(result.from, result.to)) {
        const action = resolveAction(result.node);
        if (action) onAction?.({ id, action, node: result.node });
      }
      onChange?.();
      return;
    }
    const cur = resolveTask(n);
    if (!cur) return;
    const from = cur;
    const to: TaskState = from === 'done' ? 'open' : 'done';
    const nextTitle = toggleTaskMarker(n.title, to);
    const nextDoc: OutlineFoldDoc = {
      frontmatter: doc.frontmatter
        ? {
            ...doc.frontmatter,
            foldIds: doc.frontmatter.foldIds
              ? [...doc.frontmatter.foldIds]
              : undefined,
          }
        : undefined,
      nodes: structuredClone(doc.nodes),
      fold: { mode: doc.fold.mode, ids: [...doc.fold.ids] },
    };
    patchNodeTitle(nextDoc.nodes, id, nextTitle);
    const nextNode = findNode(nextDoc.nodes, id)!;
    // Also stamp structured fields for consistency
    nextNode.task = to;
    setDoc(nextDoc);
    onTaskToggle?.({ id, from, to, node: nextNode });
    if (shouldFireAction(from, to)) {
      const action = resolveAction(nextNode);
      if (action) onAction?.({ id, action, node: nextNode });
    }
    onChange?.();
  }

  function paint(): void {
    // Snapshot before DOM rebuild — never steal focus from the editor.
    const paintFocusOwner =
      typeof document !== 'undefined' ? document.activeElement : null;

    const prev = snapshotPositions();
    const hadViewport = !!host.querySelector('#mapViewport');

    ensurePositions();
    const doc = getDoc();
    const layout = getLayout();
    const vb = layout.viewBox!;
    const focusId = getFocusId();
    const edges: { d: string }[] = [];
    type NodePaint = {
      n: OutlineNode;
      pos: MapPoint;
      label: string;
      w: number;
      h: number;
      textW: number;
      foldSlot: number;
      taskLead: number;
      lines: string[];
      richLines: CaptionStyleRun[][];
      truncated: boolean;
      fullText: string;
      foldable: boolean;
      col: boolean;
      cue: boolean;
      task: TaskState | null;
      thread: string | null;
      showMore: boolean;
      showLess: boolean;
      bodyExpanded: boolean;
    };
    const nodes: NodePaint[] = [];

    function walk(n: OutlineNode): void {
      if (!n.id) return;
      const pos = layout.nodes![n.id] || { x: 100, y: 100 };
      const label = displayCaption(n.title);
      const foldable = hasKids(n);
      const col = foldable && isCollapsed(doc, n.id);
      const taskParsed = resolveTask(n);
      const size = pillSize(label, {
        reserveFold: foldable,
        reserveTask: !!taskParsed,
        wrapCh: pos.wrapCh,
        maxLines: pos.maxLines,
        bodyExpanded: !!pos.bodyExpanded,
      });
      const cue = isCue(n);
      const thread = resolveThread(n);
      nodes.push({
        n,
        pos,
        label,
        w: size.w,
        h: size.h,
        textW: size.textW,
        foldSlot: size.foldSlot,
        taskLead: size.taskLead,
        lines: size.lines,
        richLines: size.richLines,
        truncated: size.truncated,
        fullText: size.fullText || n.title,
        foldable,
        col,
        cue,
        task: taskParsed ?? null,
        thread,
        showMore: size.showMore,
        showLess: size.showLess,
        bodyExpanded: size.bodyExpanded,
      });

      if (foldable && !col) {
        for (const c of n.children!) {
          if (!c.id) continue;
          const cpos = layout.nodes![c.id] || { x: pos.x + 200, y: pos.y };
          const clabel = displayCaption(c.title);
          const cTask = resolveTask(c);
          const cs = pillSize(clabel, {
            reserveFold: hasKids(c),
            reserveTask: !!cTask,
            wrapCh: cpos.wrapCh,
            maxLines: cpos.maxLines,
            bodyExpanded: !!cpos.bodyExpanded,
          });
          edges.push({
            d: connectorPath(pos.x, pos.y, size.w, cpos.x, cpos.y, cs.w),
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
      .map(
        ({
          n,
          pos,
          label,
          w,
          h,
          textW,
          foldSlot,
          taskLead,
          lines,
          richLines,
          truncated,
          fullText,
          foldable,
          col,
          cue,
          task,
          thread,
          showMore,
          showLess,
          bodyExpanded,
        }) => {
          const x = pos.x - w / 2;
          const y = pos.y - h / 2;
          const textLeft = x + taskLead;
          const textX = textLeft + textW / 2;
          const affordance = showMore || showLess ? MORE_AFFORDANCE_H : 0;
          const textCentreY = pos.y - affordance / 2;
          const cls = [
            'map-node',
            foldable ? '' : 'leaf',
            col ? 'collapsed' : '',
            cue ? 'cue' : '',
            task === 'done' ? 'task-done' : task ? 'task-open' : '',
            bodyExpanded ? 'body-expanded' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const foldHit = foldable
            ? `<rect class="map-fold-hit" x="${x + taskLead + textW}" y="${y}" width="${foldSlot}" height="${h}" fill="transparent" cursor="pointer"/>`
            : '';
          const marker =
            foldable && col
              ? `<g class="map-fold-indicator" transform="translate(${x + taskLead + textW + foldSlot / 2} ${pos.y})" aria-hidden="true">
          <circle r="9"/>
          <path d="M -4 0 H 4 M 0 -4 V 4"/>
        </g>`
              : '';
          const taskHit =
            task != null
              ? `<rect class="map-task-hit" x="${x}" y="${Math.min(y, pos.y - 22)}" width="${Math.max(taskLead, 44)}" height="${Math.max(h, 44)}" fill="transparent" cursor="pointer" role="checkbox" aria-checked="${task === 'done' ? 'true' : 'false'}"/>`
              : '';
          const taskChrome =
            task != null
              ? taskGlyphSvg(task, x + taskLead / 2, textCentreY)
              : '';
          const tip = truncated || fullText !== label ? fullText : n.title;
          const bodyAction = showMore ? 'more' : showLess ? 'less' : '';
          const moreChrome = bodyAction
            ? `<g class="map-body-more-hit" data-body-action="${bodyAction}" transform="translate(${textX} ${y + h - 8})" cursor="pointer">
            <rect x="-28" y="-10" width="56" height="16" rx="8" fill="transparent"/>
            <text text-anchor="middle" y="3" fill="#8b9bab" font-size="11">${bodyAction}</text>
          </g>`
            : '';
          const threadChip = thread
            ? `<g class="map-thread-hit" data-thread="${esc(thread)}" transform="translate(${textX} ${y + h - (affordance ? affordance + 4 : 6)})" cursor="pointer">
            <rect x="-36" y="-10" width="72" height="18" rx="9" fill="rgba(201,162,39,0.12)" stroke="#C9A227" stroke-width="1"/>
            <text text-anchor="middle" y="3" fill="#C9A227" font-size="10">Thread</text>
          </g>`
            : '';
          return `<g class="${cls}" data-id="${esc(n.id!)}" tabindex="${n.id === focusId ? 0 : -1}"
      role="button" aria-label="${esc(label)}${task != null ? (task === 'done' ? ', task done' : ', task open') : ''}${foldable ? (col ? ', collapsed' : ', expanded') : ''}${showMore ? ', more text available' : ''}${showLess ? ', showing full body' : ''}"
      ${foldable ? `aria-expanded="${col ? 'false' : 'true'}"` : ''}>
      <title>${esc(tip)}</title>
      <rect class="map-pill" x="${x}" y="${y}" width="${w}" height="${h}" rx="18" ry="18"/>
      ${taskChrome}
      ${multiLineText(lines, textX, textCentreY, textW, richLines)}
      ${moreChrome}
      ${threadChip}
      ${marker}
      ${taskHit}
      ${foldHit}
    </g>`;
        },
      )
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

    host.querySelectorAll<SVGGElement>('.map-node').forEach((g) => {
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = g.getAttribute('data-id');
        if (!id) return;
        const t = e.target as Element | null;
        if (t?.closest?.('.map-fold-hit') || t?.closest?.('.map-fold-indicator')) {
          setFocusId(id);
          // Focus host/pill BEFORE paint so Map keys work (0.2.13).
          focusMapForKeys(g);
          const n = findNode(getDoc().nodes, id);
          userCamGesture = false;
          if (n && hasKids(n)) {
            const wasCollapsed = isCollapsed(getDoc(), id);
            setDoc(toggleFold(getDoc(), id));
            pendingFollow = wasCollapsed
              ? { kind: 'expand', focusId: id }
              : { kind: 'focus' };
          } else {
            pendingFollow = { kind: 'focus' };
          }
          onChange?.();
          return;
        }
        if (t?.closest?.('.map-task-hit') || t?.closest?.('.map-task-glyph')) {
          setFocusId(id);
          focusMapForKeys(g);
          userCamGesture = false;
          pendingFollow = { kind: 'focus' };
          applyTaskToggle(id);
          return;
        }
        if (t?.closest?.('.map-body-more-hit')) {
          // Body more/less — orthogonal to child fold / task.
          setFocusId(id);
          focusMapForKeys(g);
          userCamGesture = false;
          pendingFollow = { kind: 'focus' };
          const hit = t.closest('.map-body-more-hit') as Element;
          const action = hit.getAttribute('data-body-action');
          const lay = getLayout();
          if (!lay.nodes) lay.nodes = {};
          const cur = lay.nodes[id] || { x: 100, y: 100 };
          lay.nodes[id] = {
            ...cur,
            bodyExpanded: action === 'more',
          };
          onChange?.();
          return;
        }
        if (t?.closest?.('.map-thread-hit')) {
          setFocusId(id);
          focusMapForKeys(g);
          userCamGesture = false;
          pendingFollow = { kind: 'focus' };
          const n = findNode(getDoc().nodes, id);
          const thread = n ? resolveThread(n) : null;
          if (n && thread) onThread?.({ id, thread, node: n });
          onChange?.();
          return;
        }
        // Text / pill chrome: select + focus only — never fold.
        // Label text-drag: keep native Selection (skip paint that would wipe it).
        const prevFocus = getFocusId();
        setFocusId(id);
        // Always move focus into Map on node click so arrows/digits/fold keys work.
        focusMapForKeys(g);
        userCamGesture = false;
        pendingFollow = { kind: 'focus' };
        const sel =
          typeof window !== 'undefined' && window.getSelection
            ? window.getSelection()
            : null;
        if (mapNodeKeepsTextSelection(g, sel)) {
          // Still ensure visible without wiping selection via paint when possible.
          runPendingFollow();
          return;
        }
        if (prevFocus !== id) {
          onChange?.();
        } else {
          runPendingFollow();
        }
      });
    });

    const focused = host.querySelector(
      `[data-id="${CSS.escape(getFocusId())}"]`,
    ) as HTMLElement | null;
    if (
      focused &&
      isActive() &&
      mapPaintShouldRestoreFocus(host, paintFocusOwner)
    ) {
      focused.focus({ preventScroll: true });
    }

    // Camera follow after layout settles (focus / expand / edit). Resume-on-load
    // leaves pendingFollow null so camera stays as restored until user acts.
    if (isActive()) {
      if (!pendingFollow && isEditing()) {
        pendingFollow = { kind: 'edit' };
      }
      const hadFollow = !!pendingFollow;
      runPendingFollow();
      if (!hadFollow) {
        clampCamNow();
        applyCam();
      }
    }
  }

  function applyFocusMove(direction: MapFocusDirection): void {
    const doc = getDoc();
    const layout = getLayout();
    const next = resolveMapFocus(doc, getFocusId(), direction, {
      isNodeCollapsed: (id) => isCollapsed(doc, id),
      positions: layout.nodes,
    });
    if (!next) return;
    setFocusId(next);
    userCamGesture = false;
    pendingFollow = { kind: 'focus' };
    onChange?.();
  }

  function bindGestures(): void {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchStartDist = 0;
    let pinchStartK = 1;

    function beginPanGuard(): void {
      host.classList.add('panning');
      host.style.userSelect = 'none';
      host.style.setProperty('-webkit-user-select', 'none');
      clearSelectionForMapPan(
        typeof window !== 'undefined' && window.getSelection
          ? window.getSelection()
          : null,
      );
    }

    function endPanGuard(): void {
      host.classList.remove('panning');
      host.style.userSelect = '';
      host.style.removeProperty('-webkit-user-select');
    }

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
      // Label / node chrome: keep native select-to-copy — do not pan.
      if ((e.target as Element | null)?.closest?.('.map-node')) return;
      // Canvas background / empty space → pan; suppress text selection.
      e.preventDefault();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      host.setPointerCapture?.(e.pointerId);
      if (pointers.size === 1) {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        userCamGesture = true;
        cancelFollowAnim();
        beginPanGuard();
      } else if (pointers.size === 2) {
        dragging = false;
        userCamGesture = true;
        cancelFollowAnim();
        beginPanGuard();
        const pts = [...pointers.values()];
        pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        pinchStartK = cam.k;
      }
    });

    host.addEventListener(
      'pointermove',
      (e) => {
        if (!isActive()) return;
        if (!pointers.has(e.pointerId)) return;
        e.preventDefault();
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
        clampCamNow();
        applyCam();
      },
      { passive: false },
    );

    const endPointer = (e: PointerEvent): void => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStartDist = 0;
      if (pointers.size === 0) {
        dragging = false;
        endPanGuard();
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
   * Map-mode keyboard — orientation table (L→R). Outline keeps attachOutlineTree ARIA map.
   * Fold never on ←/→; fold via . / Space / Enter / digits when a node is selected.
   * Digits / * are relative to the selected node (1 = show that node's children).
   * Space stays fold (not task toggle).
   */
  function bindKeyboard(wire: MapKeyboardWire = {}): void {
    document.addEventListener('keydown', (e) => {
      if (
        !mapKeyboardShouldHandle({
          isActive: isActive(),
          target: e.target as { tagName?: string; isContentEditable?: boolean } | null,
          activeElement: document.activeElement,
          host,
          modeButton: wire.modeButton ?? null,
        })
      ) {
        return;
      }

      const doc = getDoc();
      const focusId = getFocusId();
      const n = focusId ? findNode(doc.nodes, focusId) : null;
      const selected = !!(n && n.id);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        applyFocusMove('down');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        applyFocusMove('up');
      } else if (e.key === 'Home') {
        e.preventDefault();
        applyFocusMove('home');
      } else if (e.key === 'End') {
        e.preventDefault();
        applyFocusMove('end');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        applyFocusMove('right');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        applyFocusMove('left');
      } else if (e.key === 'Enter' || e.key === ' ' || e.key === '.') {
        if (selected && hasKids(n!) && n!.id) {
          e.preventDefault();
          setDoc(toggleFold(doc, n!.id));
          onChange?.();
        }
      } else if (e.key === '*') {
        if (!selected) return;
        e.preventDefault();
        // Expand-all relative to selection (subtree), not whole forest.
        setDoc(setExpandLevel(doc, '*', { under: n!.id! }));
        onChange?.();
      } else if (e.key >= '0' && e.key <= '9') {
        if (!selected) return;
        e.preventDefault();
        // Digit N = depth under the selected node (1 = show its children).
        setDoc(setExpandLevel(doc, Number(e.key), { under: n!.id! }));
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
    ensureEditVisible,
  };
}

// Re-export shortLabel for tests that imported behaviour indirectly — not public API.
export { shortLabel as _shortLabelForTests };
