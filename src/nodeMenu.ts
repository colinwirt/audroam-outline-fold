/**
 * Map node menu, Open group: Copy jump and Copy link (0.2.39, node menu M2–M4,
 * M8, M9, M11). Pure helpers plus the small DOM view the map mounts when a host
 * turns on its built-in node menu (`createMapView({ nodeMenu: true })`). A host
 * with its own node menu (`#row-menu`) uses `map.nodeCopyItems(id)`,
 * `map.copyJump(id)` and `map.copyLink(id)` instead.
 *
 * - Copy jump copies `<r:id>`: the in-map jump tag, as the package writes it
 *   (no spaces). Pasted into another caption it is a `→ caption` jump chip.
 * - Copy link copies the full URL that opens the map focused on the node: the
 *   host's `nodeUri` (a `{id}` template or a callback), else the current page
 *   with `focus=<id>`. No safe URL: the item is hidden.
 * - Neither opens a window, so neither has a `↗` (M4). Labels only, no icons.
 */
import type { OutlineNode } from './types.js';

/** `<id:>` characters; a jump target must match (as in parse and serialize). */
export const NODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const COPY_JUMP_LABEL = 'Copy jump';
export const COPY_LINK_LABEL = 'Copy link';
/** The query key the default Copy link sets (the viewer reads `?focus=`). */
export const FOCUS_PARAM = 'focus';
/** Touch / pen slop for the node menu hold (M7): moving further cancels it to a pan. */
export const NODE_HOLD_SLOP = 10;
/** How long the visible "Copied" confirmation stays (ms). */
export const COPIED_TOAST_MS = 1600;

export type NodeCopyKind = 'jump' | 'link';

/**
 * Host option for Copy link. A string is a template with `{id}` (http(s) or
 * root-relative); a function gets the node's id and returns a URL. `null` or
 * `''` (or a template without `{id}`, or a function that returns nothing)
 * hides Copy link. Unset: the current page with `focus=<id>`.
 */
export type NodeUriOption =
  | string
  | null
  | ((ev: { id: string; node: OutlineNode | null }) => string | null | undefined);

/** The jump tag for an id, exactly as the package writes it: `<r:id>`. Null for a bad id. */
export function jumpTagFor(id: string): string | null {
  return id && NODE_ID_RE.test(id) ? `<r:${id}>` : null;
}

function httpUrl(u: string): URL | null {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** A root-relative path (not `//host` or `/\host`). */
function rootRelative(u: string): boolean {
  return u.startsWith('/') && !u.startsWith('//') && !u.startsWith('/\\');
}

/** Make `href` absolute (http/https only): root-relative paths take `base`'s origin. */
function absoluteHttp(href: string, base: string | null | undefined): string | null {
  const h = href.trim();
  if (!h) return null;
  if (rootRelative(h)) {
    const b = base ? httpUrl(base) : null;
    return b ? new URL(h, b.origin).href : null;
  }
  return httpUrl(h)?.href ?? null;
}

/**
 * The full URL that opens the map focused on node `id`, or null when it cannot
 * be built safely (then Copy link is hidden).
 * - `nodeUri` string: `{id}` is replaced (URL-encoded); `none`, `''` or no `{id}` gives null.
 * - `nodeUri` function: its result, made absolute against `base` when root-relative.
 * - unset: `base` (the current page; http or https only) with `focus=<id>` set
 *   (other query keys kept, the hash dropped).
 * The result is always an absolute http(s) URL.
 */
export function nodeFocusHref(
  id: string,
  opts: { nodeUri?: NodeUriOption; node?: OutlineNode | null; base?: string | null } = {},
): string | null {
  if (!id || !NODE_ID_RE.test(id)) return null;
  const { nodeUri, base } = opts;
  if (typeof nodeUri === 'function') {
    let out: string | null | undefined;
    try {
      out = nodeUri({ id, node: opts.node ?? null });
    } catch {
      return null;
    }
    return typeof out === 'string' ? absoluteHttp(out, base) : null;
  }
  if (nodeUri !== undefined) {
    const t = typeof nodeUri === 'string' ? nodeUri.trim() : '';
    if (!t || /^none$/i.test(t) || !t.includes('{id}')) return null;
    return absoluteHttp(t.replace(/\{id\}/g, encodeURIComponent(id)), base);
  }
  const url = base ? httpUrl(base) : null;
  if (!url) return null;
  url.searchParams.set(FOCUS_PARAM, id);
  url.hash = '';
  return url.href;
}

/** One Open-group item for a node, shown or hidden (M11), with the reason when hidden. */
export interface NodeCopyItem {
  kind: NodeCopyKind;
  label: string;
  /** Hidden items are left out of the package menu (M11: show only what applies). */
  hidden: boolean;
  /** Why it is hidden: for a host that shows it disabled with a tooltip instead. */
  reason?: string;
  /** The text a pick copies, when it is known without minting (the node already has an id). */
  text?: string;
}

export const READ_ONLY_REASON = 'Read-only: this line has no id to copy';
export const NO_LINK_REASON = 'No link: the host gives no address for this map';

/**
 * Copy jump and Copy link for a node (M3 Open group order).
 * - `id`: the node's written id (`<id:…>` on the line), or null. A session id
 *   that is not written yet counts as no id.
 * - `canMint`: the host can edit the document, so a missing id may be minted.
 * - `href(id)`: Copy link's URL for an id (`nodeFocusHref`), null when unsafe.
 * - `previewId`: the id a mint would give, to check Copy link before minting.
 * Read-only and no id: both hidden (nothing is minted).
 */
export function nodeCopyItems(p: {
  id: string | null;
  canMint: boolean;
  previewId?: string | null;
  href: (id: string) => string | null;
}): NodeCopyItem[] {
  const has = !!p.id;
  const usable = has || p.canMint;
  const probe = p.id || p.previewId || '';
  const link = probe ? p.href(probe) : null;
  const jump: NodeCopyItem = { kind: 'jump', label: COPY_JUMP_LABEL, hidden: !usable };
  if (!usable) jump.reason = READ_ONLY_REASON;
  else if (has) jump.text = jumpTagFor(p.id!) ?? undefined;
  const linkItem: NodeCopyItem = { kind: 'link', label: COPY_LINK_LABEL, hidden: !usable || !link };
  if (!usable) linkItem.reason = READ_ONLY_REASON;
  else if (!link) linkItem.reason = NO_LINK_REASON;
  else if (has) linkItem.text = link;
  return [jump, linkItem];
}

/** Live-region and toast text after a copy. */
export function copiedText(kind: NodeCopyKind, ok: boolean): string {
  if (!ok) return "Couldn't copy";
  return kind === 'jump' ? 'Copied jump' : 'Copied link';
}

/** Hidden-textarea + `execCommand('copy')`: the fallback when the Clipboard API is missing or refused. */
export function copyTextFallback(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const prev = document.activeElement as HTMLElement | null;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  ta.tabIndex = -1;
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  let ok = false;
  try {
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  try {
    prev?.focus?.({ preventScroll: true });
  } catch {
    /* focus not available */
  }
  return ok;
}

/**
 * Copy `text`: `navigator.clipboard.writeText` first, then the textarea
 * fallback. Call it straight from the click (user activation). True when copied.
 */
export function copyText(text: string): Promise<boolean> {
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (clip && typeof clip.writeText === 'function') {
    let p: Promise<void>;
    try {
      p = clip.writeText(text);
    } catch {
      return Promise.resolve(copyTextFallback(text));
    }
    return p.then(
      () => true,
      () => copyTextFallback(text),
    );
  }
  return Promise.resolve(copyTextFallback(text));
}

// ── Menu view (M2 groups, M8 keys, M9 ARIA) ─────────────────────────────────

export type NodeMenuGroup = 'View' | 'Open';

export interface NodeMenuEntry {
  /** `levels`, `copy-jump`, `copy-link`. */
  key: string;
  label: string;
  group: NodeMenuGroup;
  /** Opens a picker (`Levels…`): `aria-haspopup=menu`. */
  popup?: boolean;
}

export interface NodeMenuView {
  el: HTMLElement;
  items: HTMLElement[];
}

let menuSeq = 0;

function mk<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

/**
 * The node menu: `role=menu` named by the caption, one `role=group` per
 * non-empty group labelled by its muted label, `role=separator` between groups,
 * `role=menuitem` buttons (labels only).
 */
export function renderNodeMenu(opts: { title: string; entries: NodeMenuEntry[]; fine: boolean; nodeId?: string }): NodeMenuView {
  const seq = ++menuSeq;
  const title = opts.title.replace(/\s+/g, ' ').trim() || 'Node';
  const el = mk('div', 'map-node-menu');
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', title);
  el.dataset.pointer = opts.fine ? 'fine' : 'coarse';
  if (opts.nodeId) el.dataset.nodeId = opts.nodeId;
  el.style.position = 'absolute';
  el.style.zIndex = '7';
  const items: HTMLElement[] = [];
  const groups: NodeMenuGroup[] = ['View', 'Open'];
  let first = true;
  for (const g of groups) {
    const list = opts.entries.filter((e) => e.group === g);
    if (!list.length) continue;
    if (!first) {
      const sep = mk('div', 'map-node-menu-sep');
      sep.setAttribute('role', 'separator');
      el.appendChild(sep);
    }
    first = false;
    const labelId = `map-node-menu-${seq}-${g.toLowerCase()}`;
    const group = mk('div', 'map-node-menu-group');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', labelId);
    group.dataset.group = g.toLowerCase();
    const label = mk('div', 'map-node-menu-label', g);
    label.id = labelId;
    group.appendChild(label);
    for (const e of list) {
      const b = mk('button', 'map-node-menu-item', e.label);
      b.type = 'button';
      b.tabIndex = -1;
      b.setAttribute('role', 'menuitem');
      b.dataset.item = e.key;
      if (e.popup) b.setAttribute('aria-haspopup', 'menu');
      group.appendChild(b);
      items.push(b);
    }
    el.appendChild(group);
  }
  return { el, items };
}

export type NodeMenuKeyAction =
  | { type: 'move'; index: number }
  | { type: 'close'; returnFocus: boolean }
  | { type: 'activate'; index: number }
  | null;

/**
 * Keys in the node menu (M8): ↑/↓ wrap, Home/End, type-ahead by first letter
 * (cycling through items that share it), Enter/Space activate, → on an item
 * that opens a picker activates it, Esc closes (focus back to the map), Tab
 * closes.
 */
export function nodeMenuKeyAction(
  key: string,
  index: number,
  items: { label: string; popup?: boolean }[],
): NodeMenuKeyAction {
  const n = items.length;
  if (!n) return key === 'Escape' || key === 'Tab' ? { type: 'close', returnFocus: key === 'Escape' } : null;
  const at = index >= 0 && index < n ? index : -1;
  switch (key) {
    case 'ArrowDown':
      return { type: 'move', index: at < 0 ? 0 : (at + 1) % n };
    case 'ArrowUp':
      return { type: 'move', index: at < 0 ? n - 1 : (at - 1 + n) % n };
    case 'Home':
      return { type: 'move', index: 0 };
    case 'End':
      return { type: 'move', index: n - 1 };
    case 'Escape':
      return { type: 'close', returnFocus: true };
    case 'Tab':
      return { type: 'close', returnFocus: false };
    case 'Enter':
    case ' ':
      return at >= 0 ? { type: 'activate', index: at } : null;
    case 'ArrowRight':
      return at >= 0 && items[at]!.popup ? { type: 'activate', index: at } : null;
    default:
      break;
  }
  if (key.length === 1 && /\S/.test(key)) {
    const k = key.toLowerCase();
    for (let step = 1; step <= n; step++) {
      const i = (at + step + n) % n;
      if (items[i]!.label.trim().toLowerCase().startsWith(k)) return { type: 'move', index: i };
    }
  }
  return null;
}

/**
 * Where the menu goes, host-local px: at the press point (below and right of
 * it), flipped or clamped to stay `inset` px inside the map (M7 popover).
 */
export function placeNodeMenu(opts: {
  at: { x: number; y: number };
  panel: { w: number; h: number };
  menu: { w: number; h: number };
  inset?: number;
}): { left: number; top: number } {
  const inset = opts.inset ?? 8;
  const { at, panel, menu } = opts;
  let left = at.x;
  let top = at.y;
  if (left + menu.w > panel.w - inset) left = at.x - menu.w;
  if (top + menu.h > panel.h - inset) top = at.y - menu.h;
  const maxLeft = Math.max(inset, panel.w - menu.w - inset);
  const maxTop = Math.max(inset, panel.h - menu.h - inset);
  left = Math.min(maxLeft, Math.max(inset, left));
  top = Math.min(maxTop, Math.max(inset, top));
  return { left: Math.round(left), top: Math.round(top) };
}
