/** Fold mode: '-' = default expanded (ids = collapsed); '+' = default collapsed (ids = expanded). */
export type FoldMode = '-' | '+';

export type NodeFlag = 'private' | 'encrypted' | 'db';

export type NodeKind =
  | 'doc'
  | 'ticket'
  | 'globe'
  | 'db'
  | 'feature'
  | 'form'
  | 'bug'
  | 'risk'
  | 'lock'
  | 'encrypted'
  | 'system-link'
  | string;

export interface OutlineNode {
  id?: string;
  title: string;
  children?: OutlineNode[];
  depth: number;
  kind?: NodeKind;
  flags?: NodeFlag[];
  /** Optional DB connection ref string — host resolves; package never opens DB. */
  dbRef?: string;
}

export interface OutlineFrontmatter {
  foldMode?: FoldMode;
  foldIds?: string[];
  collapsedMarker?: string;
  expandedMarker?: string;
}

export interface FoldState {
  mode: FoldMode;
  ids: string[];
}

export interface OutlineFoldDoc {
  frontmatter?: OutlineFrontmatter;
  nodes: OutlineNode[];
  fold: FoldState;
}

/** Host-supplied hooks — package does not implement MFA/crypto. */
export interface OutlineViewCallbacks {
  onUnlock?(id: string): void;
  onDecrypt?(id: string): void;
}

export interface ToHtmlOptions {
  callbacks?: OutlineViewCallbacks;
  /** Class prefix for generated elements. Default: "of" */
  classPrefix?: string;
  /** Show locked chrome for private/encrypted nodes. Default true. */
  lockedChrome?: boolean;
}
