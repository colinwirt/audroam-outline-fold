/**
 * Map renderer: doc + fold + layout → SVG L→R pills.
 * Auto-pack (`layout._source === 'auto-pack'`): recursive L→R tidy layout.
 * Parent Y centres on the midpoint of its visible child stack; tree height grows
 * with leaf/sibling count. Recomputed on every paint so fold expand/collapse
 * reflows without overlap.
 *
 * Scrapbook (0.2.8+): multi-line wrap, task lead SVG, text click ≠ fold; label text selectable (0.2.10); pan clears selection (0.2.11); keyboard only when Map focused (0.2.12); rich caption breaks+HTML + focus-on-click + camera follow/clamp (0.2.13); proportion follow + cameraRecentre + edit ensure (0.2.14); focusId is-focused ring (0.2.15); single stable focus owner = host tabindex=0 + aria-activedescendant, keydown on host (0.2.16).
 * Sealed nodes: omitted until unlocked (no gray stubs) — caller filters doc if needed.
 */
import { captionLinks, captionWithoutLinks } from './captionRich.js';
import {
  captionLinkRows,
  noteLinkRows,
  placeLinkPop,
  renderLinkPopRows,
  threadRows,
  type LinkPopRow,
} from './linkPop.js';
import { noteLinkHrefs, type NoteUriOptions } from './linkTemplates.js';
import {
  toggleFold,
  isCollapsed,
  setExpandLevel,
} from './fold.js';
import {
  afterLift,
  anchorPan,
  anchorPinch,
  nextGestureMode,
  inertiaEligible,
  isDoubleTap,
  isTwoFingerTap,
  mid,
  panFrame,
  pinchFrame,
  retargetZoom,
  slopPx,
  softAxis,
  softZoom,
  velocityFromSamples,
  capSpeed,
  decayVelocity,
  translationClearsContent,
  flingClearsContent,
  wheelIntent,
  type Cam as GestureCam,
  type PanAnchor,
  type PinchAnchor,
  type Pt,
} from './mapGesture.js';
import type { OutlineFoldDoc, OutlineNode } from './types.js';
import {
  measurePill,
  DEFAULT_WRAP_CH,
  DEFAULT_MAX_LINES,
  SOFT_SAFETY_MAX_LINES,
  SOFT_SAFETY_MAX_CHARS,
  TASK_LEAD,
  TASK_BOX,
  TASK_INSET,
  LINE_H,
  PILL_PAD_X,
  lineWidth,
  mapChipPieces,
  THREAD_CHIP_H,
  type MapChipPiece,
  type MapChipSpec,
  PILL_PAD_Y,
  MORE_AFFORDANCE_H,
  DEFAULT_FONT_PX,
  lineBox,
  resolveFontPx,
} from './mapLabel.js';
import { LABEL_FONT_FAMILY } from './svgTextMeasure.js';
import {
  armSwallow,
  bindTap,
  isTapPointer,
  nodeTapShouldActivate,
  swallowConsumes,
  touchClickGuarded,
  type SwallowRecord,
} from './mapTap.js';
import {
  displayCaption,
  resolveTask,
  resolveAction,
  resolveThread,
  resolveNoteLinks,
  noteLinkHref,
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
import { assignPersistentId, indexOutline, nodeMapKey } from './nodeAddress.js';
import { toggleTask, nextTaskState, shouldFireAction } from './task.js';
import {
  foldLevelAnnouncement,
  foldLevelPicker,
  foldLevelSkipsAnimation,
  wholeMapAnnouncement,
  type FoldLevelKey,
  type FoldLevelPicker,
} from './foldLevel.js';
import {
  LEVEL_HOLD_MS,
  LEVEL_RING_MS,
  currentWholeMapLevel,
  levelHoldAt,
  levelHoldCancel,
  levelHoldMoved,
  levelKeepVisibleShift,
  levelMenuInitialIndex,
  levelMenuKeyAction,
  levelPickNeedsConfirm,
  placeLevelMenu,
  renderLevelMenu,
  shownBelow,
  startLevelHold,
  wholeMapLevelDoc,
  WHOLE_MAP_LEVELS,
  type LevelHold,
  type WholeMapLevel,
} from './foldLevelMenu.js';

export interface MapPoint {
  x: number;
  y: number;
  wrapCh?: number;
  /** Product clip; null = unlimited (soft safety). Default ~30 when omitted. */
  maxLines?: number | null;
  /** more/less body reveal — orthogonal to child fold. */
  bodyExpanded?: boolean;
  /** Label size in px. Overrides the layout file and outline frontmatter. */
  fontSize?: number;
  /** Caption column width in px. Set by the right-edge handle. */
  w?: number;
}

export interface MapViewBox {
  w: number;
  h: number;
}

/** Mutable layout: authored sidecar positions or auto-pack. */
export interface MapLayout {
  viewBox?: MapViewBox;
  nodes?: Record<string, MapPoint>;
  /** Label size in px for nodes that omit fontSize. */
  fontSize?: number;
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
  /** Default label size when a node omits fontSize. */
  fontSize?: number;
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
  fontSize?: number;
  /** Caption column width in px. Overrides wrapCh. */
  widthPx?: number;
  /** `<t:N>` ids drawn after the caption. */
  noteLinks?: string[];
  /** Thread pill in the chip row after the caption (0.2.34). */
  thread?: boolean;
  /** `<r:x>` jump chips after the `#N` chips (0.2.34). */
  jumps?: { id: string; label: string }[];
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
  fontPx: number;
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
   * Optional: a `#N` popover row was picked (`open`: `note` = Open #N, `map`,
   * `details`). The row's own link opens in a new tab when it has an href.
   */
  onNoteLink?: (ev: { id: string; pnid: string; node: OutlineNode; open?: 'note' | 'map' | 'details' }) => void;
  /**
   * Fallback when the layout block omits `noteUri`.
   * `{id}` is the note id. http(s) or a root-relative path.
   */
  noteUri?: string;
  /**
   * Open map row in `#N` popovers when the layout block omits `noteMapUri`
   * (0.2.34). `{id}` is the note number. Unset: `/notes/{id}/map`; `null` or `''`: no row.
   */
  noteMapUri?: string | null;
  /**
   * Open details row in `#N` popovers when the layout block omits `noteDetailsUri`
   * (0.2.34). `{id}` is the note number. Unset: `/notes/{id}/details`; `null` or `''`: no row.
   */
  noteDetailsUri?: string | null;
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
  /**
   * Wheel default is pan (trackpad scroll). `'zoom'` restores the old
   * "every wheel notch zooms" behaviour. Ctrl/Cmd+wheel always zooms.
   */
  wheel?: 'pan' | 'zoom';
  /** Phase-2 gesture switches. Defaults match the locked spec. */
  gestures?: {
    wheel?: 'pan' | 'zoom';
    inertia?: boolean;
    rubberBand?: boolean;
    doubleTapZoom?: boolean;
    twoFingerTapZoomOut?: boolean;
  };
  onCameraSettle?: (cam: { x: number; y: number; k: number }) => void;
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
  zoomBy: (factor: number) => void;
  panBy: (dx: number, dy: number) => void;
  fit: () => void;
  applyCam: () => void;
  cam: { x: number; y: number; k: number };
  bindGestures: () => void;
  unbindGestures: () => void;
  bindKeyboard: (wire?: MapKeyboardWire) => void;
  visibleList: (nodes?: OutlineNode[], out?: OutlineNode[]) => OutlineNode[];
  findNode: (nodes: OutlineNode[], id: string) => OutlineNode | null;
  /** Gentle ensure edit node / caret region visible (host may call while typing). */
  ensureEditVisible: () => void;
  /**
   * Open the fold-to-level menu for a node (default: the selected node), as
   * right-click / ContextMenu / Shift+F10 do. False when it has no children.
   */
  openLevelMenu: (id?: string) => boolean;
  /** Close the fold-to-level menu if it is open. */
  closeLevelMenu: () => void;
  /** Apply a level under a node, as a menu pick does (anchors the handle, announces). */
  applyFoldLevel: (id: string, level: FoldLevelKey) => void;
  /** Every root to a level (toolbar Levels, L8). */
  setWholeMapLevel: (level: WholeMapLevel) => void;
  /** The toolbar level the whole map is at, or null. */
  currentWholeMapLevel: () => WholeMapLevel | null;
  /** Called after every paint. Returns an unsubscribe function. */
  onPaint: (fn: () => void) => () => void;
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

/** Fold handle radius. */
export const FOLD_R = 9;
/** Stroke of the expanded handle's gold ring. Keep in step with
 * `.map-fold-indicator.is-expanded circle` in outline-fold.css. */
export const FOLD_RING_W = 1.6;
/** Connector and stem stroke, same as `.map-edge` in outline-fold.css. */
const CONNECTOR_W = 1.4;

export type FoldHandleGeometry = {
  /** Handle centre x. */
  cx: number;
  r: number;
  /** Where the stem from the pill stops. */
  innerRim: number;
  /** Outside edge of the gold ring. Child connectors start here. */
  outerRim: number;
};

/** Handle geometry for a pill whose visible right edge is `boxRight`. The
 * handle sits in the middle of the fold slot, past the pill. */
export function foldHandleGeometry(boxRight: number, foldSlot: number = FOLD_SLOT): FoldHandleGeometry {
  const cx = boxRight + foldSlot / 2;
  return {
    cx,
    r: FOLD_R,
    innerRim: cx - FOLD_R,
    outerRim: cx + FOLD_R + FOLD_RING_W / 2,
  };
}

/** Visible right edge of a pill. The fold slot is drawn outside the pill. */
function pillBoxRight(centreX: number, w: number, foldSlot: number): number {
  return centreX - w / 2 + Math.max(1, w - foldSlot);
}

/**
 * x where the connectors to a node's children begin. With a fold handle it's
 * the outer edge of the ring, so no line runs under the handle (0.2.31).
 * Without one it's the pill's right edge, as before.
 */
export function connectorStartX(centreX: number, w: number, foldSlot: number): number {
  const boxRight = pillBoxRight(centreX, w, foldSlot);
  return foldSlot > 0 ? foldHandleGeometry(boxRight, foldSlot).outerRim : boxRight;
}

/** The short stem from the pill to the handle's inner rim. It is the same for
 * a folded and an expanded node. */
export function foldStemSvg(boxRight: number, y: number, foldSlot: number = FOLD_SLOT): string {
  const { innerRim } = foldHandleGeometry(boxRight, foldSlot);
  return `<path class="map-fold-stem" d="M ${boxRight} ${y} H ${innerRim}" fill="none" stroke="var(--connector)" stroke-width="${CONNECTOR_W}" pointer-events="none"/>`;
}

/** Fold handle: solid gold with a + when folded, a gold ring with a − when
 * expanded. The expanded disc is see-through; nothing is drawn behind it. */
export function foldHandleSvg(
  boxRight: number,
  y: number,
  collapsed: boolean,
  foldSlot: number = FOLD_SLOT,
): string {
  const { cx, r } = foldHandleGeometry(boxRight, foldSlot);
  return collapsed
    ? `<g class="map-fold-indicator" transform="translate(${cx} ${y})" aria-hidden="true">
          <circle r="${r}"/>
          <path d="M -4 0 H 4 M 0 -4 V 4"/>
        </g>`
    : `<g class="map-fold-indicator is-expanded" transform="translate(${cx} ${y})" aria-hidden="true">
          <circle r="${r}" fill="none"/>
          <path d="M -4 0 H 4"/>
        </g>`;
}

/** Halo ring casing: 1.5 px each side of the 1.6 px gold ring. */
export const FOLD_HALO_RING_W = 4.6;
/** Halo casing under the − dash. */
export const FOLD_HALO_DASH_W = 4.4;
/** Casing stroke under each connector and stem when `--connector-casing` is set. */
export const CONNECTOR_CASING_W = 3.2;

/**
 * Halo under the expanded handle's ring and dash, in `--map-halo` (default:
 * the canvas colour at 85%). Invisible on a plain canvas; a thin outline on a
 * pattern or image. The folded + is solid gold and gets none.
 */
export function foldHaloSvg(boxRight: number, y: number, foldSlot: number = FOLD_SLOT): string {
  const { cx, r } = foldHandleGeometry(boxRight, foldSlot);
  return `<g class="map-fold-halo" transform="translate(${cx} ${y})" aria-hidden="true" pointer-events="none">
          <circle r="${r}" fill="none" stroke-width="${FOLD_HALO_RING_W}"/>
          <path d="M -4 0 H 4" fill="none" stroke-width="${FOLD_HALO_DASH_W}"/>
        </g>`;
}

/** Casing stroke drawn under the stem when the host set `--connector-casing`. */
export function foldStemCasingSvg(boxRight: number, y: number, foldSlot: number = FOLD_SLOT): string {
  const { innerRim } = foldHandleGeometry(boxRight, foldSlot);
  return `<path class="map-fold-stem-casing" d="M ${boxRight} ${y} H ${innerRim}" fill="none" stroke-width="${CONNECTOR_CASING_W}" pointer-events="none"/>`;
}

export type FoldChromeOptions = {
  /** Draw a casing under the stem (`--connector-casing` is set). */
  casing?: boolean;
};

/**
 * Fold chrome in paint order: halo (expanded only), stem casing (opt-in),
 * stem, handle. The halo goes under the stem so the stub stays 8 px.
 */
export function foldChromeSvg(
  boxRight: number,
  y: number,
  collapsed: boolean,
  foldSlot: number = FOLD_SLOT,
  opts: FoldChromeOptions = {},
): string {
  const parts: string[] = [];
  if (!collapsed) parts.push(foldHaloSvg(boxRight, y, foldSlot));
  if (opts.casing) parts.push(foldStemCasingSvg(boxRight, y, foldSlot));
  parts.push(foldStemSvg(boxRight, y, foldSlot));
  parts.push(foldHandleSvg(boxRight, y, collapsed, foldSlot));
  return parts.join('\n      ');
}

/**
 * Whether a `--connector-casing` value asks for a casing. Empty, `transparent`,
 * `none` and fully transparent colours do not.
 */
export function isConnectorCasingSet(value: string | null | undefined): boolean {
  const v = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!v || v === 'transparent' || v === 'none' || v === 'initial' || v === 'unset') return false;
  // rgba(r,g,b,0) / rgb(r g b / 0) / hsla(...,0)
  const alpha = /^(?:rgba?|hsla?)\(.*[,/](0(?:\.0+)?|0?\.0+|0%)\)$/.exec(v);
  if (alpha) return false;
  // #rgba / #rrggbbaa with zero alpha
  if (/^#[0-9a-f]{3}0$/.test(v) || /^#[0-9a-f]{6}00$/.test(v)) return false;
  return true;
}

/** Casing paths for all edges, drawn before any edge line. */
export function mapEdgeCasingSvg(d: string): string {
  return `<path class="map-edge-casing" d="${d}"/>`;
}

/** Connector from a parent pill to one child. Positions are pill centres. */
export function childConnectorPath(
  parent: { x: number; y: number; w: number; foldSlot: number },
  child: { x: number; y: number; w: number },
): string {
  return connectorPath(
    connectorStartX(parent.x, parent.w, parent.foldSlot),
    parent.y,
    child.x - child.w / 2,
    child.y,
  );
}

export function mapEdgeSvg(d: string): string {
  return `<path class="map-edge" d="${d}"/>`;
}

export { DEFAULT_WRAP_CH, DEFAULT_MAX_LINES, SOFT_SAFETY_MAX_LINES, SOFT_SAFETY_MAX_CHARS, TASK_LEAD };

/**
 * Measure pill dimensions; optionally reserve fold chrome end-cap and task lead.
 * Multi-line wraps at wrapCh. The border follows the measured line, not that wrap width.
 */

/**
 * Map pill `<g>` class list. `is-focused` is driven by selection focusId (not
 * only DOM :focus-visible) so click/arrow selection always shows the accent ring.
 */
export function mapNodeClassNames(opts: {
  foldable?: boolean;
  collapsed?: boolean;
  cue?: boolean;
  task?: TaskState | null;
  bodyExpanded?: boolean;
  focused?: boolean;
}): string {
  return [
    'map-node',
    opts.foldable ? '' : 'leaf',
    opts.collapsed ? 'collapsed' : '',
    opts.cue ? 'cue' : '',
    opts.task === 'done' ? 'task-done' : opts.task === 'pending' ? 'task-pending' : opts.task ? 'task-open' : '',
    opts.bodyExpanded ? 'body-expanded' : '',
    opts.focused ? 'is-focused' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function pillSize(label: string, opts: PillSizeOptions = {}): PillSize {
  const measured = measurePill(label, {
    wrapCh: opts.wrapCh ?? DEFAULT_WRAP_CH,
    widthPx: opts.widthPx,
    maxLines: opts.maxLines,
    bodyExpanded: opts.bodyExpanded,
    fontSize: opts.fontSize,
    reserveFold: opts.reserveFold,
    reserveTask: opts.reserveTask,
    foldSlot: FOLD_SLOT,
    taskLead: TASK_LEAD,
    noteLinks: opts.noteLinks,
    thread: opts.thread,
    jumps: opts.jumps,
  });
  return measured;
}

function nodePillOpts(
  n: OutlineNode,
  nodeLayout?: Record<string, MapPoint>,
  defaults?: { wrapCh?: number; maxLines?: number | null; fontSize?: number },
  key?: string,
): PillSizeOptions {
  const lay =
    (key && nodeLayout ? nodeLayout[key] : undefined) ||
    (n.id && nodeLayout ? nodeLayout[n.id] : undefined);
  const maxLines =
    lay?.maxLines !== undefined
      ? lay.maxLines
      : defaults?.maxLines !== undefined
        ? defaults.maxLines
        : undefined;
  const widthPx = lay?.w ?? n.layout?.w;
  return {
    reserveFold: hasKids(n),
    reserveTask: !!resolveTask(n),
    wrapCh: lay?.wrapCh ?? defaults?.wrapCh ?? DEFAULT_WRAP_CH,
    widthPx: typeof widthPx === 'number' && widthPx > 0 ? widthPx : undefined,
    maxLines,
    bodyExpanded: !!lay?.bodyExpanded,
    fontSize: lay?.fontSize ?? defaults?.fontSize,
    ...nodeChips(n),
  };
}

/** Chips after the caption: thread pill, `#N` notes (0.2.34: the thread pill joined the row). */
function nodeChips(n: OutlineNode): MapChipSpec {
  return { thread: !!resolveThread(n), noteLinks: resolveNoteLinks(n) };
}

function connectorPath(x1: number, y1: number, x2: number, y2: number): string {
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
  const stroke = state === 'open' ? '#8b9bab' : '#C9A227';
  const mark =
    state === 'done'
      ? `<path d="M-4 0.5 l2.5 2.5 L4 -3" fill="none" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>`
      : state === 'pending'
        ? `<path d="M-4 0 H4" fill="none" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round"/>`
        : '';
  return `<g class="map-task-glyph" transform="translate(${x} ${y})" aria-hidden="true">
    <rect x="-7" y="-7" width="14" height="14" rx="3" fill="none" stroke="${stroke}" stroke-width="1.75"/>
    ${mark}
  </g>`;
}

function globeGlyphSvg(x: number, y: number): string {
  return `<g class="map-link-hit" transform="translate(${x} ${y})" cursor="pointer">
    <rect x="-12" y="-12" width="24" height="24" rx="8" fill="transparent"/>
    <circle r="8" fill="none" stroke="#8ec8ff" stroke-width="1.4"/>
    <ellipse rx="3.2" ry="8" fill="none" stroke="#8ec8ff" stroke-width="1.2"/>
    <path d="M -8 0 H 8 M -6.5 -4 H 6.5 M -6.5 4 H 6.5" fill="none" stroke="#8ec8ff" stroke-width="1"/>
  </g>`;
}

function multiLineText(
  lines: string[],
  textX: number,
  centreY: number,
  _textW: number,
  richLines?: CaptionStyleRun[][],
  fontPx = DEFAULT_FONT_PX,
): string {
  const n = Math.max(1, lines.length);
  const box = lineBox(fontPx);
  const blockH = n * box;
  const top = centreY - blockH / 2 + box * 0.75;
  const tspans = lines
    .map((line, i) => {
      const dy = i === 0 ? 0 : box;
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
  return `<text class="map-label" x="${textX}" y="${top}" text-anchor="start" font-size="${fontPx}" font-weight="400" font-family="${LABEL_FONT_FAMILY}">${tspans}</text>`;
}

/**
 * Deterministic L→R auto-pack for the *visible* (non-collapsed) tree.
 * Parent centres vertically on the midpoint of its child stack; height grows
 * with siblings/leaves. Siblings under the *same parent* share a common left
 * edge (M13) — not a tree-wide depth column. Each parent's child group starts
 * at one groupLeft (parent's painted right + gapX). Stored x is the painted
 * pill centre, so the left edge is groupLeft. The painted caption is
 * captionWithoutLinks(displayCaption(title)), including fold and task chrome.
 */
export function autoPackPositions(
  doc: OutlineFoldDoc,
  opts: AutoPackOptions = {},
): AutoPackResult {
  const isNodeCollapsed = opts.isNodeCollapsed || (() => false);
  const gapY = opts.gapY ?? 14;
  const gapX = opts.gapX ?? 56;
  const margin = opts.margin ?? 40;
  const defaults = { wrapCh: opts.wrapCh, maxLines: opts.maxLines, fontSize: opts.fontSize };
  const nodeLayout = opts.nodeLayout;

  const order = indexOutline(doc.nodes || []);
  const visible: { n: OutlineNode; depth: number }[] = [];
  function walkVis(n: OutlineNode, depth: number): void {
    if (!n) return;
    visible.push({ n, depth });
    if (hasKids(n) && !(n.id && isNodeCollapsed(n.id))) {
      for (const c of n.children!) walkVis(c, depth + 1);
    }
  }
  for (const root of doc.nodes || []) walkVis(root, 0);

  const positions: Record<string, MapPoint> = {};
  const paintedSize = new Map<string, { w: number; h: number }>();

  function layoutSubtree(n: OutlineNode, groupLeft: number, top: number): number {
    const key = nodeMapKey(n, order.get(n) || 0);
    const label = captionWithoutLinks(displayCaption(n.title));
    const painted = pillSize(label, nodePillOpts(n, nodeLayout, defaults, key));
    paintedSize.set(key, { w: painted.w, h: painted.h });
    const x = groupLeft + painted.w / 2;
    const kids =
      hasKids(n) && !(n.id && isNodeCollapsed(n.id))
        ? n.children || []
        : [];

    if (kids.length === 0) {
      positions[key] = { x, y: top + painted.h / 2, w: n.layout?.w };
      return painted.h;
    }

    const childGroupLeft = groupLeft + painted.w + gapX;
    let y = top;
    const seen = new Set(Object.keys(positions));
    for (let i = 0; i < kids.length; i++) {
      const ch = layoutSubtree(kids[i]!, childGroupLeft, y);
      y += ch;
      if (i < kids.length - 1) y += gapY;
    }
    const stackH = y - top;
    // A pill taller than its child stack used to stay centred on the stack
    // and spill upward into the sibling above. Shift the stack down so the
    // pill starts at `top` and the children stay centred on the pill.
    const shift = painted.h > stackH ? (painted.h - stackH) / 2 : 0;
    if (shift !== 0) {
      for (const k of Object.keys(positions)) {
        if (!seen.has(k)) positions[k]!.y += shift;
      }
    }
    positions[key] = { x, y: top + shift + stackH / 2, w: n.layout?.w };
    return Math.max(stackH, painted.h);
  }

  let top = margin;
  const roots = doc.nodes || [];
  for (let i = 0; i < roots.length; i++) {
    const h = layoutSubtree(roots[i]!, margin, top);
    top += h;
    if (i < roots.length - 1) top += gapY * 2;
  }

  let maxX = margin;
  let maxY = margin;
  for (const { n } of visible) {
    const pos = positions[nodeMapKey(n, order.get(n) || 0)];
    if (!pos) continue;
    const size = paintedSize.get(nodeMapKey(n, order.get(n) || 0));
    if (!size) continue;
    maxX = Math.max(maxX, pos.x + size.w / 2);
    maxY = Math.max(maxY, pos.y + size.h / 2);
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
 * What a pointer-down does to the browser Selection before a pan.
 * Label presses stay alone so drag-select and double-click word select work.
 * Any other press on empty canvas must preventDefault. Otherwise the browser
 * starts a drag-select and extends it on every pointermove, which repaints
 * the whole map and the pan never stays smooth. A node click only clears,
 * so the click still reaches the pill.
 */
export function mapBackgroundPanSelection(opts: {
  onLabel: boolean;
  onNode: boolean;
  clickDetail: number;
  selectionOutside: boolean;
}): 'ignore' | 'clear' | 'prevent-and-clear' {
  if (opts.onLabel) return 'ignore';
  if (!opts.onNode) return 'prevent-and-clear';
  return 'clear';
}

/**
 * Clear the browser Selection when a map pan/pinch gesture starts so
 * background drag does not paint a huge text range. Label drag-select
 * never hits this path (`pointerdown` on `.map-label` returns early).
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
 * True when the map host owns DOM focus (host itself or a descendant).
 * Evaluate BEFORE a paint rebuild: after `innerHTML` the old descendant is
 * detached and `host.contains(old)` is false (the 0.2.12–0.2.15 regression).
 */
export function mapHostOwnsFocus(
  host: { contains: (node: Node | null) => boolean },
  activeElement: Node | null,
): boolean {
  if (!activeElement) return false;
  if ((activeElement as unknown) === (host as unknown)) return true;
  return host.contains(activeElement);
}

/**
 * @deprecated since 0.2.16 — use {@link mapHostOwnsFocus} on a snapshot taken
 * before the DOM rebuild, then {@link mapPaintFocusAction}. Kept for compat:
 * true only when `activeElement` is (inside) the host.
 */
export function mapPaintShouldRestoreFocus(
  host: { contains: (node: Node | null) => boolean },
  activeElement: Node | null,
): boolean {
  return mapHostOwnsFocus(host, activeElement);
}

/**
 * Post-paint focus plan (0.2.16 single focus owner).
 *
 * - `hadFocus` MUST be the boolean snapshot from {@link mapHostOwnsFocus}
 *   taken before `innerHTML` (never an element reference re-checked later).
 * - If the map did not own focus before paint → `'none'` (never steal from a
 *   textarea / editor / other control).
 * - If it did and focus is still on the host → `'keep'`.
 * - If it did but the rebuild dropped focus (to body or a detached node) →
 *   `'focus-host'`: re-focus the stable host (tabindex=0), never a per-node
 *   element that the next paint would destroy again.
 */
export function mapPaintFocusAction(opts: {
  hadFocus: boolean;
  isActive: boolean;
  host: { contains: (node: Node | null) => boolean };
  activeElementAfter: Node | null;
}): 'none' | 'keep' | 'focus-host' {
  if (!opts.hadFocus || !opts.isActive) return 'none';
  const ae = opts.activeElementAfter;
  if (ae && (ae as unknown) === (opts.host as unknown)) return 'keep';
  if (ae && (ae as { isConnected?: boolean }).isConnected !== false && opts.host.contains(ae)) {
    return 'keep';
  }
  return 'focus-host';
}

/**
 * Stable DOM id for a map node `<g>` so the host can point
 * `aria-activedescendant` at the selected node. `prefix` is per map instance.
 */
export function mapNodeDomId(prefix: string, nodeId: string): string {
  const safe = String(nodeId).replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`);
  return `${prefix}-n-${safe}`;
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
  /** Ctrl/Meta/Alt held — leave to browser/app (copy, tab switch, …). */
  modifier?: boolean;
}): boolean {
  if (!opts.isActive) return false;
  if (opts.modifier) return false;
  const tag = (opts.target?.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
  if (opts.target?.isContentEditable) return false;
  const ae = opts.activeElement;
  if (opts.modeButton && ae === opts.modeButton) return true;
  if (mapHostOwnsFocus(opts.host, ae)) return true;
  if (opts.target && opts.host.contains(opts.target as unknown as Node)) {
    return true;
  }
  return false;
}

let mapInstanceSeq = 0;

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
    onNoteLink,
    noteUri: noteUriFallback,
    noteMapUri,
    noteDetailsUri,
    cameraRecentre: cameraRecentreOpt = true,
    isEditing = () => false,
    getEditRegion,
    wheel: wheelMode = 'pan',
    gestures: gestureOpts = {},
    onCameraSettle,
  } = opts;
  const wheelSetting = gestureOpts.wheel ?? wheelMode;
  // Host fallbacks for the note-link templates; `'noteMapUri' in opts` keeps an explicit null.
  const noteUriOpts: NoteUriOptions = { noteUri: noteUriFallback };
  if ('noteMapUri' in opts) noteUriOpts.noteMapUri = noteMapUri;
  if ('noteDetailsUri' in opts) noteUriOpts.noteDetailsUri = noteDetailsUri;
  const inertiaOn = gestureOpts.inertia !== false;
  const rubberOn = gestureOpts.rubberBand !== false;
  const doubleTapOn = gestureOpts.doubleTapZoom !== false;
  const twoFingerZoomOut = gestureOpts.twoFingerTapZoomOut !== false;

  function recentreEnabled(): boolean {
    return typeof cameraRecentreOpt === 'function'
      ? !!cameraRecentreOpt()
      : cameraRecentreOpt !== false;
  }

  // 0.2.16 single stable focus owner: the host (tabindex=0) keeps DOM focus
  // across paint(); nodes are not focusable; aria-activedescendant names the
  // selected node. paint() rewrites host.innerHTML, so focusing a node <g>
  // lost focus to <body> on the next paint and Map keys stopped working.
  const domPrefix = `ofmap${++mapInstanceSeq}`;
  ensureHostFocusable();
  if (!host.hasAttribute('role')) host.setAttribute('role', 'tree');
  if (!host.hasAttribute('aria-label')) host.setAttribute('aria-label', ariaLabel);

  function ensureHostFocusable(): void {
    const ti = host.getAttribute('tabindex');
    if (ti == null || Number(ti) < 0) host.setAttribute('tabindex', '0');
  }

  const CAM_MIN = 0.35;
  const CAM_MAX = 3.5;
  const cam = { x: 0, y: 0, k: 1 };
  /** Pill whose right edge is under the pointer, or being pulled. */
  let widthHotKey: string | null = null;
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
  let keyboardBound = false;

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
    const order = indexOutline(doc.nodes);
    function walk(n: OutlineNode): void {
      const key = nodeMapKey(n, order.get(n) || 0);
      if (!layout.nodes?.[key]) return;
      const pos = layout.nodes[key]!;
      const label = captionWithoutLinks(displayCaption(n.title));
      const foldable = hasKids(n);
      const size = pillSize(label, {
        reserveFold: foldable,
        reserveTask: !!resolveTask(n),
        wrapCh: pos.wrapCh ?? defaults.wrapCh,
        widthPx: pos.w,
        maxLines: pos.maxLines,
        bodyExpanded: !!pos.bodyExpanded,
        fontSize: resolveFontPx(pos.fontSize, layout.fontSize, doc.frontmatter?.fontSize),
        ...nodeChips(n),
      });
      const r = pillWorldRect(pos.x, pos.y, size.w, size.h);
      rects.push(r);
      byId.set(key, r);
      if (foldable && !(n.id && isCollapsed(doc, n.id))) {
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

  function reducedMotion(): boolean {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  let motionRaf = 0;
  function stopMotion(): void {
    if (motionRaf) cancelAnimationFrame(motionRaf);
    motionRaf = 0;
  }

  function settleCam(): void {
    onCameraSettle?.({ x: cam.x, y: cam.y, k: cam.k });
  }

  function animateCamTo(target: { x: number; y: number; k: number }, ms: number): void {
    stopMotion();
    if (reducedMotion() || ms <= 0) {
      cam.x = target.x;
      cam.y = target.y;
      cam.k = target.k;
      applyCam();
      settleCam();
      return;
    }
    const from = { x: cam.x, y: cam.y, k: cam.k };
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      cam.x = from.x + (target.x - from.x) * e;
      cam.y = from.y + (target.y - from.y) * e;
      cam.k = from.k + (target.k - from.k) * e;
      applyCam();
      if (t < 1) motionRaf = requestAnimationFrame(step);
      else {
        motionRaf = 0;
        settleCam();
      }
    };
    motionRaf = requestAnimationFrame(step);
  }

  /** Undefined means dirty. Null means the outline has no visible pills. */
  let contentUnionCache: ReturnType<typeof unionWorldRects> | undefined;

  function invalidateContentUnion(): void {
    contentUnionCache = undefined;
  }

  function contentUnion() {
    if (contentUnionCache !== undefined) return contentUnionCache;
    contentUnionCache = unionWorldRects(collectVisiblePillRects().rects);
    return contentUnionCache;
  }

  function hardCam(raw: { x: number; y: number; k: number }) {
    const content = contentUnion();
    if (!content) return { ...raw };
    return clampCamToContent(raw, hostViewport(), content, {
      paddingPx: DEFAULT_CAM_PADDING_PX,
      minK: CAM_MIN,
      maxK: CAM_MAX,
    });
  }

  function fit(): void {
    stopMotion();
    cancelFollowAnim();
    userCamGesture = true;
    const content = contentUnion();
    const vp = hostViewport();
    if (!content) return;
    const pad = DEFAULT_CAM_PADDING_PX;
    const fitK = Math.min(
      (vp.w - pad * 2) / Math.max(1, content.w),
      (vp.h - pad * 2) / Math.max(1, content.h),
    );
    const k = Math.max(CAM_MIN, Math.min(1, fitK));
    const target = hardCam({
      k,
      x: (vp.w - content.w * k) / 2 - content.x * k,
      y: (vp.h - content.h * k) / 2 - content.y * k,
    });
    animateCamTo(target, 250);
  }

  function zoomBy(factor: number): void {
    const rect = host.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    settleCam();
  }

  function panBy(dx: number, dy: number): void {
    stopMotion();
    cancelFollowAnim();
    userCamGesture = true;
    cam.x += dx;
    cam.y += dy;
    clampCamNow();
    applyCam();
    settleCam();
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


  // ── Link popover (globe badge), styled as the level menu (0.2.33) ──────
  type LinkPopState = {
    id: string;
    /** Selector of the chip inside the node: `.map-link-hit`, a `#N` chip, `.map-thread-hit`. */
    anchorSel: string;
    el: HTMLElement;
    items: HTMLAnchorElement[];
    abort: AbortController;
  };
  type LinkPopSpec = {
    id: string;
    anchorSel: string;
    rows: LinkPopRow[];
    label: string;
    kind: string;
    /** A row without `hopId` was picked (a new-tab row after the browser opens it). */
    onOpen?: (row: LinkPopRow) => void;
  };
  let linkPop: LinkPopState | null = null;

  /** Chip rect (globe, `#N`, thread) in host-local px. */
  function linkHitRect(id: string, anchorSel: string): { x: number; y: number; w: number; h: number } | null {
    const hit = host
      .querySelector(`.map-node[data-id="${CSS.escape(id)}"]`)
      ?.querySelector(anchorSel);
    if (!hit) return null;
    const r = hit.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    return { x: r.left - hr.left, y: r.top - hr.top, w: r.width, h: r.height };
  }

  /** Right of the chip, centred on it; returns the pan that would fit it. */
  function positionLinkPop(): { x: number; y: number } | null {
    const m = linkPop;
    if (!m) return null;
    const anchor = linkHitRect(m.id, m.anchorSel);
    if (!anchor) {
      dismissLinkPop();
      return null;
    }
    // Fractional size: offsetWidth rounds, which would put the edge 7.5–8.5 px in.
    const size = m.el.getBoundingClientRect();
    const pos = placeLinkPop({
      anchor,
      panel: hostViewport(),
      menu: { w: size.width, h: size.height },
    });
    m.el.style.left = `${pos.left}px`;
    m.el.style.top = `${pos.top}px`;
    return pos.shift;
  }

  function focusLinkItem(index: number): void {
    const m = linkPop;
    const a = m?.items[index];
    if (!m || !a) return;
    for (const it of m.items) it.tabIndex = -1;
    a.tabIndex = 0;
    try {
      a.focus({ preventScroll: true });
    } catch {
      /* focus not available */
    }
  }

  /** Fade out over 180 ms. `returnFocus` puts keys back on the map (Esc, Tab, hop). */
  function dismissLinkPop(returnFocus = false): void {
    const m = linkPop;
    if (!m) return;
    linkPop = null;
    m.abort.abort();
    const hadFocus = m.el.contains(document.activeElement);
    m.el.dataset.closing = '1';
    m.el.classList.add('is-closing');
    for (const a of m.items) a.tabIndex = -1;
    window.setTimeout(() => m.el.remove(), 180);
    if (returnFocus || hadFocus) focusMapForKeys();
  }

  function pageBase(): string | undefined {
    return typeof location !== 'undefined' ? location.href : undefined;
  }

  /** Globe badge: one row per caption link. */
  function showLinkPop(id: string, title: string): void {
    const links = captionLinks(title);
    if (!links.length) return;
    openLinkPop({
      id,
      anchorSel: '.map-link-hit',
      rows: captionLinkRows(links, pageBase()),
      label: 'Links',
      kind: 'links',
    });
  }

  /**
   * `#N` chip: Open #N (new tab + onNoteLink), Open map, Open details. N is a
   * note number, not a node id, so there is no in-map row (0.2.34).
   */
  function showNotePop(id: string, hit: Element): void {
    const pnid = hit.getAttribute('data-note-link') || '';
    const index = hit.getAttribute('data-note-index') || '0';
    if (!pnid) return;
    const doc = getDoc();
    const hrefs = noteLinkHrefs(pnid, doc.frontmatter, noteUriOpts);
    openLinkPop({
      id,
      anchorSel: `.map-note-link-hit[data-note-index="${CSS.escape(index)}"]`,
      rows: noteLinkRows(pnid, hrefs.note, { base: pageBase(), mapHref: hrefs.map, detailsHref: hrefs.details }),
      label: `#${pnid}`,
      kind: 'note',
      onOpen: (row) => {
        setFocusId(id);
        userCamGesture = false;
        pendingFollow = { kind: 'focus' };
        const n = findNode(getDoc().nodes, id);
        const open = row.kind === 'note-map' ? 'map' : row.kind === 'note-details' ? 'details' : 'note';
        if (n) onNoteLink?.({ id, pnid, node: n, open });
        onChange?.();
      },
    });
  }

  /** Thread chip: one row, Open thread (onThread). */
  function showThreadPop(id: string): void {
    openLinkPop({
      id,
      anchorSel: '.map-thread-hit',
      rows: threadRows(),
      label: 'Thread',
      kind: 'thread',
      onOpen: () => {
        setFocusId(id);
        userCamGesture = false;
        pendingFollow = { kind: 'focus' };
        const n = findNode(getDoc().nodes, id);
        const thread = n ? resolveThread(n) : null;
        if (n && thread) onThread?.({ id, thread, node: n });
        onChange?.();
      },
    });
  }

  /** The one popover for the globe, `#N` and thread chips (0.2.34). */
  function openLinkPop(spec: LinkPopSpec): void {
    if (linkPop) {
      linkPop.abort.abort();
      linkPop.el.remove();
      linkPop = null;
    }
    host.querySelectorAll(':scope > .map-link-pop').forEach((el) => el.remove());
    const { id, rows } = spec;
    if (!rows.length) return;
    const view = renderLinkPopRows(rows, {
      fine: !coarsePointer(),
      nodeId: id,
      label: spec.label,
      kind: spec.kind,
    });
    const abort = new AbortController();
    const sig = abort.signal;
    const m: LinkPopState = { id, anchorSel: spec.anchorSel, el: view.el, items: view.items, abort };
    linkPop = m;
    view.items.forEach((a, i) => {
      const row = rows[i]!;
      a.addEventListener(
        'click',
        (ev) => {
          ev.stopPropagation();
          if (row.hopId) {
            ev.preventDefault();
            setFocusId(row.hopId);
            userCamGesture = false;
            pendingFollow = { kind: 'focus' };
            dismissLinkPop(true);
            onChange?.();
            return;
          }
          if (row.href && row.newTab) {
            // The browser opens it in a new tab (noopener); the menu closes.
            dismissLinkPop(false);
            spec.onOpen?.(row);
            return;
          }
          ev.preventDefault();
          dismissLinkPop(true);
          spec.onOpen?.(row);
        },
        { signal: sig },
      );
      a.addEventListener('pointerenter', () => a.classList.add('is-hot'), { signal: sig });
      a.addEventListener('pointerleave', () => a.classList.remove('is-hot'), { signal: sig });
      a.addEventListener('focus', () => focusLinkItem(i), { signal: sig });
    });
    view.el.addEventListener(
      'keydown',
      (e) => {
        const i = m.items.indexOf(document.activeElement as HTMLAnchorElement);
        const act = levelMenuKeyAction(
          e.key,
          i,
          m.items.map(() => ({})),
        );
        // Keys stay in the menu: no fold, zoom or host shortcut.
        e.stopPropagation();
        if (!act) return;
        if (act.type === 'move') {
          e.preventDefault();
          focusLinkItem(act.index);
        } else if (act.type === 'close') {
          e.preventDefault();
          dismissLinkPop(true);
        } else if (act.type === 'apply') {
          // Enter follows a link natively; Space, and Enter on a row
          // without an href, click it here.
          const it = m.items[act.index];
          if (e.key === 'Enter' && it?.hasAttribute('href')) return;
          e.preventDefault();
          it?.click();
        }
      },
      { signal: sig },
    );
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(view.el);
    const shift = positionLinkPop();
    if (shift && (shift.x || shift.y)) {
      // Past the map edge: pan just enough (8 px margin), zoom unchanged.
      // animateCamTo jumps when reduced motion is on.
      animateCamTo({ x: cam.x + shift.x, y: cam.y + shift.y, k: cam.k }, 200);
    }
    // Close on a tap or click outside it (here or anywhere on the page) that
    // did not drag. A pan, pinch or wheel zoom keeps it open; it follows the
    // globe through applyCam.
    const downs = new Map<number, { x: number; y: number; slop: number; moved: boolean }>();
    const inPop = (t: EventTarget | null) =>
      !!(t as Element | null)?.closest?.(
        '.map-link-pop, .map-link-hit, .map-note-link-hit, .map-thread-hit',
      );
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (inPop(e.target)) return;
        const type = e.pointerType || 'mouse';
        downs.set(e.pointerId, { x: e.clientX, y: e.clientY, slop: type === 'mouse' ? 4 : 10, moved: false });
        // A second finger is a pinch: none of these is a tap.
        if (downs.size > 1) for (const d of downs.values()) d.moved = true;
      },
      { capture: true, signal: sig },
    );
    document.addEventListener(
      'pointermove',
      (e) => {
        const d = downs.get(e.pointerId);
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > d.slop) d.moved = true;
      },
      { capture: true, signal: sig },
    );
    document.addEventListener(
      'pointerup',
      (e) => {
        const d = downs.get(e.pointerId);
        downs.delete(e.pointerId);
        if (!d || d.moved || inPop(e.target)) return;
        dismissLinkPop(false);
      },
      { capture: true, signal: sig },
    );
    document.addEventListener('pointercancel', (e) => downs.delete(e.pointerId), {
      capture: true,
      signal: sig,
    });
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || m.el.contains(e.target as Node)) return;
        e.preventDefault();
        e.stopPropagation();
        dismissLinkPop(true);
      },
      { capture: true, signal: sig },
    );
    if (!m.el.contains(document.activeElement)) focusLinkItem(0);
  }

  /** Move DOM focus to the stable map host so digits/arrows/fold keys work
   * after a node/canvas click. Only called from user gestures inside the map
   * (never from paint alone), so it cannot steal focus from an editor.
   */
  function focusMapForKeys(): void {
    try {
      ensureHostFocusable();
      if (typeof document !== 'undefined' && document.activeElement === host) return;
      host.focus({ preventScroll: true });
    } catch {
      /* focus not available */
    }
  }

  /** Point aria-activedescendant at the selected node (or clear it). */
  function syncActiveDescendant(): void {
    const id = getFocusId();
    const domId = id ? mapNodeDomId(domPrefix, id) : '';
    if (domId && host.querySelector(`#${CSS.escape(domId)}`)) {
      host.setAttribute('aria-activedescendant', domId);
    } else {
      host.removeAttribute('aria-activedescendant');
    }
  }

  // ── Fold to level (Design UX 2026-10-06, L1–L16) ──────────────────────────
  type LevelMenuState = {
    id: string;
    picker: FoldLevelPicker;
    fine: boolean;
    confirm: boolean;
    el: HTMLElement;
    items: HTMLElement[];
    abort: AbortController;
    /** Pointer still down from the hold that opened it (drag-to-level, L5). */
    dragPointer: number | null;
  };
  let levelMenu: LevelMenuState | null = null;
  /** Set by applyFoldLevel; paint() keeps the pressed handle at this screen point (L10). */
  let pendingLevelAnchor: {
    id: string;
    sx: number;
    sy: number;
    expand: boolean;
    noFlip: boolean;
  } | null = null;
  const paintListeners = new Set<() => void>();
  /** bindGestures installs this so a menu tap's trailing click is swallowed. */
  let armClickSwallow: ((x: number, y: number) => void) | null = null;

  function nodeEl(id: string): Element | null {
    return host.querySelector(`.map-node[data-id="${CSS.escape(id)}"]`);
  }

  /** Handle rect in host-local px (the 32×32 hit, scaled by the camera). */
  function handleRect(id: string): { x: number; y: number; w: number; h: number } | null {
    const hit = nodeEl(id)?.querySelector('.map-fold-hit');
    if (!hit) return null;
    const r = hit.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    return { x: r.left - hr.left, y: r.top - hr.top, w: r.width, h: r.height };
  }

  function liveRegion(): HTMLElement {
    let el = host.querySelector(':scope > .map-live') as HTMLElement | null;
    if (el) return el;
    el = document.createElement('div');
    el.className = 'map-live';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText =
      'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0';
    host.appendChild(el);
    return el;
  }

  /** Live-region text (L13). Cleared first so the same text is read again. */
  function announce(text: string): void {
    const el = liveRegion();
    el.textContent = '';
    requestAnimationFrame(() => {
      el.textContent = text;
    });
  }

  function coarsePointer(): boolean {
    try {
      return window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
    } catch {
      return false;
    }
  }

  function positionLevelMenu(): void {
    const m = levelMenu;
    if (!m) return;
    const anchor = handleRect(m.id);
    if (!anchor) {
      closeLevelMenu(false);
      return;
    }
    const vp = hostViewport();
    const pos = placeLevelMenu({
      anchor,
      panel: vp,
      menu: { w: m.el.offsetWidth, h: m.el.offsetHeight },
    });
    m.el.style.left = `${pos.left}px`;
    m.el.style.top = `${pos.top}px`;
    m.el.dataset.below = pos.below ? 'true' : 'false';
  }

  function levelItemsState(): { disabled: boolean; hint?: string }[] {
    return (levelMenu?.items || []).map((b) => ({
      disabled: b.getAttribute('aria-disabled') === 'true',
      hint: b.getAttribute('aria-keyshortcuts') || undefined,
    }));
  }

  function focusLevelItem(index: number): void {
    const b = levelMenu?.items[index];
    if (!b) return;
    for (const it of levelMenu!.items) it.tabIndex = -1;
    b.tabIndex = 0;
    try {
      b.focus({ preventScroll: true });
    } catch {
      /* focus not available */
    }
  }

  function hotLevelItem(index: number): void {
    levelMenu?.items.forEach((b, i) => b.classList.toggle('is-hot', i === index));
  }

  function closeLevelMenu(returnFocus = true): void {
    const m = levelMenu;
    if (!m) return;
    levelMenu = null;
    m.abort.abort();
    const hadFocus = m.el.contains(document.activeElement);
    m.el.remove();
    for (const g of host.querySelectorAll('.map-node[aria-expanded]')) g.removeAttribute('data-level-open');
    if (returnFocus || hadFocus) focusMapForKeys();
  }

  /** Build (or rebuild for the confirm step) the menu view inside the host. */
  function mountLevelMenuView(m: LevelMenuState, confirm: boolean): void {
    const view = renderLevelMenu(m.picker, { fine: m.fine, confirm });
    const old = m.el;
    m.el = view.el;
    m.items = view.items;
    m.confirm = confirm;
    const sig = m.abort.signal;
    view.items.forEach((b, i) => {
      bindTap(
        b,
        (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (ev.type === 'pointerup') {
            const pe = ev as PointerEvent;
            armClickSwallow?.(pe.clientX, pe.clientY);
          }
          pickLevelItem(i);
        },
        { signal: sig },
      );
      b.addEventListener('pointerenter', () => hotLevelItem(i), { signal: sig });
      b.addEventListener('pointerleave', () => b.classList.remove('is-hot'), { signal: sig });
    });
    view.el.addEventListener(
      'keydown',
      (e) => {
        const i = m.items.indexOf(document.activeElement as HTMLElement);
        const act = levelMenuKeyAction(e.key, i, levelItemsState());
        // Every key stays inside the menu: no fold, zoom or host shortcut.
        e.stopPropagation();
        if (!act) return;
        if (act.type === 'move') {
          e.preventDefault();
          focusLevelItem(act.index);
        } else if (act.type === 'close') {
          e.preventDefault();
          if (m.confirm && e.key === 'Escape') {
            mountLevelMenuView(m, false);
            focusLevelItem(levelMenuInitialIndex(m.picker.items));
            return;
          }
          closeLevelMenu(true);
        } else if (act.type === 'apply') {
          // Enter / Space reach the button's own click (bindTap); a key hint applies here.
          if (e.key === 'Enter' || e.key === ' ') return;
          e.preventDefault();
          pickLevelItem(act.index);
        }
      },
      { signal: sig },
    );
    view.el.addEventListener('contextmenu', (e) => e.preventDefault(), { signal: sig });
    if (old.isConnected) old.replaceWith(view.el);
    else host.appendChild(view.el);
    positionLevelMenu();
  }

  /** Open the menu for `id` (L1, L9). Returns false when the node has no children. */
  function openLevelMenu(id: string, how: { fine?: boolean; dragPointer?: number | null } = {}): boolean {
    closeLevelMenu(false);
    const doc = getDoc();
    const picker = foldLevelPicker(doc, id);
    if (!picker || !nodeEl(id)) return false;
    if (getFocusId() !== id) {
      setFocusId(id);
      userCamGesture = true;
      pendingFollow = null;
      onChange?.();
    }
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const abort = new AbortController();
    const m: LevelMenuState = {
      id,
      picker,
      fine: how.fine ?? !coarsePointer(),
      confirm: false,
      el: document.createElement('div'),
      items: [],
      abort,
      dragPointer: how.dragPointer ?? null,
    };
    levelMenu = m;
    mountLevelMenuView(m, false);
    nodeEl(id)?.setAttribute('data-level-open', 'true');
    document.addEventListener(
      'pointerdown',
      (e) => {
        const t = e.target as Node | null;
        if (t && (m.el.contains(t) || host.contains(t))) return;
        closeLevelMenu(false);
      },
      { capture: true, signal: abort.signal },
    );
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || !levelMenu) return;
        if (m.el.contains(e.target as Node)) return;
        e.preventDefault();
        e.stopPropagation();
        closeLevelMenu(true);
      },
      { capture: true, signal: abort.signal },
    );
    focusLevelItem(levelMenuInitialIndex(picker.items));
    return true;
  }

  function pickLevelItem(index: number): void {
    const m = levelMenu;
    if (!m) return;
    const b = m.items[index];
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    const level = b.dataset.level || '';
    if (m.confirm) {
      if (level === 'confirm') {
        closeLevelMenu(true);
        applyFoldLevel(m.id, '*');
      } else {
        mountLevelMenuView(m, false);
        focusLevelItem(levelMenuInitialIndex(m.picker.items));
      }
      return;
    }
    const key: FoldLevelKey = level === '*' ? '*' : (Number(level) as 0 | 1 | 2 | 3);
    if (levelPickNeedsConfirm(m.picker, key)) {
      mountLevelMenuView(m, true);
      focusLevelItem(0);
      return;
    }
    closeLevelMenu(true);
    applyFoldLevel(m.id, key);
  }

  /**
   * One pick: `setExpandLevel(doc, level, { under: id })` (resets the whole
   * subtree, L16), one setDoc + onChange, the pressed handle kept at its
   * screen point (L10), and the live-region text (L13). Fold state only.
   */
  function applyFoldLevel(id: string, level: FoldLevelKey): void {
    const doc = getDoc();
    const picker = foldLevelPicker(doc, id);
    if (!picker) return;
    const item = picker.items.find((it) => it.key === level);
    if (!item || item.disabled) return;
    const next = setExpandLevel(doc, level, { under: id });
    const r = handleRect(id);
    pendingLevelAnchor = r
      ? {
          id,
          sx: r.x + r.w / 2,
          sy: r.y + r.h / 2,
          expand: item.shown > shownBelow(doc, id),
          noFlip: foldLevelSkipsAnimation(doc, next),
        }
      : null;
    stopMotion();
    cancelFollowAnim();
    if (getFocusId() !== id) setFocusId(id);
    userCamGesture = true;
    pendingFollow = null;
    setDoc(next);
    onChange?.();
    announce(foldLevelAnnouncement(picker, level));
  }

  /** Toolbar Levels (L8): every root, counted from the root, first root's handle anchored. */
  function setWholeMapLevel(level: WholeMapLevel): void {
    const doc = getDoc();
    const next = wholeMapLevelDoc(doc, level);
    const root = (doc.nodes || []).find((n) => n.id && hasKids(n));
    const r = root?.id ? handleRect(root.id) : null;
    pendingLevelAnchor =
      root?.id && r
        ? {
            id: root.id,
            sx: r.x + r.w / 2,
            sy: r.y + r.h / 2,
            expand: false,
            noFlip: foldLevelSkipsAnimation(doc, next),
          }
        : null;
    stopMotion();
    cancelFollowAnim();
    userCamGesture = true;
    pendingFollow = null;
    closeLevelMenu(false);
    setDoc(next);
    onChange?.();
    announce(wholeMapAnnouncement(next, level));
  }

  function applyCam(): void {
    const g = host.querySelector('#mapViewport');
    if (!g) return;
    g.setAttribute(
      'transform',
      `translate(${cam.x} ${cam.y}) scale(${cam.k})`,
    );
    // L6: the menu follows its handle through pans and zooms.
    if (levelMenu) positionLevelMenu();
    if (linkPop) positionLinkPop();
  }

  function resetCam(): void {
    // A running spring-back / Fit / glide would overwrite this camera on its
    // next frame (0.2.30).
    stopMotion();
    cancelFollowAnim();
    const layout = getLayout();
    const vb = layout.viewBox || { w: 1200, h: 960 };
    const rect = host.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const k = Math.min(w / vb.w, h / vb.h) * 0.92;
    cam.k = Math.max(CAM_MIN, Math.min(CAM_MAX, k || 1));
    // Keep the outline's left edge on the left of the map. A centred viewBox
    // hides the root once the tree is wider than the panel.
    const pad = 16;
    cam.x = pad;
    const slackY = h - vb.h * cam.k;
    cam.y = slackY >= pad * 2 ? slackY / 2 : pad;
    applyCam();
  }

  function zoomAt(clientX: number, clientY: number, factor: number): void {
    // Zoom the camera shown right now. Without this, a spring-back or Fit
    // animation still running overwrites the zoom on its next frame (0.2.30).
    stopMotion();
    userCamGesture = true;
    cancelFollowAnim();
    const rect = host.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    let next = Math.max(CAM_MIN, Math.min(CAM_MAX, cam.k * factor));
    const content = contentUnion();
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
        fontSize: resolveFontPx(undefined, layout.fontSize, doc.frontmatter?.fontSize),
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
          fontSize: prev?.fontSize,
          w: prev?.w ?? pos.w,
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

  /** `shift` (world px) is the camera move made in the same frame (L10). */
  function runFlipAnimation(prev: Record<string, MapPoint>, shift = { x: 0, y: 0 }): void {
    if (!prev || prefersReducedMotion()) return;
    const layout = getLayout();
    const nodes = host.querySelectorAll<SVGGElement>('.map-node');
    if (!nodes.length || nodes.length > 80) return;

    const movers: SVGGElement[] = [];
    nodes.forEach((g) => {
      const id = g.getAttribute('data-id');
      if (!id || !prev[id] || !layout.nodes?.[id]) return;
      const dx = prev[id].x - layout.nodes[id].x + shift.x;
      const dy = prev[id].y - layout.nodes[id].y + shift.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      g.style.transition = 'none';
      g.style.transform = `translate(${dx}px, ${dy}px)`;
      movers.push(g);
    });
    if (!movers.length) return;

    host.querySelectorAll<SVGElement>('.map-edge, .map-edge-casing').forEach((el) => {
      el.style.transition = 'none';
      el.style.opacity = '0.25';
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        movers.forEach((g) => {
          g.style.transition = `transform ${ANIM_MS}ms ease`;
          g.style.transform = '';
        });
        host.querySelectorAll<SVGElement>('.map-edge, .map-edge-casing').forEach((el) => {
          el.style.transition = `opacity ${ANIM_MS}ms ease`;
          el.style.opacity = '';
        });
        window.setTimeout(() => {
          movers.forEach((g) => {
            g.style.transition = '';
            g.style.transform = '';
          });
          host.querySelectorAll<SVGElement>('.map-edge, .map-edge-casing').forEach((el) => {
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
    const to = nextTaskState(from);
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

  /**
   * One activation of a pill or one of its in-map handles (fold, task box,
   * body more/less, globe, `#N` chip, thread chip). Mouse and keyboard reach
   * this from the node's `click`; touch and pen reach it from `pointerup`
   * (0.2.30), because the browser can drop the click after a fling.
   */
  function activateNodeHit(g: Element, t: Element | null, e: Event): void {
    const id = g.getAttribute('data-id');
    if (!id) return;
    if (t?.closest?.('.map-width-hit')) return;
    if (t?.closest?.('.map-fold-hit') || t?.closest?.('.map-fold-indicator')) {
      setFocusId(id);
      // Focus host/pill BEFORE paint so Map keys work (0.2.13).
      focusMapForKeys();
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
      focusMapForKeys();
      userCamGesture = false;
      pendingFollow = { kind: 'focus' };
      applyTaskToggle(id);
      return;
    }
    if (t?.closest?.('.map-body-more-hit')) {
      // Body more/less — orthogonal to child fold / task.
      setFocusId(id);
      focusMapForKeys();
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
    if (t?.closest?.('.map-link-hit')) {
      const n = findNode(getDoc().nodes, id);
      showLinkPop(id, n?.title || '');
      return;
    }
    if (t?.closest?.('.map-note-link-hit')) {
      const hit = t.closest('.map-note-link-hit') as Element;
      const me = e as MouseEvent;
      if (e.type === 'click' && (me.ctrlKey || me.metaKey || me.shiftKey)) {
        // Modifier click: the SVG anchor opens its own tab, as before.
        const pnid = hit.getAttribute('data-note-link') || '';
        const n = findNode(getDoc().nodes, id);
        if (n && pnid) onNoteLink?.({ id, pnid, node: n });
        return;
      }
      e.preventDefault();
      showNotePop(id, hit);
      return;
    }
    if (t?.closest?.('.map-thread-hit')) {
      showThreadPop(id);
      return;
    }
    // Text / pill chrome: select + focus only — never fold.
    // Label text-drag: keep native Selection (skip paint that would wipe it).
    const prevFocus = getFocusId();
    setFocusId(id);
    // Always move focus to the map host on node click so keys work.
    focusMapForKeys();
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
  }

  /** H8: read --connector-casing once per paint. */
  function connectorCasingOn(): boolean {
    if (typeof getComputedStyle !== 'function') return false;
    try {
      return isConnectorCasingSet(getComputedStyle(host).getPropertyValue('--connector-casing'));
    } catch {
      return false;
    }
  }

  function paint(): void {
    invalidateContentUnion();
    // Boolean snapshot BEFORE the DOM rebuild (an element ref would be detached
    // afterwards). Never steal focus from the editor.
    const hadMapFocus =
      typeof document !== 'undefined' &&
      mapHostOwnsFocus(host, document.activeElement);

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
      key: string;
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
      chips: MapChipPiece[];
      showMore: boolean;
      showLess: boolean;
      bodyExpanded: boolean;
      fontPx: number;
    };
    const nodes: NodePaint[] = [];
    const order = indexOutline(doc.nodes);

    function walk(n: OutlineNode): void {
      const key = nodeMapKey(n, order.get(n) || 0);
      const pos = layout.nodes![key] || { x: 100, y: 100 };
      const label = captionWithoutLinks(displayCaption(n.title));
      const foldable = hasKids(n);
      const col = foldable && !!n.id && isCollapsed(doc, n.id);
      const taskParsed = resolveTask(n);
      const size = pillSize(label, {
        reserveFold: foldable,
        reserveTask: !!taskParsed,
        wrapCh: pos.wrapCh,
        widthPx: pos.w ?? n.layout?.w,
        maxLines: pos.maxLines,
        bodyExpanded: !!pos.bodyExpanded,
        fontSize: resolveFontPx(pos.fontSize, layout.fontSize, doc.frontmatter?.fontSize),
        ...nodeChips(n),
      });
      const cue = isCue(n);
      const thread = resolveThread(n);
      const chips = mapChipPieces(nodeChips(n));
      nodes.push({
        n,
        key,
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
        chips,
        showMore: size.showMore,
        showLess: size.showLess,
        bodyExpanded: size.bodyExpanded,
        fontPx: size.fontPx,
      });

      if (foldable && !col) {
        for (const c of n.children!) {
          const cKey = nodeMapKey(c, order.get(c) || 0);
          const cpos = layout.nodes![cKey] || { x: pos.x + 200, y: pos.y };
          const clabel = captionWithoutLinks(displayCaption(c.title));
          const cTask = resolveTask(c);
          const cs = pillSize(clabel, {
            reserveFold: hasKids(c),
            reserveTask: !!cTask,
            wrapCh: cpos.wrapCh,
            widthPx: cpos.w ?? c.layout?.w,
            maxLines: cpos.maxLines,
            bodyExpanded: !!cpos.bodyExpanded,
            fontSize: resolveFontPx(cpos.fontSize, layout.fontSize, doc.frontmatter?.fontSize),
            ...nodeChips(c),
          });
          // Starts past the fold handle, not under it.
          edges.push({
            d: childConnectorPath(
              { x: pos.x, y: pos.y, w: size.w, foldSlot: size.foldSlot },
              { x: cpos.x, y: cpos.y, w: cs.w },
            ),
          });
          walk(c);
        }
      }
    }
    for (const root of doc.nodes) walk(root);

    // H8: when the host sets --connector-casing, every casing goes under every line.
    const casing = connectorCasingOn();
    const edgeSvg =
      (casing ? edges.map((e) => mapEdgeCasingSvg(e.d)).join('') : '') +
      edges.map((e) => mapEdgeSvg(e.d)).join('');
    const nodeSvg = nodes
      .map(
        ({
          n,
          key,
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
          chips,
          showMore,
          showLess,
          bodyExpanded,
          fontPx,
        }) => {
          const x = pos.x - w / 2;
          const y = pos.y - h / 2;
          const textLeft = x + taskLead;
          const textX = textLeft + textW / 2;
          const boxW = Math.max(1, w - foldSlot);
          const boxRight = x + boxW;
          const affordance = showMore || showLess ? MORE_AFFORDANCE_H : 0;
          const textCentreY = pos.y - affordance / 2;
          const focused = key === focusId;
          const widthHot = key === widthHotKey;
          const widthShown = widthHot || focused;
          const cls = mapNodeClassNames({
            foldable,
            collapsed: col,
            cue,
            task,
            bodyExpanded,
            focused,
          });
          const foldCx = foldHandleGeometry(boxRight, foldSlot).cx;
          const foldHit = foldable
            ? `<rect class="map-fold-hit" x="${foldCx - 16}" y="${pos.y - 16}" width="32" height="32" fill="transparent" cursor="pointer"/>`
            : '';
          const foldChrome = foldable ? foldChromeSvg(boxRight, pos.y, !!col, foldSlot, { casing }) : '';
          const taskHit =
            task != null
              ? `<rect class="map-task-hit" x="${x + 2}" y="${Math.min(y, pos.y - 22)}" width="${Math.max(taskLead - 2, TASK_BOX)}" height="${Math.max(h, 44)}" fill="transparent" cursor="pointer" role="checkbox" aria-checked="${task === 'done' ? 'true' : task === 'pending' ? 'mixed' : 'false'}"/>`
              : '';
          const taskChrome =
            task != null
              ? taskGlyphSvg(task, x + TASK_INSET + TASK_BOX / 2, textCentreY)
              : '';
          const tip = fullText || label;
          const bodyAction = showMore ? 'more' : showLess ? 'less' : '';
          const moreChrome = bodyAction
            ? `<g class="map-body-more-hit" data-body-action="${bodyAction}" transform="translate(${textX} ${y + h - 8})" cursor="pointer">
            <rect x="-28" y="-10" width="56" height="16" rx="8" fill="transparent"/>
            <text text-anchor="middle" y="3" fill="#8b9bab" font-size="11">${bodyAction}</text>
          </g>`
            : '';
          const links = captionLinks(n.title || '');
          // In the top-right corner, top of the glyph flush with the pill
          // top so it does not sit in the gap above the node.
          const globe =
            links.length > 0
              ? globeGlyphSvg(boxRight - 2, y + 8)
              : '';
          const captionX = task != null ? textLeft : x + PILL_PAD_X;
          const widest = richLines.reduce(
            (max, line) => Math.max(max, lineWidth(line, fontPx)),
            0,
          );
          // Chip row after the widest line, centred on the caption: thread pill,
          // `#N` notes. pillSize reserved its width, so it sits inside the node.
          let chipCursor = captionX + widest + 6;
          const notePattern = doc.frontmatter?.noteUri || noteUriFallback;
          let noteIndex = 0;
          const chipSvg = chips
            .map((piece) => {
              const at = chipCursor;
              chipCursor += piece.w + 8;
              if (piece.kind === 'thread') {
                return `<g class="map-thread-hit" data-thread="${esc(thread || '')}" transform="translate(${at} ${textCentreY})" cursor="pointer">
            <rect x="0" y="-11" width="${piece.w}" height="22" fill="transparent"/>
            <rect class="map-thread-pill" x="0.5" y="${-THREAD_CHIP_H / 2}" width="${piece.w - 1}" height="${THREAD_CHIP_H}" rx="${THREAD_CHIP_H / 2}"/>
            <text class="map-thread-label" x="${piece.w / 2}" text-anchor="middle" y="4">${esc(piece.label)}</text>
          </g>`;
              }
              const pieceIndex = noteIndex++;
              const href = noteLinkHref(notePattern, piece.id);
              const chip = `<g class="map-note-link-hit" data-note-link="${esc(piece.id)}" data-note-index="${pieceIndex}" transform="translate(${at} ${textCentreY})" cursor="pointer">
            <title>${href ? esc(href) : `Note ${esc(piece.id)}`}</title>
            <rect x="0" y="-11" width="${piece.w}" height="20" fill="transparent"/>
            <text class="map-note-link" text-anchor="start" y="4">${esc(piece.label)}</text>
          </g>`;
              const wrapped = href
                ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${chip}</a>`
                : chip;
              return wrapped;
            })
            .join('');
          return `<g class="${cls}" id="${esc(mapNodeDomId(domPrefix, key))}" data-id="${esc(key)}" data-text-w="${textW}"
      role="treeitem" aria-selected="${focused ? 'true' : 'false'}" aria-current="${focused ? 'true' : 'false'}" aria-label="${esc(label)}${task != null ? (task === 'done' ? ', task done' : task === 'pending' ? ', task pending' : ', task open') : ''}${foldable ? (col ? ', collapsed' : ', expanded') : ''}${showMore ? ', more text available' : ''}${showLess ? ', showing full body' : ''}"
      ${foldable ? `aria-expanded="${col ? 'false' : 'true'}" aria-haspopup="menu"` : ''}${levelMenu && levelMenu.id === key ? ' data-level-open="true"' : ''}>
      <title>${esc(tip)}</title>
      <rect class="map-pill" x="${x}" y="${y}" width="${boxW}" height="${h}" rx="18" ry="18"/>
      ${taskChrome}
      ${globe}
      ${multiLineText(lines, captionX, textCentreY, textW, richLines, fontPx)}
      ${moreChrome}
      ${chipSvg}
      ${foldChrome}
      ${taskHit}
      ${foldHit}
      <g class="map-width-grip" stroke="#8ec8ff" stroke-width="1.75" stroke-linecap="round" fill="none" pointer-events="none" opacity="${widthShown ? '1' : '0'}">
        <path d="M ${boxRight - 10} ${y + h + 5} H ${boxRight + 5} V ${y + h - 10}"/>
      </g>
      <rect class="map-width-hit" data-text-w="${textW}" x="${boxRight - 6}" y="${y + h - 6}" width="18" height="18" fill="transparent" cursor="ew-resize" pointer-events="${widthShown ? 'all' : 'none'}"/>
    </g>`;
        },
      )
      .join('');

    // Overlays that live inside the host (resize popover, controls a host put
    // in the map) survive the SVG rewrite (0.2.30).
    const overlays = Array.from(host.children).filter((el) =>
      el.matches?.(
        '.map-width-pop, .of-map-controls, .map-level-menu, .map-level-ring, .map-live, .map-link-pop',
      ),
    );
    // A focused menu item is detached by the rewrite below; put focus back after.
    const levelFocus =
      levelMenu && typeof document !== 'undefined'
        ? levelMenu.items.indexOf(document.activeElement as HTMLElement)
        : -1;
    const linkFocus =
      linkPop && typeof document !== 'undefined'
        ? linkPop.items.indexOf(document.activeElement as HTMLAnchorElement)
        : -1;
    host.innerHTML = `<svg class="map-svg" viewBox="0 0 ${Math.max(1, host.clientWidth || 1180)} ${Math.max(1, host.clientHeight || 520)}"
      preserveAspectRatio="xMidYMid meet" role="none" focusable="false">
      <rect width="100%" height="100%" fill="var(--map-bg)"/>
      <g id="mapViewport">
        <rect x="0" y="0" width="${vb.w}" height="${vb.h}" fill="var(--map-bg)" opacity="0"/>
        ${edgeSvg}
        ${nodeSvg}
      </g>
    </svg>`;
    for (const el of overlays) host.appendChild(el);
    if (linkPop && linkFocus >= 0) {
      try {
        linkPop.items[linkFocus]?.focus({ preventScroll: true });
      } catch {
        /* focus not available */
      }
    }
    if (levelMenu && levelFocus >= 0) {
      try {
        levelMenu.items[levelFocus]?.focus({ preventScroll: true });
      } catch {
        /* focus not available */
      }
    }

    // L10: a level pick keeps the pressed handle at its screen point, zoom
    // unchanged; an expand may pan (never zoom) to keep the new subtree in
    // view. The camera moves in this same frame and the FLIP offsets carry
    // the move, so nothing jumps.
    let flipShift = { x: 0, y: 0 };
    let skipFlip = false;
    let anchored = false;
    const la = pendingLevelAnchor;
    pendingLevelAnchor = null;
    if (la && hadViewport) {
      const np = nodes.find((p) => p.key === la.id);
      if (np) {
        const left = np.pos.x - np.w / 2;
        const boxRight = left + Math.max(1, np.w - np.foldSlot);
        const hx = foldHandleGeometry(boxRight, np.foldSlot).cx;
        const old = { x: cam.x, y: cam.y };
        cam.x = la.sx - hx * cam.k;
        cam.y = la.sy - np.pos.y * cam.k;
        if (la.expand) {
          const below = new Set<string>();
          const anchorNode = findNode(doc.nodes, la.id);
          const walkBelow = (n: OutlineNode) => {
            if (n.id && isCollapsed(doc, n.id)) return;
            for (const c of n.children || []) {
              below.add(nodeMapKey(c, order.get(c) || 0));
              walkBelow(c);
            }
          };
          if (anchorNode) walkBelow(anchorNode);
          const toScreen = (p: (typeof nodes)[number]) => ({
            x: (p.pos.x - p.w / 2) * cam.k + cam.x,
            y: (p.pos.y - p.h / 2) * cam.k + cam.y,
            w: p.w * cam.k,
            h: p.h * cam.k,
          });
          let shown: { x: number; y: number; w: number; h: number } | null = null;
          for (const p of nodes) {
            if (!below.has(p.key)) continue;
            const r = toScreen(p);
            if (!shown) shown = r;
            else {
              const x = Math.min(shown.x, r.x);
              const y = Math.min(shown.y, r.y);
              shown = {
                x,
                y,
                w: Math.max(shown.x + shown.w, r.x + r.w) - x,
                h: Math.max(shown.y + shown.h, r.y + r.h) - y,
              };
            }
          }
          const shift = levelKeepVisibleShift({
            viewport: hostViewport(),
            anchor: toScreen(np),
            shown,
            paddingPx: DEFAULT_CAM_PADDING_PX,
            keepFrac: DEFAULT_KEEP_VISIBLE_FRAC,
          });
          cam.x += shift.dx;
          cam.y += shift.dy;
        }
        flipShift = { x: (old.x - cam.x) / cam.k, y: (old.y - cam.y) / cam.k };
        skipFlip = la.noFlip;
        anchored = true;
      }
    }

    if (!hadViewport) resetCam();
    else applyCam();

    if (hadViewport && isAutoPack(layout) && !skipFlip) {
      runFlipAnimation(prev, flipShift);
    }

    host.querySelectorAll<SVGGElement>('.map-node').forEach((g) => {
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        activateNodeHit(g, e.target as Element | null, e);
      });
    });

    syncActiveDescendant();
    const focusPlan = mapPaintFocusAction({
      hadFocus: hadMapFocus,
      isActive: isActive(),
      host,
      activeElementAfter:
        typeof document !== 'undefined' ? document.activeElement : null,
    });
    if (focusPlan === 'focus-host') focusMapForKeys();

    // Camera follow after layout settles (focus / expand / edit). Resume-on-load
    // leaves pendingFollow null so camera stays as restored until user acts.
    if (isActive()) {
      if (!pendingFollow && isEditing()) {
        pendingFollow = { kind: 'edit' };
      }
      const hadFollow = !!pendingFollow;
      runPendingFollow();
      if (!hadFollow && !anchored) {
        clampCamNow();
        applyCam();
      }
    }
    if (anchored) settleCam();
    if (levelMenu) positionLevelMenu();
    if (linkPop) positionLinkPop();
    for (const fn of [...paintListeners]) {
      try {
        fn();
      } catch {
        /* a listener must not break paint */
      }
    }
  }

  function applyFocusMove(direction: MapFocusDirection): void {
    stopMotion();
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

  let gestureAbort: AbortController | null = null;

  function bindGestures(): void {
    if (gestureAbort) return;
    const ac = new AbortController();
    gestureAbort = ac;
    const signal = ac.signal;
    host.style.touchAction = 'none';

    type Tracked = Pt & {
      id: number;
      type: string;
      sx: number;
      sy: number;
      role: 'driver' | 'spare' | 'select';
      /** Pill to select after a still touch. Empty for mouse and for control hits. */
      selectId?: string;
      /** In-map handle a touch / pen press began on (activates on pointerup). */
      hit?: Element;
    };
    const pointers = new Map<number, Tracked>();
    let mode: 'idle' | 'pending' | 'pan' | 'pinch' = 'idle';
    let widthDrag: {
      pointerId: number;
      key: string;
      startX: number;
      startW: number;
      moved: boolean;
    } | null = null;

    const MIN_COL = 120;
    const MAX_COL = 1400;

    function applyWidth(key: string, w: number): void {
      const layout = getLayout();
      if (!layout.nodes) layout.nodes = {};
      const prev = layout.nodes[key] || { x: 100, y: 100 };
      layout.nodes[key] = { ...prev, w: Math.max(MIN_COL, Math.min(MAX_COL, Math.round(w))) };
    }

    function findNodeByKey(key: string): OutlineNode | null {
      const order = indexOutline(getDoc().nodes);
      for (const [n, pos] of order) {
        if (nodeMapKey(n, pos) === key) return n;
      }
      return null;
    }

    /** `w` null returns the pill to auto width and drops the layout entry. */
    function persistColumn(key: string, w: number | null): void {
      const doc = getDoc();
      const node = findNodeByKey(key);
      const layout = getLayout();
      if (!node) return;
      if (w == null) {
        if (node.layout) {
          delete node.layout.w;
          if (node.layout.w == null) delete node.layout;
        }
        if (layout.nodes?.[key]) delete layout.nodes[key].w;
      } else {
        const id = assignPersistentId(doc, node);
        const width = Math.max(MIN_COL, Math.min(MAX_COL, Math.round(w)));
        node.layout = { ...(node.layout || {}), w: width };
        if (!layout.nodes) layout.nodes = {};
        const prev = layout.nodes[key] || layout.nodes[id] || { x: 100, y: 100 };
        if (id !== key) delete layout.nodes[key];
        layout.nodes[id] = { ...prev, w: width };
        if (getFocusId() === key) setFocusId(id);
      }
      widthHotKey = null;
      setDoc(doc);
      onChange?.();
    }

    function commitWidth(): void {
      if (!widthDrag) return;
      const key = widthDrag.key;
      const w = getLayout().nodes?.[key]?.w;
      widthDrag = null;
      if (typeof w !== 'number') return;
      persistColumn(key, w);
    }

    /** Last popover choice per pill key, to mark it when the width still matches. */
    const widthChoiceByKey = new Map<string, { label: string; w: number }>();
    let widthPopAbort: AbortController | null = null;

    function dismissWidthPop(): void {
      widthPopAbort?.abort();
      widthPopAbort = null;
      host.querySelector('.map-width-pop')?.remove();
    }

    /**
     * Above-left of the corner the finger released on, so the finger does not
     * cover it; below only when there is no room above. Clamped inside the
     * host on all four sides (8 px inset). The host clips overflow.
     */
    function placeWidthPop(pop: HTMLElement, clientX: number, clientY: number): void {
      const inset = 8;
      const gap = 28;
      const hr = host.getBoundingClientRect();
      const pr = pop.getBoundingClientRect();
      const pw = pr.width;
      const ph = pr.height;
      const ax = clientX - hr.left;
      const ay = clientY - hr.top;
      let left = ax - pw + 16;
      let top = ay - gap - ph;
      if (top < inset) top = ay + gap;
      const maxLeft = Math.max(inset, hr.width - pw - inset);
      const maxTop = Math.max(inset, hr.height - ph - inset);
      left = Math.min(maxLeft, Math.max(inset, left));
      top = Math.min(maxTop, Math.max(inset, top));
      pop.style.left = `${Math.round(left)}px`;
      pop.style.top = `${Math.round(top)}px`;
    }

    function storedWidth(key: string): number | null {
      const node = findNodeByKey(key);
      const w = node?.layout?.w ?? getLayout().nodes?.[key]?.w;
      return typeof w === 'number' ? w : null;
    }

    function showWidthPop(clientX: number, clientY: number, key: string, textW: number): void {
      dismissWidthPop();
      const ac = new AbortController();
      widthPopAbort = ac;
      const pop = document.createElement('div');
      pop.className = 'map-width-pop';
      pop.setAttribute('role', 'menu');
      pop.setAttribute('aria-label', 'Pill width');
      pop.style.cssText = [
        'position:absolute',
        'z-index:6',
        'display:flex',
        'gap:6px',
        'padding:6px',
        'border-radius:10px',
        'background:#13202b',
        'border:1px solid #3d5a73',
        'box-shadow:0 8px 24px rgba(0,0,0,.35)',
        'touch-action:manipulation',
      ].join(';');
      const slimW = Math.max(MIN_COL, Math.min(MAX_COL, Math.round(textW - 56)));
      const widerW = Math.max(MIN_COL, Math.min(MAX_COL, Math.round(textW + 56)));
      const choices: { label: string; w: number | null }[] = [
        { label: 'Slim', w: slimW },
        { label: 'Wider', w: widerW },
        { label: 'Auto', w: null },
      ];
      const cur = storedWidth(key);
      const last = widthChoiceByKey.get(key);
      const currentLabel =
        cur == null ? 'Auto' : last && last.w === cur ? last.label : null;
      const buttons: HTMLButtonElement[] = [];
      for (const choice of choices) {
        const btn = document.createElement('button');
        btn.type = 'button';
        const checked = choice.label === currentLabel;
        btn.setAttribute('role', 'menuitemradio');
        btn.setAttribute('aria-checked', checked ? 'true' : 'false');
        btn.dataset.choice = choice.label.toLowerCase();
        btn.textContent = checked ? `✓ ${choice.label}` : choice.label;
        btn.style.cssText = [
          'min-height:44px',
          'min-width:44px',
          'padding:0 14px',
          'border-radius:8px',
          `border:1px solid ${checked ? '#8ec8ff' : '#3d5a73'}`,
          `background:${checked ? '#24425e' : '#1b3044'}`,
          'color:#e7ecf1',
          'font:15px/1 system-ui,sans-serif',
          'cursor:pointer',
          'touch-action:manipulation',
        ].join(';');
        bindTap(
          btn,
          (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            dismissWidthPop();
            if (ev.type === 'pointerup') {
              // The repaint removes this button; its trailing click must not
              // land on whatever is drawn under the finger next.
              const pe = ev as PointerEvent;
              swallow = armSwallow(performance.now(), pe.clientX, pe.clientY);
            }
            if (choice.w == null) widthChoiceByKey.delete(key);
            else widthChoiceByKey.set(key, { label: choice.label, w: choice.w });
            persistColumn(key, choice.w);
          },
          { signal: ac.signal },
        );
        buttons.push(btn);
        pop.appendChild(btn);
      }
      // Keys stay inside the menu: Enter / Space must not reach the host's
      // fold keys, arrows move between items, Esc closes.
      pop.addEventListener(
        'keydown',
        (e) => {
          const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            buttons[(i + 1 + buttons.length) % buttons.length]?.focus();
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
          } else if (e.key === 'Home') {
            buttons[0]?.focus();
          } else if (e.key === 'End') {
            buttons[buttons.length - 1]?.focus();
          } else if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Escape' && e.key !== 'Tab') {
            return;
          }
          e.stopPropagation();
          if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Tab') e.preventDefault();
        },
        { signal: ac.signal },
      );
      document.addEventListener(
        'keydown',
        (e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          const hadFocus = pop.contains(document.activeElement);
          dismissWidthPop();
          if (hadFocus) focusMapForKeys();
        },
        { capture: true, signal: ac.signal },
      );
      const hostStyle = getComputedStyle(host);
      if (hostStyle.position === 'static') host.style.position = 'relative';
      host.appendChild(pop);
      placeWidthPop(pop, clientX, clientY);
    }

    let edgeArm: {
      pointerId: number;
      key: string;
      startX: number;
      startY: number;
      startW: number;
    } | null = null;

    function rightEdgeKey(
      clientX: number,
      clientY: number,
      slop: number,
    ): { key: string; textW: number } | null {
      let best: { key: string; textW: number } | null = null;
      let bestDx = slop + 1;
      host.querySelectorAll<SVGGElement>('.map-node').forEach((g) => {
        const pill = g.querySelector('.map-pill');
        if (!pill) return;
        const r = pill.getBoundingClientRect();
        if (clientY < r.bottom - 14 || clientY > r.bottom + slop) return;
        if (clientX < r.right - 12 || clientX > r.right + slop) return;
        const dx = Math.abs(clientX - r.right) + Math.abs(clientY - r.bottom);
        if (dx >= bestDx) return;
        const key = g.getAttribute('data-id') || '';
        if (!key) return;
        bestDx = dx;
        best = { key, textW: Number(g.getAttribute('data-text-w')) || MIN_COL };
      });
      return best;
    }

    function showWidthHot(key: string | null): void {
      if (widthHotKey === key) return;
      widthHotKey = key;
      host.querySelectorAll<SVGGElement>('.map-node').forEach((g) => {
        const on = !!key && g.getAttribute('data-id') === key;
        g.querySelector('.map-width-grip')?.setAttribute('opacity', on ? '1' : '0');
        g.querySelector('.map-width-hit')?.setAttribute('pointer-events', on ? 'all' : 'none');
      });
    }
    let pinch: PinchAnchor | null = null;
    let pan: PanAnchor | null = null;
    let raf = 0;
    /** One-shot click swallow for the click a pan / pinch / pill tap makes. */
    let swallow: SwallowRecord | null = null;
    /** This touch sequence had two fingers down: never glide from it. */
    let gestureHadTwo = false;
    /** Last in-map handle activated from a touch / pen pointerup. */
    let nodeTouchTapAt = -Infinity;
    let releasing = false;
    let longPressTimer = 0;
    let touchSelectTimer = 0;
    let labelTextHold = false;
    // -Infinity, not 0: a mouse press in the first 700 ms of the page is not a finger echo.
    let lastFingerDown = -Infinity;
    let samples: { t: number; x: number; y: number }[] = [];
    let lastTap = { t: 0, x: 0, y: 0 };
    let firstDownAt = 0;
    let secondDownAt = 0;
    let pinchScaleLive = false;
    /** Pinch dropped to one finger. One-finger pan stays off until none remain. */
    let singlePanLocked = false;
    let gestureActive = false;
    let gestureK0 = 1;
    let wheelSettle = 0;
    let selectionGuardOn = false;

    function localPt(e: PointerEvent): Pt {
      const rect = host.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function drivers(): Tracked[] {
      return [...pointers.values()].filter((p) => p.role === 'driver');
    }

    function armSelectionGuard(): void {
      if (selectionGuardOn) return;
      selectionGuardOn = true;
      host.style.userSelect = 'none';
      host.style.setProperty('-webkit-user-select', 'none');
    }

    function clearLiveSelection(): void {
      const sel =
        typeof window !== 'undefined' && window.getSelection
          ? window.getSelection()
          : null;
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      clearSelectionForMapPan(sel);
    }

    function beginPanGuard(): void {
      host.classList.add('panning');
      armSelectionGuard();
      clearLiveSelection();
    }

    function endPanGuard(): void {
      host.classList.remove('panning');
      if (!selectionGuardOn) return;
      selectionGuardOn = false;
      host.style.userSelect = '';
      host.style.removeProperty('-webkit-user-select');
    }

    /** Screen point a pinch is scaling around. Release springs back around it. */
    let pinchZoomAnchor: Pt | null = null;

    function applyGestureCam(next: GestureCam, zoomAnchor?: Pt): void {
      const hard = hardCam(next);
      const shownK = rubberOn ? softZoom(next.k, hard.k) : hard.k;
      const framed =
        zoomAnchor && next.k > 0 && Math.abs(shownK - next.k) > 1e-6
          ? retargetZoom(next, shownK, zoomAnchor)
          : { x: next.x, y: next.y, k: shownK };
      if (zoomAnchor) pinchZoomAnchor = zoomAnchor;
      if (!rubberOn) {
        const clamped = hardCam(framed);
        cam.x = clamped.x;
        cam.y = clamped.y;
        cam.k = clamped.k;
      } else {
        const lo = hardCam({ x: -1e9, y: -1e9, k: framed.k });
        const hi = hardCam({ x: 1e9, y: 1e9, k: framed.k });
        cam.x = softAxis(framed.x, Math.min(lo.x, hi.x), Math.max(lo.x, hi.x));
        cam.y = softAxis(framed.y, Math.min(lo.y, hi.y), Math.max(lo.y, hi.y));
        cam.k = framed.k;
      }
      applyCam();
    }

    function springBack(): void {
      const hard = hardCam(cam);
      let target = hard;
      if (pinchZoomAnchor && cam.k > 0 && Math.abs(hard.k - cam.k) > 1e-4) {
        target = hardCam(retargetZoom(cam, hard.k, pinchZoomAnchor));
      }
      pinchZoomAnchor = null;
      animateCamTo(target, 200);
    }

    function maybeInertia(pointerType: string): boolean {
      const now = performance.now();
      const vel = velocityFromSamples(samples, now);
      const speed = Math.hypot(vel.vx, vel.vy);
      if (
        !inertiaEligible({
          pointerType,
          speedPxPerMs: speed,
          sinceLastMoveMs: vel.sinceLastMoveMs,
          reducedMotion: reducedMotion(),
          enabled: inertiaOn,
        })
      ) {
        return false;
      }
      const capped = capSpeed(vel.vx, vel.vy);
      const content = contentUnion();
      const vp = hostViewport();
      if (content && flingClearsContent(capped.vx, capped.vy, cam, content, vp)) {
        return false;
      }
      let vx = capped.vx;
      let vy = capped.vy;
      let prev = now;
      stopMotion();
      const step = (t: number) => {
        const dt = t - prev;
        prev = t;
        vx = decayVelocity(vx, dt);
        vy = decayVelocity(vy, dt);
        if (Math.hypot(vx, vy) < 0.02) {
          motionRaf = 0;
          springBack();
          return;
        }
        const before = hardCam(cam);
        cam.x += vx * dt;
        cam.y += vy * dt;
        const after = hardCam(cam);
        if (after.x === before.x) vx = 0;
        if (after.y === before.y) vy = 0;
        cam.x = after.x;
        cam.y = after.y;
        cam.k = after.k;
        applyCam();
        motionRaf = requestAnimationFrame(step);
      };
      motionRaf = requestAnimationFrame(step);
      return true;
    }

    function armSwallowAtLocal(p: Pt): void {
      const rect = host.getBoundingClientRect();
      swallow = armSwallow(performance.now(), rect.left + p.x, rect.top + p.y);
    }
    armClickSwallow = (x, y) => {
      swallow = armSwallow(performance.now(), x, y);
    };

    // Fold-handle hold (L1, L4): ring at 150 ms, menu at 450 ms.
    let levelHold: LevelHold | null = null;
    let levelRingTimer = 0;
    let levelOpenTimer = 0;

    function levelRingEl(): HTMLElement | null {
      return host.querySelector(':scope > .map-level-ring');
    }

    function clearLevelHold(): void {
      if (levelRingTimer) window.clearTimeout(levelRingTimer);
      if (levelOpenTimer) window.clearTimeout(levelOpenTimer);
      levelRingTimer = 0;
      levelOpenTimer = 0;
      levelHold = null;
      levelRingEl()?.remove();
    }

    function showLevelRing(id: string): void {
      const r = handleRect(id);
      if (!r) return;
      levelRingEl()?.remove();
      const ring = document.createElement('div');
      ring.className = 'map-level-ring';
      ring.setAttribute('aria-hidden', 'true');
      const size = 44;
      ring.style.cssText = `position:absolute;z-index:6;pointer-events:none;width:${size}px;height:${size}px;left:${Math.round(r.x + r.w / 2 - size / 2)}px;top:${Math.round(r.y + r.h / 2 - size / 2)}px`;
      ring.innerHTML =
        '<svg viewBox="0 0 44 44" width="44" height="44"><circle class="map-level-ring-track" cx="22" cy="22" r="19"/><circle class="map-level-ring-fill" cx="22" cy="22" r="19" pathLength="100" transform="rotate(-90 22 22)"/></svg>';
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      host.appendChild(ring);
      // Fill runs from 150 ms to 450 ms; reduced motion shows a static dot (css).
      ring.style.setProperty('--map-level-ring-ms', `${LEVEL_HOLD_MS - LEVEL_RING_MS}ms`);
      requestAnimationFrame(() => ring.classList.add('is-filling'));
    }

    function beginLevelHold(e: PointerEvent, id: string): void {
      clearLevelHold();
      const hold = startLevelHold({
        pointerId: e.pointerId,
        pointerType: e.pointerType || 'mouse',
        id,
        x: e.clientX,
        y: e.clientY,
        t: performance.now(),
      });
      levelHold = hold;
      levelRingTimer = window.setTimeout(() => {
        levelRingTimer = 0;
        if (levelHold !== hold) return;
        levelHold = levelHoldAt(hold, Math.max(performance.now(), hold.t0 + LEVEL_RING_MS));
        if (levelHold.phase === 'ring') showLevelRing(id);
      }, LEVEL_RING_MS);
      levelOpenTimer = window.setTimeout(() => {
        levelOpenTimer = 0;
        const h = levelHold;
        if (!h || h.pointerId !== hold.pointerId || h.phase === 'cancelled') return;
        const opened = levelHoldAt(h, Math.max(performance.now(), h.t0 + LEVEL_HOLD_MS));
        const p = pointers.get(h.pointerId);
        if (opened.phase !== 'open' || !p || mode !== 'pending' || drivers().length !== 1) {
          clearLevelHold();
          return;
        }
        levelRingEl()?.remove();
        clearLongPress();
        clearTouchSelect();
        // The gesture machine forgets this pointer: from here it only slides (L5).
        pointers.delete(h.pointerId);
        mode = 'idle';
        samples = [];
        levelHold = null;
        try {
          if (h.pointerType === 'touch' && typeof navigator !== 'undefined') navigator.vibrate?.(10);
        } catch {
          /* vibrate not allowed */
        }
        const fine = h.pointerType === 'mouse' && !coarsePointer();
        if (!openLevelMenu(h.id, { fine, dragPointer: h.pointerId })) return;
      }, LEVEL_HOLD_MS);
    }

    function levelItemAt(clientX: number, clientY: number): number {
      const m = levelMenu;
      if (!m) return -1;
      const el = document.elementFromPoint?.(clientX, clientY);
      const item = el?.closest?.('.map-level-item') as HTMLElement | null;
      return item ? m.items.indexOf(item) : -1;
    }

    function recognise(kind: 'pan' | 'pinch'): void {
      const was = mode;
      mode = kind;
      // A pan or pinch cancels a fold-handle hold (L4).
      if (levelHold) clearLevelHold();
      if (was === 'pending' || was === 'idle') {
        userCamGesture = true;
        const ds = drivers();
        if (ds.length) armSwallowAtLocal(kind === 'pinch' && ds.length >= 2 ? mid(ds[0], ds[1]) : ds[0]);
        beginPanGuard();
      }
      for (const p of drivers()) {
        try {
          host.setPointerCapture(p.id);
        } catch {
          /* already captured or gone */
        }
      }
    }

    function clearTouchSelect(): void {
      if (touchSelectTimer) window.clearTimeout(touchSelectTimer);
      touchSelectTimer = 0;
    }

    function startPan(p: Pt): void {
      clearTouchSelect();
      pan = anchorPan(cam, p);
      pinch = null;
      recognise('pan');
    }

    function startPinch(a: Pt, b: Pt): void {
      pinch = anchorPinch(cam, a, b);
      pan = null;
      recognise('pinch');
    }

    function clearLongPress(): void {
      if (longPressTimer) window.clearTimeout(longPressTimer);
      longPressTimer = 0;
    }

    function resetPointers(): void {
      clearLongPress();
      clearTouchSelect();
      clearLevelHold();
      if (levelMenu) levelMenu.dragPointer = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      releasing = true;
      for (const id of pointers.keys()) {
        try {
          host.releasePointerCapture(id);
        } catch {
          /* not captured */
        }
      }
      releasing = false;
      pointers.clear();
      pinch = null;
      pan = null;
      pinchZoomAnchor = null;
      singlePanLocked = false;
      mode = 'idle';
      endPanGuard();
      // Cancel / blur / hidden must not leave a swallow armed (0.2.30).
      swallow = null;
      // nodeTouchTapAt stays: it is time-boxed, and a handle that opens a tab
      // (blur) must still drop its own trailing click.
      gestureHadTwo = false;
    }

    function schedule(): void {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!isActive()) return;
        const ds = drivers();
        if (mode === 'pinch' && pinch && ds.length >= 2) {
          applyGestureCam(pinchFrame(pinch, ds[0], ds[1]), mid(ds[0], ds[1]));
          pinchScaleLive = pinch.scaleLive;
        } else if (mode === 'pan' && pan && ds.length === 1) {
          const next = panFrame(pan, ds[0]);
          const content = contentUnion();
          const vp = hostViewport();
          if (
            content &&
            translationClearsContent(next.x - cam.x, next.y - cam.y, cam, content, vp)
          ) {
            return;
          }
          applyGestureCam(next);
        } else if (mode === 'pending' && ds.length === 1 && !singlePanLocked) {
          const p = ds[0];
          const moved = Math.hypot(p.x - p.sx, p.y - p.sy);
          if (moved > slopPx(p.type)) startPan(p);
        }
      });
    }

    host.addEventListener(
      'click',
      (e) => {
        const now = performance.now();
        const target = e.target as Element | null;
        // The click that follows a handle activated on touch pointerup
        // (bindTap rule: 800 ms, keyboard clicks never). The popover and
        // in-map controls guard their own clicks.
        if (
          touchClickGuarded(e.detail, now, nodeTouchTapAt) &&
          !target?.closest?.('.map-width-pop, .of-map-controls, .map-level-menu, .map-link-pop')
        ) {
          swallow = null;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const rec = swallow;
        swallow = null;
        if (!swallowConsumes(rec, now, e.clientX, e.clientY)) return;
        e.preventDefault();
        e.stopPropagation();
      },
      { capture: true, signal },
    );

    host.addEventListener(
      'wheel',
      (e) => {
        if (!isActive()) return;
        const target = e.target as Element | null;
        if (target?.closest?.('textarea, input, [contenteditable="true"]')) return;
        e.preventDefault();
        userCamGesture = true;
        cancelFollowAnim();
        if (gestureActive && (e.ctrlKey || e.metaKey)) return;
        const intent = wheelIntent(e, wheelSetting, Math.max(1, host.clientHeight));
        if (intent.kind === 'zoom') {
          zoomAt(e.clientX, e.clientY, Math.pow(2, intent.s));
          return;
        }
        cam.x -= intent.dx;
        cam.y -= intent.dy;
        clampCamNow();
        applyCam();
        window.clearTimeout(wheelSettle);
        wheelSettle = window.setTimeout(() => settleCam(), 150);
      },
      { passive: false, signal },
    );

    host.addEventListener('pointerdown', (e) => {
      // Any new primary press is a new gesture: the last one's click swallow
      // is over, even inside the popover or the controls (0.2.30).
      if (e.isPrimary) swallow = null;
      // A mouse press ends the touch click guard (as in bindTap).
      if ((e.pointerType || 'mouse') === 'mouse') nodeTouchTapAt = -Infinity;
      if (!isActive()) return;
      const target = e.target as Element | null;
      // The resize popover and in-map controls handle their own taps: no
      // preventDefault, capture or double-tap zoom on them.
      if (target?.closest?.('.map-width-pop, .of-map-controls, .map-level-menu, .map-link-pop')) return;
      dismissWidthPop();
      closeLevelMenu(false);
      const onLabel = !!target?.closest?.('.map-label');
      const type = e.pointerType || 'mouse';
      const barrel = type === 'pen' && (e.buttons & 2) !== 0;
      if (e.button > 1) return;
      const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
      const finger = type === 'touch' || (coarse && type === 'mouse' && e.button === 0);
      const onControl = !!target?.closest?.(
        '.map-fold-hit, .map-fold-indicator, .map-task-hit, .map-task-glyph, .map-body-more-hit, .map-thread-hit, .map-note-link-hit, .map-link-hit',
      );
      const edge = onControl ? null : rightEdgeKey(e.clientX, e.clientY, finger ? 28 : 18);
      if (!finger && edge && e.button === 0) {
        setFocusId(edge.key);
        focusMapForKeys();
        showWidthHot(edge.key);
        widthDrag = {
          pointerId: e.pointerId,
          key: edge.key,
          startX: e.clientX,
          startW: edge.textW,
          moved: false,
        };
        onChange?.();
        e.preventDefault();
        try {
          host.setPointerCapture(e.pointerId);
        } catch {
          /* capture is optional */
        }
        return;
      }
      if (finger && edge && edge.key === getFocusId()) {
        // Touch resize only after the pill is already selected. A first
        // touch selects; a pan must not drag the corner into a resize.
        edgeArm = {
          pointerId: e.pointerId,
          key: edge.key,
          startX: e.clientX,
          startY: e.clientY,
          startW: edge.textW,
        };
        // Lazy capture (0.2.30): the host captures only once this turns into
        // a width drag, so a tap still reaches the pill's own handlers.
        e.preventDefault();
        return;
      }
      if (type === 'mouse' && performance.now() - lastFingerDown < 700) return;
      if (!finger && (type === 'mouse' || type === 'pen') && onLabel && !barrel && e.button !== 1) return;
      const sel =
        typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null;
      const anchor = sel?.anchorNode ?? null;
      const selectionOutside =
        !!sel && sel.rangeCount > 0 && !sel.isCollapsed && !(anchor && host.contains(anchor));
      const selAction = mapBackgroundPanSelection({
        onLabel,
        onNode: !!target?.closest?.('.map-node'),
        clickDetail: e.detail || 0,
        selectionOutside,
      });
      if (selAction === 'prevent-and-clear') e.preventDefault();
      if (selAction !== 'ignore') {
        // Before the browser's drag-select starts. Doing this only after the
        // pan passes slop lets the highlight grow on every move.
        armSelectionGuard();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) clearSelectionForMapPan(sel);
      }
      if (finger) {
        lastFingerDown = performance.now();
        e.preventDefault();
        // Lazy capture (0.2.30): recognise() captures the drivers once a pan
        // or pinch is recognised. Capturing here would retarget the tap's
        // click to the host on some engines and skip fold / task / globe.
      }

      if (type === 'touch' && e.isPrimary) {
        const stale = [...pointers.values()].some((p) => p.type === 'touch');
        if (stale) resetPointers();
      }
      if (pointers.size === 0) gestureHadTwo = false;
      if (type === 'pen' && [...pointers.values()].some((p) => p.type === 'touch')) return;
      if ([...pointers.values()].some((p) => p.type === 'pen' && p.role !== 'spare') && type === 'touch') {
        return;
      }

      cancelFollowAnim();
      stopMotion();
      focusMapForKeys();
      if (pointers.size === 0) firstDownAt = performance.now();
      else if (pointers.size === 1) secondDownAt = performance.now();
      const pt = localPt(e);
      const role: Tracked['role'] = pointers.size >= 2 ? 'spare' : 'driver';
      const nodeEl = (target as Element | null)?.closest?.('.map-node');
      const control = (target as Element | null)?.closest?.(
        '.map-fold-hit, .map-fold-indicator, .map-task-hit, .map-task-glyph, .map-body-more-hit, .map-thread-hit, .map-note-link-hit, .map-link-hit, .map-width-hit',
      );
      const selectId =
        finger && nodeEl && !control ? nodeEl.getAttribute('data-id') || '' : '';
      const hit =
        isTapPointer(type) && nodeEl && control && !control.matches('.map-width-hit')
          ? control
          : undefined;
      pointers.set(e.pointerId, {
        id: e.pointerId,
        type,
        x: pt.x,
        y: pt.y,
        sx: pt.x,
        sy: pt.y,
        role,
        selectId,
        hit,
      });

      const count = drivers().length;
      if (count >= 2) {
        // Never glide from a gesture that had two fingers down: drop the
        // one-finger samples now (0.2.30, gesture amendment 2026-10-05).
        gestureHadTwo = true;
        samples = [];
        // A second pointer cancels a fold-handle hold (L4).
        if (levelHold) clearLevelHold();
      } else if (
        count === 1 &&
        nodeEl &&
        control?.matches('.map-fold-hit, .map-fold-indicator') &&
        e.button === 0 &&
        !barrel
      ) {
        const id = nodeEl.getAttribute('data-id') || '';
        if (id && foldLevelPicker(getDoc(), id)) beginLevelHold(e, id);
      }
      const next = nextGestureMode(mode, count, false);
      if (next === 'pinch' && mode !== 'pinch') {
        clearLongPress();
        const ds = drivers();
        startPinch(ds[0], ds[1]);
      } else if (next === 'pinch') {
        clearLongPress();
      } else {
        mode = 'pending';
        if (finger && onLabel) {
          const label = target!.closest('.map-label') as Element;
          clearLongPress();
          longPressTimer = window.setTimeout(() => {
            const p = pointers.get(e.pointerId);
            if (!p || mode !== 'pending') return;
            if (Math.hypot(p.x - p.sx, p.y - p.sy) > slopPx(p.type)) return;
            labelTextHold = true;
            window.setTimeout(() => {
              const sel = window.getSelection?.();
              if (sel && sel.toString()) return;
              const node = label.querySelector('tspan') || label;
              const range = document.createRange();
              range.selectNodeContents(node);
              sel?.removeAllRanges();
              sel?.addRange(range);
            }, 100);
          }, 500);
        }
      }
    }, { signal });

    host.addEventListener(
      'pointermove',
      (e) => {
        // Drag-to-level (L5): after the menu opens, the finger only slides.
        if (levelMenu && levelMenu.dragPointer === e.pointerId) {
          e.preventDefault();
          hotLevelItem(levelItemAt(e.clientX, e.clientY));
          return;
        }
        if (levelHold && e.pointerId === levelHold.pointerId) {
          levelHold = levelHoldMoved(levelHold, e.clientX, e.clientY);
          if (levelHold.phase === 'cancelled') clearLevelHold();
        }
        if (widthDrag && e.pointerId === widthDrag.pointerId) {
          e.preventDefault();
          widthDrag.moved = true;
          const dx = (e.clientX - widthDrag.startX) / (cam.k || 1);
          showWidthHot(widthDrag.key);
          applyWidth(widthDrag.key, widthDrag.startW + dx);
          paint();
          return;
        }
        if (edgeArm && e.pointerId === edgeArm.pointerId) {
          const dx = e.clientX - edgeArm.startX;
          const dy = e.clientY - edgeArm.startY;
          if (Math.hypot(dx, dy) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
            const arm = edgeArm;
            edgeArm = null;
            pointers.delete(e.pointerId);
            mode = 'idle';
            pan = null;
            clearLongPress();
            clearTouchSelect();
            showWidthHot(arm.key);
            widthDrag = {
              pointerId: e.pointerId,
              key: arm.key,
              startX: arm.startX,
              startW: arm.startW,
              moved: true,
            };
            try {
              host.setPointerCapture(e.pointerId);
            } catch {
              /* capture is optional */
            }
            applyWidth(arm.key, arm.startW + dx / (cam.k || 1));
            paint();
            return;
          }
        }
        if (
          !widthDrag &&
          !edgeArm &&
          pointers.size === 0 &&
          mode === 'idle' &&
          (e.pointerType === 'mouse' || e.pointerType === '') &&
          e.buttons === 0
        ) {
          showWidthHot(rightEdgeKey(e.clientX, e.clientY, 18)?.key ?? null);
        }
        const p = pointers.get(e.pointerId);
        if (!p) return;
        const pt = localPt(e);
        p.x = pt.x;
        p.y = pt.y;
        if (p.role === 'select') p.role = 'driver';
        if (mode === 'idle') mode = 'pending';
        if (mode === 'pan' || mode === 'pinch' || mode === 'pending') {
          e.preventDefault();
          const now = performance.now();
          samples.push({ t: now, x: pt.x, y: pt.y });
          if (samples.length > 12) samples.shift();
        }
        schedule();
      },
      { passive: false, signal },
    );

    const endPointer = (e: PointerEvent): void => {
      // The release of the hold that opened the menu: never a toggle (L4).
      // Lifting on an item applies it; lifting anywhere else keeps the menu (L5).
      if (levelMenu && levelMenu.dragPointer === e.pointerId) {
        const m = levelMenu;
        m.dragPointer = null;
        swallow = armSwallow(performance.now(), e.clientX, e.clientY);
        nodeTouchTapAt = performance.now();
        if (pointers.size === 0) {
          mode = 'idle';
          endPanGuard();
        }
        const i = e.type === 'pointerup' ? levelItemAt(e.clientX, e.clientY) : -1;
        hotLevelItem(-1);
        if (i >= 0 && m.items[i]?.getAttribute('aria-disabled') !== 'true') pickLevelItem(i);
        return;
      }
      if (levelHold && levelHold.pointerId === e.pointerId) clearLevelHold();
      if (widthDrag && e.pointerId === widthDrag.pointerId) {
        const drag = widthDrag;
        widthDrag = null;
        if (!drag.moved) {
          swallow = armSwallow(performance.now(), e.clientX, e.clientY);
          showWidthPop(e.clientX, e.clientY, drag.key, drag.startW);
          return;
        }
        widthDrag = drag;
        commitWidth();
        paint();
        return;
      }
      if (edgeArm?.pointerId === e.pointerId) {
        const arm = edgeArm;
        edgeArm = null;
        const moved = Math.hypot(e.clientX - arm.startX, e.clientY - arm.startY);
        if (moved < 10) {
          swallow = armSwallow(performance.now(), e.clientX, e.clientY);
          showWidthPop(e.clientX, e.clientY, arm.key, arm.startW);
        }
      }
      const had = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (!had || had.role === 'spare') {
        if (pointers.size === 0) {
          mode = 'idle';
          endPanGuard();
        }
        return;
      }
      clearLongPress();
      clearTouchSelect();
      for (const p of pointers.values()) {
        if (drivers().length >= 2) break;
        if (p.role === 'spare') p.role = 'driver';
      }
      const ds = drivers();
      const wasPinch = mode === 'pinch';
      const wasPan = mode === 'pan';
      // The swallow follows the gesture to where the finger lifted.
      if (wasPan || wasPinch) swallow = armSwallow(performance.now(), e.clientX, e.clientY);
      const lift = afterLift(mode, ds.length, singlePanLocked);
      mode = lift.mode;
      singlePanLocked = lift.singlePanLocked;
      if (lift.action === 'retarget-pinch') {
        startPinch(ds[0], ds[1]);
        return;
      }
      if (lift.action === 'hold') {
        samples = [];
        pan = null;
        return;
      }
      if (lift.action === 'retarget-pan') {
        startPan(ds[0]);
        return;
      }
      if (ds.length === 0) {
        const skipFling = lift.skipFling;
        const moved = Math.hypot(had.x - had.sx, had.y - had.sy);
        const now = performance.now();
        mode = 'idle';
        pinch = null;
        pan = null;
        endPanGuard();
        if (
          twoFingerZoomOut &&
          wasPinch &&
          isTwoFingerTap({
            secondDownDelayMs: secondDownAt - firstDownAt,
            spanMs: now - firstDownAt,
            movedA: moved,
            movedB: moved,
            scaleLive: pinchScaleLive,
          })
        ) {
          const rect = host.getBoundingClientRect();
          zoomAt(rect.left + had.x, rect.top + had.y, 0.5);
          springBack();
        } else if (
          doubleTapOn &&
          !wasPan &&
          !wasPinch &&
          moved <= 30 &&
          !(e.target as Element | null)?.closest?.('.map-node') &&
          isDoubleTap(now - lastTap.t, Math.hypot(had.x - lastTap.x, had.y - lastTap.y))
        ) {
          const rect = host.getBoundingClientRect();
          zoomAt(rect.left + had.x, rect.top + had.y, 2);
          springBack();
          lastTap = { t: 0, x: 0, y: 0 };
        } else if (!wasPan && !wasPinch) {
          // Touch / pen tap on an in-map handle: activate now. After a fling
          // the browser can drop the click for a few hundred ms (0.2.30).
          if (e.type === 'pointerup' && had.hit) {
            const lp = localPt(e);
            const g = had.hit.closest('.map-node');
            const tapped = nodeTapShouldActivate({
              pointerType: had.type,
              movedPx: Math.hypot(lp.x - had.sx, lp.y - had.sy),
              swallow,
              now,
              x: e.clientX,
              y: e.clientY,
            });
            if (swallowConsumes(swallow, now, e.clientX, e.clientY)) swallow = null;
            if (tapped && g && had.hit.isConnected) {
              nodeTouchTapAt = now;
              activateNodeHit(g, had.hit, e);
            }
          }
          if (
            had.selectId &&
            !labelTextHold &&
            moved <= slopPx(had.type)
          ) {
            setFocusId(had.selectId);
            focusMapForKeys();
            userCamGesture = false;
            pendingFollow = { kind: 'focus' };
            onChange?.();
            swallow = armSwallow(now, e.clientX, e.clientY);
          } else if (had.selectId) {
            swallow = armSwallow(now, e.clientX, e.clientY);
          }
          labelTextHold = false;
          clearTouchSelect();
          lastTap = { t: now, x: had.x, y: had.y };
          settleCam();
        } else if (skipFling || wasPinch || gestureHadTwo || !maybeInertia(had.type)) {
          // No glide from any gesture that had two fingers down.
          springBack();
        }
        samples = [];
        pinchScaleLive = false;
        gestureHadTwo = false;
      }
    };
    host.addEventListener('pointerup', endPointer, { signal });
    host.addEventListener('pointerleave', () => {
      if (!widthDrag) showWidthHot(null);
    }, { signal });
    host.addEventListener('pointercancel', (e) => {
      endPointer(e);
      if (pointers.size === 0) resetPointers();
    }, { signal });
    host.addEventListener('lostpointercapture', () => {
      if (releasing) return;
    }, { signal });

    // Right-click on a handle or a pill opens the level menu (L9). A touch
    // long-press is the hold above, so the platform menu is suppressed there.
    host.addEventListener('contextmenu', (e) => {
      if (!isActive()) return;
      const t = e.target as Element | null;
      if (t?.closest?.('.map-level-menu')) {
        e.preventDefault();
        return;
      }
      const g = t?.closest?.('.map-node');
      const onHandle = !!t?.closest?.('.map-fold-hit, .map-fold-indicator');
      const pt = (e as PointerEvent).pointerType || '';
      if (levelHold || levelMenu) {
        if (onHandle || levelMenu) e.preventDefault();
        return;
      }
      if (!g) return;
      if (pt === 'touch' || pt === 'pen') {
        if (onHandle) e.preventDefault();
        return;
      }
      if (!onHandle && t?.closest?.('.map-label')) {
        // Label with a text selection: keep the browser menu (Copy).
        const sel = window.getSelection?.();
        if (sel && !sel.isCollapsed && mapNodeKeepsTextSelection(g, sel)) return;
      }
      const id = g.getAttribute('data-id') || '';
      if (!id || !foldLevelPicker(getDoc(), id)) return;
      e.preventDefault();
      openLevelMenu(id, { fine: !coarsePointer() || pt === 'mouse' });
    }, { signal });
    window.addEventListener('blur', () => resetPointers(), { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) resetPointers();
    }, { signal });

    const onGesture = (ev: Event) => {
      const e = ev as Event & { scale?: number; clientX?: number; clientY?: number };
      if (e.type === 'gesturestart') {
        e.preventDefault?.();
        gestureActive = true;
        gestureK0 = cam.k;
        userCamGesture = true;
        cancelFollowAnim();
        return;
      }
      if (e.type === 'gesturechange' && typeof e.scale === 'number') {
        e.preventDefault?.();
        // Touch pinch already updates the camera from the pointer pair.
        // Applying the Safari gesture scale on top of that double-zooms,
        // and at the cap the second write flings the map off the fingers.
        if (mode === 'pinch') return;
        const factor = (gestureK0 * e.scale) / Math.max(0.0001, cam.k);
        zoomAt(e.clientX || 0, e.clientY || 0, factor);
        return;
      }
      if (e.type === 'gestureend') {
        gestureActive = false;
        springBack();
      }
    };
    host.addEventListener('gesturestart', onGesture, { signal });
    host.addEventListener('gesturechange', onGesture, { signal });
    host.addEventListener('gestureend', onGesture, { signal });
    window.addEventListener('pagehide', () => resetPointers(), { signal });

    window.addEventListener('resize', () => {
      if (!isActive()) return;
      const svg = host.querySelector('svg');
      if (svg) {
        svg.setAttribute(
          'viewBox',
          `0 0 ${Math.max(1, host.clientWidth)} ${Math.max(1, host.clientHeight)}`,
        );
      }
    }, { signal });
  }

  function unbindGestures(): void {
    closeLevelMenu(false);
    armClickSwallow = null;
    gestureAbort?.abort();
    gestureAbort = null;
    host.style.touchAction = '';
  }

  /**
   * Map-mode keyboard — orientation table (L→R). Outline keeps attachOutlineTree ARIA map.
   * Fold never on ←/→; fold via . / Space / Enter / digits when a node is selected.
   * Digits / * are relative to the selected node (1 = show that node's children).
   * Space stays fold (not task toggle).
   */
  function bindKeyboard(wire: MapKeyboardWire = {}): void {
    if (keyboardBound) return;
    keyboardBound = true;
    const modeButton = wire.modeButton ?? null;
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      // A button in the resize popover or in controls a host put inside the
      // map keeps its own Enter / Space (no fold toggle on the way).
      const kt = e.target as Element | null;
      if (kt?.closest?.('.map-width-pop, .of-map-controls, .map-level-menu, .map-link-pop')) return;
      // Enter / Space on a focused chip (the #N chip's SVG anchor) opens its popover.
      const chipSel = '.map-note-link-hit, .map-thread-hit, .map-link-hit';
      const chip =
        kt?.closest?.(chipSel) ?? (kt?.tagName?.toLowerCase() === 'a' ? kt.querySelector?.(chipSel) : null);
      const chipNode = chip?.closest?.('.map-node');
      if (chip && chipNode && (e.key === 'Enter' || e.key === ' ') && isActive()) {
        e.preventDefault();
        e.stopPropagation();
        activateNodeHit(chipNode, chip, e);
        return;
      }
      if (
        !mapKeyboardShouldHandle({
          isActive: isActive(),
          target: e.target as { tagName?: string; isContentEditable?: boolean } | null,
          activeElement: document.activeElement,
          host,
          modeButton,
          modifier: e.ctrlKey || e.metaKey || e.altKey,
        })
      ) {
        return;
      }
      const doc = getDoc();
      const focusId = getFocusId();
      const n = focusId ? findNode(doc.nodes, focusId) : null;
      const selected = !!(n && n.id);

      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        // L9: the level menu for the selected node.
        if (selected && hasKids(n!)) {
          e.preventDefault();
          openLevelMenu(n!.id!, { fine: !coarsePointer() });
        }
        return;
      }
      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        stopMotion();
        const vp = hostViewport();
        const stepX = vp.w * 0.1;
        const stepY = vp.h * 0.1;
        const dx = e.key === 'ArrowLeft' ? stepX : e.key === 'ArrowRight' ? -stepX : 0;
        const dy = e.key === 'ArrowUp' ? stepY : e.key === 'ArrowDown' ? -stepY : 0;
        panBy(dx, dy);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        stopMotion();
        zoomBy(1.2);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        stopMotion();
        zoomBy(1 / 1.2);
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        fit();
      } else if (e.key === 'ArrowDown') {
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
        // Space on the focused host would scroll the page — always swallow.
        if (e.key === ' ') e.preventDefault();
        if (selected && hasKids(n!) && n!.id) {
          e.preventDefault();
          const wasCollapsed = isCollapsed(doc, n!.id);
          setDoc(toggleFold(doc, n!.id));
          // Keep the selection (and newly shown kids) in view, like circle-+.
          userCamGesture = false;
          pendingFollow = wasCollapsed
            ? { kind: 'expand', focusId: n!.id }
            : { kind: 'focus' };
          onChange?.();
        }
      } else if (e.key === '*') {
        if (!selected) return;
        e.preventDefault();
        // Expand-all relative to selection (subtree), not whole forest.
        setDoc(setExpandLevel(doc, '*', { under: n!.id! }));
        userCamGesture = false;
        pendingFollow = { kind: 'expand', focusId: n!.id! };
        onChange?.();
      } else if (e.key >= '0' && e.key <= '9') {
        if (!selected) return;
        e.preventDefault();
        // Digit N = depth under the selected node (1 = show its children).
        setDoc(setExpandLevel(doc, Number(e.key), { under: n!.id! }));
        userCamGesture = false;
        pendingFollow =
          e.key === '0' ? { kind: 'focus' } : { kind: 'expand', focusId: n!.id! };
        onChange?.();
      }
    };
    // Keydown on the stable focus owner (host) — events from any descendant
    // bubble here. Mode button kept so keys work right after clicking "Map".
    host.addEventListener('keydown', onKey);
    if (modeButton && !host.contains(modeButton)) {
      modeButton.addEventListener('keydown', onKey);
    }
  }

  return {
    paint,
    ensurePositions,
    resetCam,
    zoomAt,
    zoomBy,
    panBy,
    fit,
    applyCam,
    cam,
    bindGestures,
    unbindGestures,
    bindKeyboard,
    visibleList,
    findNode,
    ensureEditVisible,
    openLevelMenu: (id?: string) => {
      const target = id ?? getFocusId();
      return target ? openLevelMenu(target) : false;
    },
    closeLevelMenu: () => closeLevelMenu(false),
    applyFoldLevel,
    setWholeMapLevel,
    currentWholeMapLevel: () => currentWholeMapLevel(getDoc()),
    onPaint: (fn: () => void) => {
      paintListeners.add(fn);
      return () => {
        paintListeners.delete(fn);
      };
    },
  };
}

// Re-export shortLabel for tests that imported behaviour indirectly — not public API.
export { shortLabel as _shortLabelForTests };

/**
 * Toolbar Levels group (fold to level L8, optional): `Levels 1 2 3 All`, the
 * whole map counted from each root, the current level pressed. Buttons are
 * at least 44px. Returns the group.
 */
export function mountMapLevels(
  map: Pick<MapViewHandle, 'setWholeMapLevel' | 'currentWholeMapLevel' | 'onPaint'>,
  container: HTMLElement,
): HTMLElement {
  const group = document.createElement('div');
  group.className = 'of-map-levels';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Levels');
  group.style.touchAction = 'manipulation';
  const label = document.createElement('span');
  label.className = 'of-map-levels-label';
  label.textContent = 'Levels';
  label.setAttribute('aria-hidden', 'true');
  group.appendChild(label);
  const buttons: { level: WholeMapLevel; el: HTMLButtonElement }[] = [];
  for (const level of WHOLE_MAP_LEVELS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = level === '*' ? 'All' : String(level);
    b.setAttribute('aria-label', level === '*' ? 'All levels' : `Level ${level}`);
    b.dataset.level = String(level);
    b.style.minWidth = '44px';
    b.style.minHeight = '44px';
    b.style.touchAction = 'manipulation';
    bindTap(b, () => map.setWholeMapLevel(level));
    buttons.push({ level, el: b });
    group.appendChild(b);
  }
  const sync = () => {
    const now = map.currentWholeMapLevel();
    for (const { level, el } of buttons) el.setAttribute('aria-pressed', now === level ? 'true' : 'false');
  };
  map.onPaint(sync);
  sync();
  container.appendChild(group);
  return group;
}

/**
 * Zoom − / + / Fit controls. Buttons are at least 44px. Pan arrows stay off
 * unless asked. `levels: true` adds the Levels group (needs a full map handle).
 */
export function mountMapControls(
  map: Pick<MapViewHandle, 'zoomBy' | 'fit' | 'panBy' | 'cam'> &
    Partial<Pick<MapViewHandle, 'setWholeMapLevel' | 'currentWholeMapLevel' | 'onPaint'>>,
  container: HTMLElement,
  opts: { panArrows?: boolean; levels?: boolean } = {},
): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'of-map-controls';
  bar.style.display = 'flex';
  bar.style.gap = '8px';
  bar.style.touchAction = 'manipulation';
  const mk = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-label', label);
    b.style.minWidth = '44px';
    b.style.minHeight = '44px';
    b.style.touchAction = 'manipulation';
    // Touch activates on pointerup (a fling can drop the click); mouse and
    // keyboard keep click. One activation per tap (0.2.30).
    bindTap(b, () => fn());
    bar.appendChild(b);
    return b;
  };
  mk('Zoom out', () => map.zoomBy(1 / 1.2));
  mk('Zoom in', () => map.zoomBy(1.2));
  mk('Fit', () => map.fit());
  if (opts.levels && map.setWholeMapLevel && map.currentWholeMapLevel && map.onPaint) {
    mountMapLevels(
      {
        setWholeMapLevel: map.setWholeMapLevel,
        currentWholeMapLevel: map.currentWholeMapLevel,
        onPaint: map.onPaint,
      },
      bar,
    );
  }
  if (opts.panArrows) {
    mk('Pan left', () => map.panBy(40, 0));
    mk('Pan right', () => map.panBy(-40, 0));
    mk('Pan up', () => map.panBy(0, 40));
    mk('Pan down', () => map.panBy(0, -40));
  }
  container.appendChild(bar);
  return bar;
}
