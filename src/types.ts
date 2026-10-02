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

/** Task checkbox state from leading `[ ]` / `[x]` / `[-]`. */
export type TaskState = 'open' | 'done' | 'pending';

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
  /** Key id — expected per sealed node; omit only under host single-key fallback. */
  kid?: string;
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
  /** Leading `[ ]` / `[x]` / `[-]` → task chrome (ASCII stripped from visible label). */
  task?: TaskState;
  /**
   * Explicit action binding from `<action:https://…>` or `<action:event:…>`.
   * Host runs on open→done only (package emits onTaskToggle; never auto-fires caption https).
   */
  action?: string;
  /** Thread / deep-link ref from `<thread:…>` — host navigates on chip click. */
  thread?: string;
  /**
   * Layout stored in the outline text (`--- layout ---`), keyed by this node's id.
   * `w` is the caption column width in px. Absent until a custom width (or other
   * payload) needs a persistent id on the outline line.
   */
  layout?: NodeLayout;
}

/** Per-node layout authored in the outline text, not the map sidecar. */
export interface NodeLayout {
  /** Caption column width in px. The map wraps the pill to this width. */
  w?: number;
}

export interface OutlineFrontmatter {
  foldMode?: FoldMode;
  foldIds?: string[];
  collapsedMarker?: string;
  expandedMarker?: string;
  /** Map label size in px. Overridden by the layout file and by a node fontSize. */
  fontSize?: number;
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

/** Emitted when Map/Outline task SVG is toggled. Host owns persist / side effects. */
export interface TaskToggleEvent {
  id: string;
  from: TaskState;
  to: TaskState;
  node: OutlineNode;
}

export interface ToHtmlOptions {
  callbacks?: OutlineViewCallbacks;
  /** Class prefix for generated elements. Default: "of" */
  classPrefix?: string;
  /** Show locked chrome for private/encrypted nodes. Default true. */
  lockedChrome?: boolean;
  /** Accessible name for role=tree root. Default: "Outline" */
  ariaLabel?: string;
  /**
   * When true, task SVG is a role=checkbox button (interactive). Host still
   * must wire click → onTaskToggle / setDoc. Default true when task present.
   */
  interactiveTasks?: boolean;
}
