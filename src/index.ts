export type {
  FoldMode,
  FoldState,
  NodeFlag,
  NodeKind,
  NodeLayout,
  OutlineFoldDoc,
  OutlineFrontmatter,
  OutlineNode,
  OutlineViewCallbacks,
  SealedPayload,
  TaskState,
  TaskToggleEvent,
  ToHtmlOptions,
} from './types.js';

export { parse } from './parse.js';
export { serialize } from './serialize.js';
export { toggleFold, isCollapsed, setExpandLevel, type ExpandLevel, type SetExpandLevelOptions } from './fold.js';
export { toHtml } from './toHtml.js';
export {
  captionToHtml,
  captionLinks,
  isAllowedCaptionUrl,
  parseHopTarget,
  normalizeCaptionBreaks,
  captionVisibleText,
  captionStyleRuns,
  parseTinyHtmlRuns,
  tinyHtmlToSafeHtml,
  captionRunToTspanInner,
  type CaptionStyleRun,
} from './captionRich.js';
export {
  attachOutlineTree,
  expandLevelAnnouncement,
  foldToggleAnnouncement,
  type AttachOutlineTreeOptions,
  type AttachOutlineTreeHandle,
} from './attachOutlineTree.js';
export { ICONS, iconForNode, iconForTask, type IconName } from './icons.js';
export { hasSealed, isRemoteSealed, parseEncBody, formatEncTag } from './sealed.js';
export {
  demoSeal,
  demoOpen,
  DEMO_PASSPHRASE,
  DEMO_ALG,
} from './demoCrypto.js';
export {
  peelTrailingSections,
  parsePayloadMap,
  formatPayloadsBlock,
  collectPayloads,
  attachLayouts,
  attachPayloads,
  collectLayouts,
  formatLayoutBlock,
  parseLayoutMap,
  mergeFrontmatter,
  type LayoutMap,
} from './payloads.js';

export {
  assignPersistentId,
  indexOutline,
  linkPayloadNodes,
  nextAutoId,
  nodeMapKey,
  type AutoIdOptions,
} from './nodeAddress.js';

export type {
  ValidationSeverity,
  ValidationIssue,
  ValidationResult,
  ValidateOptions,
} from './validate.js';
export { validateDocument } from './validate.js';

export {
  createMapView,
  mountMapControls,
  autoPackPositions,
  pillSize,
  mapNodeClassNames,
  FOLD_SLOT,
  resolveMapFocus,
  mapNodeKeepsTextSelection,
  mapBackgroundPanSelection,
  clearSelectionForMapPan,
  mapPaintShouldRestoreFocus,
  mapKeyboardShouldHandle,
  mapHostOwnsFocus,
  mapPaintFocusAction,
  mapNodeDomId,
  type MapPoint,
  type MapViewBox,
  type MapLayout,
  type AutoPackOptions,
  type AutoPackResult,
  type PillSizeOptions,
  type PillSize,
  type MapViewOptions,
  type MapKeyboardWire,
  type MapViewHandle,
  type MapFocusDirection,
  type ResolveMapFocusOptions,
} from './mapView.js';

export {
  DEFAULT_WRAP_CH,
  DEFAULT_MAX_LINES,
  SOFT_SAFETY_MAX_LINES,
  SOFT_SAFETY_MAX_CHARS,
  TASK_LEAD,
  CHAR_W,
  CODE_CHAR_W,
  lineAdvance,
  LINE_H,
  PILL_PAD_Y,
  MIN_TEXT_W,
  PILL_PAD_X,
  MORE_AFFORDANCE_H,
  resolveEffectiveMaxLines,
  wrapLines,
  measurePill,
  type WrapResult,
  type MeasurePillOpts,
  type MeasuredPill,
} from './mapLabel.js';

export {
  seedColdStartFold,
  measureLineageHeight,
  DEFAULT_LINEAGE_HEIGHT_CAP,
} from './mapSeed.js';

export {
  mapResumeStorageKey,
  pagesDocKey,
  loadMapResume,
  saveMapResume,
  clearMapResume,
  overlayResumeOnLayout,
  softResetResume,
  isResumeStale,
  collectNodeIds,
  createDebouncedResumeSave,
  type MapResumeState,
  type MapCameraState,
  type MapNodeNudge,
  type MapResumeKeyParts,
  type ResumeLayoutLike,
  type StaleCheckResult,
  type DebouncedSave,
} from './mapResume.js';

export {
  parseLeadingTask,
  displayCaption,
  parseActionTag,
  parseThreadTag,
  toggleTaskMarker,
  taskStateOf,
  resolveTask,
  resolveAction,
  resolveThread,
  resolveNoteLinks,
  type ParsedTask,
} from './taskChrome.js';

export {
  toggleTask,
  nextTaskState,
  shouldFireAction,
} from './task.js';

export {
  clampCamToContent,
  camToEnsureVisible,
  camToFrameRects,
  followActionForFocus,
  followActionForExpand,
  visibleFractionOfRect,
  isRectComfortablyVisible,
  isRectIntersectingViewport,
  isRectFullyInvisible,
  pillWorldRect,
  unionWorldRects,
  worldRectToScreen,
  lerpCam,
  easeOutCubic,
  DEFAULT_CAM_PADDING_PX,
  DEFAULT_FOLLOW_EASE_MS,
  DEFAULT_KEEP_VISIBLE_FRAC,
  DEFAULT_RECENTRE_FRAC,
  COMFORT_INSET_PX,
  type CamState,
  type ViewportSize,
  type WorldRect,
  type FollowAction,
} from './mapCamera.js';
