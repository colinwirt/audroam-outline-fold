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

/**
 * Sealed payload on a node (v0.2).
 * Cleartext caption stays lossy; secret material is either:
 * - **inline** `ciphertext` (bundled in the outline doc), or
 * - **remote** `uri` (host fetches after auth).
 * Exactly one of `ciphertext` | `uri` should be set.
 * Each sealed node is expected to carry its own `kid`; sharing a `kid` is a
 * deliberate choice when the user judges node sensitivity to be the same.
 * A host may apply the documented single-key fallback for unkeyed whole-document
 * material; this does not change the per-entry grammar.
 */
export interface SealedPayload {
  kid: string;
  /** Base64url (or base64) ciphertext — inline / bundled style. */
  ciphertext?: string;
  /** Remote blob URI — host fetches after key release. */
  uri?: string;
  alg?: string;
}

export interface OutlineNode {
  id?: string;
  title: string;
  children?: OutlineNode[];
  depth: number;
  kind?: NodeKind;
  flags?: NodeFlag[];
  /** Optional DB connection ref string — host resolves; package never opens DB. */
  dbRef?: string;
  /** Sealed / encrypted payload (`<enc:…>`). Demo or host crypto opens it. */
  sealed?: SealedPayload;
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
  onDecrypt?(id: string, kid?: string): void | Promise<void>;
}

export interface ToHtmlOptions {
  callbacks?: OutlineViewCallbacks;
  /** Class prefix for generated elements. Default: "of" */
  classPrefix?: string;
  /** Show locked chrome for private/encrypted nodes. Default true. */
  lockedChrome?: boolean;
}
