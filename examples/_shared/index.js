/**
 * Shared Pages demo core.
 * parse(md) → doc; outlineView(doc); mapView(doc, layoutSidecar).
 * Package owns parse / toHtml / attachOutlineTree / toggleFold / createMapView / autoPackPositions.
 * mapView.js re-exports the package Map; layoutSidecar stays Pages-only.
 */
export { parseDoc, loadDoc, parse, validateDocument } from './parseDoc.js';
export { createOutlineView, toHtml, attachOutlineTree, serialize } from './outlineView.js';
export {
  createMapView,
  autoPackPositions,
  pillSize,
  FOLD_SLOT,
  DEFAULT_WRAP_CH,
  DEFAULT_MAX_LINES,
  seedColdStartFold,
  mapResumeStorageKey,
  pagesDocKey,
  loadMapResume,
  createDebouncedResumeSave,
} from './mapView.js';
export {
  resolveLayout,
  extractLayoutSidecarPointer,
} from './layoutSidecar.js';
export {
  tryUnlock,
  findNode,
  isPlaceholderSealed,
  injectReveals,
  escHtml,
} from './unlockStub.js';
