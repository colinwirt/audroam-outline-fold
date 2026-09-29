/**
 * Thin re-export — Map lives in the package (`@audroam/outline-fold`).
 * Pages demos keep importing from here so one source of truth is dist/.
 */
export {
  createMapView,
  autoPackPositions,
  pillSize,
  FOLD_SLOT,
  TASK_LEAD,
  DEFAULT_WRAP_CH,
  DEFAULT_MAX_LINES,
  resolveMapFocus,
  seedColdStartFold,
  measureLineageHeight,
  mapResumeStorageKey,
  pagesDocKey,
  loadMapResume,
  saveMapResume,
  overlayResumeOnLayout,
  softResetResume,
  isResumeStale,
  collectNodeIds,
  createDebouncedResumeSave,
  toggleTask,
  shouldFireAction,
} from '../../dist/index.js';
