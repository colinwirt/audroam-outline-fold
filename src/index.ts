export type {
  FoldMode,
  FoldState,
  NodeFlag,
  NodeKind,
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
  isAllowedCaptionUrl,
  parseHopTarget,
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
  attachPayloads,
  mergeFrontmatter,
} from './payloads.js';

export type {
  ValidationSeverity,
  ValidationIssue,
  ValidationResult,
  ValidateOptions,
} from './validate.js';
export { validateDocument } from './validate.js';

export {
  createMapView,
  autoPackPositions,
  pillSize,
  FOLD_SLOT,
  resolveMapFocus,
  mapNodeKeepsTextSelection,
  clearSelectionForMapPan,
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
  LINE_H,
  PILL_PAD_Y,
  MIN_TEXT_W,
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
  type ParsedTask,
} from './taskChrome.js';

export {
  toggleTask,
  nextTaskState,
  shouldFireAction,
} from './task.js';
