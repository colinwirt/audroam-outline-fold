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
import { iconGlyph, iconLabel, loadEmojiData } from './emoji/icons.js';
import { openIconPicker, type IconPickerHandle } from './emoji/picker.js';
import { applyNodePalette, setColourFill, colourGroups, colourLabel, isHighlighter, isAudroam, resolveColour, isSolidColour } from './nodeColour.js';
import { resolveFollowInText, setFollowInText, loadMapResume } from './mapResume.js';
import { ALT_HOLD_MS, altDragCommits, altPressKind } from './altGesture.js';
import { captionLinks, captionWithoutLinks, captionRegionRefs, markCode, showsAsCode } from './captionRich.js';
import {
  captionLinkRows,
  renderLinkPreview,
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
import { CLOUD_OUTER, cloudHull, cloudPad, cloudSvg, regionHull, regionSvg, wrapPlain, type MapRegion } from './mapRegion.js';
import { placeRegions, innerRegionEdges, type PlacedBox, type PlacedRegion, type RegionHostSpec } from './regionLayout.js';
import { createRegionFoldStore, isMemoryOnlyRegion, revealScopedId, type RegionFoldStore } from './regionFold.js';
import { parseScopedId, scopeId } from './scopedId.js';
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
  clampFontPx,
  naturalLineWidth,
  fitTextWidth,
  autoTextWidth,
} from './mapLabel.js';
import { LABEL_FONT_FAMILY } from './svgTextMeasure.js';

/** 0.4.4: caption prefix on an unlocked sealed anchor pill. */
export const UNLOCK_MARK = '🔓 ';
import {
  W_AUTO_SINGLE_LINE,
  WIDTHS_REDONE,
  WIDTHS_RESTORED,
  WIDTH_MAX_COL,
  WIDTH_TOAST_MS,
  fitTextEntry,
  oneLineEntry,
  wideEntry,
  dragEntry,
  passedDragThreshold,
  normalizeWidthPickKind,
  isSingleLineMode,
  autoWrapCh,
  AUTO_WIDTH_CHOICES,
  type LegacyWidthPickKind,
  sameWidth,
  siblingScope,
  levelScope,
  isCopyScopeKind,
  copyWidthEntry,
  singleLineCap,
  singleLineWidth,
  stepEntry,
  widthMenuKeyItem,
  widthPickAnnouncement,
  widthToastText,
  WIDTH_MENU_KEYS,
  type WidthEntry,
  type WidthPickKind,
} from './mapFit.js';
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
  parseLeadingTask,
  resolveTask,
  resolveAction,
  resolveThread,
  resolveJumps,
  jumpChipLabel,
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
import { assignPersistentId, mintNodeId, previewPersistentId, writtenId } from './nodeAddress.js';
import { createSessionIndex, isBlankNode, isViewKey, viewLayout, type SessionIndex } from './sessionIndex.js';
import {
  COPIED_TOAST_MS,
  NODE_HOLD_SLOP,
  copiedText,
  copyText,
  jumpTagFor,
  nodeCopyItems as nodeCopyItemsFor,
  nodeFocusHref,
  nodeMenuKeyAction,
  placeNodeMenu,
  renderNodeMenu,
  type NodeCopyItem,
  type NodeCopyKind,
  type NodeMenuEntry,
  type NodeUriOption,
  isCompactSwatchMenu,
} from './nodeMenu.js';
import { openColourPalette, type ColourPaletteHandle } from './colourPalette.js';
import { recentColours, rememberColour } from './colourRecent.js';
import { toggleTask, setTask, nextTaskState, nextTaskCycle, shouldFireAction } from './task.js';
import { mapRefOf, type MapNodeRef } from './mapRef.js';
import {
  TIME_LEAF_GAP_Y,
  TIME_LEAF_LETTER,
  TIME_LEAF_LETTER_GAP,
  TIME_LEAF_NAME,
  TIME_LEAF_PAD_X,
  TIME_LEAF_PAD_Y,
  timeLeafAriaLabel,
  timeLeafCaption,
  timeLeafFontPx,
  timeLeafKind,
  type TimeLeafKind,
} from './timeLeaf.js';
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
  levelContextAction,
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
import {
  THUMB_DEFAULT_W,
  THUMB_INSET,
  THUMB_RADIUS,
  assetKeyFor,
  clampThumbWidth,
  defaultImageAdd,
  imageFilesOf,
  safeAssetSrc,
  thumbBox,
  type ImageAddHook,
} from './thumbnails.js';

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
  /**
   * F5a `w-auto` mode (`single-line`): the map re-measures the natural
   * one-line width on every paint and writes it to `w`. `''` (session-only
   * widths) overrides a mode authored in the document.
   */
  wAuto?: string;
}

/**
 * One width undo step (hold-to-fit F7): a popover pick, a `w`-menu pick or a
 * drag, however many pills changed. A host with its own D5 stack can take it
 * through `onWidthStep`.
 */
export interface MapWidthStep {
  kind: WidthPickKind | 'drag';
  /** Pills that changed, as host ids (the line's id once written; a view key otherwise). */
  keys: string[];
  /** Toast text, e.g. "4 widths changed". */
  label: string;
  undo: () => void;
  redo: () => void;
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
  /** Optional per-key layout nudges (wrapCh/maxLines), keyed like the result. */
  nodeLayout?: Record<string, MapPoint>;
  /**
   * Key for each node in the result (0.6.6). The Map passes its session index
   * (`__sid-N` view keys). Standalone default: the node's unique `node.id`, else a
   * view key; never a 1-based position.
   */
  keyOf?: (n: OutlineNode) => string;
}

/** Standalone pack keys: a unique `node.id`, else a view key. Never a place number. */
function publicPackKeys(nodes: OutlineNode[]): (n: OutlineNode) => string {
  const idx = createSessionIndex();
  idx.sync(nodes);
  const dup = idx.duplicates();
  return (n) => (n.id && !dup.has(n.id) && !(n.autoId && false) ? n.id : idx.keyOf(n));
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
  /** Measure the caption at 600: an open or pending task (K4, 0.2.38). */
  semibold?: boolean;
  /**
   * Time leaf (0.2.40, TL1): one line that hugs the caption (no wrap, no
   * stored width, no more/less), the compact height, and room for the kind
   * letter. `fontSize` is the size to paint at (see `timeLeafNodeFontPx`).
   */
  timeLeaf?: TimeLeafKind | null;
  /** 0.5.21: thumbnail above the caption (T5/T6). `src` is a checked source (T4). */
  thumb?: ThumbSpec | null;
  /** Whole caption is code (`<font:code>` / `<style:code>`, or inherited). */
  code?: boolean;
}

export interface ThumbSpec {
  src: string | null;
  natW?: number;
  natH?: number;
  alt?: string;
}

export interface PillSize {
  /** 0.5.21: drawn thumbnail box (image width/height, crop when the 1.25× cap applies). */
  thumb?: { w: number; h: number; crop: boolean; src: string | null; alt?: string };
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
  /** Sub-instance regions (sealed viewer, separate record) drawn as clouds around a subtree. */
  getRegions?: () => MapRegion[];
  /**
   * Cloud-region child instances (spec 20261101 §1). Each child lays out in its own frame
   * and the parent auto-pack reserves room so no parent node overlaps a region. Hosts may
   * also use `mountRegion` / `unmountRegion` on the handle instead of this option.
   */
  getRegionHosts?: () => RegionHostSpec[];
  /**
   * Region fold store (§R1), keyed by scoped id. Share the same store with Outline so both
   * views read one fold state. Default: a private in-memory store.
   */
  regionFold?: RegionFoldStore;
  /** A locked sealed region's fold handle was activated: ask the host to unlock (§R1 d). */
  onRegionUnlock?: (region: string) => void;
  /** 0.4.3: zone header 🔒 on an open sealed cloud (host locks the session). */
  onRegionLock?: (region: string) => void;
  /** 0.4.3: zone header More ▾ on an open sealed cloud (host shows Remove seal…). */
  onRegionMore?: (region: string, anchor: DOMRect) => void;
  /**
   * 0.4.7: a [ ] box on a row inside an unlocked region (scoped id). The host toggles the
   * task in that region's child doc (the zone plaintext) and marks it dirty; Save re-seals.
   * Return true when it changed.
   */
  onRegionTaskToggle?: (scopedId: string, to?: TaskState | null) => boolean;
  /**
   * A width change on a pill inside an unlocked region (corner drag or the width menu).
   * The map has already written it onto that child. `w` null is Auto (clear `w` and `wAuto`).
   * A string `wAuto` sets the one-line flag; null clears it; omitted leaves it as it was.
   * The host marks the region dirty so the next re-seal keeps the width.
   */
  onRegionWidth?: (scopedId: string, w: number | null, wAuto?: string | null) => void;
  /**
   * 0.5.28: a style change (icon, colour, fill, cloud) on a node inside an unlocked region.
   * The map has written it onto that child as inline tags (never the plaintext layout block,
   * which would leak sealed content). The host marks the region dirty so Save & re-seal keeps it.
   */
  onRegionStyle?: (scopedId: string) => void;
  /**
   * An inner branch in a region was folded or expanded. The store already holds the new state.
   * The host copies it onto the child document so a sealed submap writes `(+)` on the next re-seal.
   */
  onRegionFoldSync?: (region: string) => void;
  /**
   * 0.4.15: a [ ] box on a main-doc row. The doc owner cycles that line's marker as a text edit
   * (no whole-doc re-serialise, so it cannot trip the sealed-save guard). Return the states.
   * Null means the line was not edited. When this is set, the map does not fall through to
   * `setDoc` — that re-serialise inserted a second line for `[]` and for session ids.
   */
  /** 0.5.15: `ref` names the row for certain (id, path from the shown top row, title), so the
   *  text side resolves it against the whole note. A number is the 0.5.14 ordinal. */
  onMainTaskToggle?: (id: string, ref?: MapNodeRef | number, to?: TaskState | null) => { from: TaskState | null; to: TaskState | null } | null;
  /**
   * When false, Map task clicks and the `t` shortcut are ignored (announce
   * "Task toggle is read-only"). Default true. Same idea as Outline `allowTaskToggle`.
   */
  allowTaskToggle?: boolean;
  /** Map focus moved (click, keys, `setFocus`): scoped id (`region:node` inside a region). */
  onFocusChange?: (scopedId: string) => void;
  /**
   * 0.4.8: the note's doc handle (`createOutlineDoc`). Supplies the region clouds, the shared
   * fold store, Lock and the in-cloud task toggle; explicit options above still win.
   */
  outlineDoc?: { mapOptions(onUnlock?: (region: string) => void, onMore?: (branchId: string, rect: DOMRect) => void): Partial<MapViewOptions> };
  getDoc: () => OutlineFoldDoc;
  setDoc: (d: OutlineFoldDoc) => void;
  getLayout: () => MapLayout;
  getFocusId: () => string;
  setFocusId: (id: string) => void;
  /**
   * 0.6.6: a shared session index (e.g. `outlineDoc.mapOptions().sessionIndex`), so the
   * Map, the text and the Outline use the same view keys. Default: the view's own.
   */
  sessionIndex?: SessionIndex;
  onChange?: () => void;
  ariaLabel?: string;
  /**
   * Secondary chrome (0.2.41): folded-count badges after fold handles and the
   * key hints / item counts in the level and width menus. Default false
   * (clean map). Toggles the `of-details` class on the host; CSS does the rest.
   */
  details?: boolean;
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
   * Optional: a hop row or `<r:x>` chip selected node `id` (from node `from`).
   * The map has already selected it and unfolded its ancestors.
   */
  onHop?: (ev: { id: string; from: string; node: OutlineNode }) => void;
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
  /**
   * Hold-to-fit F8: when false (a viewer without write rights), widths from
   * the popover, `w` and drags are session-only: they go to the layout object
   * only, no id is minted, `setDoc` / `onChange` are not called. Default true.
   */
  canPersistWidths?: boolean | (() => boolean);
  /**
   * Hold-to-fit F7: every width step. Return true to take it onto the host's
   * own undo stack (D5); the package then keeps no stack of its own and leaves
   * Ctrl/⌘+Z to the host. Otherwise the package keeps it (Ctrl/⌘+Z on the map,
   * the toast's Undo, `map.undoWidth()`).
   */
  onWidthStep?: (step: MapWidthStep) => boolean | void;
  /**
   * 0.2.39: the package's own node menu (M2–M4, M8, M9) with `Levels…` and the
   * Open group (`Copy jump`, `Copy link`). It opens on a right-click on the
   * pill (not the ± handle), a touch or pen hold of 450 ms on the pill chrome
   * (not the label), and `ContextMenu` / `Shift+F10` for the selected node.
   * Default false: a host with its own node menu leaves it off and calls
   * `map.nodeCopyItems`, `map.copyJump` and `map.copyLink` from its items.
   */
  nodeMenu?: boolean;
  /**
   * 0.5.18: `Icon…` / `Remove icon` in the package node menu and Ctrl/⌘+. on the
   * selected node (emoji / clipart picker, EP-1). Default false (opt-in, so existing node menus keep their items).
   */
  nodeIcons?: boolean;
  /** 0.6.2: draw node icons in Map labels (default true). Toggle later with `map.setNodeIconsVisible`. */
  showNodeIcons?: boolean;
  /**
   * 0.5.18: `Cloud` checkbox in the node menu's Edit group (EP-39). Clouds already on the
   * line (`<cloud>`) always paint; this only adds the menu toggle. Default false (opt-in).
   */
  nodeClouds?: boolean;
  /**
   * 0.5.21: editors can add thumbnails (Create › Image…, paste, drop) and resize a
   * selected thumbnail with its frame handle. Thumbnails render either way.
   */
  nodeImages?: boolean;
  /** 0.5.21: store an added image file. Default: an embedded data URL. */
  onImageAdd?: ImageAddHook;
  /** 0.5.21: URL to draw for an `att:` source (never written to the doc). Null: placeholder. */
  resolveImageSrc?: (src: string) => string | null;
  /**
   * 0.5.19: `Colour` swatches (palette group + Highlighter group + None, EP-31) in the node
   * menu's Edit group and in the icon picker panel; with `nodeClouds` too, `Cloud colour`
   * swatches on a cloud root (EP-39). Colours already on the line (`<color:moss>`,
   * `<cloud:creek>`) always paint; this only adds the controls. Default false (opt-in).
   */
  nodeColours?: boolean;
  /**
   * 0.5.19: named palette for the colour roles (default `forest`). Tags store roles, so a
   * different palette recolours the map without editing the text. Add sets with
   * `registerNodePalette` (a token table). Adds `of-palette-<name>` to the host.
   */
  colourPalette?: string;
  /**
   * `Follow in text` checkbox in the node menu's View group. Opt-in (0.4.1): the item
   * shows only when `followMenu: true`, so a plain node menu keeps its 0.3 items, focus
   * order and the read-only "no id, no menu" rule. The value resolves per-user resume
   * (`followResumeKey`) → layout block `follow:` → on; toggling writes both
   * (`setFollowInText`) and calls `onFollowInText`.
   */
  followMenu?: boolean;
  followResumeKey?: string | null;
  onFollowInText?: (on: boolean) => void;
  /**
   * 0.2.39 Copy link: the URL that opens the map focused on a node. A template
   * with `{id}` (http(s) or root-relative; made absolute against the page), or
   * a function `({ id, node }) => url`. Unset: the current page with
   * `focus=<id>` (http(s) pages only). `null` or `''`: no Copy link.
   */
  nodeUri?: NodeUriOption;
  /**
   * 0.2.39: Copy jump / Copy link on a line without an id write a short id
   * onto it (`assignPersistentId`, as widths do) through setDoc + onChange, so
   * the host marks the document dirty and its save keeps it. False: read-only,
   * nothing is minted and the two items are hidden on lines without an id
   * (M11). Default: the value of `canPersistWidths` (true when unset).
   */
  canMintIds?: boolean | (() => boolean);
  /** 0.2.39: after every Copy jump / Copy link (copied or not). */
  onCopy?: (ev: NodeCopyResult) => void;
}

/** What a Copy jump / Copy link did (0.2.39). */
export interface NodeCopyResult {
  kind: NodeCopyKind;
  /** The map key it was asked for (a view key `__sid-N`, or the id the host passed). */
  key: string;
  /** The node's id afterwards, or null when there is none (read-only). */
  id: string | null;
  /** What was put on the clipboard (or would have been). */
  text: string | null;
  /** True when this copy wrote a new id onto the line. */
  minted: boolean;
  /** True when the clipboard took it. */
  ok: boolean;
  /** Why nothing was copied: `missing`, `read-only`, `no-link`, `clipboard`. */
  reason?: 'missing' | 'read-only' | 'no-link' | 'clipboard';
}

export interface MapKeyboardWire {
  /** @deprecated Ignored for key gating since 0.2.12 (host/modeButton only). Kept for call-site compat. */
  panel?: HTMLElement | null;
  /** When focused (e.g. after clicking Map), digit/fold/arrow keys still apply. */
  modeButton?: HTMLElement | null;
}

export interface MapRegionHandle {
  relayout(): void;
  setFolded(folded: boolean): void;
  bbox(): { x: number; y: number; w: number; h: number } | null;
}

export interface MapViewHandle {
  /** `Follow in text` as resolved now (resume → layout → on). */
  followInText(): boolean;
  /** Set it (writes layout block + resume, like the menu toggle). */
  setFollowInText(on: boolean): void;
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
  /** Mount a cloud-region child instance under `host.anchor` (spec 20261101 §1). */
  mountRegion: (host: RegionHostSpec) => MapRegionHandle;
  /** Unmount a region; the host is expected to wipe the child (lock/close its session). */
  unmountRegion: (id: string) => void;
  /** Regions placed by the last auto-pack (parent frame). */
  placedRegions: () => readonly PlacedRegion[];
  /** The region fold store this view reads (shared with Outline when passed in). */
  regionFold: RegionFoldStore;
  /** Select a node inside a region by scoped id (keyboard focus stays in the region). */
  focusRegionNode: (scoped: string | null) => void;
  /**
   * Unfold the path to a scoped id (anchor, region root, inner parents; enclosing regions
   * too) and select it. A sealed region on the path stops at its root and asks to unlock
   * (`onRegionUnlock`). Use for `<r:REGION:N>` links and the `reveal` / `focus` commands.
   */
  revealScoped: (id: string) => string;
  /** Move Map focus to a scoped id: unfold the path, follow with the camera, stop at a sealed root. */
  setFocus: (id: string) => string;
  /** Current Map focus as a scoped id (region focus wins over the root focus). */
  focusedScopedId: () => string | null;
  /**
   * Open the fold-to-level menu for a node (default: the selected node),
   * anchored at its fold handle, as a right-click or hold on the handle does.
   * For a host node menu's `Levels…` item. Closes the package's other menus
   * first. False when the node has no children.
   */
  openLevelMenu: (id?: string) => boolean;
  /** Close the fold-to-level menu if it is open. */
  closeLevelMenu: () => void;
  /**
   * Close every menu the package has open: the level picker, the link popover
   * and the width popover. A host calls it before opening its own menu, so
   * only one menu is ever open.
   */
  closeMenus: () => void;
  /**
   * Hold-to-fit P1: open the width popover for a node (default: the selected
   * one), as the `w` key does, with focus on its current item. False without
   * bindGestures() or a node.
   */
  openWidthMenu: (id?: string) => boolean;
  /** Apply a width pick (`fit`, `line`, `siblings`, `level`, `wide`, `auto`; legacy `slim`/`wider`) as the popover does. */
  applyWidthPick: (id: string, kind: LegacyWidthPickKind) => boolean;
  /** Undo / redo the last width step on the package's own stack. False when there is none. */
  undoWidth: () => boolean;
  redoWidth: () => boolean;
  /**
   * Undo / redo the last map chrome edit (width or style: colour / fill / cloud / icon).
   * Ctrl/⌘+Z and Shift+Ctrl/⌘+Z call these. `undoWidth` / `redoWidth` only touch width steps.
   */
  undoMapEdit: () => boolean;
  redoMapEdit: () => boolean;
  /** Apply a level under a node, as a menu pick does (anchors the handle, announces). */
  applyFoldLevel: (id: string, level: FoldLevelKey) => void;
  /** Show or hide secondary chrome (counts, key hints); see `details`. */
  setDetails: (on: boolean) => void;
  /** 0.5.20 / 0.6.1: Fill (wash) on/off; promotes branch colour (or white) when the node has none. */
  setNodeColourFill: (id: string, on: boolean) => boolean;
  /** 0.5.28: add (`'default'` or a colour) or remove (undefined) a node's cloud; scoped ids style a zone node inline. */
  setNodeCloud: (id: string, color: string | undefined) => void;
  /** 0.5.22: set or clear a node colour (written to its layout entry). */
  setNodeColour: (id: string, color: string | undefined) => void;
  /** 0.5.22: set or clear a node icon (written to its layout entry). */
  setNodeIcon: (id: string, token: string | undefined) => void;
  /**
   * Set or clear a node's code font. `code` writes `font: code` in that node's
   * layout entry (and mints an id when the line has none). `auto` writes
   * `font: auto`, which clears the own value so the node follows its parent.
   * A sealed-zone row is written inline.
   */
  setNodeFont: (id: string, font: 'code' | 'auto' | undefined) => void;
  /** 0.5.21: add an image under a node as a thumbnail child (editors). Resolves the child key, or null. */
  addImage: (id: string, file: File) => Promise<string | null>;
  /** 0.5.21: set a thumbnail node's width (clamped 120–480), one undo step. */
  setThumbWidth: (id: string, w: number) => boolean;
  /** 0.5.21: the node menu entries for a node (for hosts and tests). */
  nodeMenuEntries: (id: string) => NodeMenuEntry[];
  /** Whether secondary chrome is showing. */
  details: () => boolean;
  /** Every root to a level (toolbar Levels, L8). */
  setWholeMapLevel: (level: WholeMapLevel) => void;
  /** The toolbar level the whole map is at, or null. */
  currentWholeMapLevel: () => WholeMapLevel | null;
  /** Called after every paint. Returns an unsubscribe function. */
  onPaint: (fn: () => void) => () => void;
  /**
   * 0.2.39: open the package node menu for a node (default: the selected one),
   * at a client point or under the pill. Needs `nodeMenu: true` and
   * bindGestures(). False when nothing in it applies.
   */
  openNodeMenu: (id?: string, at?: { clientX: number; clientY: number }, how?: { fine?: boolean; pointerType?: string }) => boolean;
  /** 0.5.18: open the icon picker (panel, Map tab) for a node. */
  openIconPicker: (id?: string) => boolean;
  /**
   * 0.5.30: toolbar toggle for the node icon picker. Open: closes it (returns false). Closed:
   * opens it for the node, staying open across picks until toggled off or Esc. Pass the host's
   * button as `toggle` so its own press is not read as an outside press.
   */
  toggleIconPicker: (id?: string, opts?: { toggle?: Element | null }) => boolean;
  /** 0.6.2: show or hide every node icon / emoji in Map labels (view only; the text is unchanged). Repaints. */
  setNodeIconsVisible: (on: boolean) => void;
  /** 0.6.2: whether node icons are drawn. */
  nodeIconsVisible: () => boolean;
  /** 0.5.30: close the map's icon picker if open. */
  closeIconPicker: () => void;
  /** 0.5.30: whether the map's icon picker is open (drive the toolbar's aria-pressed). */
  isIconPickerOpen: () => boolean;
  /** 0.5.30: called with true/false when the map's icon picker opens or closes. Returns unsubscribe. */
  onIconPickerChange: (fn: (open: boolean) => void) => () => void;
  /**
   * Open the dedicated colour palette for a node (default: the focused one).
   * Stay-open picks use the existing colour undo / style-preview path.
   */
  openColourPalette: (id?: string, how?: { toggle?: Element | null }) => boolean;
  /** Toolbar toggle: close if open, else open for the focused (or given) node. */
  toggleColourPalette: (id?: string, how?: { toggle?: Element | null }) => boolean;
  closeColourPalette: () => void;
  isColourPaletteOpen: () => boolean;
  onColourPaletteChange: (fn: (open: boolean) => void) => () => void;
  /** 0.2.39: close the package node menu if it is open. */
  closeNodeMenu: () => void;
  /**
   * 0.2.39: Copy jump and Copy link for a node (default: the selected one), in
   * menu order, each with `hidden` and a `reason` (for a host that shows it
   * disabled with a tooltip) and `text` when the node already has an id.
   */
  nodeCopyItems: (id?: string) => NodeCopyItem[];
  /** 0.2.39: copy `<r:id>` for a node, minting its id first if needed and allowed. */
  copyJump: (id?: string) => Promise<NodeCopyResult>;
  /** 0.2.39: copy the URL that opens the map focused on a node, minting its id first if needed and allowed. */
  copyLink: (id?: string) => Promise<NodeCopyResult>;
  /**
   * 0.2.39: the node's written id, minting one (setDoc + onChange) when it has
   * none and minting is allowed. Null when read-only and there is none.
   */
  ensureNodeId: (id?: string) => string | null;
  /**
   * 0.2.39: select a node, unfold its folded ancestors and let the camera
   * follow (as a jump does, without onHop). For `?focus=<id>` on load.
   */
  focusNode: (id: string) => boolean;
  /**
   * 0.6.6: the view key (`__sid-N`) of a node object, or of a fixed reference
   * (`<id:N>` / `__sid-N`). Every Map method that takes a key accepts either.
   */
  viewKey: (nodeOrRef: OutlineNode | string) => string | null;
  /** The node a view key or fixed reference names in the current doc. */
  nodeForKey: (keyOrRef: string) => OutlineNode | null;
  /**
   * The focused node, from the session view key (`getFocusId()`), the same
   * lookup the node menu uses (`nodeForKey`). Works for id-less nodes and
   * after a remote rewrite or expand/collapse. Null when nothing is focused.
   * A host style toolbar should enable from this, not from `node.id === focusId`.
   */
  focusedNode: () => OutlineNode | null;
  /** The id a host sees for a view key: the line's id when it has one, else the view key. */
  hostId: (keyOrRef: string) => string;
  /** The session index behind this view (line ↔ key, fixed ref ↔ key, duplicates). */
  sessionIndex: () => SessionIndex;
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
/**
 * 0.4.5 (Colin): folded region pill (lock glyph only) sized like a normal pill at this font:
 * 12px inset, glyph, 12px inset, room for the key chip, then the fold slot.
 */
export function foldedRegionPill(fontPx: number): { w: number; h: number } {
  const glyph = Math.ceil(fontPx * 1.4);
  return { w: 12 + glyph + 12 + 34 + FOLD_SLOT, h: Math.max(30, Math.ceil(fontPx * 1.3 + 14)) };
}

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

/** K6 (0.2.38): folded-count badge height and font size. */
export const FOLD_COUNT_H = 16;
export const FOLD_COUNT_FONT = 11;
/** The fold hit target is 32 px wide around the handle centre (`.map-fold-hit`). */
const FOLD_HIT_HALF = 16;

/** Accessible text for a folded node's count: `5 hidden`. */
export function foldCountLabel(count: number): string {
  return `${count} hidden`;
}

/**
 * K6 (0.2.38): a folded node's hidden-child count (its direct children),
 * beside the gold + handle. 11 px on the menu surface, `aria-label` "5 hidden".
 * It starts past the handle's 32 px hit target and takes no pointer events,
 * so it is never part of the handle's hit area. Empty for 0.
 */
export function foldCountSvg(
  boxRight: number,
  y: number,
  count: number,
  foldSlot: number = FOLD_SLOT,
): string {
  if (!(count > 0)) return '';
  const { cx } = foldHandleGeometry(boxRight, foldSlot);
  const text = String(count);
  const w = Math.max(FOLD_COUNT_H, Math.round(text.length * 6.6 + 10));
  const x = cx + FOLD_HIT_HALF + 1;
  const label = foldCountLabel(count);
  return `<g class="map-fold-count" transform="translate(${x} ${y})" role="img" aria-label="${label}" pointer-events="none">
          <rect x="0" y="${-FOLD_COUNT_H / 2}" width="${w}" height="${FOLD_COUNT_H}" rx="${FOLD_COUNT_H / 2}"/>
          <text x="${w / 2}" y="4" text-anchor="middle" font-size="${FOLD_COUNT_FONT}" aria-hidden="true">${text}</text>
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
  /** Folded only: hidden-child count drawn beside the + (K6, 0.2.38). */
  hiddenCount?: number;
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
  if (collapsed && opts.hiddenCount) parts.push(foldCountSvg(boxRight, y, opts.hiddenCount, foldSlot));
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

/**
 * A connector. `timeLeaf` marks the edge into a time leaf (0.2.40, TL4):
 * `map-edge edge-time`, 1 px `--time-edge`.
 */
export function mapEdgeSvg(d: string, opts: { timeLeaf?: boolean; colour?: string | null } = {}): string {
  const c = !opts.timeLeaf ? resolveColour(opts.colour) : null;
  return `<path class="map-edge${opts.timeLeaf ? ' edge-time' : ''}${c ? ` edge-colour edge-colour-${c}` : ''}" d="${d}"${c ? ` style="--ec: var(--node-${c})"` : ''}/>`;
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
  /** Time leaf (0.2.40): `time-leaf kind-time` / `time-leaf kind-session`. Leaves only. */
  timeLeaf?: TimeLeafKind | null;
  /** 0.5.19 node colour token: `has-colour colour-<name>` (ignored on time leaves, TL7 / Q14). */
  color?: string | null;
  /** 0.5.20: `colour-fill` adds the wash (`<color:x:fill>`); default is border only. */
  colorFill?: boolean;
}): string {
  const tl = !opts.foldable && opts.timeLeaf ? opts.timeLeaf : null;
  const colour = !tl ? resolveColour(opts.color) : null;
  return [
    'map-node',
    opts.foldable ? '' : 'leaf',
    tl ? `time-leaf kind-${tl}` : '',
    opts.collapsed ? 'collapsed' : '',
    opts.cue ? 'cue' : '',
    opts.task === 'done' ? 'task-done' : opts.task === 'pending' ? 'task-pending' : opts.task ? 'task-open' : '',
    opts.bodyExpanded ? 'body-expanded' : '',
    opts.focused ? 'is-focused' : '',
    colour ? `has-colour colour-${colour}${opts.colorFill ? ` colour-fill${isSolidColour(colour) ? ' is-solid' : isHighlighter(colour) ? ' is-hl' : isAudroam(colour) ? ' is-au' : ''}` : ''}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Kind letter width (bold `T` / `S`) at a font size. */
export function timeLeafLetterW(fontPx: number): number {
  return Math.ceil(fontPx * 0.68);
}

/** Left pad of a time leaf: pad, the kind letter, the gap before the caption. */
export function timeLeafPadLeft(fontPx: number): number {
  return TIME_LEAF_PAD_X + timeLeafLetterW(fontPx) + TIME_LEAF_LETTER_GAP;
}

/**
 * TL1 font for a time leaf: a per-node `fontSize` in the layout is used as
 * written; otherwise 0.85× the map font (layout file, frontmatter, then 16).
 */
export function timeLeafNodeFontPx(
  node: number | undefined,
  layout: number | undefined,
  frontmatter: number | undefined,
): number {
  if (typeof node === 'number' && Number.isFinite(node)) return resolveFontPx(node, undefined, undefined);
  return timeLeafFontPx(resolveFontPx(undefined, layout, frontmatter));
}

export function pillSize(label: string, opts: PillSizeOptions = {}): PillSize {
  if (opts.timeLeaf) {
    const fontPx = clampFontPx(opts.fontSize);
    return measurePill(timeLeafCaption(label), {
      wrapCh: 100000,
      maxLines: 1,
      fontSize: fontPx,
      reserveFold: false,
      reserveTask: false,
      reserveMoreAffordance: false,
      compactPadY: TIME_LEAF_PAD_Y,
      padLeft: timeLeafPadLeft(fontPx),
      foldSlot: FOLD_SLOT,
      taskLead: TASK_LEAD,
      noteLinks: opts.noteLinks,
      thread: opts.thread,
      jumps: opts.jumps,
      code: opts.code,
    });
  }
  const thumb = opts.thumb;
  const measured = measurePill(label, {
    wrapCh: opts.wrapCh ?? DEFAULT_WRAP_CH,
    widthPx: thumb ? opts.widthPx ?? THUMB_DEFAULT_W : opts.widthPx,
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
    semibold: opts.semibold,
    code: opts.code,
  });
  if (thumb) {
    // T5: the image fills the box (minus the fold slot) with an 8px inset; T6 cap.
    const box = thumbBox(measured.w - measured.foldSlot - THUMB_INSET * 2, thumb.natW, thumb.natH);
    return { ...measured, h: measured.h + box.h + THUMB_INSET, thumb: { ...box, src: thumb.src, alt: thumb.alt } };
  }
  return measured;
}

function nodePillOpts(
  n: OutlineNode,
  nodeLayout?: Record<string, MapPoint>,
  defaults?: { wrapCh?: number; maxLines?: number | null; fontSize?: number },
  key?: string,
  doc?: OutlineFoldDoc,
  code = false,
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
  const tl = timeLeafKind(n);
  if (tl) {
    return {
      timeLeaf: tl,
      fontSize: timeLeafNodeFontPx(lay?.fontSize, defaults?.fontSize, undefined),
      ...nodeChips(n, doc, code),
      code,
    };
  }
  return {
    reserveFold: hasKids(n),
    reserveTask: !!resolveTask(n),
    semibold: false,
    wrapCh: lay?.wrapCh ?? defaults?.wrapCh ?? DEFAULT_WRAP_CH,
    widthPx: typeof widthPx === 'number' && widthPx > 0 ? widthPx : undefined,
    maxLines,
    bodyExpanded: !!lay?.bodyExpanded,
    fontSize: lay?.fontSize ?? defaults?.fontSize,
    ...nodeChips(n, doc, code),
    code,
  };
}

/**
 * Time leaf pill options for paint (0.2.40): the stored width, wrap and
 * more/less of the layout entry do not apply (TL1). Null for other nodes.
 */
function timeLeafPaintOpts(
  n: OutlineNode,
  pos: { fontSize?: number } | undefined,
  layoutFont: number | undefined,
  fmFont: number | undefined,
  doc?: OutlineFoldDoc,
  code = false,
): PillSizeOptions | null {
  const tl = timeLeafKind(n);
  if (!tl) return null;
  return { timeLeaf: tl, fontSize: timeLeafNodeFontPx(pos?.fontSize, layoutFont, fmFont), ...nodeChips(n, doc, code), code };
}

/**
 * Chips after the caption (0.2.34): thread pill, `#N` notes (`<t:N>`, then
 * caption `[label](#pnid:N)`), `<r:x>` jumps labelled with the target's caption.
 */
function nodeChips(n: OutlineNode, doc?: OutlineFoldDoc, code = false): MapChipSpec & { thumb?: ThumbSpec } {
  const notes = resolveNoteLinks(n);
  // A code caption is literal: links written in it stay text, not chips.
  if (!code) for (const l of captionLinks(n.title || '')) if (l.pnid && !notes.includes(l.pnid)) notes.push(l.pnid);
  const jumps = resolveJumps(n).map((id) => ({ id, label: jumpChipLabel(doc, id) }));
  // `<r:REGION:N>` chips: the click goes through setFocus → revealScoped.
  if (!code) for (const id of captionRegionRefs(n.title || '')) jumps.push({ id, label: jumpChipLabel(null, id) });
  const out: MapChipSpec & { thumb?: ThumbSpec } = { thread: !!resolveThread(n), noteLinks: notes, jumps };
  if (n.img && !timeLeafKind(n)) {
    const a = doc?.assets?.find((e) => e.key === n.img);
    out.thumb = { src: safeAssetSrc(a?.src), natW: a?.w, natH: a?.h, alt: a?.alt };
  }
  return out;
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

/**
 * K4 (0.2.38): an open `[ ]` or in-progress `[-]` task gets a 2 px stroke and
 * a semibold label. Done `[x]` drops to 1 px with muted text (CSS).
 */
export function isTaskEmphasis(state: TaskState | null | undefined): boolean {
  return state === 'open' || state === 'pending';
}

function taskGlyphSvg(state: TaskState, x: number, y: number): string {
  const stroke = state === 'open' ? '#8b9bab' : '#C9A227';
  const mark =
    state === 'done'
      ? `<path class="map-task-mark" d="M-4 0.5 l2.5 2.5 L4 -3" fill="none" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>`
      : state === 'pending'
        ? `<path class="map-task-mark" d="M-4 0 H4" fill="none" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round"/>`
        : '';
  return `<g class="map-task-glyph" pointer-events="none" transform="translate(${x} ${y})" aria-hidden="true">
    <rect class="map-task-box" x="-7" y="-7" width="14" height="14" rx="3" fill="none" stroke="${stroke}" stroke-width="1.75"/>
    ${mark}
  </g>`;
}

/**
 * 0.4.12: the one task lead (hit target + glyph) for every Map node, main or region. The hit
 * spans the lead column; the glyph is the 14 px box centred on `cy`. Callers pass geometry only.
 */
export function taskLeadSvg(state: TaskState, g: { x: number; y: number; h: number; cy: number; lead: number; hitCy?: number }): string {
  const aria = state === 'done' ? 'true' : state === 'pending' ? 'mixed' : 'false';
  return `<rect class="map-task-hit" x="${g.x + 2}" y="${Math.min(g.y, (g.hitCy ?? g.cy) - 22)}" width="${Math.max(g.lead - 2, TASK_BOX)}" height="${Math.max(g.h, 44)}" fill="transparent" cursor="pointer" role="checkbox" aria-checked="${aria}"/>` +
    taskGlyphSvg(state, g.x + TASK_INSET + TASK_BOX / 2, g.cy);
}

/** The width grip and its hit area (bottom-right corner). Time leaves have none (TL1). */
function widthGripSvg(boxRight: number, y: number, h: number, textW: number, shown: boolean): string {
  return `<g class="map-width-grip" stroke="#8ec8ff" stroke-width="1.75" stroke-linecap="round" fill="none" pointer-events="none" opacity="${shown ? '1' : '0'}">
        <path d="M ${boxRight - 10} ${y + h + 5} H ${boxRight + 5} V ${y + h - 10}"/>
      </g>
      <rect class="map-width-hit" data-text-w="${textW}" x="${boxRight - 6}" y="${y + h - 6}" width="18" height="18" fill="transparent" cursor="ew-resize" pointer-events="${shown ? 'all' : 'none'}"/>`;
}

/**
 * 0.5.21 (T13 merged with the selection frame): a dashed frame round a selected
 * thumbnail node and ONE square handle at its bottom-right. The handle is the width
 * grip: its hit rect is the same `.map-width-hit` the width drag uses.
 */
function thumbFrameSvg(x: number, y: number, boxW: number, h: number, textW: number): string {
  const r = x + boxW;
  const b = y + h;
  return `<rect class="map-thumb-frame" x="${x - 4}" y="${y - 4}" width="${boxW + 8}" height="${h + 8}" rx="6" ry="6" fill="none" stroke="#8ec8ff" stroke-width="1.4" stroke-dasharray="5 4" pointer-events="none"/>
      <rect class="map-thumb-handle" x="${r}" y="${b}" width="8" height="8" fill="#0f1720" stroke="#8ec8ff" stroke-width="1.5" pointer-events="none"/>
      <rect class="map-width-hit" data-text-w="${textW}" x="${r - 6}" y="${b - 6}" width="20" height="20" fill="transparent" cursor="nwse-resize" pointer-events="all"/>`;
}

/** TL3: a `●` in a time leaf caption (`● open`) paints in the kind letter's green. */
function timeLeafDots(textSvg: string): string {
  return textSvg.replace(/●/g, '<tspan class="map-time-dot">●</tspan>');
}

function globeGlyphSvg(x: number, y: number): string {
  return `<g class="map-link-hit" transform="translate(${x} ${y})" cursor="pointer">
    <rect x="-12" y="-12" width="24" height="24" rx="8" fill="transparent"/>
    <circle r="8" fill="none" stroke="#8ec8ff" stroke-width="1.4"/>
    <ellipse rx="3.2" ry="8" fill="none" stroke="#8ec8ff" stroke-width="1.2"/>
    <path d="M -8 0 H 8 M -6.5 -4 H 6.5 M -6.5 4 H 6.5" fill="none" stroke="#8ec8ff" stroke-width="1"/>
  </g>`;
}

/**
 * 0.5.23 code regions: a rounded rect (`.map-code-bg`, token fill) behind each inline code run;
 * neighbouring lines that are all code (a fenced block) share one rect across the text width.
 * Painted before the text, beside the pill, so the branch wash never tints it.
 */
function codeRegionRects(
  textX: number,
  blockTop: number,
  box: number,
  textW: number,
  richLines: CaptionStyleRun[][] | undefined,
  fontPx: number,
): string {
  if (!richLines || !richLines.some((l) => l.some((r) => r.code && r.text))) return '';
  const PAD = 4;
  const rect = (x: number, y: number, w: number, h: number) =>
    `<rect class="map-code-bg" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="var(--map-code-bg)"/>`;
  const allCode = richLines.map((l) => l.some((r) => r.text) && l.every((r) => r.code || !r.text.trim()));
  let out = '';
  for (let i = 0; i < richLines.length; i++) {
    const runs = richLines[i]!;
    const block = allCode[i] && (allCode[i - 1] || allCode[i + 1]);
    if (block) {
      if (allCode[i - 1]) continue;
      let j = i;
      while (allCode[j + 1]) j++;
      const w = Math.min(Math.max(textW, 0) || Infinity, Math.max(...richLines.slice(i, j + 1).map((l) => lineWidth(l, fontPx))));
      out += rect(textX - PAD, blockTop + i * box + 1, w + PAD * 2, (j - i + 1) * box - 2);
      continue;
    }
    let x = textX;
    for (const r of runs) {
      const w = lineWidth([r], fontPx);
      if (r.code && r.text) out += rect(x - PAD, blockTop + i * box + 1, w + PAD * 2, box - 2);
      x += w;
    }
  }
  return out;
}

function multiLineText(
  lines: string[],
  textX: number,
  centreY: number,
  _textW: number,
  richLines?: CaptionStyleRun[][],
  fontPx = DEFAULT_FONT_PX,
  fontWeight = 400,
): string {
  const n = Math.max(1, lines.length);
  const box = lineBox(fontPx);
  const blockH = n * box;
  const top = centreY - blockH / 2 + box * 0.75;
  const codeBg = codeRegionRects(textX, centreY - blockH / 2, box, _textW, richLines, fontPx);
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
  return `${codeBg}<text class="map-label" x="${textX}" y="${top}" text-anchor="start" font-size="${fontPx}" font-weight="${fontWeight}" font-family="${LABEL_FONT_FAMILY}">${tspans}</text>`;
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

  const keyOf = opts.keyOf ?? publicPackKeys(doc.nodes || []);
  const codes = markCode(doc.nodes || []);
  const visible: { n: OutlineNode; depth: number }[] = [];
  function walkVis(n: OutlineNode, depth: number): void {
    if (!n || isBlankNode(n)) return;
    visible.push({ n, depth });
    if (hasKids(n) && !(n.id && isNodeCollapsed(n.id))) {
      for (const c of n.children!) walkVis(c, depth + 1);
    }
  }
  for (const root of doc.nodes || []) walkVis(root, 0);

  const positions: Record<string, MapPoint> = {};
  const paintedSize = new Map<string, { w: number; h: number }>();

  // How far a visible cloud outline sticks out past this subtree's pills.
  function cloudOutset(n: OutlineNode, depth: number): number {
    let p = n.cloud ? cloudPad(depth) : 0;
    if (hasKids(n) && !(n.id && isNodeCollapsed(n.id))) {
      const childDepth = n.cloud ? depth + 1 : depth;
      for (const c of n.children || []) {
        if (isBlankNode(c)) continue;
        p = Math.max(p, cloudOutset(c, childDepth));
      }
    }
    return p;
  }
  // Sibling gap that leaves CLOUD_OUTER outside each cloud outline.
  function stackGap(a: OutlineNode, b: OutlineNode, depth: number, base: number): number {
    const protrude = cloudOutset(a, depth) + cloudOutset(b, depth);
    if (protrude <= 0) return base;
    return Math.max(base, protrude + CLOUD_OUTER);
  }

  function layoutSubtree(n: OutlineNode, groupLeft: number, top: number, depth: number): number {
    const key = keyOf(n);
    const code = codes.get(n) === true;
    const shown = displayCaption(n.title);
    const label = nodeIconLabel(n, code ? shown : captionWithoutLinks(shown));
    const painted = pillSize(label, nodePillOpts(n, nodeLayout, defaults, key, doc, code));
    paintedSize.set(key, { w: painted.w, h: painted.h });
    const x = groupLeft + painted.w / 2;
    // A blank `- ` line is not drawn on the Map until it has content (0.6.6).
    const kids =
      hasKids(n) && !(n.id && isNodeCollapsed(n.id))
        ? (n.children || []).filter((c) => !isBlankNode(c))
        : [];

    if (kids.length === 0) {
      positions[key] = { x, y: top + painted.h / 2, w: n.layout?.w };
      return painted.h;
    }

    const childGroupLeft = groupLeft + painted.w + gapX;
    const childDepth = n.cloud ? depth + 1 : depth;
    let y = top;
    const seen = new Set(Object.keys(positions));
    for (let i = 0; i < kids.length; i++) {
      const ch = layoutSubtree(kids[i]!, childGroupLeft, y, childDepth);
      y += ch;
      // TL5: two consecutive time leaves under one parent stack 6 px apart.
      // A cloud outline needs room beyond that, or it lands on the next pill.
      if (i < kids.length - 1) {
        const base = timeLeafKind(kids[i]) && timeLeafKind(kids[i + 1]) ? Math.min(gapY, TIME_LEAF_GAP_Y) : gapY;
        y += stackGap(kids[i]!, kids[i + 1]!, childDepth, base);
      }
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
  const drawn = roots.filter((r) => !isBlankNode(r));
  const edge = drawn.reduce((m, r) => Math.max(m, cloudOutset(r, 0)), 0);
  const origin = Math.max(margin, edge > 0 ? edge + CLOUD_OUTER : margin);
  top = origin;
  for (let i = 0; i < drawn.length; i++) {
    const h = layoutSubtree(drawn[i]!, origin, top, 0);
    top += h;
    if (i < drawn.length - 1) top += stackGap(drawn[i]!, drawn[i + 1]!, 0, gapY * 2);
  }

  let maxX = margin;
  let maxY = margin;
  for (const { n } of visible) {
    const pos = positions[keyOf(n)];
    if (!pos) continue;
    const size = paintedSize.get(keyOf(n));
    if (!size) continue;
    maxX = Math.max(maxX, pos.x + size.w / 2);
    maxY = Math.max(maxY, pos.y + size.h / 2);
  }

  const hullAir = edge > 0 ? Math.max(0, edge + CLOUD_OUTER - margin) : 0;
  return {
    nodes: positions,
    viewBox: {
      w: Math.max(400, Math.ceil(maxX + margin + hullAir)),
      h: Math.max(300, Math.ceil(maxY + margin + hullAir)),
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
  /**
   * Node key (0.6.6). The Map passes its view key (`__sid-N`), so every node can
   * take focus. Default: `node.id` (nodes without an id are skipped, as before).
   * `focusId`, `positions` and the result use this key; `isNodeCollapsed` gets `node.id`.
   */
  keyOf?: (n: OutlineNode) => string | undefined;
}

/**
 * Map L→R orientation focus resolver (v1). Fold is never implied by a direction.
 * Returns the next focus key, or `null` for a soft no-op. Blank `- ` lines are
 * not on the Map and are skipped.
 */
export function resolveMapFocus(
  doc: OutlineFoldDoc,
  focusId: string,
  direction: MapFocusDirection,
  opts: ResolveMapFocusOptions = {},
): string | null {
  const isNodeCollapsed = opts.isNodeCollapsed || (() => false);
  const positions = opts.positions;
  const keyOf = opts.keyOf ?? ((n: OutlineNode) => n.id);
  const usable = (n: OutlineNode | undefined): n is OutlineNode => !!n && !!keyOf(n) && !isBlankNode(n);
  let focused: OutlineNode | null = null;
  let parent: OutlineNode | null = null;
  let siblings: OutlineNode[] = [];
  const find = (list: OutlineNode[], p: OutlineNode | null): boolean => {
    for (const n of list) {
      if (!n) continue;
      if (keyOf(n) === focusId) { focused = n; parent = p; siblings = list; return true; }
      if (n.children?.length && find(n.children, n)) return true;
    }
    return false;
  };
  find(doc.nodes || [], null);
  const f = focused as OutlineNode | null;
  if (!f || !keyOf(f)) return null;
  const k = (n: OutlineNode | null | undefined) => (n ? keyOf(n) ?? null : null);

  function sortSiblings(sibs: OutlineNode[]): OutlineNode[] {
    const indexed = sibs.map((n, i) => ({ n, i }));
    indexed.sort((a, b) => {
      if (positions) {
        const ay = positions[keyOf(a.n)!]?.y;
        const by = positions[keyOf(b.n)!]?.y;
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
    const sibs = sortSiblings(siblings.filter(usable));
    if (!sibs.length) return null;
    const i = sibs.indexOf(f);
    if (direction === 'home') return k(sibs[0]);
    if (direction === 'end') return k(sibs[sibs.length - 1]);
    if (i < 0) return k(sibs[0]);
    if (direction === 'down') {
      if (i >= sibs.length - 1) return null;
      return k(sibs[i + 1]);
    }
    if (i <= 0) return null;
    return k(sibs[i - 1]);
  }

  if (direction === 'right') {
    if (!hasKids(f) || (f.id && isNodeCollapsed(f.id))) return null;
    const first = (f.children || []).find(usable);
    return k(first);
  }

  if (direction === 'left') {
    const p = parent as OutlineNode | null;
    return p && keyOf(p) ? k(p) : null;
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

// 0.6.6: id-keyed helpers, wrapped inside createMapView so a view key resolves first.
const findNodeById = findNode;
const parentOfId = parentOf;
const patchNodeTitleById = patchNodeTitle;
const isCollapsedById = isCollapsed;
const toggleFoldById = toggleFold;
const toggleTaskById = toggleTask;
const setExpandLevelById = setExpandLevel;

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
  optsIn: MapViewOptions,
): MapViewHandle {
  const opts: MapViewOptions = optsIn.outlineDoc
    ? { ...optsIn.outlineDoc.mapOptions(optsIn.onRegionUnlock), ...Object.fromEntries(Object.entries(optsIn).filter(([, v]) => v !== undefined)) } as MapViewOptions
    : optsIn;
  host.classList.toggle('of-details', !!opts.details);
  const paletteName = applyNodePalette(host, opts.colourPalette);
  let lastFocusEmit: string | null = null;
  let regionFocusRef: () => string | null = () => null;
  // emitFocus / sessionFocus are declared after toKey (they close over it).
  let emitFocus: () => void = () => {};
  // 0.6.6: one session index per view. Every node is keyed by a view key
  // (`__sid-N`). Authored ids (`<id:N>`) resolve once through the fixed-ref
  // index and are never themselves a focus / follow / Map↔text sync key;
  // hops, copy-link and `data-id` still publish the fixed reference (`toRef`).
  const viewIndex: SessionIndex = opts.sessionIndex ?? createSessionIndex();
  /**
   * Every tree the host hands over is synced as it is read, in order, so a host that
   * re-parses on each getDoc() still gets the same view keys (carried by id, line, caption).
   */
  const getDoc = (): OutlineFoldDoc => {
    const d = getDocRaw();
    viewIndex.sync(d);
    return d;
  };
  const syncIndex = () => { getDoc(); };
  /** The node's view key: the only Map identity (paint, hit-test, layout, focus). */
  const vkey = (n: OutlineNode): string => viewIndex.keyOf(n);
  /** Host id (fixed reference, or a scoped id) → view key; unknown ids pass through. */
  const toKey = (id: string): string => {
    if (!id) return id;
    syncIndex();
    return viewIndex.resolve(id) ?? id;
  };
  /** View key → the id the host sees: the node's fixed reference when it has one. */
  const toRef = (id: string): string => {
    if (!id) return id;
    syncIndex();
    return viewIndex.resolve(id) ? viewIndex.publicId(id) : id;
  };
  const sessionFocus = (raw: string | null | undefined): string => {
    if (!raw) return '';
    return toKey(raw);
  };
  emitFocus = () => {
    const id = sessionFocus(regionFocusRef() ?? opts.getFocusId());
    if (!id || id === lastFocusEmit) return;
    lastFocusEmit = id;
    opts.onFocusChange?.(id);
  };
  /**
   * Host + FocusLink key is the session id. An authored `<id:>` is resolved once
   * via the fixed-ref index and never stored or emitted as the key.
   */
  const setFocusId = (id: string) => {
    setFocusIdRaw(sessionFocus(id) || id);
    rememberTaskCycleOrigin(id);
    emitFocus();
  };
  const getFocusId = (): string => toKey(getFocusIdRaw());
  const getLayout = (): MapLayout => {
    syncIndex();
    return viewLayout(getLayoutRaw(), viewIndex);
  };
  /** The node a view key (or fixed ref) names in `nodes`; the live tree resolves through the index. */
  const findNode = (nodes: OutlineNode[], id: string): OutlineNode | null => {
    if (!id) return null;
    const live = getDoc().nodes;
    const key = viewIndex.resolve(id);
    if (key) {
      if (nodes === live) return viewIndex.nodeOf(key);
      // An earlier read of a host that re-parses: same view key on that tree's node.
      let hit: OutlineNode | null = null;
      const walk = (list: OutlineNode[]) => {
        for (const n of list) {
          if (hit) return;
          if (viewIndex.peek(n) === key) { hit = n; return; }
          if (n.children?.length) walk(n.children);
        }
      };
      walk(nodes || []);
      if (hit) return hit;
    }
    // A zone tree is not in the main session index. A row id `__sid-N` can resolve
    // to a main-doc public id; that rewrite painted another zone row's caption here.
    if (nodes !== live) {
      const direct = findNodeById(nodes, id);
      if (direct) return direct;
    }
    return findNodeById(nodes, toRef(id));
  };
  const parentOf = (nodes: OutlineNode[], id: string, parent: OutlineNode | null = null) =>
    parentOfId(nodes, toRef(id), parent);
  const patchNodeTitle = (nodes: OutlineNode[], id: string, title: string) => patchNodeTitleById(nodes, toRef(id), title);
  const isCollapsed = (doc: OutlineFoldDoc, id: string) => isCollapsedById(doc, toRef(id));
  /**
   * Fold by one session id. An authored id is used as written. A line with no
   * authored id uses the view key Follow in text holds (`__sid-N`). A session id
   * already on the node that is not that key is renamed to it, including its
   * `doc.fold` entry. Serialize keeps the fold as the line's `(+)` and does not
   * write the session id.
   */
  const foldRef = (doc: OutlineFoldDoc, id: string): string => {
    const n = findNode(nodes0(doc) || [], id);
    if (n?.id && !n.autoId) return n.id;
    if (!n) return toRef(id);
    const key = vkey(n);
    if (n.id && n.id !== key && doc.fold?.ids) {
      const at = doc.fold.ids.indexOf(n.id);
      if (at >= 0) {
        doc.fold.ids[at] = key;
        if (doc.frontmatter?.foldIds) doc.frontmatter.foldIds = [...doc.fold.ids];
      }
    }
    if (n.id !== key || !n.autoId) {
      n.id = key;
      n.autoId = true;
    }
    return key;
  };
  const nodes0 = (doc: OutlineFoldDoc) => doc.nodes;
  const toggleFold = (doc: OutlineFoldDoc, id: string) => toggleFoldById(doc, foldRef(doc, id));
  const toggleTask = (doc: OutlineFoldDoc, id: string) => toggleTaskById(doc, toRef(id));
  const setExpandLevel = (doc: OutlineFoldDoc, level: Parameters<typeof setExpandLevelById>[1], o?: Parameters<typeof setExpandLevelById>[2]) =>
    setExpandLevelById(doc, level, o?.under ? { ...o, under: foldRef(doc, o.under) } : o);
  const {
    getDoc: getDocRaw,
    setDoc,
    getLayout: getLayoutRaw,
    getFocusId: getFocusIdRaw,
    setFocusId: setFocusIdRaw,
    onChange,
    ariaLabel = 'Outline mind map, left to right. Pan and zoom enabled.',
    isActive = () => true,
    onTaskToggle,
    allowTaskToggle: allowTaskToggleOpt,
    onAction,
    onThread,
    onNoteLink,
    onHop,
    noteUri: noteUriFallback,
    noteMapUri,
    noteDetailsUri,
    cameraRecentre: cameraRecentreOpt = true,
    isEditing = () => false,
    getEditRegion,
    wheel: wheelMode = 'pan',
    gestures: gestureOpts = {},
    onCameraSettle,
    canPersistWidths: canPersistWidthsOpt,
    onWidthStep,
    nodeMenu: nodeMenuOn = false,
    nodeIcons: nodeIconsOpt,
    showNodeIcons: showNodeIconsOpt = true,
    nodeClouds: nodeCloudsOpt,
    nodeImages: nodeImagesOpt,
    onImageAdd,
    resolveImageSrc,
    nodeColours: nodeColoursOpt,
    colourPalette: colourPaletteOpt,
    followMenu = false,
    followResumeKey = null,
    onFollowInText,
    canMintIds: canMintIdsOpt,
    onCopy,
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
  let taskCycleOrigin: { id: string; includeNone: boolean } | null = null;

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
    const defaults = { wrapCh: autoCh(), maxLines: DEFAULT_MAX_LINES };
    function walk(n: OutlineNode): void {
      if (isBlankNode(n)) return;
      const key = vkey(n);
      if (!layout.nodes?.[key]) return;
      const pos = layout.nodes[key]!;
      const code = codeFor(n);
      const shown = displayCaption(n.title);
      const label = withNodeIcon(n, code ? shown : captionWithoutLinks(shown));
      const foldable = hasKids(n);
      const size = pillSize(label, timeLeafPaintOpts(n, pos, layout.fontSize, doc.frontmatter?.fontSize, doc, code) ?? {
        reserveFold: foldable,
        reserveTask: !!resolveTask(n),
        semibold: false,
        wrapCh: pos.wrapCh ?? defaults.wrapCh,
        widthPx: pos.w,
        maxLines: pos.maxLines,
        bodyExpanded: !!pos.bodyExpanded,
        fontSize: resolveFontPx(pos.fontSize, layout.fontSize, doc.frontmatter?.fontSize),
        ...nodeChips(n, doc, code),
        code,
      });
      const r = pillWorldRect(pos.x, pos.y, size.w, size.h);
      rects.push(r);
      byId.set(key, r);
      if (foldable && !(n.id && isCollapsed(doc, n.id))) {
        for (const c of n.children || []) walk(c);
      }
    }
    for (const root of doc.nodes || []) walk(root);
    // Cloud regions (unlocked / record) live outside the root doc: their hulls count
    // toward Fit and the pan clamp, or the camera cannot reach an opened region.
    for (const r of placed) rects.push({ x: r.hull.x, y: r.hull.y, w: r.hull.w, h: r.hull.h });
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
        const ck = vkey(c);
        if (byId.has(ck)) {
          const r = byId.get(ck)!;
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
      .querySelector(`.map-node[data-sid="${CSS.escape(toKey(id))}"], .map-region-node[data-scoped-id="${CSS.escape(id)}"]`)
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

  /**
   * Hop or `<r:x>` jump (0.2.34): select `target`, unfolding any folded
   * ancestor so it shows, and let the camera follow. False when it is not here.
   */
  /** A scoped id inside a drawn region (or the region itself): `<r:>` targets it via setFocus. */
  function isRegionTarget(t: string): boolean {
    return !!t && regionHosts().some((h) => t === h.id || t.startsWith(h.id + ':') || t.startsWith(h.id + '/'));
  }

  function jumpTo(target: string, from: string): boolean {
    let doc = getDoc();
    const node = target ? findNode(doc.nodes, target) : null;
    if (!node) return false;
    const path: OutlineNode[] = [];
    const walk = (list: OutlineNode[]): boolean => {
      for (const n of list) {
        if (n === node) return true;
        if (n.children?.length && walk(n.children)) {
          path.push(n);
          return true;
        }
      }
      return false;
    };
    walk(doc.nodes);
    let unfolded = false;
    for (const a of path) {
      if (a.id && isCollapsed(doc, a.id)) {
        doc = toggleFold(doc, a.id);
        unfolded = true;
      }
    }
    if (unfolded) setDoc(doc);
    setFocusId(target);
    focusMapForKeys();
    userCamGesture = false;
    pendingFollow = { kind: 'focus' };
    onHop?.({ id: toRef(target), from: toRef(from), node });
    onChange?.();
    return true;
  }

  /** Globe badge: one row per caption link. */
  function showLinkPop(id: string, title: string): void {
    const links = captionLinks(title).filter((l) => !l.pnid);
    if (!links.length) return;
    const doc = getDoc();
    openLinkPop({
      id,
      anchorSel: '.map-link-hit',
      rows: captionLinkRows(links, pageBase(), (hop) => !!findNode(doc.nodes, hop)),
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
        if (n) onNoteLink?.({ id: toRef(id), pnid, node: n, open });
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
        if (n && thread) onThread?.({ id: toRef(id), thread, node: n });
        onChange?.();
      },
    });
  }

  /** The one popover for the globe, `#N` and thread chips (0.2.34). */
  /** 0.6.5: swap the popover rows for the link preview (same surface, same close rules). */
  function showLinkPreview(row: LinkPopRow, spec: LinkPopSpec): void {
    const m = linkPop;
    if (!m || !row.href) return;
    const pv = renderLinkPreview({ label: row.label, href: row.href, base: pageBase() });
    pv.open.addEventListener(
      'click',
      (e) => {
        e.stopPropagation();
        // The browser opens it in a new tab (noopener); the popover closes.
        dismissLinkPop(false);
        spec.onOpen?.(row);
      },
      { signal: m.abort.signal },
    );
    m.el.replaceChildren(pv.el);
    m.el.dataset.kind = 'preview';
    m.items = [pv.open];
    positionLinkPop();
    pv.open.focus();
  }

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
            // A hop to a node not in this map stays open and does nothing.
            if (row.broken) return;
            dismissLinkPop(true);
            jumpTo(row.hopId, id);
            return;
          }
          if (row.href && row.newTab) {
            // 0.6.5: never navigate on the row; preview first, only Open navigates.
            ev.preventDefault();
            showLinkPreview(row, spec);
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
          const it = m.items[act.index];
          // 0.6.5: Enter on a row opens the preview (click); only the preview's Open follows natively.
          if (e.key === 'Enter' && it?.classList.contains('map-link-preview-open')) return;
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
    /** F9: `pill-left` keeps the pill's left edge, vertical centre (width picks). Default the handle. */
    at?: 'handle' | 'pill-left';
  } | null = null;
  const paintListeners = new Set<() => void>();
  /** bindGestures installs this so a menu tap's trailing click is swallowed. */
  let armClickSwallow: ((x: number, y: number) => void) | null = null;
  /** bindGestures installs this so closeMenus() can drop the width popover. */
  let dismissWidthPopHook: (() => void) | null = null;

  /** Any package menu open: level picker, link popover, width popover. */
  function packageMenuOpen(): boolean {
    return !!levelMenu || !!linkPop || !!nodeMenu || !!host.querySelector('.map-width-pop');
  }

  /** One menu at a time (node menu M1): close every package menu. */
  function closeMenus(): void {
    closeNodeMenu(false);
    closeLevelMenu(false);
    dismissLinkPop(false);
    dismissWidthPopHook?.();
    closeColourPalette(false);
  }

  function nodeEl(id: string): Element | null {
    return (
      host.querySelector(`.map-node[data-sid="${CSS.escape(toKey(id))}"]`) ??
      host.querySelector(`.map-region-node[data-scoped-id="${CSS.escape(id)}"]`)
    );
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


  /**
   * 0.7.0: Map keys are view keys (`__sid-N`). `foldLevelPicker` looks up
   * `node.id` (authored or `__sid-`), so resolve before calling it. `mint`
   * adds a session id on an id-less line, the same way a fold does.
   */
  function foldLevelLocal(id: string, mint: boolean): { fc: NonNullable<ReturnType<typeof foldCtx>>; local: string } | null {
    const fc = foldCtx(id);
    if (!fc) return null;
    if (fc.region) return { fc, local: fc.local };
    const local = mint ? foldRef(fc.doc, fc.local) : toRef(fc.local);
    return { fc, local };
  }

  /** True when the node has children (Levels… / handle hold), without minting an id. */
  function nodeCanFoldLevel(id: string): boolean {
    const fc = foldCtx(id);
    if (!fc) return false;
    const n = fc.region ? findNode(fc.doc.nodes, fc.local) : nodeByKey(id);
    return !!n && hasKids(n);
  }

  function pickerForFoldLevel(id: string): { fc: NonNullable<ReturnType<typeof foldCtx>>; local: string; picker: NonNullable<ReturnType<typeof foldLevelPicker>> } | null {
    const hit = foldLevelLocal(id, true);
    if (!hit) return null;
    const picker = foldLevelPicker(hit.fc.doc, hit.local);
    return picker ? { ...hit, picker } : null;
  }

  /** Open the menu for `id` (L1, L9). Returns false when the node has no children. */
  function openLevelMenu(id: string, how: { fine?: boolean; dragPointer?: number | null } = {}): boolean {
    closeLevelMenu(false);
    const hit = pickerForFoldLevel(id);
    const fc = hit?.fc;
    const picker = hit?.picker ?? null;
    if (!fc || !picker || !nodeEl(id)) return false;
    // One menu at a time: the node menu, link and width popovers close first.
    closeNodeMenu(false);
    dismissLinkPop(false);
    dismissWidthPopHook?.();
    if (fc.region) {
      setRegionFocus(id);
    } else if (getFocusId() !== id) {
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
    const hit = pickerForFoldLevel(id);
    if (!hit) return;
    const { fc, local, picker } = hit;
    if (fc.region) {
      // Same picker and helper, region fold store instead of the root doc (§R1 a).
      const rit = picker.items.find((it) => it.key === level);
      if (!rit || rit.disabled) return;
      rfold.commitView(fc.region, setExpandLevel(fc.doc, level, { under: local }));
      announce(foldLevelAnnouncement(picker, level));
      return;
    }
    const doc = fc.doc;
    const item = picker.items.find((it) => it.key === level);
    if (!item || item.disabled) return;
    const next = setExpandLevel(doc, level, { under: local });
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


  // ── Node menu: Copy jump / Copy link (0.2.39, node menu M2–M4, M8, M9, M11) ──

  type NodeMenuState = {
    key: string;
    el: HTMLElement;
    items: HTMLElement[];
    entries: NodeMenuEntry[];
    abort: AbortController;
    backdrop: HTMLElement | null;
  };
  let nodeMenu: NodeMenuState | null = null;
  let copiedToast: { el: HTMLElement; timer: number } | null = null;

  function idsMintable(): boolean {
    if (canMintIdsOpt !== undefined) {
      return typeof canMintIdsOpt === 'function' ? !!canMintIdsOpt() : canMintIdsOpt !== false;
    }
    return widthsPersist();
  }

  function focusHref(id: string, node: OutlineNode | null): string | null {
    return nodeFocusHref(id, { nodeUri: opts.nodeUri, node, base: pageBase() ?? null });
  }

  function copyItemsFor(key: string): NodeCopyItem[] {
    const node = nodeByKey(key);
    if (!node) return [];
    const canMint = idsMintable();
    const id = writtenId(node);
    return nodeCopyItemsFor({
      id,
      canMint,
      previewId: id ? null : node.id || previewPersistentId(getDoc(), node),
      href: (x) => focusHref(x, node),
    });
  }

  /**
   * The line's written id, or a new one: `assignPersistentId` (a `__sid-` session
   * id is replaced by a normal id; otherwise the free position or the next number), then
   * one setDoc + onChange so the host marks the document dirty. Only `<id:…>`
   * is added; the caption, its tags and their spacing are untouched.
   */
  function ensureNodeId(key: string): { id: string | null; minted: boolean } {
    const node = nodeByKey(key);
    if (!node) return { id: null, minted: false };
    const doc = getDoc();
    const { id, minted } = mintNodeId(doc, node, { canMint: idsMintable() });
    if (!id || !minted) return { id, minted: false };
    // 0.6.6: the view key does not change when a line gains an id; the layout
    // view moves a session-only entry onto the host under the new id by itself.
    setDoc(doc);
    onChange?.();
    return { id, minted: true };
  }

  function dismissCopied(): void {
    if (!copiedToast) return;
    window.clearTimeout(copiedToast.timer);
    copiedToast.el.remove();
    copiedToast = null;
  }

  /** The brief visible confirmation; `role=status` so it is read once (polite). */
  function showCopied(text: string, ok: boolean): void {
    if (typeof document === 'undefined') return;
    dismissCopied();
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const el = document.createElement('div');
    el.className = 'map-copied';
    el.dataset.ok = ok ? 'true' : 'false';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    host.appendChild(el);
    // Filled a frame later so the new live region announces it.
    requestAnimationFrame(() => {
      el.textContent = text;
    });
    const timer = window.setTimeout(() => {
      if (copiedToast?.el === el) copiedToast = null;
      el.remove();
    }, COPIED_TOAST_MS);
    copiedToast = { el, timer };
  }

  /**
   * One copy. The id is minted (when needed and allowed) and the clipboard
   * write starts in the same task as the pick, so it keeps the user activation.
   */
  function copyNode(key: string, kind: NodeCopyKind): Promise<NodeCopyResult> {
    const done = (r: NodeCopyResult): NodeCopyResult => {
      onCopy?.(r);
      return r;
    };
    const node = nodeByKey(key);
    if (!node) return Promise.resolve(done({ kind, key, id: null, text: null, minted: false, ok: false, reason: 'missing' }));
    const item = copyItemsFor(key).find((it) => it.kind === kind);
    if (!item || item.hidden) {
      const reason = writtenId(node) || idsMintable() ? 'no-link' : 'read-only';
      return Promise.resolve(done({ kind, key, id: writtenId(node), text: null, minted: false, ok: false, reason }));
    }
    const { id, minted } = ensureNodeId(key);
    const text = id ? (kind === 'jump' ? jumpTagFor(id) : focusHref(id, node)) : null;
    if (!id || !text) {
      return Promise.resolve(
        done({ kind, key, id, text: null, minted, ok: false, reason: id ? 'no-link' : 'read-only' }),
      );
    }
    return copyText(text).then((ok) => {
      showCopied(copiedText(kind, ok), ok);
      return done({ kind, key, id, text, minted, ok, ...(ok ? {} : { reason: 'clipboard' as const }) });
    });
  }

  function followInText(): boolean {
    return resolveFollowInText(getDoc().frontmatter, followResumeKey ? loadMapResume(followResumeKey) : null);
  }
  function toggleFollowInText(on = !followInText()): void {
    const doc = getDoc();
    setDoc({ ...doc, frontmatter: setFollowInText(doc.frontmatter, on, followResumeKey) });
    onFollowInText?.(on);
    onChange?.();
  }

  const nodeIconsOn = nodeIconsOpt ?? false;
  // 0.6.2: icon visibility (view state). The painter reads it through the local withNodeIcon below.
  let iconsShown = showNodeIconsOpt !== false;
  const withNodeIcon = (n: { icon?: string }, label: string): string => (iconsShown ? nodeIconLabel(n, label) : label);
  const nodeCloudsOn = nodeCloudsOpt ?? false;
  const nodeColoursOn = nodeColoursOpt ?? false;
  function swatchEntries(prefix: string, row: string, current: string | undefined): NodeMenuEntry[] {
    // Two rows per target: `<row> · Forest` (with None first) and `<row> · Highlighter`.
    const cur = resolveColour(current) ?? 'none';
    const out: NodeMenuEntry[] = [];
    colourGroups(paletteName).forEach((g, gi) => {
      const r = `${row} · ${g.name}`;
      if (gi === 0) out.push({ key: `${prefix}:none`, label: 'None', group: 'Edit', swatch: 'none', row: r, checked: cur === 'none' });
      for (const c of g.colours) out.push({ key: `${prefix}:${c}`, label: colourLabel(c, paletteName), group: 'Edit', swatch: c, row: r, checked: cur === c });
    });
    return out;
  }
  function nodeMenuEntries(key: string): NodeMenuEntry[] {
    const entries: NodeMenuEntry[] = [];
    if (imagesEditable() && nodeByKey(key)) entries.push({ key: 'image', label: 'Image…', group: 'Create', popup: true });
    if (nodeIconsOn) {
      entries.push({ key: 'icon', label: 'Icon…', group: 'Edit', popup: true });
      if (nodeByKey(key)?.icon) entries.push({ key: 'icon-remove', label: 'Remove icon', group: 'Edit' });
    }
    if (nodeCloudsOn && nodeByKey(key)) {
      entries.push({ key: 'cloud', label: 'Cloud', group: 'Edit', checked: !!nodeByKey(key)?.cloud });
    }
    if (nodeColoursOn && nodeByKey(key)) {
      entries.push(...swatchEntries('color', 'Colour', nodeByKey(key)?.color));
      // 0.6.1: Fill is always offered; turning it on without an own colour promotes the branch colour (or white).
      entries.push({ key: 'colour-fill', label: 'Fill', group: 'Edit', checked: fillShownOn(key) });
      if (nodeCloudsOn && nodeByKey(key)?.cloud) entries.push(...swatchEntries('cloud-color', 'Cloud colour', nodeByKey(key)?.cloud));
    }
    if (nodeByKey(key)) {
      entries.push({ key: 'font-code', label: 'Code', group: 'Edit', checked: nodeByKey(key)?.font === 'code' });
    }
    if (nodeCanFoldLevel(key)) entries.push({ key: 'levels', label: 'Levels…', group: 'View', popup: true });
    if (followMenu) entries.push({ key: 'follow', label: 'Follow in text', group: 'View', checked: followInText() });
    for (const it of copyItemsFor(key)) {
      if (it.hidden) continue;
      entries.push({ key: it.kind === 'jump' ? 'copy-jump' : 'copy-link', label: it.label, group: 'Open' });
    }
    return entries;
  }

  function closeNodeMenu(returnFocus = true): void {
    const m = nodeMenu;
    if (!m) return;
    nodeMenu = null;
    m.abort.abort();
    const hadFocus = m.el.contains(document.activeElement);
    m.backdrop?.remove();
    m.el.remove();
    nodeEl(m.key)?.removeAttribute('data-node-menu-open');
    if (returnFocus || hadFocus) focusMapForKeys();
  }

  function focusNodeMenuItem(index: number): void {
    const m = nodeMenu;
    const b = m?.items[index];
    if (!m || !b) return;
    for (const it of m.items) it.tabIndex = -1;
    b.tabIndex = 0;
    try {
      b.focus({ preventScroll: true });
    } catch {
      /* focus not available */
    }
  }

  /** Colour / fill / cloud / icon-remove stay open so the user can preview (t2498u). */
  function isStyleMenuPick(entry: NodeMenuEntry): boolean {
    return !!(
      entry.swatch ||
      entry.key === 'colour-fill' ||
      entry.key === 'cloud' ||
      entry.key === 'font-code' ||
      entry.key === 'icon-remove'
    );
  }

  /**
   * Rebuild the open node menu in place (same node, pointer size, roughly same
   * screen position) so checked swatches / toggles match the doc after a
   * stay-open style apply. Focus returns to the same entry key when possible.
   */
  function refreshOpenNodeMenu(focusEntryKey?: string): void {
    const m = nodeMenu;
    if (!m) return;
    const key = m.key;
    const fine = m.el.dataset.pointer !== 'coarse';
    const focusKey =
      focusEntryKey ??
      (() => {
        const i = m.items.indexOf(document.activeElement as HTMLElement);
        return i >= 0 ? m.entries[i]?.key : undefined;
      })();
    const r = m.el.getBoundingClientRect();
    m.abort.abort();
    m.backdrop?.remove();
    m.el.remove();
    nodeEl(m.key)?.removeAttribute('data-node-menu-open');
    nodeMenu = null;
    if (!openNodeMenu(key, { clientX: r.left, clientY: r.top }, { fine })) return;
    // CFA does not see openNodeMenu's write to nodeMenu after the nulling above.
    const opened = nodeMenu as NodeMenuState | null;
    if (!focusKey || !opened) return;
    const idx = opened.entries.findIndex((e: NodeMenuEntry) => e.key === focusKey);
    if (idx >= 0) focusNodeMenuItem(idx);
  }

  function pickNodeMenuItem(index: number): void {
    const m = nodeMenu;
    if (!m) return;
    const entry = m.entries[index];
    if (!entry) return;
    const key = m.key;
    const styleStayOpen = isStyleMenuPick(entry);
    if (entry.key === 'icon') {
      closeNodeMenu(false);
      openNodeIconPicker(key);
      return;
    }
    if (!styleStayOpen) closeNodeMenu(true);
    if (entry.key === 'image') {
      pickImageFile(key);
      return;
    }
    if (entry.swatch) {
      const c = entry.swatch === 'none' ? undefined : entry.swatch;
      if (entry.key.startsWith('cloud-color:')) setNodeCloud(key, c ?? 'default');
      else setNodeColour(key, c);
      if (styleStayOpen) refreshOpenNodeMenu(entry.key);
      return;
    }
    if (entry.key === 'colour-fill') {
      setNodeColourFill(key, !fillShownOn(key));
      if (styleStayOpen) refreshOpenNodeMenu(entry.key);
      return;
    }
    if (entry.key === 'cloud') {
      setNodeCloud(key, nodeByKey(key)?.cloud ? undefined : 'default');
      if (styleStayOpen) refreshOpenNodeMenu(entry.key);
      return;
    }
    if (entry.key === 'font-code') {
      setNodeFont(key, nodeByKey(key)?.font === 'code' ? 'auto' : 'code');
      if (styleStayOpen) refreshOpenNodeMenu(entry.key);
      return;
    }
    if (entry.key === 'icon-remove') {
      setNodeIcon(key, undefined);
      if (styleStayOpen) refreshOpenNodeMenu(entry.key);
      return;
    }
    if (entry.key === 'levels') {
      openLevelMenu(key);
      return;
    }
    if (entry.key === 'follow') {
      toggleFollowInText();
      return;
    }
    void copyNode(key, entry.key === 'copy-jump' ? 'jump' : 'link');
  }

  /**
   * 0.5.28: a node inside an unlocked region (scoped id `region:node`), from the region host's
   * child doc. Null for a main-doc key, a region root, or a locked region.
   */
  function zoneNode(key: string): OutlineNode | null {
    const { region, id } = parseScopedId(key);
    if (!region || !id) return null;
    const h = regionHosts().find((x) => x.id === region);
    if (!h || !h.doc) return null;
    return findNode(h.doc.nodes, id);
  }
  /**
   * 0.5.28: style write on a zone node. Inline only: drop any layout copy so the node
   * serialises `<color:…>`, `<cloud>` and its leading icon in the sealed body, never by id in
   * the plaintext layout block. Returns false when nothing changed (or the zone is locked).
   */
  function zoneStyle(key: string, apply: (n: OutlineNode) => boolean, msg: string): boolean {
    const n = zoneNode(key);
    if (!n || !apply(n)) return false;
    if (n.layout) {
      delete n.layout.color; delete n.layout.colorFill; delete n.layout.colorKey; delete n.layout.icon;
      if (!Object.keys(n.layout).length) delete n.layout;
    }
    delete n.inlineColor;
    delete n.inlineIcon;
    if (n.tagSpellings?.color) delete n.tagSpellings.color;
    opts.onRegionStyle?.(key);
    paint();
    announce(msg);
    return true;
  }

  function setNodeIcon(key: string, token: string | undefined): void {
    if (zoneNode(key)) {
      const z0 = zoneNode(key);
      const before = readStyleSnap(z0);
      const ok = zoneStyle(key, (z) => {
        if ((z.icon ?? undefined) === token) return false;
        if (token) z.icon = token; else delete z.icon;
        return true;
      }, token ? `Icon set: ${iconLabel(token)}` : 'Icon removed');
      if (ok) commitStyleStep(key, before, readStyleSnap(zoneNode(key)));
      return;
    }
    const n = nodeByKey(key);
    if (!n || (n.icon ?? undefined) === token) return;
    const before = readStyleSnap(n);
    if (token) n.icon = token;
    else delete n.icon;
    const id = persistStyle(key, n);
    setDoc(getDoc());
    onChange?.();
    commitStyleStep(id, before, readStyleSnap(nodeByKey(id) ?? n));
    announce(token ? `Icon set: ${iconLabel(token)}` : 'Icon removed');
  }

  /**
   * Code font on a node. Main outline: `layout.font`, which serialises as
   * `font: code` or `font: auto` under the node's id. Zone: the line tag only,
   * never the plaintext layout block. `auto` clears an own value so the node
   * follows its parent.
   */
  function applyNodeFont(n: OutlineNode, font: 'code' | 'text' | 'none' | 'auto' | undefined, zone: boolean): void {
    delete n.inlineFont;
    if (n.tagSpellings?.font) {
      delete n.tagSpellings.font;
      if (!Object.keys(n.tagSpellings).length) delete n.tagSpellings;
    }
    if (font) n.font = font;
    else delete n.font;
    if (zone) {
      if (n.layout) {
        delete n.layout.font;
        delete n.layout.fontKey;
        if (!Object.keys(n.layout).length) delete n.layout;
      }
      return;
    }
    const nl: NonNullable<OutlineNode['layout']> = { ...(n.layout || {}) };
    if (font) {
      nl.font = font;
      if (nl.fontKey !== 'style') nl.fontKey = 'font';
    } else {
      delete nl.font;
      delete nl.fontKey;
    }
    if (Object.keys(nl).length) n.layout = nl;
    else delete n.layout;
  }

  function setNodeFont(key: string, font: 'code' | 'auto' | undefined): void {
    const next = font === 'code' || font === 'auto' ? font : undefined;
    const zoneSettled = (z: OutlineNode) =>
      z.font === next && !z.inlineFont && !z.layout?.font;
    const mainSettled = (n: OutlineNode) =>
      n.font === next && n.layout?.font === next && !n.inlineFont;
    if (zoneNode(key)) {
      const z0 = zoneNode(key);
      const before = readStyleSnap(z0);
      const ok = zoneStyle(key, (z) => {
        if (next ? zoneSettled(z) : z.font == null && !z.layout?.font && !z.inlineFont) return false;
        applyNodeFont(z, next, true);
        return true;
      }, next === 'code' ? 'Code font' : 'Code font cleared');
      if (ok) commitStyleStep(key, before, readStyleSnap(zoneNode(key)));
      return;
    }
    const n = nodeByKey(key);
    if (!n) return;
    if (next ? mainSettled(n) : n.font == null && n.layout?.font == null && !n.inlineFont) return;
    const before = readStyleSnap(n);
    applyNodeFont(n, next, false);
    if (next) assignPersistentId(getDoc(), n);
    setDoc(getDoc());
    onChange?.();
    commitStyleStep(key, before, readStyleSnap(nodeByKey(key) ?? n));
    announce(next === 'code' ? 'Code font' : 'Code font cleared');
  }

  /**
   * 0.5.22: a UI colour / fill / icon write lands in the node's layout entry (by id,
   * minted like a width) and drops the inline tag it replaces. Returns the node's key.
   */
  function persistStyle(key: string, n: OutlineNode): string {
    const doc = getDoc();
    const wantColour = !!n.color;
    const wantIcon = !!n.icon;
    const wantNoFill = !wantColour && !!n.noFill;
    const nl: NonNullable<OutlineNode['layout']> = { ...(n.layout || {}) };
    if (wantColour) {
      nl.color = n.color!;
      if (n.colorFill) nl.colorFill = true;
      else delete nl.colorFill;
      nl.colorKey = nl.colorKey ?? colourKeyFor(doc, n);
    } else {
      delete nl.color; delete nl.colorFill; delete nl.colorKey;
    }
    if (wantIcon) nl.icon = n.icon!;
    else delete nl.icon;
    if (wantNoFill) nl.noFill = true;
    else { delete nl.noFill; delete n.noFill; }
    delete n.inlineColor;
    delete n.inlineIcon;
    if (n.tagSpellings?.color) delete n.tagSpellings.color;
    if (Object.keys(nl).length) n.layout = nl;
    else delete n.layout;
    if (!wantColour && !wantIcon && !wantNoFill) return key;
    // The view key stays; the layout view follows the new id (0.6.6).
    assignPersistentId(doc, n);
    return key;
  }

  /** 0.5.18 EP-39: add (neutral default) or remove the cloud owned by a node. */
  function setNodeCloud(key: string, color: string | undefined): void {
    if (zoneNode(key)) {
      const before = readStyleSnap(zoneNode(key));
      const ok = zoneStyle(key, (z) => {
        if ((z.cloud ?? undefined) === color) return false;
        if (color) z.cloud = color; else delete z.cloud;
        return true;
      }, color ? 'Cloud added' : 'Cloud removed');
      if (ok) commitStyleStep(key, before, readStyleSnap(zoneNode(key)));
      return;
    }
    const n = nodeByKey(key);
    if (!n || (n.cloud ?? undefined) === color) return;
    const before = readStyleSnap(n);
    if (color) n.cloud = color;
    else delete n.cloud;
    setDoc(getDoc());
    onChange?.();
    commitStyleStep(key, before, readStyleSnap(n));
    announce(color ? 'Cloud added' : 'Cloud removed');
  }

  /** 0.5.19 EP-31: set or clear one node's colour token (never hex). */
  function setNodeColour(key: string, color: string | undefined): void {
    if (zoneNode(key)) {
      const before = readStyleSnap(zoneNode(key));
      const ok = zoneStyle(key, (z) => {
        if ((z.color ?? undefined) === color) return false;
        if (color && resolveColour(color)) z.color = resolveColour(color)!;
        else { delete z.color; delete z.colorFill; }
        return true;
      }, color ? `Colour: ${colourLabel(color, paletteName)}` : 'Colour removed');
      if (ok) {
        commitStyleStep(key, before, readStyleSnap(zoneNode(key)));
        if (color) rememberColour(color);
      }
      return;
    }
    const n = nodeByKey(key);
    if (!n) return;
    // 0.6.2: None on a node that would still inherit a wash writes an explicit `fill: none`.
    const wantNoFill = !color && inheritedFillOf(key);
    if ((n.color ?? undefined) === color && !!n.noFill === wantNoFill) return;
    const before = readStyleSnap(n);
    if (color && resolveColour(color)) { n.color = resolveColour(color)!; delete n.noFill; }
    else { delete n.color; delete n.colorFill; if (wantNoFill) n.noFill = true; else delete n.noFill; }
    const id = persistStyle(key, n);
    setDoc(getDoc());
    onChange?.();
    commitStyleStep(id, before, readStyleSnap(nodeByKey(id) ?? n));
    announce(color ? `Colour: ${colourLabel(color, paletteName)}` : 'Colour removed');
    if (color) rememberColour(color);
  }

  /** 0.6.2: the wash this node actually paints (own :fill, or inherited and not `fill: none`). */
  function fillShownOn(key: string): boolean {
    const n = nodeByKey(key);
    if (!n) return false;
    if (resolveColour(n.color)) return !!n.colorFill;
    return !n.noFill && inheritedFillOf(key);
  }

  /** 0.6.2: does this node's parent branch paint a wash (nearest coloured ancestor has :fill, no `fill: none` between)? */
  function inheritedFillOf(key: string): boolean {
    const self = nodeByKey(key);
    if (!self) return false;
    // By identity, so a node without an id still finds its ancestors.
    const chain: OutlineNode[] = [];
    const find = (list: OutlineNode[]): boolean => {
      for (const n of list) {
        if (n === self) return true;
        chain.push(n);
        if (n.children?.length && find(n.children)) return true;
        chain.pop();
      }
      return false;
    };
    if (!find(getDoc().nodes)) return false;
    for (let i = chain.length - 1; i >= 0; i--) {
      const a = chain[i]!;
      if (resolveColour(a.color)) return !!a.colorFill;
      if (a.noFill) return false;
    }
    return false;
  }

  /** Nearest ancestor colour (own colour of this node or a parent), else undefined. */
  function branchColourOf(key: string): string | undefined {
    let cur: OutlineNode | null | undefined = nodeByKey(key);
    const roots = getDoc().nodes;
    while (cur) {
      const own = resolveColour(cur.color);
      if (own) return own;
      const p = parentOf(roots, cur.id || '');
      cur = p === undefined ? null : p;
    }
    return undefined;
  }

  /** 0.5.20 / 0.6.1: Fill toggle. With no own colour, promote the branch colour (else white) then fill. */
  function setNodeColourFill(key: string, on: boolean): boolean {
    if (zoneNode(key)) {
      const before = readStyleSnap(zoneNode(key));
      const ok = zoneStyle(key, (z) => {
        if (on && !z.color) z.color = resolveColour(branchColourOf(key)) || 'white';
        return setColourFill(z, on);
      }, on ? 'Fill on' : 'Fill off');
      if (ok) commitStyleStep(key, before, readStyleSnap(zoneNode(key)));
      return ok;
    }
    const n = nodeByKey(key);
    if (!n) return false;
    const before = readStyleSnap(n);
    if (!on && !n.color) {
      // 0.6.2: no own colour: Fill off on a node inside a washed branch writes `fill: none`.
      if (!inheritedFillOf(key) || n.noFill) return false;
      n.noFill = true;
      const id = persistStyle(key, n);
      setDoc(getDoc());
      onChange?.();
      commitStyleStep(id, before, readStyleSnap(nodeByKey(id) ?? n));
      announce('Fill off');
      return true;
    }
    if (on && !n.color) {
      const promoted = resolveColour(branchColourOf(key)) || 'white';
      n.color = promoted;
    }
    if (on) delete n.noFill;
    if (!setColourFill(n, on)) return false;
    const id = persistStyle(key, n);
    setDoc(getDoc());
    onChange?.();
    commitStyleStep(id, before, readStyleSnap(nodeByKey(id) ?? n));
    announce(on ? 'Fill on' : 'Fill off');
    return true;
  }

  
  // ── 0.5.21 thumbnails ────────────────────────────────────────────────
  /** Editors only: `nodeImages` on and widths may be written (not read-only). */
  function imagesEditable(): boolean {
    return !!nodeImagesOpt && widthsPersist();
  }

  /** T4/T16: the URL to draw. `att:` goes through the host; https and checked data as stored. */
  function thumbHref(src: string | null): string | null {
    if (!src) return null;
    if (src.startsWith('att:')) {
      const r = resolveImageSrc?.(src);
      // The resolved URL must itself be same-origin relative or https.
      return typeof r === 'string' && (/^\/(?!\/)[^\s]*$/.test(r) || /^https:\/\//i.test(r) || /^blob:/i.test(r)) ? r : null;
    }
    return src;
  }

  /** T5/T6: the image, inset 8px, 11px radius, centre-cropped past 1.25×; or a placeholder. */
  function thumbSvg(key: string, t: NonNullable<PillSize['thumb']>, x: number, y: number, _boxW: number): string {
    const ix = x + THUMB_INSET;
    const iy = y + THUMB_INSET;
    const href = thumbHref(t.src);
    if (!href) {
      return `<rect class="map-thumb-ph" x="${ix}" y="${iy}" width="${t.w}" height="${t.h}" rx="${THUMB_RADIUS}" ry="${THUMB_RADIUS}" pointer-events="none"/>`;
    }
    const clipId = `${domPrefix}-thumb-${String(key).replace(/[^A-Za-z0-9_-]/g, '_')}`;
    return `<clipPath id="${esc(clipId)}" class="map-thumb-clip"><rect x="${ix}" y="${iy}" width="${t.w}" height="${t.h}" rx="${THUMB_RADIUS}" ry="${THUMB_RADIUS}"/></clipPath><image class="map-thumb" href="${esc(href)}" x="${ix}" y="${iy}" width="${t.w}" height="${t.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${esc(clipId)})" pointer-events="none"${t.alt ? ` aria-label="${esc(t.alt)}"` : ''}/>`;
  }

  /** Create › Image…, paste and drop all land here: one thumbnail CHILD per file. */
  async function addImage(key: string, file: File): Promise<string | null> {
    if (!imagesEditable() || !file || !imageFilesOf([file]).length) return null;
    const parent = nodeByKey(key);
    if (!parent) return null;
    let res;
    try {
      res = await (onImageAdd ?? defaultImageAdd)(file, { key });
    } catch {
      announce('Image could not be added');
      return null;
    }
    const src = safeAssetSrc(res?.src);
    if (!src) {
      announce('Image source refused');
      return null;
    }
    const doc = getDoc();
    const assets = (doc.assets ??= []);
    const assetKey = assetKeyFor(file.name || 'image', assets.map((a) => a.key));
    const w = Math.max(0, Math.round(Number(res.w) || 0));
    const h = Math.max(0, Math.round(Number(res.h) || 0));
    assets.push({ key: assetKey, src, ...(w ? { w } : {}), ...(h ? { h } : {}), ...(res.alt ? { alt: res.alt } : {}) });
    const title = (file.name || 'Image').replace(/\.[A-Za-z0-9]+$/, '').trim() || 'Image';
    const child: OutlineNode = { title, depth: parent.depth + 1, img: assetKey };
    (parent.children ??= []).push(child);
    setDoc(doc);
    const childKey = keyOfNode(child);
    setFocusId(childKey);
    onChange?.();
    announce(`Image added: ${title}`);
    return childKey;
  }

  /** The frame handle's width (T13): clamped 120–480, height follows (T6). One undo step. */
  function setThumbWidth(key: string, w: number): boolean {
    const n = nodeByKey(key);
    if (!n?.img || !imagesEditable()) return false;
    const next = clampThumbWidth(w);
    return !!commitWidthStep('drag', key, [{ key, before: readWidth(key, n), after: { w: next, wAuto: null }, idState: idStateOf(n) }], { toast: false });
  }

  function pickImageFile(key: string): void {
    if (typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml';
    input.className = 'map-image-input';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const f = imageFilesOf(input.files)[0];
      input.remove();
      if (f) void addImage(key, f);
    });
    host.appendChild(input);
    input.click();
  }

  host.addEventListener('paste', (e: ClipboardEvent) => {
    if (!imagesEditable()) return;
    const key = getFocusId();
    if (!key || !nodeByKey(key)) return;
    const files = imageFilesOf(e.clipboardData?.files);
    if (!files.length) return;
    e.preventDefault();
    for (const f of files) void addImage(key, f);
  });
  host.addEventListener('dragover', (e: DragEvent) => {
    if (!imagesEditable() || !Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  host.addEventListener('drop', (e: DragEvent) => {
    if (!imagesEditable()) return;
    const files = imageFilesOf(e.dataTransfer?.files);
    if (!files.length) return;
    const t = (e.target as Element | null)?.closest?.('.map-node[data-sid]');
    const key = t?.getAttribute('data-sid') ?? getFocusId();
    if (!key || !nodeByKey(key)) return;
    e.preventDefault();
    for (const f of files) void addImage(key, f);
  });

  /** 0.5.18 EP-1 / EP-12: the picker for one node, opened on the panel (Map tab first). */
  let nodePicker: IconPickerHandle | null = null;
  const pickerListeners = new Set<(open: boolean) => void>();
  const emitPicker = (open: boolean) => { for (const f of pickerListeners) f(open); };
  function openNodeIconPicker(key: string, how: { stayOpen?: boolean; toggle?: Element | null } = {}): boolean {
    if (!nodeIconsOn || typeof document === 'undefined') return false;
    const zn = zoneNode(key);
    const zel = zn && typeof document !== 'undefined' ? document.getElementById(regionDomId(key)) : null;
    const pill = zn ? (zel?.querySelector('.map-region-body') ?? zel) : (nodeEl(key)?.querySelector('.map-pill') ?? nodeEl(key));
    const styleOf = () => zoneNode(key) ?? nodeByKey(key);
    if (!pill || !styleOf()) return false;
    closeMenus();
    void loadEmojiData();
    const handle: IconPickerHandle = openIconPicker({
      // 0.5.30: a toolbar toggle anchors the popover under itself.
      anchor: how.toggle ?? pill,
      mode: 'node',
      expanded: true,
      stayOpen: how.stayOpen,
      toggle: how.toggle ?? null,
      // 0.6.2: keep the popover inside the map host as well as the viewport.
      bounds: host,
      onPick: (token) => setNodeIcon(key, token),
      onRemove: styleOf()?.icon ? () => setNodeIcon(key, undefined) : undefined,
      colour: nodeColoursOn ? { value: styleOf()?.color, palette: paletteName, onColour: (c) => setNodeColour(key, c) } : undefined,
      onClose: () => { if (nodePicker === handle) { nodePicker = null; emitPicker(false); } focusMapForKeys(); },
    });
    nodePicker = handle;
    emitPicker(true);
    return true;
  }

  let colourPalette: ColourPaletteHandle | null = null;
  const colourPaletteListeners = new Set<(open: boolean) => void>();
  const emitColourPalette = (open: boolean) => { for (const f of colourPaletteListeners) f(open); };

  function closeColourPalette(_returnFocus = false): void {
    if (!colourPalette) return;
    const h = colourPalette;
    colourPalette = null;
    h.close(false);
    emitColourPalette(false);
  }

  function openNodeColourPalette(key: string, how: { toggle?: Element | null } = {}): boolean {
    if (!nodeColoursOn || typeof document === 'undefined') return false;
    const node = zoneNode(key) ?? nodeByKey(key);
    if (!node) return false;
    closeNodeMenu(false);
    closeLevelMenu(false);
    dismissLinkPop(false);
    dismissWidthPopHook?.();
    nodePicker?.close(true);
    closeColourPalette(false);
    const handle = openColourPalette({
      anchor: how.toggle ?? nodeEl(key)?.querySelector('.map-pill') ?? nodeEl(key),
      toggle: how.toggle ?? null,
      value: resolveColour(node.color) ?? undefined,
      palette: paletteName,
      onColour: (c) => setNodeColour(key, c),
      stayOpen: true,
      container: document.body,
      bounds: host,
      onClose: () => {
        if (colourPalette === handle) {
          colourPalette = null;
          emitColourPalette(false);
        }
      },
    });
    colourPalette = handle;
    emitColourPalette(true);
    return true;
  }

  function toggleColourPalette(key?: string, how: { toggle?: Element | null } = {}): boolean {
    if (colourPalette) { closeColourPalette(true); return false; }
    const k = key ?? getFocusId();
    return k ? openNodeColourPalette(k, how) : false;
  }

  /** Host-local point under the pill's left edge, for a keyboard open. */
  function pillAnchor(key: string): { x: number; y: number } | null {
    const pill = nodeEl(key)?.querySelector('.map-pill');
    if (!pill) return null;
    const r = pill.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    return { x: r.left - hr.left, y: r.bottom - hr.top + 4 };
  }

  function openNodeMenu(key: string, at?: { clientX: number; clientY: number } | null, how: { fine?: boolean; pointerType?: string } = {}): boolean {
    if (!nodeMenuOn || typeof document === 'undefined') return false;
    closeMenus();
    const node = nodeByKey(key);
    if (!node || !nodeEl(key)) return false;
    const entries = nodeMenuEntries(key);
    if (!entries.length) return false;
    if (getFocusId() !== key) {
      setFocusId(key);
      userCamGesture = true;
      pendingFollow = null;
      onChange?.();
    }
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    // Mouse → fine (22px) even on hybrid coarse matchMedia; touch/pen → coarse (36px).
    const pt = how.pointerType ?? '';
    const fine = how.fine ?? (pt === 'touch' || pt === 'pen' ? false : pt === 'mouse' ? true : !coarsePointer());
    const compact = isCompactSwatchMenu({ fine });
    const view = renderNodeMenu({
      title: widthTitle(node),
      entries,
      fine,
      nodeId: key,
      compact,
      recent: recentColours(),
      closable: compact,
      backdrop: compact,
      onItemsChange: (next) => {
        m.items = next;
        bindMenuItems();
      },
    });
    const abort = new AbortController();
    const m: NodeMenuState = { key, el: view.el, items: view.items, entries, abort, backdrop: view.backdrop };
    nodeMenu = m;
    const sig = abort.signal;
    const entryIndexFor = (el: Element | null): number => {
      const k = (el as HTMLElement | null)?.dataset?.item;
      if (!k) return -1;
      return m.entries.findIndex((e) => e.key === k);
    };
    const bindMenuItems = () => {
      for (const b of m.items) {
        bindTap(
          b,
          (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (ev.type === 'pointerup') {
              const pe = ev as PointerEvent;
              armClickSwallow?.(pe.clientX, pe.clientY);
            }
            const idx = entryIndexFor(b);
            if (idx >= 0) pickNodeMenuItem(idx);
          },
          { signal: sig },
        );
      }
    };
    bindMenuItems();
    if (view.closeBtn) {
      bindTap(
        view.closeBtn,
        (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          closeNodeMenu(true);
        },
        { signal: sig },
      );
    }
    view.el.addEventListener(
      'keydown',
      (e) => {
        const i = m.items.indexOf(document.activeElement as HTMLElement);
        // 0.5.19: ←/→ move along one target's swatches, across its Forest and Highlighter rows.
        // Look up by data-item so a compact (recent-first, subset) strip stays aligned.
        const swIdx = entryIndexFor(document.activeElement);
        const sw = swIdx >= 0 ? m.entries[swIdx] : undefined;
        if (sw?.swatch && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          e.stopPropagation();
          const j = i + (e.key === 'ArrowRight' ? 1 : -1);
          const pre = (k: string) => k.slice(0, k.indexOf(':'));
          const nextIdx = entryIndexFor(m.items[j] ?? null);
          const next = nextIdx >= 0 ? m.entries[nextIdx] : undefined;
          if (next?.swatch && pre(next.key) === pre(sw.key)) focusNodeMenuItem(j);
          return;
        }
        // t2499u: undo/redo while the stay-open style menu has focus.
        if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
          e.preventDefault();
          e.stopPropagation();
          if (!isEditing() && (e.shiftKey ? redoMapEdit() : undoMapEdit())) {
            /* refreshOpenNodeMenu already runs from style undo/redo when menu matches */
          }
          return;
        }
        const visEntries = m.items.map((el) => m.entries.find((en) => en.key === el.dataset.item)).filter((x): x is NodeMenuEntry => !!x);
        const visIndex = visEntries.findIndex((en) => en.key === (document.activeElement as HTMLElement | null)?.dataset?.item);
        const act = nodeMenuKeyAction(e.key, visIndex, visEntries);
        // Every key stays inside the menu: no fold, zoom or host shortcut.
        e.stopPropagation();
        if (!act) return;
        if (act.type === 'move') {
          e.preventDefault();
          focusNodeMenuItem(act.index);
        } else if (act.type === 'close') {
          if (e.key === 'Escape') e.preventDefault();
          closeNodeMenu(act.returnFocus);
        } else if (act.type === 'activate') {
          // Enter / Space reach the button's own click (bindTap).
          if (e.key === 'Enter' || e.key === ' ') return;
          e.preventDefault();
          const vis = visEntries[act.index];
          const idx = vis ? m.entries.findIndex((en) => en.key === vis.key) : -1;
          if (idx >= 0) pickNodeMenuItem(idx);
        }
      },
      { signal: sig },
    );
    view.el.addEventListener('contextmenu', (e) => e.preventDefault(), { signal: sig });
    if (view.backdrop) host.appendChild(view.backdrop);
    host.appendChild(view.el);
    const hr = host.getBoundingClientRect();
    const point = at ? { x: at.clientX - hr.left, y: at.clientY - hr.top } : pillAnchor(key) ?? { x: 8, y: 8 };
    const vp = hostViewport();
    const pos = placeNodeMenu({ at: point, panel: vp, menu: { w: view.el.offsetWidth, h: view.el.offsetHeight } });
    view.el.style.left = `${pos.left}px`;
    view.el.style.top = `${pos.top}px`;
    nodeEl(key)?.setAttribute('data-node-menu-open', 'true');
    document.addEventListener(
      'pointerdown',
      (e) => {
        const t = e.target as Node | null;
        if (t && m.el.contains(t)) return;
        closeNodeMenu(false);
      },
      { capture: true, signal: sig },
    );
    document.addEventListener(
      'keydown',
      (e) => {
        // Capture-phase Escape always dismisses, including when focus is inside
        // the menu (t2498u). Relying only on the menu bubble handler fails if an
        // older aborted-less listener stopPropagation'd first.
        if (e.key !== 'Escape' || nodeMenu !== m) return;
        e.preventDefault();
        e.stopPropagation();
        closeNodeMenu(true);
      },
      { capture: true, signal: sig },
    );
    focusNodeMenuItem(0);
    return true;
  }

  /** Select a node and unfold its ancestors (a jump without onHop). */
  function focusNode(id: string): boolean {
    let doc = getDoc();
    const node = id ? findNode(doc.nodes, id) : null;
    if (!node) return false;
    const path: OutlineNode[] = [];
    const walk = (list: OutlineNode[]): boolean => {
      for (const n of list) {
        if (n === node) return true;
        if (n.children?.length && walk(n.children)) {
          path.push(n);
          return true;
        }
      }
      return false;
    };
    walk(doc.nodes);
    let unfolded = false;
    for (const a of path) {
      if (a.id && isCollapsed(doc, a.id)) {
        doc = toggleFold(doc, a.id);
        unfolded = true;
      }
    }
    if (unfolded) setDoc(doc);
    setFocusId(id);
    userCamGesture = false;
    pendingFollow = { kind: 'focus' };
    onChange?.();
    return true;
  }


  // ── Pill widths for reading (hold-to-fit P1, Design UX 2026-10-08) ────────
  // F3 fit row on tap, F11 `w`, F8 batched persistence as ordinary `w`
  // entries (+ F5a `w-auto: single-line`), F7 undo steps with a toast, F9
  // camera, F12 announcements. The grip hold and the Child widths row are P2.

  function widthsPersist(): boolean {
    return typeof canPersistWidthsOpt === 'function' ? !!canPersistWidthsOpt() : canPersistWidthsOpt !== false;
  }

  type WidthIdState = 'none' | 'session' | 'kept';
  function idStateOf(n: OutlineNode | null | undefined): WidthIdState {
    return !n?.id ? 'none' : n.autoId ? 'session' : 'kept';
  }
  type WidthStepEntry = {
    key: string;
    before: WidthEntry;
    after: WidthEntry;
    /** The node's id before this step: none, session-only, or written (lazy ids, F8). */
    idState: WidthIdState;
    /** Pill inside an open region. Undo writes this node, not the host document. */
    node?: OutlineNode;
  };
  type WidthStepRec = {
    kind: WidthPickKind | 'drag';
    entries: WidthStepEntry[];
    anchorKey: string;
    persist: boolean;
    /** Open region whose children this step sizes. Absent for a host-doc step. */
    region?: string;
  };
  type StyleSnap = {
    color?: string;
    colorFill?: boolean;
    noFill?: boolean;
    cloud?: string;
    icon?: string;
    font?: 'code' | 'text' | 'none' | 'auto';
  };
  type StyleStepRec = { key: string; before: StyleSnap; after: StyleSnap };
  type MapEditRec = { type: 'width'; rec: WidthStepRec } | { type: 'style'; rec: StyleStepRec };
  const editUndoStack: MapEditRec[] = [];
  const editRedoStack: MapEditRec[] = [];
  /** While applying an undo/redo snap, setters must not push another step. */
  let suppressStyleStep = false;
  /** Pill being dragged: its live width wins over `w-auto` until the drag commits. */
  let resizingWidthKey: string | null = null;
  /** Last single-line width per key, kept while that caption is being edited (F5a). */
  const autoWidthCache = new Map<string, number>();
  /** bindGestures installs this: open the width popover (P1 tap popover). */
  let openWidthPopHook: ((key: string, how: { keyboard?: boolean }) => boolean) | null = null;
  let widthToast: { el: HTMLElement; timer: number; abort: AbortController } | null = null;

  /** Node for a session id, or for an authored `<id:>` from outside. */
  function nodeByKey(key: string): OutlineNode | null {
    viewIndex.sync(getDoc());
    return viewIndex.nodeOf(key);
  }

  function keyOfNode(n: OutlineNode): string {
    return vkey(n);
  }

  /** Stored width of a pill: the layout object first (as paint reads it), then the node. */
  function readWidth(key: string, n?: OutlineNode | null): WidthEntry {
    const node = n ?? nodeByKey(key);
    const lay = getLayout().nodes?.[key];
    const rawW = lay && lay.w !== undefined ? lay.w : node?.layout?.w;
    const rawMode = lay && lay.wAuto !== undefined ? lay.wAuto : node?.layout?.wAuto;
    return {
      w: typeof rawW === 'number' && rawW > 0 ? rawW : null,
      wAuto: rawW && rawMode ? rawMode : null,
    };
  }

  /**
   * Write one pill's width. Persisted: like a drag (lazy id via
   * assignPersistentId only when a `w` is written; Auto deletes both keys).
   * Session-only: the layout object only (`w: 0` / `wAuto: ''` override an
   * authored entry). Returns the pill's key afterwards (its id once written).
   */
  function writeWidth(key: string, next: WidthEntry, persist: boolean): string {
    const doc = getDoc();
    const node = nodeByKey(key);
    const layout = getLayout();
    if (!layout.nodes) layout.nodes = {};
    if (!node) return key;
    if (!persist) {
      const entry = layout.nodes[key] || (layout.nodes[key] = { x: 100, y: 100 });
      if (next.w == null) {
        if (node.layout?.w) entry.w = 0;
        else delete entry.w;
        if (node.layout?.wAuto) entry.wAuto = '';
        else delete entry.wAuto;
      } else {
        entry.w = next.w;
        if (next.wAuto) entry.wAuto = next.wAuto;
        else if (node.layout?.wAuto) entry.wAuto = '';
        else delete entry.wAuto;
      }
      return key;
    }
    if (next.w == null) {
      if (node.layout) {
        delete node.layout.w;
        delete node.layout.wAuto;
        if (!Object.keys(node.layout).length) delete node.layout;
      }
      const entry = layout.nodes[key];
      if (entry) {
        delete entry.w;
        delete entry.wAuto;
      }
      return key;
    }
    const id = assignPersistentId(doc, node);
    const w = Math.round(next.w);
    const nl: NonNullable<OutlineNode['layout']> = { ...(node.layout || {}), w };
    if (next.wAuto) nl.wAuto = next.wAuto;
    else delete nl.wAuto;
    node.layout = nl;
    void id;
    const prev = layout.nodes[key] || { x: 100, y: 100 };
    const entry: MapPoint = { ...prev, w };
    if (next.wAuto) entry.wAuto = next.wAuto;
    else delete entry.wAuto;
    // 0.6.6: the view key is unchanged by minting; the layout view writes it under the id.
    layout.nodes[key] = entry;
    return key;
  }

  /** The caption and measure options paint uses for this pill. */
  function fitMeasure(n: OutlineNode, key: string) {
    const layout = getLayout();
    const pos = layout.nodes?.[key];
    return {
      label: withNodeIcon(n, (codeFor(n) ? displayCaption(n.title) : captionWithoutLinks(displayCaption(n.title)))),
      opts: {
        fontSize: resolveFontPx(pos?.fontSize, layout.fontSize, getDoc().frontmatter?.fontSize),
        reserveTask: !!resolveTask(n),
        semibold: false,
        wrapCh: pos?.wrapCh ?? autoCh(),
        maxLines: pos?.maxLines,
        bodyExpanded: !!pos?.bodyExpanded,
        code: codeFor(n),
      },
    };
  }

  /** F5a cap: the map's visible width at 100% zoom − 48, at most 1400. */
  function currentSingleLineCap(): number {
    return singleLineCap(hostViewport().w);
  }

  /** 0.2.43: Auto's wrap for this map (`autoWidth:` in the layout block). */
  function autoCh(): number {
    const doc = getDoc();
    return autoWrapCh(doc.frontmatter?.autoWidth, {
      viewportW: hostViewport().w,
      fontPx: resolveFontPx(undefined, getLayout().fontSize, doc.frontmatter?.fontSize),
      fallback: DEFAULT_WRAP_CH,
    });
  }

  /**
   * F5a: every `w-auto: single-line` pill re-measures its natural one-line
   * width on render and writes it to `w` (layout object and node), so the
   * stored `w` is current whenever the host saves. While a caption is being
   * edited its width holds until the edit commits (no shift under the caret).
   */
  function resolveAutoWidths(): void {
    const doc = getDoc();
    const layout = getLayout();
    const cap = currentSingleLineCap();
    const editingKey = isEditing() ? getFocusId() : '';
    viewIndex.sync(doc);
    for (const n of viewIndex.order().map((k) => viewIndex.nodeOf(k)!).filter(Boolean)) {
      const key = vkey(n);
      const lay = layout.nodes?.[key];
      const mode = lay && lay.wAuto !== undefined ? lay.wAuto : n.layout?.wAuto;
      if (mode !== W_AUTO_SINGLE_LINE || key === resizingWidthKey || timeLeafKind(n)) continue;
      let w: number;
      const held = autoWidthCache.get(key);
      if (editingKey && key === editingKey && held != null) {
        w = held;
      } else {
        const m = fitMeasure(n, key);
        w = singleLineWidth(naturalLineWidth(m.label, m.opts), cap);
        autoWidthCache.set(key, w);
      }
      if (lay) lay.w = w;
      if (n.layout?.wAuto === W_AUTO_SINGLE_LINE) n.layout.w = w;
    }
  }

  function widthTitle(n: OutlineNode): string {
    return captionWithoutLinks(displayCaption(n.title)).split('\n')[0] || 'Node';
  }

  function paintedTextW(key: string, n: OutlineNode): number {
    const attr = Number(nodeEl(key)?.getAttribute('data-text-w'));
    if (Number.isFinite(attr) && attr > 0) return attr;
    const m = fitMeasure(n, key);
    const cur = readWidth(key, n).w;
    return cur ?? autoTextWidth(m.label, m.opts);
  }

  /** F9: remember where the pressed pill's left edge (vertical centre) is on screen. */
  function anchorPillLeft(key: string): void {
    const pill = nodeEl(key)?.querySelector('.map-pill');
    if (!pill) return;
    const r = pill.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    pendingLevelAnchor = {
      id: key,
      sx: r.left - hr.left,
      sy: r.top + r.height / 2 - hr.top,
      expand: false,
      noFlip: false,
      at: 'pill-left',
    };
  }

  /** One batched write for a step: one setDoc + onChange (or one paint when session-only). */
  function flushWidths(persist: boolean): void {
    widthHotKey = null;
    stopMotion();
    cancelFollowAnim();
    userCamGesture = true;
    pendingFollow = null;
    if (persist) {
      setDoc(getDoc());
      onChange?.();
    } else {
      paint();
    }
  }

  /** Write one region's child width. Auto deletes both keys. */
  function writeNodeLayout(node: OutlineNode, next: WidthEntry): void {
    regionWidthLive.delete(node);
    if (next.w == null) {
      if (node.layout) {
        delete node.layout.w;
        delete node.layout.wAuto;
        if (!Object.keys(node.layout).length) delete node.layout;
      }
      return;
    }
    const nl: NonNullable<OutlineNode['layout']> = { ...(node.layout || {}), w: Math.round(next.w) };
    if (next.wAuto) nl.wAuto = next.wAuto;
    else delete nl.wAuto;
    node.layout = nl;
  }

  function applyEntries(rec: WidthStepRec, side: 'before' | 'after'): void {
    if (rec.region) {
      for (const e of rec.entries) {
        if (!e.node) continue;
        writeNodeLayout(e.node, e[side]);
        if (e.node.id) opts.onRegionWidth?.(scopeId(rec.region, e.node.id), e[side].w, e[side].wAuto);
      }
      return;
    }
    const doc = getDoc();
    for (const e of rec.entries) {
      const key = writeWidth(e.key, e[side], rec.persist);
      if (key !== e.key) {
        if (rec.anchorKey === e.key) rec.anchorKey = key;
        e.key = key;
      }
      if (side === 'before' && rec.persist && e.idState !== 'kept' && e.before.w == null) {
        // Undo takes back an id this step minted when nothing else needs it (F8).
        const n = nodeByKey(e.key);
        if (n?.id && !n.layout?.w && !n.sealed && !doc.fold.ids.includes(n.id)) {
          if (e.idState === 'session') {
            n.autoId = true;
          } else {
            const id = n.id;
            delete n.id;
            const key = keyOfNode(n);
            const layout = getLayout();
            if (key !== id && layout.nodes?.[id]) {
              layout.nodes[key] = layout.nodes[id]!;
              delete layout.nodes[id];
            }
            if (getFocusId() === id) setFocusId(key);
            if (rec.anchorKey === e.key) rec.anchorKey = key;
            e.key = key;
          }
        }
      }
    }
  }

  function stepFor(rec: WidthStepRec): MapWidthStep {
    return {
      kind: rec.kind,
      keys: rec.entries.map((e) => toRef(e.key)),
      label: widthToastText(rec.entries.length),
      undo: () => runWidthUndo(rec),
      redo: () => runWidthRedo(rec),
    };
  }

  function runWidthUndo(rec: WidthStepRec): void {
    dismissWidthToast();
    anchorPillLeft(rec.anchorKey);
    applyEntries(rec, 'before');
    if (pendingLevelAnchor?.at === 'pill-left') pendingLevelAnchor.id = rec.anchorKey;
    flushWidths(rec.persist);
    announce(WIDTHS_RESTORED);
  }

  function runWidthRedo(rec: WidthStepRec): void {
    dismissWidthToast();
    anchorPillLeft(rec.anchorKey);
    applyEntries(rec, 'after');
    if (pendingLevelAnchor?.at === 'pill-left') pendingLevelAnchor.id = rec.anchorKey;
    flushWidths(rec.persist);
    announce(WIDTHS_REDONE);
  }

  function readStyleSnap(n: OutlineNode | null | undefined): StyleSnap {
    if (!n) return {};
    return {
      color: n.color,
      colorFill: n.colorFill || undefined,
      noFill: n.noFill || undefined,
      cloud: n.cloud,
      icon: n.icon,
      font: n.font,
    };
  }

  function sameStyleSnap(a: StyleSnap, b: StyleSnap): boolean {
    return (
      (a.color ?? undefined) === (b.color ?? undefined) &&
      !!a.colorFill === !!b.colorFill &&
      !!a.noFill === !!b.noFill &&
      (a.cloud ?? undefined) === (b.cloud ?? undefined) &&
      (a.icon ?? undefined) === (b.icon ?? undefined) &&
      (a.font ?? undefined) === (b.font ?? undefined)
    );
  }

  /** Restore a style snapshot without pushing a new undo step. */
  function writeStyleSnap(key: string, snap: StyleSnap): string {
    suppressStyleStep = true;
    try {
      if (zoneNode(key)) {
        zoneStyle(
          key,
          (z) => {
            if (snap.color) z.color = snap.color;
            else delete z.color;
            if (snap.colorFill) z.colorFill = true;
            else delete z.colorFill;
            if (snap.noFill) z.noFill = true;
            else delete z.noFill;
            if (snap.cloud) z.cloud = snap.cloud;
            else delete z.cloud;
            if (snap.icon) z.icon = snap.icon;
            else delete z.icon;
            applyNodeFont(z, snap.font, true);
            return true;
          },
          'Style restored.',
        );
        return key;
      }
      const n = nodeByKey(key);
      if (!n) return key;
      if (snap.color) n.color = snap.color;
      else delete n.color;
      if (snap.colorFill) n.colorFill = true;
      else delete n.colorFill;
      if (snap.noFill) n.noFill = true;
      else delete n.noFill;
      if (snap.cloud) n.cloud = snap.cloud;
      else delete n.cloud;
      if (snap.icon) n.icon = snap.icon;
      else delete n.icon;
      applyNodeFont(n, snap.font, false);
      if (snap.font) assignPersistentId(getDoc(), n);
      const id = persistStyle(key, n);
      setDoc(getDoc());
      onChange?.();
      return id;
    } finally {
      suppressStyleStep = false;
    }
  }

  function runStyleUndo(rec: StyleStepRec): void {
    const key = writeStyleSnap(rec.key, rec.before);
    if (key !== rec.key) rec.key = key;
    announce('Style restored.');
    if (nodeMenu?.key === rec.key || nodeMenu?.key === key) refreshOpenNodeMenu();
  }

  function runStyleRedo(rec: StyleStepRec): void {
    const key = writeStyleSnap(rec.key, rec.after);
    if (key !== rec.key) rec.key = key;
    announce('Style applied again.');
    if (nodeMenu?.key === rec.key || nodeMenu?.key === key) refreshOpenNodeMenu();
  }

  function commitStyleStep(key: string, before: StyleSnap, after: StyleSnap): void {
    if (suppressStyleStep) return;
    if (sameStyleSnap(before, after)) return;
    const rec: StyleStepRec = { key, before, after };
    editUndoStack.push({ type: 'style', rec });
    editRedoStack.length = 0;
  }

  function undoMapEdit(): boolean {
    const edit = editUndoStack.pop();
    if (!edit) return false;
    if (edit.type === 'width') runWidthUndo(edit.rec);
    else runStyleUndo(edit.rec);
    editRedoStack.push(edit);
    return true;
  }

  function redoMapEdit(): boolean {
    const edit = editRedoStack.pop();
    if (!edit) return false;
    if (edit.type === 'width') runWidthRedo(edit.rec);
    else runStyleRedo(edit.rec);
    editUndoStack.push(edit);
    return true;
  }

  function undoWidth(): boolean {
    const top = editUndoStack[editUndoStack.length - 1];
    if (!top || top.type !== 'width') return false;
    return undoMapEdit();
  }

  function redoWidth(): boolean {
    const top = editRedoStack[editRedoStack.length - 1];
    if (!top || top.type !== 'width') return false;
    return redoMapEdit();
  }

  /**
   * Commit a step: write every entry, one batched setDoc + onChange, push one
   * undo step (F7), anchor the pressed pill (F9). Entries that change nothing
   * are dropped; a step with none is not pushed.
   */
  function commitWidthStep(
    kind: WidthPickKind | 'drag',
    anchorKey: string,
    entries: WidthStepEntry[],
    how: { toast: boolean; announce?: string },
    region?: string,
  ): MapWidthStep | null {
    const changed = entries.filter((e) => !sameWidth(e.before, e.after));
    // A region pick stays in that sealed branch. It does not setDoc the host note.
    const rec: WidthStepRec = { kind, entries: changed, anchorKey, persist: region ? false : widthsPersist(), region };
    if (changed.length) {
      anchorPillLeft(anchorKey);
      applyEntries(rec, 'after');
      if (pendingLevelAnchor?.at === 'pill-left') pendingLevelAnchor.id = rec.anchorKey;
      for (const e of changed) autoWidthCache.delete(e.key);
      flushWidths(rec.persist);
    }
    if (how.announce) announce(how.announce);
    if (!changed.length) return null;
    const step = stepFor(rec);
    const hostTook = onWidthStep?.(step) === true;
    if (!hostTook) {
      editUndoStack.push({ type: 'width', rec });
      editRedoStack.length = 0;
      if (how.toast) showWidthToast(rec);
    }
    return step;
  }

  /** The popover's and `w` menu's picks (F3–F6). */
  function applyWidthPick(key: string, rawKind: LegacyWidthPickKind, _explicitW?: number): MapWidthStep | null | false {
    // 0.2.43: `slim` → Fit text, `wider` → Wide (old hosts / saved picks).
    const kind = normalizeWidthPickKind(rawKind);
    if (!kind) return false;
    const hit = regionWidthDoc(key);
    const n = hit?.node ?? nodeByKey(key);
    // Time leaves have no width (TL1): no pick applies to them.
    if (!n || timeLeafKind(n)) return false;
    const roots = hit ? hit.doc.nodes : getDoc().nodes;
    let scope: OutlineNode[] = [n];
    if (kind === 'siblings') {
      const parent = findParentOf(roots, n);
      // TL1: Copy to siblings skips time leaves.
      scope = siblingScope(n, parent ? parent.children : roots).filter((s) => !timeLeafKind(s));
    } else if (kind === 'level') {
      scope = levelScope(n, roots).filter((s) => !timeLeafKind(s));
    }
    const cap = currentSingleLineCap();
    let capped = 0;
    // 6 Nov 2026: Copy to siblings / all at this level clones THIS node's
    // current width state (w / wAuto, Auto included) onto the scope.
    const copyFrom = isCopyScopeKind(kind) ? copyWidthEntry(readWidth(key, n)) : null;
    const entries: WidthStepEntry[] = scope.map((node) => {
      const k = hit ? (node.id ? scopeId(hit.region, node.id) : key) : keyOfNode(node);
      const before = readWidth(k, node);
      const m = fitMeasure(node, k);
      let after: WidthEntry;
      if (copyFrom) {
        after = { ...copyFrom };
      } else if (kind === 'fit') {
        after = fitTextEntry({ fit: fitTextWidth(m.label, m.opts), auto: autoTextWidth(m.label, m.opts) });
      } else if (kind === 'line') {
        const one = oneLineEntry({
          natural: naturalLineWidth(m.label, m.opts),
          auto: autoTextWidth(m.label, m.opts),
          cap,
        });
        if (one.capped) capped++;
        after = { w: one.w, wAuto: one.wAuto };
      } else if (kind === 'wide') {
        after = wideEntry({ natural: naturalLineWidth(m.label, m.opts), current: paintedTextW(k, node), cap });
      } else {
        after = { w: null, wAuto: null };
      }
      return { key: k, before, after, idState: idStateOf(node), node: hit ? node : undefined };
    });
    const fitAuto = kind === 'fit' && entries[0]!.after.w == null;
    return commitWidthStep(kind, key, entries, {
      toast: true,
      announce: widthPickAnnouncement(kind, {
        title: widthTitle(n),
        count: scope.length,
        capped,
        auto: fitAuto,
      }),
    }, hit?.region);
  }

  function findParentOf(list: OutlineNode[], target: OutlineNode): OutlineNode | null {
    for (const n of list) {
      if (n.children?.includes(target)) return n;
      const hit = n.children?.length ? findParentOf(n.children, target) : null;
      if (hit) return hit;
    }
    return null;
  }

  function dismissWidthToast(): void {
    const t = widthToast;
    if (!t) return;
    widthToast = null;
    window.clearTimeout(t.timer);
    t.abort.abort();
    t.el.remove();
  }

  /**
   * F7 toast (D5 pattern): "4 widths changed · Undo", role=status, about 8 s,
   * pauses on hover or focus, ✕ dismisses, never takes focus. It lives in the
   * host and survives paint().
   */
  function showWidthToast(rec: WidthStepRec): void {
    dismissWidthToast();
    if (typeof document === 'undefined') return;
    const ac = new AbortController();
    const el = document.createElement('div');
    el.className = 'map-toast';
    el.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.className = 'map-toast-text';
    text.textContent = widthToastText(rec.entries.length);
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'map-toast-undo';
    undoBtn.textContent = 'Undo';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'map-toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '✕';
    el.style.cssText = [
      'position:absolute',
      'z-index:7',
      'left:50%',
      'bottom:12px',
      'transform:translateX(-50%)',
      'display:flex',
      'align-items:center',
      'gap:8px',
      'padding:4px 4px 4px 14px',
      'border-radius:10px',
      'background:#13202b',
      'border:1px solid #3d5a73',
      'box-shadow:0 8px 24px rgba(0,0,0,.35)',
      'color:#e7ecf1',
      'font:14px/1.2 system-ui,sans-serif',
      'max-width:calc(100% - 16px)',
      'touch-action:manipulation',
    ].join(';');
    const btnCss = [
      'min-height:44px',
      'min-width:44px',
      'padding:0 12px',
      'border-radius:8px',
      'border:1px solid #3d5a73',
      'background:#1b3044',
      'color:#e7ecf1',
      'font:inherit',
      'cursor:pointer',
      'touch-action:manipulation',
    ].join(';');
    undoBtn.style.cssText = `${btnCss};font-weight:600`;
    close.style.cssText = btnCss;
    el.append(text, undoBtn, close);
    const t = { el, timer: 0, abort: ac };
    const arm = () => {
      window.clearTimeout(t.timer);
      t.timer = window.setTimeout(() => {
        if (widthToast === t) dismissWidthToast();
      }, WIDTH_TOAST_MS);
    };
    const pause = () => window.clearTimeout(t.timer);
    bindTap(
      undoBtn,
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        // Undo the step this toast is for, if it is still the latest.
        const top = editUndoStack[editUndoStack.length - 1];
        if (top?.type === 'width' && top.rec === rec) undoMapEdit();
        else dismissWidthToast();
      },
      { signal: ac.signal },
    );
    bindTap(
      close,
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        dismissWidthToast();
      },
      { signal: ac.signal },
    );
    for (const type of ['pointerenter', 'focusin'] as const) el.addEventListener(type, pause, { signal: ac.signal });
    el.addEventListener('pointerleave', () => { if (!el.contains(document.activeElement)) arm(); }, { signal: ac.signal });
    el.addEventListener('focusout', (e) => {
      if (!el.contains((e as FocusEvent).relatedTarget as Node | null)) arm();
    }, { signal: ac.signal });
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(el);
    widthToast = t;
    arm();
  }

  /** F11: the width popover for a node, as the `w` key opens it. */
  function openWidthMenu(id?: string): boolean {
    const key = id || regionFocus || getFocusId();
    if (!key || !openWidthPopHook) return false;
    if (!nodeByKey(key) && !regionWidthTarget(key)) return false;
    return openWidthPopHook(key, { keyboard: true });
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

  const mounted = new Map<string, RegionHostSpec>();
  let placed: PlacedRegion[] = [];
  const rfold: RegionFoldStore = opts.regionFold ?? createRegionFoldStore();
  /** Selected node inside a region (scoped id) or a region root (region id); null = root doc. */
  let regionFocus: string | null = null;
  /** Caption column while a region pill's corner is being dragged. Cleared on commit. */
  const regionWidthLive = new Map<OutlineNode, number>();
  rfold.subscribe(() => {
    if (host.isConnected) paint();
  });
  host.addEventListener('click', (e) => {
    const t = e.target as Element | null;
    const tool = t?.closest?.('.map-region-tool');
    if (tool && host.contains(tool)) {
      e.preventDefault();
      e.stopPropagation();
      const region = tool.getAttribute('data-region-id') || '';
      if (tool.getAttribute('data-region-tool') === 'lock') {
        opts.onRegionLock?.(region);
        announce('Sealed branch locked');
      } else opts.onRegionMore?.(region, (tool as Element).getBoundingClientRect());
      return;
    }
    const g = t?.closest?.('.map-region-node');
    if (!g || !host.contains(g)) {
      if (t?.closest?.('.map-node')) setRegionFocus(null);
      return;
    }
    const key = g.getAttribute('data-scoped-id') || '';
    e.preventDefault();
    e.stopPropagation();
    if (t?.closest?.('.map-link-hit')) {
      // 0.6.6: globe on a zone node opens the same Links popover, from the zone's own doc.
      focusMapForKeys();
      setRegionFocus(key);
      const hit = regionBox(key);
      const zn = hit?.r.host.doc && hit.b.localId ? findNode(hit.r.host.doc.nodes, hit.b.localId) : null;
      if (zn) showLinkPop(key, zn.title || '');
      return;
    }
    if (t?.closest?.('.map-task-hit, .map-task-glyph')) {
      // Same toggle as a main Map row: applyTaskToggle → onRegionTaskToggle (re-seal path).
      focusMapForKeys();
      setRegionFocus(key);
      applyTaskToggle(key);
    } else if (t?.closest?.('.map-fold-hit, .map-fold-indicator') || g.classList.contains('map-region-root')) activateRegionFold(key);
    else {
      focusMapForKeys();
      setRegionFocus(key);
    }
  });
  function hostOf(region: string): RegionHostSpec | undefined {
    return regionHosts().find((h) => h.id === region);
  }
  function regionLocked(h: RegionHostSpec | undefined): boolean {
    return !h || !h.doc;
  }
  function regionIsFolded(h: RegionHostSpec): boolean {
    return regionLocked(h) || h.folded || rfold.isRegionFolded(h.id);
  }
  /** Placed box for a scoped id / region id. */
  function regionBox(key: string): { r: PlacedRegion; b: PlacedBox } | null {
    for (const r of placed) for (const b of r.boxes) if (b.key === key) return { r, b };
    return null;
  }
  /**
   * Fold context for an id: the root doc for plain ids, or a store-backed view doc for a
   * node inside a region (scoped id). Same helpers either way, no fork (§R1 a).
   */
  function foldCtx(id: string): { region: string; local: string; doc: OutlineFoldDoc } | null {
    const hit = regionBox(id);
    if (!hit) return { region: '', local: id, doc: getDoc() };
    const h = hit.r.host;
    if (hit.b.root || !h.doc || !hit.b.localId) return null;
    return { region: h.id, local: hit.b.localId, doc: rfold.viewDoc(h.id, h.doc) };
  }
  regionFocusRef = () => regionFocus;
  function setRegionFocus(key: string | null): void {
    regionFocus = key;
    syncRegionFocus();
    if (key) {
      rememberTaskCycleOrigin(key);
      emitFocus();
    }
  }
  function syncRegionFocus(): void {
    for (const el of host.querySelectorAll('.map-region-node.is-focused, .map-region.is-focused')) el.classList.remove('is-focused');
    const el = regionFocus
      ? host.querySelector(`.map-region-node[data-scoped-id="${CSS.escape(regionFocus)}"]`)
      : null;
    if (regionFocus && !el) regionFocus = null;
    if (el) {
      el.classList.add('is-focused');
      el.setAttribute('aria-selected', 'true');
      if (el.id) host.setAttribute('aria-activedescendant', el.id);
    }
    syncRegionWidthGrips();
  }
  /** Corner grip on the focused region pill, and on the pill whose corner is hot. */
  function syncRegionWidthGrips(): void {
    host.querySelectorAll<SVGGElement>('.map-region-node').forEach((g) => {
      const id = g.getAttribute('data-scoped-id');
      const on = !!id && (id === regionFocus || id === widthHotKey);
      const grip = g.querySelector('.map-width-grip');
      if (!grip) return;
      grip.setAttribute('opacity', on ? '1' : '0');
      g.querySelector('.map-width-hit')?.setAttribute('pointer-events', on ? 'all' : 'none');
    });
  }
  /** Child node of an open region, plus that region's doc. Null for a root-doc id or the cloud root. */
  function regionWidthDoc(key: string): { region: string; doc: OutlineFoldDoc; node: OutlineNode } | null {
    const hit = regionBox(key);
    if (!hit || hit.b.root || !hit.r.host.doc || !hit.b.localId) return null;
    const node = findNode(hit.r.host.doc.nodes, hit.b.localId);
    if (!node) return null;
    return { region: hit.r.host.id, doc: hit.r.host.doc, node };
  }
  /** Child node of an open region, or null for a root-doc id / the cloud root. */
  function regionWidthTarget(key: string): OutlineNode | null {
    return regionWidthDoc(key)?.node ?? null;
  }
  function resolveFocusedTaskNode(id: string): OutlineNode | null {
    return findNode(getDoc().nodes, id) ?? regionWidthTarget(id);
  }
  function rememberTaskCycleOrigin(id: string | null): void {
    if (!id) return;
    const key = parseScopedId(id).region ? id : toRef(id);
    if (taskCycleOrigin?.id === key || taskCycleOrigin?.id === id) return;
    const n = resolveFocusedTaskNode(id) ?? resolveFocusedTaskNode(key);
    taskCycleOrigin = { id: key, includeNone: !!n && !timeLeafKind(n) && !resolveTask(n) };
  }
  /** Write a finished region-pill drag onto the child. Returns true when `key` is in a region. */
  function commitRegionWidth(key: string): boolean {
    const node = regionWidthTarget(key);
    if (!node) return false;
    const w = regionWidthLive.get(node);
    regionWidthLive.delete(node);
    if (typeof w !== 'number') return true;
    node.layout = { ...(node.layout || {}), w };
    opts.onRegionWidth?.(key, w);
    return true;
  }
  /** Activate a region fold handle: inner node toggle, region root fold / unfold, or unlock. */
  function activateRegionFold(key: string): void {
    const hit = regionBox(key);
    const h = hit ? hit.r.host : hostOf(key);
    if (!h) return;
    focusMapForKeys();
    if (!hit || hit.b.root || key === h.id) {
      setRegionFocus(h.id);
      if (regionLocked(h)) {
        // A locked sealed region never unfolds; ask the host to unlock (§R1 d / FOLD-7).
        opts.onRegionUnlock?.(h.id);
        announce(h.kind === 'sealed' ? 'Sealed branch is locked' : 'Region is not loaded');
        return;
      }
      const was = regionIsFolded(h);
      if (h.folded && was) {
        const m = mounted.get(h.id);
        if (m) m.folded = false;
      }
      rfold.setRegionFolded(h.id, !was);
      announce(`${was ? 'Expanded' : 'Collapsed'}: ${h.label || (h.kind === 'sealed' ? 'Sealed branch' : 'Record')}`);
      return;
    }
    setRegionFocus(key);
    if (!hit.b.foldable || !hit.b.localId || !h.doc) return;
    const nowCollapsed = rfold.toggleNode(h.id, h.doc, hit.b.localId);
    opts.onRegionFoldSync?.(h.id);
    announce(`${nowCollapsed ? 'Collapsed' : 'Expanded'}: ${captionWithoutLinks(displayCaption(hit.b.title))}`);
  }
  /** Ordered region keys for arrow navigation inside one region (cloud root first). */
  function regionOrder(region: string): string[] {
    const r = placed.find((p) => p.host.id === region);
    if (!r) return [];
    const h = r.host;
    if (r.boxes.length === 1 && r.boxes[0]!.root) return [h.id];
    const out = [h.id];
    if (!h.doc) return out;
    const view = rfold.viewDoc(h.id, h.doc);
    const walkO = (l: OutlineNode[] | undefined) =>
      l?.forEach((n) => {
        if (!n.id) return;
        out.push(`${h.id}:${n.id}`);
        if (hasKids(n) && !isCollapsed(view, n.id)) walkO(n.children);
      });
    walkO(h.doc.nodes);
    return out.filter((k) => k === h.id || !!regionBox(k));
  }
  function regionParentKey(region: string, local: string): string {
    const h = hostOf(region);
    const path: string[] = [];
    const find = (l: OutlineNode[] | undefined): boolean =>
      !!l?.some((n) => {
        if (n.id === local) return true;
        if (find(n.children)) {
          if (n.id) path.unshift(n.id);
          return true;
        }
        return false;
      });
    find(h?.doc?.nodes);
    return path.length ? `${region}:${path[path.length - 1]}` : region;
  }
  /** Fold / nav keys on a selected region node: same key map as root nodes (§R1 a, FOLD-2). */
  function onRegionKey(e: KeyboardEvent): void {
    if (!regionFocus || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (levelMenu || (e.target as Element | null)?.closest?.('input, textarea, [contenteditable="true"], .map-level-menu, .map-node-menu')) return;
    const key = regionFocus;
    const hit = regionBox(key);
    const h = hit ? hit.r.host : hostOf(key);
    if (!h) {
      regionFocus = null;
      return;
    }
    const isRoot = key === h.id || !!hit?.b.root;
    const local = hit?.b.localId;
    const doc = h.doc;
    const collapsed = isRoot ? regionIsFolded(h) : !!hit?.b.collapsed;
    const foldable = isRoot || !!hit?.b.foldable;
    const order = regionOrder(h.id);
    const i = order.indexOf(isRoot ? h.id : key);
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End': {
        stop();
        const j = e.key === 'Home' ? 0 : e.key === 'End' ? order.length - 1 : i + (e.key === 'ArrowDown' ? 1 : -1);
        if (j >= 0 && j < order.length) setRegionFocus(order[j]!);
        return;
      }
      case 'ArrowRight':
        stop();
        if (foldable && collapsed) activateRegionFold(key);
        else if (i + 1 < order.length) setRegionFocus(order[i + 1]!);
        return;
      case 'ArrowLeft':
        stop();
        if (foldable && !collapsed) activateRegionFold(key);
        else if (!isRoot && local) setRegionFocus(regionParentKey(h.id, local));
        return;
      case 'Escape': {
        // Leave the region explicitly: back to the anchor in the parent.
        stop();
        regionFocus = null;
        syncRegionFocus();
        const parent = h.parent ?? '';
        if (parent) setRegionFocus(`${parent}:${h.anchor}`);
        else {
          setFocusId(h.anchor);
          onChange?.();
        }
        return;
      }
      case 'Enter':
      case ' ':
      case '.':
        stop();
        if (foldable) activateRegionFold(key);
        return;
      default:
        break;
    }
    if (e.key === '*' || (e.key >= '0' && e.key <= '9')) {
      stop();
      if (!doc || regionLocked(h)) {
        if (isRoot) activateRegionFold(h.id);
        return;
      }
      const level = e.key === '*' ? '*' : (Number(e.key) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
      if (isRoot) {
        // Region root counts as one level: 0 folds the cloud, N shows N-1 levels inside it.
        if (level === 0) rfold.setRegionFolded(h.id, true);
        else {
          rfold.setRegionFolded(h.id, false);
          rfold.setLevel(h.id, doc, level === '*' ? '*' : ((level - 1) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8));
        }
      } else if (local) rfold.setLevel(h.id, doc, level, local);
      opts.onRegionFoldSync?.(h.id);
    }
  }
  function regionHosts(): RegionHostSpec[] {
    return [...(opts.getRegionHosts?.() ?? []), ...mounted.values()];
  }
  // 0.4.4: an open top-level sealed region's anchor pill reads "🔓 <caption>"; the mark is part of
  // the caption so pillSize counts it in the pill width.
  function unlockedAnchorKeys(): Set<string> {
    const out = new Set<string>();
    for (const r of placed) if (r.host.kind === 'sealed' && r.host.doc && !r.host.parent) out.add(r.host.anchor);
    return out;
  }
  function anchorCaption(key: string | undefined, label: string, anchors: Set<string> = unlockedAnchorKeys()): string {
    return key !== undefined && anchors.has(key) ? UNLOCK_MARK + label : label;
  }
  let codeMemo: WeakMap<OutlineNode, boolean> | null = null;
  /**
   * Code format for a node in the live doc or an open zone.
   * Children follow a code parent. An open zone follows its anchor, so a
   * `<font:code>` anchor paints the rows inside the cloud as code too.
   */
  function codeFor(n: OutlineNode): boolean {
    if (!codeMemo) {
      const doc = getDoc();
      const memo = markCode(doc.nodes);
      const hosts = regionHosts();
      const byId = new Map(hosts.map((h) => [h.id, h]));
      const ordered = [...hosts].sort((a, b) => a.id.split('/').length - b.id.split('/').length);
      for (const h of ordered) {
        if (!h.doc) continue;
        let inherited = false;
        if (h.anchor) {
          const parentDoc = h.parent ? byId.get(h.parent)?.doc : doc;
          const anchor = parentDoc ? findNode(parentDoc.nodes, h.anchor) : null;
          if (anchor) inherited = memo.get(anchor) ?? showsAsCode(anchor, false);
        }
        markCode(h.doc.nodes, memo, inherited);
      }
      codeMemo = memo;
    }
    return codeMemo.get(n) ?? showsAsCode(n, false);
  }
  function nodeMeasure(d: OutlineFoldDoc, n: OutlineNode, pos: MapPoint | undefined, key?: string) {
    const code = codeFor(n);
    const shown = displayCaption(n.title);
    const label = anchorCaption(key, withNodeIcon(n, code ? shown : captionWithoutLinks(shown)));
    const live = regionWidthLive.get(n);
    return pillSize(label, {
      reserveFold: hasKids(n),
      reserveTask: !!resolveTask(n),
      semibold: false,
      wrapCh: pos?.wrapCh ?? autoCh(),
      widthPx: live ?? pos?.w ?? n.layout?.w,
      maxLines: pos?.maxLines,
      fontSize: resolveFontPx(pos?.fontSize, getLayout().fontSize, d.frontmatter?.fontSize),
      code,
    });
  }
  function quickSize(d: OutlineFoldDoc, n: OutlineNode, pos: MapPoint | undefined, key?: string): { w: number; h: number } {
    const sz = nodeMeasure(d, n, pos, key);
    return { w: sz.w, h: sz.h };
  }
  /** Key of a row inside a region doc: its local id (rows get session ids there). */
  function regionKey(n: OutlineNode): string {
    return n.id ?? vkey(n);
  }
  function visibleKeyed(d0: OutlineFoldDoc, region?: string): { n: OutlineNode; key: string; parentKey: string | null }[] {
    const d = region ? rfold.viewDoc(region, d0) : d0;
    const out: { n: OutlineNode; key: string; parentKey: string | null }[] = [];
    const walkV = (n: OutlineNode, parentKey: string | null) => {
      if (isBlankNode(n)) return;
      // Main Map: view keys. Inside a region (its own doc, every row has an id) the
      // local id is the key, as the region's scoped ids are built from it.
      const key = region ? regionKey(n) : vkey(n);
      out.push({ n, key, parentKey });
      if (hasKids(n) && !(n.id && isCollapsed(d, n.id))) n.children!.forEach((c) => walkV(c, key));
    };
    (d.nodes || []).forEach((n) => walkV(n, null));
    return out;
  }
  /** Reserve room for cloud regions in the auto-packed parent (no overlap by construction). */
  function reserveRegions(doc: OutlineFoldDoc): void {
    // A top-level anchor names a main-Map line: its key is that line's view key.
    const hosts = regionHosts().map((h) => (h.parent ? h : { ...h, anchor: toKey(h.anchor) }));
    placed = [];
    invalidateContentUnion();
    if (!hosts.length) return;
    const layout = getLayout();
    const vis = visibleKeyed(doc);
    const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
    const kids = new Map<string, string[]>();
    for (const v of vis) {
      const p = layout.nodes![v.key];
      if (!p) continue;
      const sz = quickSize(doc, v.n, p, v.key);
      boxes.set(v.key, { x: p.x - sz.w / 2, y: p.y - sz.h / 2, ...sz });
      if (v.parentKey) (kids.get(v.parentKey) ?? kids.set(v.parentKey, []).get(v.parentKey)!).push(v.key);
    }
    placed = placeRegions(boxes, (k) => kids.get(k) ?? [], '', hosts, {
      pack: (d0, region) => {
        const d = region ? rfold.viewDoc(region, d0) : d0;
        // A live drag is not on the node yet. Stamp it so the centre uses the
        // same width as the pill, and the shared left edge stays put.
        const nodeLayout: Record<string, MapPoint> = {};
        const stamp = (n: OutlineNode) => {
          const w = regionWidthLive.get(n);
          if (typeof w === 'number') nodeLayout[region ? regionKey(n) : vkey(n)] = { x: 0, y: 0, w };
          n.children?.forEach(stamp);
        };
        (d.nodes || []).forEach(stamp);
        return autoPackPositions(d, {
          isNodeCollapsed: (id) => isCollapsed(d, id),
          wrapCh: autoCh(),
          fontSize: resolveFontPx(undefined, getLayout().fontSize, getDoc().frontmatter?.fontSize),
          nodeLayout,
          keyOf: region ? regionKey : vkey,
        }).nodes;
      },
      size: (n) => quickSize(doc, n, undefined),
      visible: visibleKeyed,
      regionFolded: regionIsFolded,
      nodeCollapsed: (region, d, id) => rfold.isNodeCollapsed(region, d, id),
      foldedPill: foldedRegionPill(resolveFontPx(undefined, getLayout().fontSize, getDoc().frontmatter?.fontSize)),
    });
    let maxX = layout.viewBox?.w ?? 0, maxY = layout.viewBox?.h ?? 0;
    for (const [k, b] of boxes) {
      const p = layout.nodes![k]!;
      p.y = b.y + b.h / 2;
      maxY = Math.max(maxY, b.y + b.h + 40);
    }
    for (const r of placed) {
      maxX = Math.max(maxX, r.hull.x + r.hull.w + 40);
      maxY = Math.max(maxY, r.hull.y + r.hull.h + 40);
    }
    layout.viewBox = { ...(layout.viewBox ?? { w: maxX, h: maxY }), w: maxX, h: maxY };
  }
  function regionDomId(key: string): string {
    return `${domPrefix}-rg-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  }
  function regionCloudSvg(): string {
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return placed
      .map((r) => {
        // Open sealed cloud reads "🔓 k1" with a solid green border (seal-edit 05).
        const cloudLabel = r.host.kind === 'sealed' && r.host.doc ? `🔓 ${r.host.kid ?? 'key'}` : r.host.label;
        const cloud = regionSvg({ rootId: r.host.id, kind: r.host.kind, label: cloudLabel, unlocked: r.host.kind === 'sealed' && !!r.host.doc }, r.hull);
        const expandedCloud = !(r.boxes.length === 1 && r.boxes[0]!.root);
        // 0.4.3 (QA C): zone header tools on an open sealed cloud: 🔒 Lock now and More ▾.
        const tools = r.host.kind === 'sealed' && r.host.doc && expandedCloud
          ? (() => {
              const y = r.hull.y + 4;
              const xm = r.hull.x + r.hull.w - 44 - 22 - 56;
              const xl = xm - 28;
              const rid = esc(r.host.id);
              return `<g class="map-region-tool map-region-lock" data-region-tool="lock" data-region-id="${rid}" role="button" tabindex="-1" aria-label="Lock now"><title>Lock now</title><rect x="${xl}" y="${y}" width="24" height="20" rx="5"/><text x="${xl + 12}" y="${y + 14}" text-anchor="middle">🔒</text></g>` +
                `<g class="map-region-tool map-region-more" data-region-tool="more" data-region-id="${rid}" role="button" tabindex="-1" aria-haspopup="menu" aria-label="More secure zone actions"><title>More</title><rect x="${xm}" y="${y}" width="52" height="20" rx="5"/><text x="${xm + 26}" y="${y + 14}" text-anchor="middle">More ▾</text></g>`;
            })()
          : '';
        // Region root fold handle on the open cloud (top-right): folds the whole region (§R1 b).
        const cloudFold = expandedCloud
          ? `<g class="map-region-node map-region-root" id="${esc(regionDomId(r.host.id))}" role="treeitem" aria-expanded="true" aria-selected="false" aria-label="${esc((r.host.label || (r.host.kind === 'sealed' ? 'Sealed branch' : 'Record')) + ', expanded')}" data-scoped-id="${esc(r.host.id)}" data-region-id="${esc(r.host.id)}">${foldHandleSvg(r.hull.x + r.hull.w - 44, r.hull.y + 16, false)}<rect class="map-fold-hit" x="${r.hull.x + r.hull.w - 27 - 16}" y="${r.hull.y}" width="32" height="32" fill="transparent" cursor="pointer"/></g>`
          : '';
        const edges = r.edges
          .map(([x1, y1, x2, y2]) => `<path class="map-region-edge" d="M${x1} ${y1} C${x1} ${(y1 + y2) / 2} ${x2 - 20} ${y2} ${x2} ${y2}" fill="none"/>`)
          .join('');
        // 0.4.5 (Colin): connectors between nodes inside the open cloud, light on the green.
        const inner = innerRegionEdges(r.boxes)
          .map(([x1, y1, x2, y2]) => { const mx = (x1 + x2) / 2; return `<path class="map-region-edge map-region-inner-edge" d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" fill="none"/>`; })
          .join('');
        // 0.5.28: user clouds on zone nodes (inline <cloud> in the sealed body), over the visible
        // boxes of the node's subtree in this region, outer first, under the pills.
        const zoneClouds: { svg: string; depth: number }[] = [];
        if (r.host.doc && expandedCloud) {
          const keys = new Map(r.boxes.filter((b) => b.localId).map((b) => [b.localId!, b]));
          const walkZ = (list: OutlineNode[] | undefined, depth: number) => {
            for (const n of list ?? []) {
              let d = depth;
              if (n.cloud && n.id && keys.has(n.id)) {
                const ids = new Set<string>();
                const walkI = (m: OutlineNode) => { if (m.id) ids.add(m.id); m.children?.forEach(walkI); };
                walkI(n);
                const pts = cloudHull(
                  [...keys.entries()].filter(([id]) => ids.has(id)).map(([, b]) => ({ x: b.x, y: b.y, w: b.w, h: b.h })),
                  cloudPad(depth),
                );
                if (pts) zoneClouds.push({ svg: cloudSvg({ rootId: scopeId(r.host.id, n.id), color: resolveColour(n.cloud) ?? n.cloud, depth }, pts), depth });
                d = depth + 1;
              }
              walkZ(n.children, d);
            }
          };
          walkZ(r.host.doc.nodes, 0);
        }
        const zoneCloudSvg = zoneClouds.sort((a, b) => a.depth - b.depth).map((c) => c.svg).join('');
        const pills = r.boxes
          .map((b) => {
            const folded = b.key === r.host.id;
            // 0.4.3 (QA C): 🔒 only while locked; an unlocked branch folded to its pill reads 🔓.
            // 0.4.5 (Colin): the folded pill sits right under its anchor, whose caption already is the
            // public label (or the 'Sealed branch' placeholder). Show only the lock glyph, not a copy.
            const regionName = r.host.label || (r.host.kind === 'sealed' ? 'Sealed branch' : 'Record');
            const node = !folded && b.localId && r.host.doc ? findNode(r.host.doc.nodes, b.localId) : null;
            const zoneCode = !folded && node ? codeFor(node) : false;
            const shown = displayCaption(b.title);
            const t = folded ? (r.host.kind === 'sealed' ? (r.host.doc ? '🔓' : '🔒') : regionName) : (zoneCode ? shown : captionWithoutLinks(shown));
            const ariaName = folded && r.host.kind === 'sealed' ? `${regionName}${r.host.doc ? '' : `, Unlock ${r.host.kid ?? 'key'}`}` : t;
            const cy = b.y + b.h / 2;
            const slot = b.foldable ? FOLD_SLOT : 0;
            const boxRight = b.x + Math.max(1, b.w - slot);
            const locked = folded && !r.host.doc;
            const chrome = b.foldable
              ? foldChromeSvg(boxRight, cy, !!b.collapsed, FOLD_SLOT, { hiddenCount: b.hidden || 0 }) +
                (locked && r.host.kind === 'sealed'
                  ? `<rect class="map-fold-hit" x="${foldHandleGeometry(boxRight).cx - 16}" y="${cy - 16}" width="32" height="32" fill="transparent" cursor="pointer" aria-label="Unlock ${esc(r.host.kid ?? 'key')}"><title>Unlock ${esc(r.host.kid ?? 'key')}</title></rect>`
                  : `<rect class="map-fold-hit" x="${foldHandleGeometry(boxRight).cx - 16}" y="${cy - 16}" width="32" height="32" fill="transparent" cursor="pointer"/>`)
              : '';
            const aria = `${ariaName}${b.foldable ? (b.collapsed ? `, collapsed${b.hidden ? `, ${foldCountLabel(b.hidden)}` : ''}${locked ? ', locked' : ''}` : ', expanded') : ''}`;
            const kidChip = locked && r.host.kid
              ? `<g class="map-region-kid"><rect x="${b.x + b.w - slot - 34}" y="${b.y - 8}" width="30" height="16" rx="8"/><text x="${b.x + b.w - slot - 19}" y="${b.y + 4}" text-anchor="middle">${esc(r.host.kid.slice(0, 4))}</text></g>`
              : '';
            // Same measure as the box, so a stored or live width wraps the caption
            // instead of drawing one line at the map's character width.
            const measured = node ? nodeMeasure(getDoc(), node, undefined) : null;
            const lines = measured?.lines.length ? measured.lines : wrapPlain(t, autoCh());
            // 0.4.4 (Colin): same font size as normal map nodes (pills are sized with it via quickSize).
            const fpx = resolveFontPx(undefined, getLayout().fontSize, getDoc().frontmatter?.fontSize);
            const lh = lineBox(fpx);
            const fa = `font-size="${fpx}" font-family="${LABEL_FONT_FAMILY}"`;
            const tip = locked && r.host.kind === 'sealed' ? `<title>Unlock ${esc(r.host.kid ?? 'key')}</title>` : '';
            // 0.4.10 (Colin): region rows draw tasks with the main Map's glyph and hit target.
            const task = !folded ? b.task ?? null : null;
            // Same lead as a main pill: the checkbox replaces the left pad. A second 12px pad
            // used to sit after TASK_LEAD, so the check hugged the curve and the caption started late.
            const tx = b.x + (task ? TASK_LEAD : PILL_PAD_X);
            const taskSvg = task ? taskLeadSvg(task, { x: b.x, y: b.y, h: b.h, cy, lead: TASK_LEAD }) : '';
            const textY = lines.length <= 1 ? cy + lh * 0.25 : cy + lh * 0.25 - ((lines.length - 1) * lh) / 2;
            // Caption column, as a main pill's data-text-w: the measured width minus the fold slot and the task lead.
            const textW = Math.max(1, Math.round(b.w - slot - (task ? TASK_LEAD : 0)));
            // 0.6.6 (Colin t2560u): a zone node paints its caption through the same rich path as a
            // main pill (multiLineText + richLines), so `code`, bold and italic render inside a
            // secure zone too. Folded / locked pills keep the plain glyph text.
            const rich = measured?.richLines?.length ? measured.richLines : null;
            const textSvg = tip + taskSvg + (rich
              ? multiLineText(lines, tx, cy, textW, rich, fpx, 400)
              : lines.length <= 1
                ? `<text x="${tx}" y="${textY}" ${fa}>${esc(lines[0] ?? t)}</text>`
                : `<text x="${tx}" y="${textY}" ${fa}>${lines.map((l, i) => `<tspan x="${tx}"${i ? ` dy="${lh}"` : ''}>${esc(l)}</tspan>`).join('')}</text>`);
            // 0.6.6 (Colin t2552u): a zone node with a caption link gets the globe, as a main pill does.
            const zoneLinks = node ? captionLinks(node.title || '').filter((l) => !l.pnid) : [];
            const zoneGlobe = zoneLinks.length ? globeGlyphSvg(boxRight - 2, b.y + 8) : '';
            const grip = folded ? '' : widthGripSvg(boxRight, b.y, b.h, textW, regionFocus === b.key || widthHotKey === b.key);
            // 0.5.28: a zone node's own colour paints its body like a main pill (seal chrome keeps its look).
            const zc = node && !folded ? resolveColour(node.color) : null;
            const zcls = zc ? ` has-colour colour-${zc}${node!.colorFill ? ` colour-fill${isSolidColour(zc) ? ' is-solid' : isHighlighter(zc) ? ' is-hl' : isAudroam(zc) ? ' is-au' : ''}` : ''}` : '';
            return `<g class="map-region-node${zcls}${folded ? ' map-region-pill' : ''}${locked && r.host.kind === 'sealed' ? ' map-region-locked' : ''}${b.collapsed ? ' collapsed' : ''}" id="${esc(regionDomId(b.key))}" role="treeitem" aria-selected="false"${b.foldable ? ` aria-expanded="${b.collapsed ? 'false' : 'true'}"` : ''} aria-label="${esc(aria)}" data-scoped-id="${esc(b.key)}" data-region-id="${esc(r.host.id)}" data-text-w="${textW}"><rect class="map-region-body" x="${b.x}" y="${b.y}" width="${Math.max(1, b.w - slot)}" height="${b.h}" rx="${Math.min(14, b.h / 2)}"/>${textSvg}${zoneGlobe}${chrome}${kidChip}${grip}</g>`;
          })
          .join('');
        return cloud + zoneCloudSvg + edges + inner + pills + cloudFold + tools;
      })
      .join('');
  }

  function ensurePositions(): void {
    const layout = getLayout();
    const doc = getDoc();
    if (!layout.nodes) layout.nodes = {};
    // F5a: single-line pills re-measure before anything is sized.
    resolveAutoWidths();

    if (isAutoPack(layout)) {
      // Preserve wrapCh/maxLines nudges across recompute
      const prior = layout.nodes;
      const packed = autoPackPositions(doc, {
        isNodeCollapsed: (id) => isCollapsed(doc, id),
        nodeLayout: prior,
        wrapCh: autoCh(),
        fontSize: resolveFontPx(undefined, layout.fontSize, doc.frontmatter?.fontSize),
        keyOf: vkey,
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
          ...(prev?.wAuto !== undefined ? { wAuto: prev.wAuto } : {}),
        };
      }
      layout.nodes = merged;
      layout.viewBox = packed.viewBox;
      reserveRegions(doc);
      return;
    }
    // Authored sidecar coordinates are never rewritten; regions only reserve room in auto-pack.
    placed = [];

    const vb = layout.viewBox || { w: 1200, h: 960 };
    layout.viewBox = vb;

    const byDepth = new Map<number, OutlineNode[]>();
    walkNodes(doc.nodes, (n, depth) => {
      if (isBlankNode(n) || layout.nodes![vkey(n)]) return;
      if (!byDepth.has(depth)) byDepth.set(depth, []);
      byDepth.get(depth)!.push(n);
    });
    for (const [depth, list] of byDepth) {
      const x = 72 + depth * 280;
      const gap = Math.min(70, (vb.h - 80) / Math.max(1, list.length));
      list.forEach((n, i) => {
        layout.nodes![vkey(n)] = {
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
      const id = g.getAttribute('data-sid');
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

  function tasksEditable(): boolean {
    return allowTaskToggleOpt !== false;
  }

  function applyTaskToggle(id: string): void {
    if (!tasksEditable()) {
      announce('Task toggle is read-only');
      return;
    }
    const doc = getDoc();
    const n = findNode(doc.nodes, id);
    if (!n) {
      // 0.4.7 (Colin QA): region rows are not in the root doc; the box used to do nothing.
      if (parseScopedId(id).region && opts.onRegionTaskToggle?.(id)) {
        onChange?.();
        paint();
      }
      return;
    }
    if (opts.onMainTaskToggle) {
      // 0.5.15: a certain reference (id, path from the shown top row, title), resolved by the
      // text side against the whole note, never by position within the shown subset.
      const viaText = opts.onMainTaskToggle(toRef(id), mapRefOf(doc, n) ?? undefined);
      if (!viaText || !viaText.from || !viaText.to) return;
      const node = { ...n, task: viaText.to };
      onTaskToggle?.({ id: toRef(id), from: viaText.from, to: viaText.to, node });
      if (shouldFireAction(viaText.from, viaText.to)) {
        const action = resolveAction(node);
        if (action) onAction?.({ id: toRef(id), action, node });
      }
      onChange?.();
      paint();
      return;
    }
    // Prefer structured node.task; fall back to title marker rewrite.
    if (n.task) {
      const result = toggleTask(doc, id);
      if (!result) return;
      setDoc(result.doc);
      onTaskToggle?.({
        id: toRef(id),
        from: result.from,
        to: result.to,
        node: result.node,
      });
      if (shouldFireAction(result.from, result.to)) {
        const action = resolveAction(result.node);
        if (action) onAction?.({ id: toRef(id), action, node: result.node });
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
    ...(doc.keys ? { keys: doc.keys } : {}),
    ...(doc.keyring ? { keyring: doc.keyring } : {}),
    ...(doc.sealedOrphans ? { sealedOrphans: { ...doc.sealedOrphans } } : {}),
    };
    patchNodeTitle(nextDoc.nodes, id, nextTitle);
    const nextNode = findNode(nextDoc.nodes, id)!;
    // Also stamp structured fields for consistency
    nextNode.task = to;
    setDoc(nextDoc);
    onTaskToggle?.({ id: toRef(id), from, to, node: nextNode });
    if (shouldFireAction(from, to)) {
      const action = resolveAction(nextNode);
      if (action) onAction?.({ id: toRef(id), action, node: nextNode });
    }
    onChange?.();
  }

  /**
   * Set, add, or remove a task marker through the same paths as a checkbox click
   * (`onMainTaskToggle` / `onRegionTaskToggle` / `setDoc`).
   */
  function applyTaskWrite(id: string, to: TaskState | null): boolean {
    if (!tasksEditable()) return false;
    const doc = getDoc();
    const n = findNode(doc.nodes, id);
    if (!n) {
      if (parseScopedId(id).region && opts.onRegionTaskToggle?.(id, to)) {
        onChange?.();
        paint();
        return true;
      }
      return false;
    }
    const from = n.task ?? resolveTask(n) ?? null;
    if (from === to) return false;
    if (opts.onMainTaskToggle) {
      const viaText = opts.onMainTaskToggle(toRef(id), mapRefOf(doc, n) ?? undefined, to);
      if (!viaText) return false;
      const node = { ...n } as OutlineNode;
      if (viaText.to) node.task = viaText.to;
      else delete node.task;
      if (viaText.from && viaText.to) {
        onTaskToggle?.({ id: toRef(id), from: viaText.from, to: viaText.to, node });
        if (shouldFireAction(viaText.from, viaText.to)) {
          const action = resolveAction(node);
          if (action) onAction?.({ id: toRef(id), action, node });
        }
      }
      onChange?.();
      paint();
      return true;
    }
    if (n.task || from == null) {
      const result = setTask(doc, toRef(id), to);
      if (!result) return false;
      setDoc(result.doc);
      if (result.from && result.to) {
        onTaskToggle?.({
          id: toRef(id),
          from: result.from,
          to: result.to,
          node: result.node,
        });
        if (shouldFireAction(result.from, result.to)) {
          const action = resolveAction(result.node);
          if (action) onAction?.({ id: toRef(id), action, node: result.node });
        }
      }
      onChange?.();
      paint();
      return true;
    }
    const nextTitle = to == null
      ? (parseLeadingTask(n.title)?.label ?? n.title)
      : toggleTaskMarker(n.title, to);
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
    ...(doc.keys ? { keys: doc.keys } : {}),
    ...(doc.keyring ? { keyring: doc.keyring } : {}),
    ...(doc.sealedOrphans ? { sealedOrphans: { ...doc.sealedOrphans } } : {}),
    };
    patchNodeTitle(nextDoc.nodes, id, nextTitle);
    const nextNode = findNode(nextDoc.nodes, id)!;
    if (to == null) delete nextNode.task;
    else nextNode.task = to;
    setDoc(nextDoc);
    onChange?.();
    paint();
    return true;
  }

  function applyTaskKey(): boolean {
    const id = regionFocus || getFocusId();
    if (!id) return false;
    const n = resolveFocusedTaskNode(id);
    if (n && timeLeafKind(n)) return true;
    if (!tasksEditable()) {
      announce('Task toggle is read-only');
      return true;
    }
    if (!n) {
      if (parseScopedId(id).region) announce('Sealed branch is locked');
      return !!parseScopedId(id).region;
    }
    rememberTaskCycleOrigin(id);
    const from = resolveTask(n) ?? null;
    const to = nextTaskCycle(from, !!taskCycleOrigin?.includeNone);
    if (from === to) return true;
    if (!applyTaskWrite(id, to)) return true;
    announce(
      to === null ? 'Task removed' : to === 'done' ? 'Task done' : to === 'pending' ? 'Task pending' : 'Task open',
    );
    return true;
  }

  /**
   * One activation of a pill or one of its in-map handles (fold, task box,
   * body more/less, globe, `#N` chip, thread chip). Mouse and keyboard reach
   * this from the node's `click`; touch and pen reach it from `pointerup`
   * (0.2.30), because the browser can drop the click after a fling.
   */
  function activateNodeHit(g: Element, t: Element | null, e: Event): void {
    const id = g.getAttribute('data-sid');
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
    if (t?.closest?.('.map-jump-hit')) {
      // `<r:x>`: select and pan to that node, as a hop row does. A broken one is inert.
      e.preventDefault();
      const target = (t.closest('.map-jump-hit') as Element).getAttribute('data-jump') || '';
      // `<r:REGION:N>` / `<r:s:x>`: reveal through regions (stops at a sealed root, which asks
      // to unlock) and move focus + camera there; emits focusChange like any Map focus move.
      if (!findNode(getDoc().nodes, target) && isRegionTarget(target)) handle.setFocus(target);
      else jumpTo(target, id);
      return;
    }
    if (t?.closest?.('.map-note-link-hit')) {
      const hit = t.closest('.map-note-link-hit') as Element;
      const me = e as MouseEvent;
      if (e.type === 'click' && (me.ctrlKey || me.metaKey || me.shiftKey)) {
        // Modifier click: the SVG anchor opens its own tab, as before.
        const pnid = hit.getAttribute('data-note-link') || '';
        const n = findNode(getDoc().nodes, id);
        if (n && pnid) onNoteLink?.({ id: toRef(id), pnid, node: n });
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

  // 0.5.26: stored `:code:` labels show as emoji once the table loads (display only).
  void loadEmojiData().then(() => { try { paint(); } catch { /* destroyed */ } });
  function paint(): void {
    codeMemo = null;
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
    const edges: { d: string; timeLeaf?: boolean; colour?: string | null }[] = [];
    /** 0.5.20 branch colour per node: nearest coloured ancestor (or self) wins. */
    const branchColour = new Map<OutlineNode, { c: string; fill: boolean }>();
    type NodePaint = {
      thumb?: PillSize['thumb'];
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
      timeLeaf: TimeLeafKind | null;
    };
    const nodes: NodePaint[] = [];

    const anchors = unlockedAnchorKeys();
    function walk(n: OutlineNode, inherited: { c: string; fill: boolean } | null = null, inheritedCode = false): void {
      // A blank `- ` line is not drawn until it has content; its view key is kept (0.6.6).
      if (isBlankNode(n)) return;
      const own = resolveColour(n.color);
      const bc = own ? { c: own, fill: !!n.colorFill } : inherited && n.noFill ? { c: inherited.c, fill: false } : inherited;
      if (bc) branchColour.set(n, bc);
      const key = vkey(n);
      const pos = layout.nodes![key] || { x: 100, y: 100 };
      // Follow the parent the way branch colour does. A fresh parse on each
      // getDoc() call is a different object, so the memo alone would drop the child.
      const code = showsAsCode(n, inheritedCode);
      const shown = displayCaption(n.title);
      const label = anchorCaption(key, withNodeIcon(n, code ? shown : captionWithoutLinks(shown)), anchors);
      const foldable = hasKids(n);
      const col = foldable && !!n.id && isCollapsed(doc, n.id);
      const taskParsed = resolveTask(n);
      const timeLeaf = timeLeafKind(n);
      const size = pillSize(label, timeLeafPaintOpts(n, pos, layout.fontSize, doc.frontmatter?.fontSize, doc, code) ?? {
        reserveFold: foldable,
        reserveTask: !!taskParsed,
        semibold: false,
        wrapCh: pos.wrapCh ?? autoCh(),
        widthPx: pos.w ?? n.layout?.w,
        maxLines: pos.maxLines,
        bodyExpanded: !!pos.bodyExpanded,
        fontSize: resolveFontPx(pos.fontSize, layout.fontSize, doc.frontmatter?.fontSize),
        ...nodeChips(n, doc, code),
        code,
      });
      const cue = !timeLeaf && isCue(n);
      const thread = resolveThread(n);
      const chips = mapChipPieces(nodeChips(n, doc));
      nodes.push({
        n,
        key,
        pos,
        label: timeLeaf ? timeLeafCaption(label) : label,
        w: size.w,
        h: size.h,
        textW: size.textW,
        foldSlot: size.foldSlot,
        taskLead: size.taskLead,
        lines: size.lines,
        richLines: size.richLines,
        truncated: size.truncated,
        fullText: timeLeaf ? label : size.fullText || n.title,
        foldable,
        col,
        cue,
        // A time leaf is a record, not a task: no checkbox (TL6).
        task: timeLeaf ? null : taskParsed ?? null,
        thread,
        chips,
        showMore: size.showMore,
        showLess: size.showLess,
        bodyExpanded: size.bodyExpanded,
        fontPx: size.fontPx,
        timeLeaf,
        thumb: size.thumb,
      });

      if (foldable && !col) {
        for (const c of n.children!) {
          if (isBlankNode(c)) continue;
          const cKey = vkey(c);
          const cpos = layout.nodes![cKey] || { x: pos.x + 200, y: pos.y };
          const childCode = showsAsCode(c, code);
          const cShown = displayCaption(c.title);
          const clabel = anchorCaption(cKey, withNodeIcon(c, childCode ? cShown : captionWithoutLinks(cShown)), anchors);
          const cTask = resolveTask(c);
          const cs = pillSize(clabel, timeLeafPaintOpts(c, cpos, layout.fontSize, doc.frontmatter?.fontSize, doc, childCode) ?? {
            reserveFold: hasKids(c),
            reserveTask: !!cTask,
            semibold: false,
            wrapCh: cpos.wrapCh ?? autoCh(),
            widthPx: cpos.w ?? c.layout?.w,
            maxLines: cpos.maxLines,
            bodyExpanded: !!cpos.bodyExpanded,
            fontSize: resolveFontPx(cpos.fontSize, layout.fontSize, doc.frontmatter?.fontSize),
            ...nodeChips(c, doc, childCode),
            code: childCode,
          });
          // Starts past the fold handle, not under it.
          edges.push({
            d: childConnectorPath(
              { x: pos.x, y: pos.y, w: size.w, foldSlot: size.foldSlot },
              { x: cpos.x, y: cpos.y, w: cs.w },
            ),
            timeLeaf: !!timeLeafKind(c),
            colour: resolveColour(c.color) ?? bc?.c ?? null,
          });
          walk(c, bc, code);
        }
      }
    }
    for (const root of doc.nodes) walk(root);

    // H8: when the host sets --connector-casing, every casing goes under every line.
    const casing = connectorCasingOn();
    const edgeSvg =
      (casing ? edges.map((e) => mapEdgeCasingSvg(e.d)).join('') : '') +
      edges.map((e) => mapEdgeSvg(e.d, { timeLeaf: e.timeLeaf, colour: e.colour })).join('');
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
          timeLeaf,
          thumb,
        }) => {
          const x = pos.x - w / 2;
          const y = pos.y - h / 2;
          const textLeft = x + taskLead;
          const textX = textLeft + textW / 2;
          const boxW = Math.max(1, w - foldSlot);
          const boxRight = x + boxW;
          const affordance = showMore || showLess ? MORE_AFFORDANCE_H : 0;
          // 0.5.21: a thumbnail sits above the caption; the caption block moves down.
          const thumbDrop = thumb ? (thumb.h + THUMB_INSET) / 2 : 0;
          const textCentreY = pos.y - affordance / 2 + thumbDrop;
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
            timeLeaf,
            color: branchColour.get(n)?.c,
            colorFill: branchColour.get(n)?.fill,
          });
          const colourName = !timeLeaf ? resolveColour(branchColour.get(n)?.c) : null;
          const foldCx = foldHandleGeometry(boxRight, foldSlot).cx;
          const foldHit = foldable
            ? `<rect class="map-fold-hit" x="${foldCx - 16}" y="${pos.y - 16}" width="32" height="32" fill="transparent" cursor="pointer"/>`
            : '';
          const hiddenCount = col ? n.children?.length ?? 0 : 0;
          const foldChrome = foldable
            ? foldChromeSvg(boxRight, pos.y, !!col, foldSlot, { casing, hiddenCount })
            : '';
          // 0.4.12: shared with region pills (taskLeadSvg); y anchor is the pill centre.
          const taskLead0 = task != null ? taskLeadSvg(task, { x, y, h, cy: textCentreY, hitCy: pos.y, lead: taskLead }) : '';
          const tip = fullText || label;
          const bodyAction = showMore ? 'more' : showLess ? 'less' : '';
          const moreChrome = bodyAction
            ? `<g class="map-body-more-hit" data-body-action="${bodyAction}" transform="translate(${textX} ${y + h - 8})" cursor="pointer">
            <rect x="-28" y="-10" width="56" height="16" rx="8" fill="transparent"/>
            <text text-anchor="middle" y="3" fill="#8b9bab" font-size="11">${bodyAction}</text>
          </g>`
            : '';
          const links = captionLinks(n.title || '').filter((l) => !l.pnid);
          // In the top-right corner, top of the glyph flush with the pill
          // top so it does not sit in the gap above the node.
          const globe =
            links.length > 0
              ? globeGlyphSvg(boxRight - 2, y + 8)
              : '';
          const captionX = timeLeaf
            ? x + timeLeafPadLeft(fontPx)
            : task != null
              ? textLeft
              : x + PILL_PAD_X;
          // TL3: the kind letter, bold green, named for assistive tech.
          const kindLetter = timeLeaf
            ? `<text class="map-kind-letter" x="${x + TIME_LEAF_PAD_X}" y="${textCentreY + lineBox(fontPx) / 4}" text-anchor="start" font-size="${fontPx}" font-weight="400" font-family="${LABEL_FONT_FAMILY}" role="img" aria-label="${TIME_LEAF_NAME[timeLeaf]}">${TIME_LEAF_LETTER[timeLeaf]}</text>`
            : '';
          const widest = richLines.reduce(
            (max, line) => Math.max(max, lineWidth(line, fontPx, false)),
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
              if (piece.kind === 'jump') {
                const ok = !!findNode(doc.nodes, piece.id) || isRegionTarget(piece.id);
                const g = `<g class="map-jump-hit${ok ? '' : ' is-broken'}" data-jump="${esc(piece.id)}"${ok ? '' : ' aria-disabled="true"'} transform="translate(${at} ${textCentreY})" cursor="${ok ? 'pointer' : 'default'}">
            <title>${esc(piece.id)}</title>
            <rect x="0" y="-11" width="${piece.w}" height="20" fill="transparent"/>
            <text class="map-jump-link" text-anchor="start" y="4">${esc(piece.label)}</text>
          </g>`;
                // The anchor makes it focusable (Enter / Space); the click never follows the hash.
                return ok ? `<a href="#id:${esc(piece.id)}">${g}</a>` : g;
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
          return `<g class="${cls}" id="${esc(mapNodeDomId(domPrefix, key))}" data-id="${esc(toRef(key))}" data-sid="${esc(key)}" data-text-w="${textW}"
      role="treeitem" aria-selected="${focused ? 'true' : 'false'}" aria-current="${focused ? 'true' : 'false'}" aria-label="${esc(timeLeaf ? timeLeafAriaLabel(timeLeaf, label) : label)}${colourName ? `, ${colourLabel(colourName, paletteName).toLowerCase()}` : ''}${task != null ? (task === 'done' ? ', task done' : task === 'pending' ? ', task pending' : ', task open') : ''}${foldable ? (col ? `, collapsed, ${foldCountLabel(hiddenCount)}` : ', expanded') : ''}${showMore ? ', more text available' : ''}${showLess ? ', showing full body' : ''}"
      ${foldable ? `aria-expanded="${col ? 'false' : 'true'}" aria-haspopup="menu"` : ''}${levelMenu && levelMenu.id === key ? ' data-level-open="true"' : ''}>
      <title>${esc(tip)}</title>
      ${colourName ? `<rect class="map-colour-ring" x="${x - 4}" y="${y - 4}" width="${boxW + 8}" height="${h + 8}" rx="22" ry="22"/>` : ''}<rect class="map-pill" x="${x}" y="${y}" width="${boxW}" height="${h}" rx="18" ry="18"/>
      ${taskLead0}
      ${globe}
      ${kindLetter}
      ${timeLeaf ? timeLeafDots(multiLineText(lines, captionX, textCentreY, textW, richLines, fontPx, 400)) : multiLineText(lines, captionX, textCentreY, textW, richLines, fontPx, 400)}
      ${moreChrome}
      ${chipSvg}
      ${foldChrome}
      ${foldHit}
      ${thumb ? thumbSvg(key, thumb, x, y, boxW) : ''}
      ${timeLeaf ? '' : thumb ? (imagesEditable() && focused ? thumbFrameSvg(x, y, boxW, h, textW) : '') : widthGripSvg(boxRight, y, h, textW, widthShown)}
    </g>`;
        },
      )
      .join('');

    // Overlays that live inside the host (resize popover, controls a host put
    // in the map) survive the SVG rewrite (0.2.30).
    const overlays = Array.from(host.children).filter((el) =>
      el.matches?.(
        '.map-width-pop, .of-map-controls, .map-level-menu, .map-level-ring, .map-live, .map-link-pop, .map-toast, .map-node-menu, .map-node-menu-backdrop, .of-colour-palette, .map-node-ring, .map-copied',
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
    const nodeMenuFocus =
      nodeMenu && typeof document !== 'undefined'
        ? nodeMenu.items.indexOf(document.activeElement as HTMLElement)
        : -1;
    // 0.5.18 user clouds (EP-38…41): live angled hulls over the visible pills of each
    // cloud's subtree (a folded branch shrinks to its pill), outer first so inner clouds
    // (inset 6px) paint above; sealed / record regions paint above every cloud.
    const cloudItems: { svg: string; depth: number }[] = [];
    const walkC = (list: OutlineNode[] | undefined, depth: number) => {
      for (const n of list ?? []) {
        let d = depth;
        if (n.cloud) {
          // 0.6.6: the subtree by view key, so a line with no id can carry a cloud too.
          const ids = new Set<string>();
          const walkI = (m: OutlineNode) => { ids.add(vkey(m)); m.children?.forEach(walkI); };
          walkI(n);
          const pts = cloudHull(
            nodes.filter((p) => ids.has(p.key)).map((p) => ({ x: p.pos.x - p.w / 2, y: p.pos.y - p.h / 2, w: p.w, h: p.h })),
            cloudPad(depth),
          );
          if (pts) cloudItems.push({ svg: cloudSvg({ rootId: toRef(vkey(n)), color: resolveColour(n.cloud) ?? branchColour.get(n)?.c ?? n.cloud, depth }, pts), depth });
          d = depth + 1;
        }
        walkC(n.children, d);
      }
    };
    walkC(doc.nodes, 0);
    const cloudLayer = cloudItems.sort((a, b) => a.depth - b.depth).map((c) => c.svg).join('');
    const regionLayer = (opts.getRegions?.() ?? [])
      .map((rg) => {
        const root = findNode(doc.nodes, rg.rootId);
        if (!root) return '';
        const ids = new Set<string>();
        const walkR = (n: OutlineNode) => { ids.add(vkey(n)); n.children?.forEach(walkR); };
        walkR(root);
        const hull = regionHull(
          nodes.filter((p) => ids.has(p.key)).map((p) => ({ x: p.pos.x - p.w / 2, y: p.pos.y - p.h / 2, w: p.w, h: p.h })),
        );
        return hull ? regionSvg(rg, hull) : '';
      })
      .join('') + regionCloudSvg();
    host.innerHTML = `<svg class="map-svg" viewBox="0 0 ${Math.max(1, host.clientWidth || 1180)} ${Math.max(1, host.clientHeight || 520)}"
      preserveAspectRatio="xMidYMid meet" role="none" focusable="false">
      <rect width="100%" height="100%" fill="var(--map-bg)"/>
      <g id="mapViewport">
        <rect x="0" y="0" width="${vb.w}" height="${vb.h}" fill="var(--map-bg)" opacity="0"/>
        ${cloudLayer}
        ${regionLayer}
        ${edgeSvg}
        ${nodeSvg}
      </g>
    </svg>`;
    for (const el of overlays) host.appendChild(el);
    if (nodeMenu) nodeEl(nodeMenu.key)?.setAttribute('data-node-menu-open', 'true');
    if (nodeMenu && nodeMenuFocus >= 0) {
      try {
        nodeMenu.items[nodeMenuFocus]?.focus({ preventScroll: true });
      } catch {
        /* focus not available */
      }
    }
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
        const hx = la.at === 'pill-left' ? left : foldHandleGeometry(boxRight, np.foldSlot).cx;
        const old = { x: cam.x, y: cam.y };
        cam.x = la.sx - hx * cam.k;
        cam.y = la.sy - np.pos.y * cam.k;
        if (la.expand) {
          const below = new Set<string>();
          const anchorNode = findNode(doc.nodes, la.id);
          const walkBelow = (n: OutlineNode) => {
            if (n.id && isCollapsed(doc, n.id)) return;
            for (const c of n.children || []) {
              below.add(vkey(c));
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
        } else if (la.at === 'pill-left') {
          // F9: keep-visible for the pressed pill only (L10 follow rules).
          const pill = {
            x: left * cam.k + cam.x,
            y: (np.pos.y - np.h / 2) * cam.k + cam.y,
            w: np.w * cam.k,
            h: np.h * cam.k,
          };
          const shift = levelKeepVisibleShift({
            viewport: hostViewport(),
            anchor: { x: pill.x, y: pill.y, w: 1, h: pill.h },
            shown: pill,
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
    if (regionFocus) syncRegionFocus();
    // Unlocked sealed anchors: tint the parent pill green.
    for (const g of host.querySelectorAll('.map-node.is-unlocked-anchor')) g.classList.remove('is-unlocked-anchor');
    for (const r of placed) {
      if (r.host.kind !== 'sealed' || !r.host.doc || r.host.parent) continue;
      host.querySelector(`.map-node[data-sid="${CSS.escape(toKey(r.host.anchor))}"]`)?.classList.add('is-unlocked-anchor');
    }
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
      keyOf: vkey,
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
    /**
     * 0.2.44 arbiter: start, last point and path length (client px) of every
     * press, so each handler asks altDragCommits (distance AND direction)
     * before it pans, drags, resizes or cancels a hold. Jitter is not a drag.
     */
    const track = new Map<number, { sx: number; sy: number; x: number; y: number; path: number; type: string }>();
    function trackDown(e: PointerEvent): void {
      track.set(e.pointerId, { sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, path: 0, type: e.pointerType || 'mouse' });
    }
    function trackMove(e: PointerEvent): void {
      const t = track.get(e.pointerId);
      if (!t) return;
      t.path += Math.hypot(e.clientX - t.x, e.clientY - t.y);
      t.x = e.clientX;
      t.y = e.clientY;
    }
    /** Whether this press has committed to a drag (shared arbiter). */
    function committed(pointerId: number, type?: string): boolean {
      const t = track.get(pointerId);
      if (!t) return false;
      return altDragCommits({ dx: t.x - t.sx, dy: t.y - t.sy, path: t.path, pointerType: type ?? t.type });
    }
    let mode: 'idle' | 'pending' | 'pan' | 'pinch' = 'idle';
    let widthDrag: {
      pointerId: number;
      key: string;
      startX: number;
      /** 0.2.43: for the drag threshold. */
      startY?: number;
      startW: number;
      moved: boolean;
      /** Width before the drag, for its undo step (F7). */
      before: WidthEntry;
      idState: WidthIdState;
    } | null = null;

    const MIN_COL = 120;
    const MAX_COL = 1400;

    function dragStart(key: string): { before: WidthEntry; idState: WidthIdState } {
      const n = nodeByKey(key);
      return { before: readWidth(key, n), idState: idStateOf(n) };
    }

    function applyWidth(key: string, w: number): void {
      // 0.5.21: a thumbnail node's handle clamps to 120–480 (T13).
      const clamped = nodeByKey(key)?.img ? clampThumbWidth(w) : Math.max(MIN_COL, Math.min(MAX_COL, Math.round(w)));
      const node = regionWidthTarget(key);
      if (node) {
        resizingWidthKey = key;
        regionWidthLive.set(node, clamped);
        paint();
        return;
      }
      const layout = getLayout();
      if (!layout.nodes) layout.nodes = {};
      resizingWidthKey = key;
      const prev = layout.nodes[key] || { x: 100, y: 100 };
      layout.nodes[key] = { ...prev, w: clamped };
    }

    /** A finished drag is one undo step (F7, no toast). 0.2.43: a 1-line pill keeps its 1-line flag. */
    function commitWidth(): void {
      const drag = widthDrag;
      widthDrag = null;
      resizingWidthKey = null;
      if (!drag) return;
      if (commitRegionWidth(drag.key)) return;
      const w = getLayout().nodes?.[drag.key]?.w;
      if (typeof w !== 'number' || w <= 0) return;
      commitWidthStep(
        'drag',
        drag.key,
        [{ key: drag.key, before: drag.before, after: dragEntry(drag.before, w), idState: drag.idState }],
        { toast: false },
      );
    }

    /**
     * Unstick (6 Nov 2026): end any width gesture that did not see its own
     * pointerup (capture lost, release outside the window, a menu pick or a
     * paint in between). A moved drag commits; a still press just clears.
     * Without this, `widthDrag` / `resizingWidthKey` / `widthHotKey` stayed
     * on the old pill: hover never re-armed (it is gated on `!widthDrag`) so
     * the old corner kept the live grip and a sibling's corner could not start.
     */
    function releaseWidthGesture(): void {
      const drag = widthDrag;
      if (drag?.moved) commitWidth();
      widthDrag = null;
      resizingWidthKey = null;
      edgeArm = null;
      clearWidthHold();
      showWidthHot(null);
    }

    /** 0.2.43: the width each pill's last Wide pick wrote, to mark Wide while it still matches. */
    const wideW = new Map<string, number>();
    let widthPopAbort: AbortController | null = null;

    function dismissWidthPop(): void {
      widthPopAbort?.abort();
      widthPopAbort = null;
      host.querySelector('.map-width-pop')?.remove();
    }
    dismissWidthPopHook = dismissWidthPop;

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
      const maxLeft = Math.max(inset, hr.width - pw - inset);
      const maxTop = Math.max(inset, hr.height - ph - inset);
      let left = Math.min(maxLeft, Math.max(inset, ax - pw + 16));
      let top: number;
      // 0.2.43: never under the finger. Above, else below, else beside the
      // touch point; when nothing fits, the roomier side scrolls.
      const spaceAbove = ay - gap - inset;
      const spaceBelow = hr.height - inset - (ay + gap);
      if (ph <= spaceAbove) top = ay - gap - ph;
      else if (ph <= spaceBelow) top = ay + gap;
      else if (ph <= hr.height - 2 * inset && (ax - gap - pw >= inset || ax + gap + pw <= hr.width - inset)) {
        top = Math.min(maxTop, Math.max(inset, ay - ph / 2));
        left = ax - gap - pw >= inset ? ax - gap - pw : ax + gap;
      } else {
        const above = spaceAbove >= spaceBelow;
        const room = Math.max(48, above ? spaceAbove : spaceBelow);
        pop.style.maxHeight = `${Math.floor(room)}px`;
        pop.style.overflowY = 'auto';
        top = above ? ay - gap - Math.min(ph, room) : ay + gap;
      }
      pop.style.left = `${Math.round(left)}px`;
      pop.style.top = `${Math.round(top)}px`;
    }

    type WidthItem = {
      kind: WidthPickKind;
      label: string;
      choice: string;
      /** `menuitem` for actions on other nodes (F12). */
      radio: boolean;
      w?: number;
      /** 0.2.43: map-wide Auto width choice (row "Auto width"). */
      autoWidth?: string;
    };

    /** 0.2.43: set what Auto means for the whole map (`autoWidth:` in the layout block). */
    function setAutoWidth(v: string): void {
      const doc = getDoc();
      const fm = { ...(doc.frontmatter || {}) };
      if (v === '32ch') delete fm.autoWidth;
      else fm.autoWidth = v;
      setDoc({ ...doc, frontmatter: fm });
      announce(`Auto width ${v === 'fit-view' ? 'fits the view' : v}.`);
      paint();
      onChange?.();
    }

    /** Which item carries ✓ for this pill (one at most). */
    function checkedWidthKind(key: string): WidthPickKind | null {
      const n = regionWidthTarget(key) ?? nodeByKey(key);
      if (!n) return null;
      const cur = readWidth(key, n);
      if (cur.w == null) return 'auto';
      if (isSingleLineMode(cur.wAuto)) return 'line';
      if (wideW.get(key) === cur.w) return 'wide';
      const m = fitMeasure(n, key);
      const fit = fitTextEntry({ fit: fitTextWidth(m.label, m.opts), auto: autoTextWidth(m.label, m.opts) });
      if (fit.w != null && Math.abs(cur.w - fit.w) <= 1) return 'fit';
      // Wide: the column already sits at min(one line, cap).
      const wideTarget = Math.min(currentSingleLineCap(), Math.ceil(naturalLineWidth(m.label, m.opts)));
      if (Math.abs(cur.w - wideTarget) <= 1) return 'wide';
      return null;
    }

    /**
     * The width popover (F3, P1 on tap and `w`): Fit (Fit text · 1 line), Width
     * (Wide · Auto), Copy to (siblings · all at this level), Auto width. One
     * pick = one batched write and one undo step; the panel stays open.
     */
    function showWidthPop(
      clientX: number,
      clientY: number,
      key: string,
      textW: number,
      how: { keyboard?: boolean; coarse?: boolean } = {},
    ): void {
      dismissWidthPop();
      closeLevelMenu(false);
      dismissLinkPop(false);
      const ac = new AbortController();
      widthPopAbort = ac;
      const coarse =
        how.coarse ??
        (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
      const pop = document.createElement('div');
      pop.className = 'map-width-pop';
      pop.setAttribute('role', 'menu');
      pop.setAttribute('aria-label', 'Pill width');
      pop.dataset.key = key;
      pop.style.cssText = [
        'position:absolute',
        'z-index:6',
        `max-width:${Math.max(160, Math.floor((host.clientWidth || 9999) - 16))}px`,
        'box-sizing:border-box',
        'display:flex',
        'flex-direction:column',
        'gap:6px',
        'padding:6px',
        'border-radius:10px',
        'background:#13202b',
        'border:1px solid #3d5a73',
        'box-shadow:0 8px 24px rgba(0,0,0,.35)',
        'touch-action:manipulation',
        '-webkit-touch-callout:none',
        'user-select:none',
      ].join(';');
      const rows: { label: string; items: WidthItem[] }[] = [
        {
          label: 'Fit',
          items: [
            { kind: 'fit', label: 'Fit text', choice: 'fit-text', radio: true },
            { kind: 'line', label: '1 line', choice: 'line', radio: true },
          ],
        },
        {
          label: 'Width',
          items: [
            { kind: 'wide', label: 'Wide', choice: 'wide', radio: true },
            { kind: 'auto', label: 'Auto', choice: 'auto', radio: true },
          ],
        },
        {
          // Step 2 (6 Nov 2026): copy this node's width, whatever it is, to others.
          label: 'Copy to',
          items: [
            { kind: 'siblings', label: 'Copy to: siblings', choice: 'siblings', radio: false },
            { kind: 'level', label: 'Copy to: all at this level', choice: 'level', radio: false },
          ],
        },
        {
          label: 'Auto width',
          items: AUTO_WIDTH_CHOICES.map((v) => ({
            kind: 'auto' as WidthPickKind,
            label: v === 'fit-view' ? 'Auto: fit view' : `Auto: ${v}`,
            choice: `auto-width-${v}`,
            radio: false,
            autoWidth: v,
          })),
        },
      ];
      const curAutoWidth = getDoc().frontmatter?.autoWidth || '32ch';
      const checkedKind = checkedWidthKind(key);
      const buttons: HTMLButtonElement[] = [];
      const kinds: WidthPickKind[] = [];
      const pick = (item: WidthItem, ev?: Event) => {
        const hadFocus = pop.contains(document.activeElement);
        // Stay open (6 Nov 2026): a pick applies and refreshes the panel in
        // place; only click-away or Escape closes it.
        const left = pop.style.left;
        const top = pop.style.top;
        const refresh = () => {
          if (widthPopAbort !== ac) return;
          showWidthPop(clientX, clientY, key, textW, how);
          const next = host.querySelector<HTMLElement>('.map-width-pop');
          if (!next) return;
          next.style.left = left;
          next.style.top = top;
          if (hadFocus) {
            try {
              next.querySelector<HTMLElement>(`[data-choice="${item.choice}"]`)?.focus({ preventScroll: true });
            } catch {
              /* focus not available */
            }
          }
        };
        if (ev?.type === 'pointerup') {
          // The rebuilt panel replaces this button; its trailing click must not
          // land on whatever is drawn under the finger next.
          const pe = ev as PointerEvent;
          swallow = armSwallow(performance.now(), pe.clientX, pe.clientY);
        }
        if (item.autoWidth) {
          setAutoWidth(item.autoWidth);
          refresh();
          return;
        }
        applyWidthPick(key, item.kind);
        if (item.kind === 'wide') {
          const node = regionWidthTarget(key) ?? nodeByKey(key);
          const w = node ? readWidth(key, node).w : null;
          if (w != null) wideW.set(key, w);
          else wideW.delete(key);
        }
        refresh();
      };
      for (const row of rows) {
        const group = document.createElement('div');
        group.className = 'map-width-row';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', row.label);
        group.dataset.row = row.label.toLowerCase();
        // 0.2.42: four Fit items; a narrow map wraps the row instead of overflowing.
        group.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
        for (const item of row.items) {
          const btn = document.createElement('button');
          btn.type = 'button';
          const checked = item.autoWidth ? item.autoWidth === curAutoWidth : item.radio && item.kind === checkedKind;
          btn.setAttribute('role', item.radio ? 'menuitemradio' : 'menuitem');
          if (item.radio) btn.setAttribute('aria-checked', checked ? 'true' : 'false');
          btn.dataset.choice = item.choice;
          const hint = item.autoWidth ? undefined : WIDTH_MENU_KEYS[item.kind];
          if (hint) btn.setAttribute('aria-keyshortcuts', hint);
          const text = document.createElement('span');
          text.className = 'map-width-label';
          text.textContent = checked ? `✓ ${item.label}` : item.label;
          btn.appendChild(text);
          if (hint && how.keyboard) {
            // Key hints only when the menu came from the keyboard (F13: no on-page copy).
            const k = document.createElement('kbd');
            k.className = 'map-width-key';
            k.setAttribute('aria-hidden', 'true');
            k.textContent = hint;
            k.style.cssText = 'margin-left:6px;opacity:.7;font:12px/1 ui-monospace,monospace';
            btn.appendChild(k);
          }
          btn.style.cssText = [
            coarse ? 'min-height:52px' : 'min-height:32px',
            coarse ? 'min-width:46px' : 'min-width:32px',
            coarse ? 'padding:0 14px' : 'padding:0 10px',
            'border-radius:8px',
            `border:1px solid ${checked ? '#8ec8ff' : '#3d5a73'}`,
            `background:${checked ? '#24425e' : '#1b3044'}`,
            'color:#e7ecf1',
            `font:${coarse ? 15 : 14}px/1 system-ui,sans-serif`,
            'white-space:nowrap',
            'cursor:pointer',
            'touch-action:manipulation',
          ].join(';');
          bindTap(
            btn,
            (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              pick(item, ev);
            },
            { signal: ac.signal },
          );
          buttons.push(btn);
          kinds.push(item.kind);
          group.appendChild(btn);
        }
        pop.appendChild(group);
      }
      // Keys stay inside the menu: Enter / Space must not reach the host's
      // fold keys, arrows move between items (one flat order across both
      // rows), the mnemonics t / l / s / a pick, Esc closes.
      pop.addEventListener(
        'keydown',
        (e) => {
          const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const mnemonic = !e.ctrlKey && !e.metaKey && !e.altKey ? widthMenuKeyItem(e.key) : null;
          if (mnemonic) {
            e.preventDefault();
            e.stopPropagation();
            const at = kinds.indexOf(mnemonic);
            const row = rows.flatMap((r) => r.items)[at];
            if (row) pick(row);
            return;
          }
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
      // Click-away anywhere outside the panel closes it (inside the map the
      // host's own pointerdown already does).
      document.addEventListener(
        'pointerdown',
        (e) => {
          const t = e.target as Node | null;
          if (t && (pop.contains(t) || host.contains(t))) return;
          dismissWidthPop();
        },
        { capture: true, signal: ac.signal },
      );
      const hostStyle = getComputedStyle(host);
      if (hostStyle.position === 'static') host.style.position = 'relative';
      host.appendChild(pop);
      placeWidthPop(pop, clientX, clientY);
      if (how.keyboard) {
        const at = checkedKind ? kinds.indexOf(checkedKind) : 0;
        try {
          buttons[Math.max(0, at)]?.focus({ preventScroll: true });
        } catch {
          /* focus not available */
        }
      }
    }

    openWidthPopHook = (key, how) => {
      // TL1: no width popover on a time leaf (`w` does nothing there).
      if (timeLeafKind(nodeByKey(key))) return false;
      const g = nodeEl(key);
      const pill = g?.querySelector('.map-pill, .map-region-body');
      if (!g || !pill) return false;
      const r = pill.getBoundingClientRect();
      const textW = Number(g.getAttribute('data-text-w')) || MIN_COL;
      showWidthPop(r.right, r.bottom, key, textW, { keyboard: !!how.keyboard });
      return true;
    };

    let edgeArm: {
      pointerId: number;
      key: string;
      startX: number;
      startY: number;
      startW: number;
    } | null = null;
    /**
     * 0.2.44 width corner hold (touch, pen): a still press of ALT_HOLD_MS on
     * the corner opens the width menu; moving past the slop first cancels it
     * (the press is then a resize). A tap / click on the corner opens nothing.
     */
    let widthHoldTimer = 0;
    /** The pointer whose corner hold opened the width menu: its lift is swallowed. */
    let widthHoldOpened: number | null = null;
    function clearWidthHold(): void {
      if (widthHoldTimer) window.clearTimeout(widthHoldTimer);
      widthHoldTimer = 0;
    }
    function beginWidthHold(pointerId: number, key: string, x: number, y: number, startW: number): void {
      clearWidthHold();
      widthHoldTimer = window.setTimeout(() => {
        widthHoldTimer = 0;
        const stillArm = edgeArm?.pointerId === pointerId;
        const stillDrag = widthDrag?.pointerId === pointerId && !widthDrag.moved;
        if (!stillArm && !stillDrag) return;
        edgeArm = null;
        if (stillDrag) widthDrag = null;
        resizingWidthKey = null;
        widthHoldOpened = pointerId;
        try {
          navigator.vibrate?.(10);
        } catch {
          /* vibrate not allowed */
        }
        showWidthPop(x, y, key, startW, { coarse: true });
      }, ALT_HOLD_MS);
    }

    function rightEdgeKey(
      clientX: number,
      clientY: number,
      slop: number,
    ): { key: string; textW: number } | null {
      let best: { key: string; textW: number } | null = null;
      let bestDx = slop + 1;
      host.querySelectorAll<SVGGElement>('.map-node:not(.time-leaf), .map-region-node:not(.map-region-root):not(.map-region-pill):not(.map-region-locked)').forEach((g) => {
        const pill = g.querySelector('.map-pill, .map-region-body');
        if (!pill) return;
        const r = pill.getBoundingClientRect();
        if (clientY < r.bottom - 14 || clientY > r.bottom + slop) return;
        if (clientX < r.right - 12 || clientX > r.right + slop) return;
        const dx = Math.abs(clientX - r.right) + Math.abs(clientY - r.bottom);
        if (dx >= bestDx) return;
        const key = g.getAttribute('data-sid') || g.getAttribute('data-scoped-id') || '';
        if (!key) return;
        bestDx = dx;
        best = { key, textW: Number(g.getAttribute('data-text-w')) || MIN_COL };
      });
      return best;
    }

    function showWidthHot(key: string | null): void {
      if (widthHotKey === key) return;
      widthHotKey = key;
      const focus = getFocusId();
      host.querySelectorAll<SVGGElement>('.map-node, .map-region-node').forEach((g) => {
        const id = g.getAttribute('data-sid') || g.getAttribute('data-scoped-id');
        const on = !!id && (id === key || id === focus || id === regionFocus);
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
        const fine = h.pointerType === 'mouse';
        if (!openLevelMenu(h.id, { fine, dragPointer: h.pointerId })) return;
      }, LEVEL_HOLD_MS);
    }

    // Node menu hold (0.2.39, M7): 450 ms on the pill chrome (not the label,
    // not a handle) with a touch or pen, a ring from 150 ms, 10 px slop.
    let nodeHold: { pointerId: number; key: string; x: number; y: number } | null = null;
    let nodeHoldTimers: number[] = [];
    /** The pointer whose hold opened the node menu: its lift is swallowed. */
    let nodeHoldOpened: number | null = null;

    function clearNodeHold(): void {
      for (const t of nodeHoldTimers) window.clearTimeout(t);
      nodeHoldTimers = [];
      nodeHold = null;
      host.querySelector(':scope > .map-node-ring')?.remove();
    }

    function beginNodeHold(e: PointerEvent, key: string): void {
      clearNodeHold();
      const hold = { pointerId: e.pointerId, key, x: e.clientX, y: e.clientY };
      nodeHold = hold;
      nodeHoldTimers.push(
        window.setTimeout(() => {
          if (nodeHold !== hold) return;
          const hr = host.getBoundingClientRect();
          const size = 44;
          const ring = document.createElement('div');
          ring.className = 'map-level-ring map-node-ring';
          ring.setAttribute('aria-hidden', 'true');
          ring.style.cssText = `position:absolute;z-index:6;pointer-events:none;width:${size}px;height:${size}px;left:${Math.round(hold.x - hr.left - size / 2)}px;top:${Math.round(hold.y - hr.top - size / 2)}px`;
          ring.innerHTML =
            '<svg viewBox="0 0 44 44" width="44" height="44"><circle class="map-level-ring-track" cx="22" cy="22" r="19"/><circle class="map-level-ring-fill" cx="22" cy="22" r="19" pathLength="100" transform="rotate(-90 22 22)"/></svg>';
          if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
          ring.style.setProperty('--map-level-ring-ms', `${LEVEL_HOLD_MS - LEVEL_RING_MS}ms`);
          host.appendChild(ring);
          requestAnimationFrame(() => ring.classList.add('is-filling'));
        }, LEVEL_RING_MS),
        window.setTimeout(() => {
          if (nodeHold !== hold) return;
          const p = pointers.get(hold.pointerId);
          const still = !!p && !committed(hold.pointerId);
          clearNodeHold();
          if (!still || mode !== 'pending' || drivers().length !== 1) return;
          clearLongPress();
          clearTouchSelect();
          // The gesture machine forgets this pointer: no tap, pan or select on lift.
          pointers.delete(hold.pointerId);
          mode = 'idle';
          samples = [];
          nodeHoldOpened = hold.pointerId;
          try {
            navigator.vibrate?.(10);
          } catch {
            /* vibrate not allowed */
          }
          if (nodeMenu?.key !== hold.key) openNodeMenu(hold.key, { clientX: hold.x, clientY: hold.y }, { fine: false });
        }, LEVEL_HOLD_MS),
      );
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
      // A pan or pinch cancels a fold-handle hold (L4) and a node menu hold (M7).
      if (levelHold) clearLevelHold();
      if (nodeHold) clearNodeHold();
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
      clearNodeHold();
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
          // Arbiter: distance past the slop AND a consistent direction.
          if (committed(p.id, p.type)) startPan(p);
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
          !target?.closest?.('.map-width-pop, .of-map-controls, .map-level-menu, .map-link-pop, .map-toast, .map-node-menu, .map-copied')
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
      trackDown(e);
      // Any new primary press is a new gesture: the last one's click swallow
      // is over, even inside the popover or the controls (0.2.30).
      if (e.isPrimary) swallow = null;
      // A mouse press ends the touch click guard (as in bindTap).
      if ((e.pointerType || 'mouse') === 'mouse') nodeTouchTapAt = -Infinity;
      if (!isActive()) return;
      const target = e.target as Element | null;
      // The resize popover and in-map controls handle their own taps: no
      // preventDefault, capture or double-tap zoom on them.
      if (target?.closest?.('.map-width-pop, .of-map-controls, .map-level-menu, .map-link-pop, .map-toast, .map-node-menu, .map-copied')) return;
      dismissWidthPop();
      closeLevelMenu(false);
      closeNodeMenu(false);
      const onLabel = !!target?.closest?.('.map-label');
      const type = e.pointerType || 'mouse';
      const barrel = type === 'pen' && (e.buttons & 2) !== 0;
      // Arbiter (0.2.44): a right / barrel press never pans, drags or resizes;
      // its contextmenu opens the menu.
      if (altPressKind({ button: e.button, buttons: e.buttons, pointerType: type }) === 'alt' || e.button > 1) return;
      const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
      const finger = type === 'touch' || (coarse && type === 'mouse' && e.button === 0);
      const onControl = !!target?.closest?.(
        '.map-fold-hit, .map-fold-indicator, .map-task-hit, .map-task-glyph, .map-body-more-hit, .map-thread-hit, .map-note-link-hit, .map-jump-hit, .map-link-hit',
      );
      const edge = onControl ? null : rightEdgeKey(e.clientX, e.clientY, finger ? 28 : 18);
      if (edge && (widthDrag || edgeArm) && (widthDrag ?? edgeArm)!.pointerId !== e.pointerId) releaseWidthGesture();
      if (!finger && edge && e.button === 0) {
        if (regionWidthTarget(edge.key)) setRegionFocus(edge.key);
        else setFocusId(edge.key);
        focusMapForKeys();
        showWidthHot(edge.key);
        widthDrag = {
          pointerId: e.pointerId,
          key: edge.key,
          startX: e.clientX,
          startW: edge.textW,
          startY: e.clientY,
          moved: false,
          ...dragStart(edge.key),
        };
        if (type === 'pen') beginWidthHold(e.pointerId, edge.key, e.clientX, e.clientY, edge.textW);
        onChange?.();
        e.preventDefault();
        try {
          host.setPointerCapture(e.pointerId);
        } catch {
          /* capture is optional */
        }
        return;
      }
      if (finger && edge && (edge.key === getFocusId() || edge.key === regionFocus)) {
        // Touch resize only after the pill is already selected. A first
        // touch selects; a pan must not drag the corner into a resize.
        edgeArm = {
          pointerId: e.pointerId,
          key: edge.key,
          startX: e.clientX,
          startY: e.clientY,
          startW: edge.textW,
        };
        beginWidthHold(e.pointerId, edge.key, e.clientX, e.clientY, edge.textW);
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
        '.map-fold-hit, .map-fold-indicator, .map-task-hit, .map-task-glyph, .map-body-more-hit, .map-thread-hit, .map-note-link-hit, .map-jump-hit, .map-link-hit, .map-width-hit',
      );
      const selectId =
        finger && nodeEl && !control ? nodeEl.getAttribute('data-sid') || '' : '';
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
        // A second pointer cancels a fold-handle hold (L4) and a node menu hold.
        if (levelHold) clearLevelHold();
        if (nodeHold) clearNodeHold();
      } else if (
        count === 1 &&
        nodeMenuOn &&
        finger &&
        type !== 'mouse' &&
        nodeEl &&
        !control &&
        !onLabel &&
        !barrel
      ) {
        beginNodeHold(e, nodeEl.getAttribute('data-sid') || '');
      } else if (
        count === 1 &&
        nodeEl &&
        control?.matches('.map-fold-hit, .map-fold-indicator') &&
        e.button === 0 &&
        !barrel
      ) {
        const id = nodeEl.getAttribute('data-sid') || '';
        if (id && nodeCanFoldLevel(id)) beginLevelHold(e, id);
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
            if (committed(e.pointerId, p.type)) return;
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
        trackMove(e);
        // Drag-to-level (L5): after the menu opens, the finger only slides.
        if (levelMenu && levelMenu.dragPointer === e.pointerId) {
          e.preventDefault();
          hotLevelItem(levelItemAt(e.clientX, e.clientY));
          return;
        }
        if (levelHold && e.pointerId === levelHold.pointerId) {
          // Arbiter: only a deliberate move cancels the hold; jitter keeps it.
          if (committed(e.pointerId, levelHold.pointerType)) levelHold = levelHoldCancel(levelHold);
          if (levelHold.phase === 'cancelled') clearLevelHold();
        }
        if (nodeHold && e.pointerId === nodeHold.pointerId) {
          if (committed(e.pointerId)) clearNodeHold();
        }
        if (
          widthDrag &&
          e.pointerId === widthDrag.pointerId &&
          (e.pointerType === 'mouse' || e.pointerType === '') &&
          e.buttons === 0
        ) {
          // The button came up where we never heard it: the gesture is over.
          releaseWidthGesture();
          paint();
        }
        if (widthDrag && e.pointerId === widthDrag.pointerId) {
          e.preventDefault();
          // 0.2.43: a click's jitter is not a resize. Nothing is written until
          // the pointer has moved WIDTH_DRAG_THRESHOLD px from the press.
          if (!widthDrag.moved) {
            if (!passedDragThreshold(e.clientX - widthDrag.startX, e.clientY - (widthDrag.startY ?? e.clientY))) return;
            if (!committed(e.pointerId)) return;
            widthDrag.moved = true;
            clearWidthHold();
          }
          const dx = (e.clientX - widthDrag.startX) / (cam.k || 1);
          showWidthHot(widthDrag.key);
          applyWidth(widthDrag.key, widthDrag.startW + dx);
          paint();
          return;
        }
        if (edgeArm && e.pointerId === edgeArm.pointerId) {
          const dx = e.clientX - edgeArm.startX;
          const dy = e.clientY - edgeArm.startY;
          const deliberate = committed(e.pointerId, 'touch');
          if (deliberate) clearWidthHold();
          if (deliberate && Math.abs(dx) > Math.abs(dy) * 1.2) {
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
              ...dragStart(arm.key),
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
      if (nodeHold && nodeHold.pointerId === e.pointerId) clearNodeHold();
      // The lift of the hold that opened the node menu: no tap, select or click.
      if (nodeHoldOpened === e.pointerId) {
        nodeHoldOpened = null;
        swallow = armSwallow(performance.now(), e.clientX, e.clientY);
        nodeTouchTapAt = performance.now();
        if (pointers.size === 0) {
          mode = 'idle';
          endPanGuard();
        }
        return;
      }
      if (widthDrag && e.pointerId === widthDrag.pointerId) {
        const drag = widthDrag;
        widthDrag = null;
        clearWidthHold();
        if (!drag.moved) {
          // 0.2.44: a click on the corner is not a menu (right-click / hold is).
          resizingWidthKey = null;
          swallow = armSwallow(performance.now(), e.clientX, e.clientY);
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
        clearWidthHold();
        // 0.2.44: a tap on the corner opens nothing (the hold does).
        if (moved < 10) swallow = armSwallow(performance.now(), e.clientX, e.clientY);
      }
      if (widthHoldOpened === e.pointerId) {
        widthHoldOpened = null;
        swallow = armSwallow(performance.now(), e.clientX, e.clientY);
        nodeTouchTapAt = performance.now();
        pointers.delete(e.pointerId);
        if (pointers.size === 0) {
          mode = 'idle';
          endPanGuard();
        }
        return;
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
    // Bubble listeners run in order: drop the arbiter track after endPointer.
    host.addEventListener('pointerup', (e) => track.delete(e.pointerId), { signal });
    host.addEventListener('pointercancel', (e) => track.delete(e.pointerId), { signal });
    host.addEventListener('pointerleave', () => {
      if (!widthDrag) showWidthHot(null);
    }, { signal });
    host.addEventListener('pointercancel', (e) => {
      endPointer(e);
      if (pointers.size === 0) resetPointers();
    }, { signal });
    host.addEventListener('lostpointercapture', (e) => {
      if (releasing) return;
      // Capture gone before our pointerup: end that width gesture here.
      if (widthDrag && e.pointerId === widthDrag.pointerId) {
        releaseWidthGesture();
        paint();
      }
    }, { signal });

    /**
     * `nodeMenu: true` (0.2.39): a contextmenu the level picker leaves alone.
     * Kept (true) inside the node menu, on the host itself while it is open
     * (the keyboard's own contextmenu), and on a pill whose node menu opens or
     * is already open (a hold opened it). The label keeps text select on touch
     * (L7) and the browser menu over a text selection (M1). False: the event
     * is the host's, untouched.
     */
    function nodeMenuContext(e: MouseEvent, pt: string): boolean {
      if (!nodeMenuOn) return false;
      const t = e.target as Element | null;
      const own = () => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return true;
      };
      if (nodeMenu && (t?.closest?.('.map-node-menu') || t === host)) return own();
      const pillKey = t?.closest?.('.map-node')?.getAttribute('data-sid') || '';
      if (!pillKey || t?.closest?.('.map-link-pop, .map-width-pop, .of-map-controls, .map-toast, .map-copied')) return false;
      const onLabel = !!t?.closest?.('.map-label');
      const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
      const selected = !!sel && !sel.isCollapsed && !!sel.toString().trim();
      if (onLabel && (pt === 'touch' || pt === 'pen' || selected)) return false;
      if (nodeMenu && nodeMenu.key === pillKey) return own();
      // Mouse (and engines that omit pointerType on contextmenu) → fine 22px
      // swatches even when the device also matches (pointer: coarse). Touch/pen
      // opens go through the hold path with fine: false (36px).
      const opened = openNodeMenu(pillKey, { clientX: e.clientX, clientY: e.clientY }, {
        fine: pt !== 'touch' && pt !== 'pen',
        pointerType: pt,
      });
      if (!opened) return false;
      if (nodeHold) {
        // The platform's long-press came first: it opened the menu, and the lift is no tap.
        nodeHoldOpened = nodeHold.pointerId;
        pointers.delete(nodeHold.pointerId);
        mode = 'idle';
        clearNodeHold();
      }
      return own();
    }

    // Right-click on a fold handle opens the level menu (L9); nowhere else
    // does (Colin, 2026-10-08). A touch or pen long-press on a handle is the
    // hold above, so only its platform menu is swallowed. Capture phase on the
    // host: it runs before any bubble listener a host put on the same element,
    // and an event the package keeps never reaches the host's own node menu.
    // A right-click elsewhere (pill, label, canvas, ContextMenu / Shift+F10)
    // is left untouched for the host and closes any open package menu.
    host.addEventListener('contextmenu', (e) => {
      if (!isActive()) return;
      const t = e.target as Element | null;
      // 0.2.44: the width corner's alternate menu. Mouse right-click opens it;
      // a touch / pen long-press opens it through the corner hold, so the
      // platform menu is only swallowed.
      if (!t?.closest?.('.map-width-pop, .map-level-menu, .map-node-menu, .of-map-controls, .map-link-pop, .map-toast, .map-copied, .map-fold-hit, .map-fold-indicator')) {
        const cpt = (e as PointerEvent).pointerType || '';
        const fingerish = cpt === 'touch' || cpt === 'pen' || (!cpt && coarsePointer());
        const corner = rightEdgeKey(e.clientX, e.clientY, fingerish ? 28 : 18);
        if (corner) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          if (cpt === 'touch' || cpt === 'pen' || widthHoldOpened !== null) return;
          closeLevelMenu(false);
          closeNodeMenu(false);
          setFocusId(corner.key);
          showWidthPop(e.clientX, e.clientY, corner.key, corner.textW, { coarse: !!cpt && cpt !== 'mouse' });
          return;
        }
      }
      const handle = t?.closest?.('.map-fold-hit, .map-fold-indicator') ?? null;
      // Region nodes (§R1 a) carry a scoped id instead of data-id.
      const g = handle?.closest?.('.map-node') ?? handle?.closest?.('.map-region-node') ?? null;
      const id = g?.getAttribute('data-sid') || g?.getAttribute('data-scoped-id') || '';
      const pt = (e as PointerEvent).pointerType || '';
      const fcx = id ? foldCtx(id) : null;
      const act = levelContextAction({
        inMenu: !!t?.closest?.('.map-level-menu'),
        inOverlay: !!t?.closest?.('.map-link-pop, .map-width-pop, .of-map-controls, .map-toast, .map-copied'),
        onHandle: !!g,
        foldable: !!fcx && nodeCanFoldLevel(id),
        menuOpen: packageMenuOpen(),
        holding: !!levelHold,
        pointerType: pt,
      });
      // The package node menu (0.2.39, opt-in) takes what the picker leaves.
      if ((act === 'pass' || act === 'close') && nodeMenuContext(e, pt)) return;
      if (act === 'pass') return;
      if (act === 'close') {
        closeMenus();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (act === 'open') openLevelMenu(id, { fine: pt !== 'touch' && pt !== 'pen' });
    }, { capture: true, signal });
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
   * Space stays fold (not task toggle). `t` cycles the focused node's task check.
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
      // t2499u: Ctrl/⌘+Z (undo/redo) must reach the map even while a node menu /
      // width pop is focused — style preview stays open across undos.
      const isMapUndoKey =
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        (e.key === 'z' || e.key === 'Z');
      if (
        !isMapUndoKey &&
        kt?.closest?.(
          '.map-width-pop, .of-map-controls, .map-level-menu, .map-link-pop, .map-toast, .map-node-menu, .map-copied',
        )
      )
        return;
      // Enter / Space on a focused chip (the #N chip's SVG anchor) opens its popover.
      const chipSel = '.map-note-link-hit, .map-jump-hit, .map-thread-hit, .map-link-hit';
      const chip =
        kt?.closest?.(chipSel) ?? (kt?.tagName?.toLowerCase() === 'a' ? kt.querySelector?.(chipSel) : null);
      const chipNode = chip?.closest?.('.map-node');
      if (chip && chipNode && (e.key === 'Enter' || e.key === ' ') && isActive()) {
        e.preventDefault();
        e.stopPropagation();
        activateNodeHit(chipNode, chip, e);
        return;
      }
      // F7 / t2499u: in view mode Ctrl/⌘+Z and Shift+Ctrl/⌘+Z undo / redo map
      // chrome edits (width + style). Edit mode or an empty stack leave the keys alone.
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        (e.key === 'z' || e.key === 'Z') &&
        !isEditing() &&
        mapKeyboardShouldHandle({
          isActive: isActive(),
          target: e.target as { tagName?: string; isContentEditable?: boolean } | null,
          activeElement: document.activeElement,
          host,
          modeButton,
          modifier: false,
        })
      ) {
        const done = e.shiftKey ? redoMapEdit() : undoMapEdit();
        if (done) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (
        !mapKeyboardShouldHandle({
          isActive: isActive(),
          target: e.target as { tagName?: string; isContentEditable?: boolean } | null,
          activeElement: document.activeElement,
          host,
          modeButton,
          modifier: (e.ctrlKey || e.metaKey || e.altKey) && !(e.key === '.' && nodeIconsOn && !e.altKey),
        })
      ) {
        return;
      }
      const doc = getDoc();
      const focusId = getFocusId();

      // F11: `w` opens the width popover for the selected node (a region pill, when one is selected).
      const widthKey = regionFocus || focusId;
      if ((e.key === 'w' || e.key === 'W') && widthKey && openWidthPopHook) {
        if (openWidthMenu(widthKey)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
      if (e.key === 't' || e.key === 'T') {
        if (applyTaskKey()) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      const n = focusId ? findNode(doc.nodes, focusId) : null;
      const selected = !!(n && n.id);

      // ContextMenu / Shift+F10 belong to the host's node menu (L9 amended,
      // node menu M1, 2026-10-08): no preventDefault, so the platform
      // contextmenu event reaches the host. A host reaches the level picker
      // with map.openLevelMenu(id) (its `Levels…` item).
      // 0.5.18 EP-30: Ctrl/⌘+. opens the icon picker for the selected node.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === '.' && nodeIconsOn && focusId) {
        if (openNodeIconPicker(focusId)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        // With the package node menu on (0.2.39) it opens for the selected node.
        if (nodeMenuOn && focusId && openNodeMenu(focusId, null, { fine: true })) {
          e.preventDefault();
          e.stopPropagation();
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
            ? { kind: 'expand', focusId }
            : { kind: 'focus' };
          onChange?.();
        }
      } else if (e.key === '*') {
        if (!selected) return;
        e.preventDefault();
        // Expand-all relative to selection (subtree), not whole forest.
        setDoc(setExpandLevel(doc, '*', { under: n!.id! }));
        userCamGesture = false;
        pendingFollow = { kind: 'expand', focusId };
        onChange?.();
      } else if (e.key >= '0' && e.key <= '9') {
        if (!selected) return;
        e.preventDefault();
        // Digit N = depth under the selected node (1 = show its children).
        setDoc(setExpandLevel(doc, Number(e.key), { under: n!.id! }));
        userCamGesture = false;
        pendingFollow =
          e.key === '0' ? { kind: 'focus' } : { kind: 'expand', focusId };
        onChange?.();
      }
    };
    // Keydown on the stable focus owner (host) — events from any descendant
    // bubble here. Mode button kept so keys work right after clicking "Map".
    host.addEventListener('keydown', onRegionKey, { capture: true });
    host.addEventListener('keydown', onKey);
    if (modeButton && !host.contains(modeButton)) {
      modeButton.addEventListener('keydown', onKey);
    }
  }

  function setDetails(on: boolean): void {
    host.classList.toggle('of-details', !!on);
  }

  const handle: MapViewHandle = {
    followInText,
    setFollowInText: (on: boolean) => toggleFollowInText(on),
    mountRegion(h: RegionHostSpec): MapRegionHandle {
      // Fold state lives in the store keyed by region id, so it survives remount (§R1 c).
      mounted.set(h.id, { ...h, folded: false });
      if (h.folded) rfold.setRegionFolded(h.id, true);
      paint();
      // 0.4.3 (QA C): replace a stale "Sealed branch is locked" in the live region.
      if (h.kind === 'sealed' && h.doc) announce('Sealed branch unlocked');
      return {
        relayout: () => paint(),
        setFolded: (f: boolean) => {
          if (mounted.has(h.id)) rfold.setRegionFolded(h.id, f);
        },
        bbox: () => placed.find((p) => p.host.id === h.id)?.hull ?? null,
      };
    },
    unmountRegion(id: string) {
      mounted.delete(id);
      // Sealed fold state is memory-only and goes with the child; record state is kept.
      if (isMemoryOnlyRegion(id)) rfold.wipe(id);
      if (regionFocus && (regionFocus === id || regionFocus.startsWith(id + ':') || regionFocus.startsWith(id + '/'))) regionFocus = null;
      paint();
    },
    placedRegions: () => placed,
    regionFold: rfold,
    focusRegionNode: (scoped: string | null) => setRegionFocus(scoped),
    focusedScopedId: () => regionFocus ?? (getFocusId() || null),
    viewKey: (x: OutlineNode | string) => {
      syncIndex();
      return typeof x === 'string' ? viewIndex.resolve(x) : vkey(x);
    },
    nodeForKey: (k: string) => nodeByKey(k),
    focusedNode: () => {
      const k = getFocusId();
      return k ? nodeByKey(k) : null;
    },
    hostId: (k: string) => toRef(k),
    sessionIndex: () => { syncIndex(); return viewIndex; },
    setFocus: (id: string) => {
      const t = handle.revealScoped(id);
      const key = sessionFocus(t) || t;
      // Camera: root targets follow via pendingFollow; region targets centre their box.
      const b = placed.flatMap((r) => r.boxes).find((x) => x.key === key || x.key === t);
      if (b) {
        const rect = host.getBoundingClientRect();
        panBy(rect.width / 2 - (b.x + b.w / 2) * cam.k - cam.x, rect.height / 2 - (b.y + b.h / 2) * cam.k - cam.y);
      }
      return key;
    },
    revealScoped: (id: string) => {
      const res = revealScopedId(id, {
        store: rfold,
        hosts: regionHosts(),
        getRootDoc: getDoc,
        setRootDoc: setDoc,
        parse: parseScopedId,
        onLocked: (r) => opts.onRegionUnlock?.(r),
      });
      const t = res.target;
      if (regionHosts().some((h) => t === h.id || t.startsWith(h.id + ':'))) {
        paint();
        setRegionFocus(t);
      } else {
        setRegionFocus(null);
        setFocusId(t);
        pendingFollow = { kind: 'focus' };
        onChange?.();
      }
      return t;
    },
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
    closeMenus,
    openWidthMenu,
    applyWidthPick: (id: string, kind: LegacyWidthPickKind) => applyWidthPick(id, kind) !== false,
    undoWidth,
    redoWidth,
    undoMapEdit,
    redoMapEdit,
    applyFoldLevel,
    setWholeMapLevel,
    setDetails,
    setNodeColourFill,
    setNodeIconsVisible: (on: boolean) => { if (iconsShown === !!on) return; iconsShown = !!on; paint(); },
    nodeIconsVisible: () => iconsShown,
    setNodeCloud: (id: string, c: string | undefined) => setNodeCloud(id, c),
    setNodeColour: (id: string, c: string | undefined) => setNodeColour(id, c),
    setNodeIcon: (id: string, t: string | undefined) => setNodeIcon(id, t),
    setNodeFont: (id: string, font: 'code' | 'auto' | undefined) => setNodeFont(id, font),
    addImage,
    setThumbWidth,
    nodeMenuEntries: (id: string) => nodeMenuEntries(id),
    details: () => host.classList.contains('of-details'),
    currentWholeMapLevel: () => currentWholeMapLevel(getDoc()),
    onPaint: (fn: () => void) => {
      paintListeners.add(fn);
      return () => {
        paintListeners.delete(fn);
      };
    },
    openIconPicker: (id?: string) => {
      const k = id ?? getFocusId();
      return k ? openNodeIconPicker(k) : false;
    },
    toggleIconPicker: (id?: string, o: { toggle?: Element | null } = {}) => {
      if (nodePicker) { nodePicker.close(true); return false; }
      const k = id ?? getFocusId();
      return k ? openNodeIconPicker(k, { stayOpen: true, toggle: o.toggle ?? null }) : false;
    },
    closeIconPicker: () => { nodePicker?.close(true); },
    isIconPickerOpen: () => !!nodePicker,
    onIconPickerChange: (fn: (open: boolean) => void) => {
      pickerListeners.add(fn);
      return () => { pickerListeners.delete(fn); };
    },
    openColourPalette: (id?: string, how: { toggle?: Element | null } = {}) => {
      const k = id ?? getFocusId();
      return k ? openNodeColourPalette(k, how) : false;
    },
    toggleColourPalette: (id?: string, how: { toggle?: Element | null } = {}) => toggleColourPalette(id, how),
    closeColourPalette: () => closeColourPalette(false),
    isColourPaletteOpen: () => !!colourPalette,
    onColourPaletteChange: (fn: (open: boolean) => void) => {
      colourPaletteListeners.add(fn);
      return () => { colourPaletteListeners.delete(fn); };
    },
    openNodeMenu: (id?: string, at?: { clientX: number; clientY: number }, how?: { fine?: boolean; pointerType?: string }) => {
      const target = id ?? getFocusId();
      return target ? openNodeMenu(target, at ?? null, how ?? {}) : false;
    },
    closeNodeMenu: () => closeNodeMenu(false),
    nodeCopyItems: (id?: string) => {
      const target = id ?? getFocusId();
      return target ? copyItemsFor(target) : [];
    },
    copyJump: (id?: string) => copyNode(id ?? getFocusId(), 'jump'),
    copyLink: (id?: string) => copyNode(id ?? getFocusId(), 'link'),
    ensureNodeId: (id?: string) => {
      const target = id ?? getFocusId();
      return target ? ensureNodeId(target).id : null;
    },
    focusNode,
  };
  return handle;
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

/** 0.5.18: Map pills are SVG text, so a node icon leads the label as its glyph (clipart → fallback emoji). */
function nodeIconLabel(n: { icon?: string }, label: string): string {
  return n.icon ? `${iconGlyph(n.icon)} ${label}` : label;
}

/** 0.5.22: `colour` when this node's old tag or the document already spells it so, else `color`. */
function colourKeyFor(doc: OutlineFoldDoc, n: OutlineNode): 'color' | 'colour' {
  if (/^<\s*colour/i.test(n.tagSpellings?.color ?? '')) return 'colour';
  let found: 'colour' | undefined;
  const walk = (list: OutlineNode[]) => {
    for (const c of list) {
      if (c.layout?.colorKey === 'colour' || /^<\s*colour/i.test(c.tagSpellings?.color ?? '')) { found = 'colour'; return; }
      if (c.children?.length) walk(c.children);
      if (found) return;
    }
  };
  walk(doc.nodes);
  return found ?? 'color';
}
