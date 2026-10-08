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
  /**
   * `id` is a session id from `parse(text, { sessionIds: true })`: fold, focus and
   * keys work, but serialize does not write `<id:…>` for it. A width, a payload or
   * a fold+ entry turns it into a written id (see `assignPersistentId`).
   */
  autoId?: boolean;
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
   * Numeric note links from `<t: 101>` (one or more).
   * Same tag the Audroam result-row outline uses. Distinct from `thread`.
   */
  noteLinks?: string[];
  /**
   * How each note link was written, keyed by id, when it is not the default
   * `<t: N>` (for example `<t:101>`). Serialize writes that spelling back so a
   * fold or a task tick does not rewrite the author's tag. A link without an
   * entry, or whose entry no longer names that id, is written as `<t: N>`.
   */
  noteLinkTags?: Record<string, string>;
  /**
   * Every link on the line (0.2.34), tags first in source order, then the caption's
   * markdown links in caption order. A `note` is a note outside this map by number
   * (`<t:N>`, `[label](#pnid:N)`); a `jump` goes to a node in this map by id
   * (`<r:x>`, `[label](#id:x)`). Tag links are written back from here with their
   * spelling; markdown links live in `title`. `noteLinks` stays the list of `<t:N>`
   * numbers: a number taken out of it drops its tag here too.
   */
  links?: NodeLink[];
  /**
   * Colon tags written with spaces (`<id : x>`, `<kind: doc>`, `<action: … >`), keyed by
   * tag name. Serialize writes the spelling back while it still names the node's value;
   * otherwise it writes `<name:value>`.
   */
  tagSpellings?: TagSpellings;
  /**
   * The fold marker as written on a line that has no id (`(+)`, or the
   * document's expanded marker). Parse sets it only when the node ends up with
   * no id (no session ids); serialize writes it back so the line round-trips.
   * Fold state for a node with an id lives in `doc.fold`, not here.
   */
  foldMark?: 'collapsed' | 'expanded';
  /**
   * Layout stored in the outline text (`--- layout ---`), keyed by this node's id.
   * `w` is the caption column width in px. Absent until a custom width (or other
   * payload) needs a persistent id on the outline line.
   * The same block may also carry document keys (fold, markers, fontSize).
   */
  layout?: NodeLayout;
}

/** One link on a line. See `OutlineNode.links`. */
export interface NodeLink {
  /** `note`: a note outside this map, by number. `jump`: a node in this map, by id. */
  kind: 'note' | 'jump';
  /** The note number or the node id. */
  target: string;
  /** `tag`: `<t:N>` / `<r:x>`. `markdown`: `[label](#pnid:N)` / `[label](#id:x)`, kept in the caption. */
  form: 'tag' | 'markdown';
  /** Exactly as written (`<r : x>`, `[Seeds](#pnid:1004)`). A new tag link may leave it out. */
  source?: string;
  /** Markdown label. */
  label?: string;
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
  /**
   * `<t:N>` open pattern from the layout block.
   * `{id}` is the note id. `https://b.audroam.com/view/pnid/{id}` or `/view/pnid/{id}`.
   */
  noteUri?: string;
  /**
   * Open map pattern for `<t:N>` popovers (0.2.34), `{id}` is the note number.
   * `none` hides the row. Unset: the `noteMapUri` option, then `/notes/{id}/map`.
   */
  noteMapUri?: string;
  /**
   * Open details pattern for `<t:N>` popovers (0.2.34), `{id}` is the note number.
   * `none` hides the row. Unset: the `noteDetailsUri` option, then `/notes/{id}/details`.
   */
  noteDetailsUri?: string;
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
  /**
   * Used when the document layout omits `noteUri`.
   * `{id}` is replaced with the `<t:N>` id. http(s) or a root-relative path.
   */
  noteUri?: string;
}

/** How colon tags were written when not `<name:value>`. See `OutlineNode.tagSpellings`. */
export type TagSpellings = Partial<Record<'id' | 'kind' | 'action' | 'thread' | 'db', string>>;
