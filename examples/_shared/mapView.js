/**
 * Thin re-export — Map lives in the package (`@audroam/outline-fold`).
 * Pages demos keep importing from here so one source of truth is dist/.
 */
export {
  createMapView,
  autoPackPositions,
  pillSize,
  FOLD_SLOT,
} from '../../dist/index.js';
