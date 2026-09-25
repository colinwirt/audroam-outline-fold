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
  ToHtmlOptions,
} from './types.js';

export { parse } from './parse.js';
export { serialize } from './serialize.js';
export { toggleFold, isCollapsed, setExpandLevel, type ExpandLevel } from './fold.js';
export { toHtml } from './toHtml.js';
export { ICONS, iconForNode, type IconName } from './icons.js';
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
