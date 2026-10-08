/**
 * Map link popover (globe badge): rows built from `captionLinks`, styled as
 * the fold-level menu (0.2.33). Pure helpers plus one DOM builder; the map
 * view owns opening, placement, keys and dismissal.
 */
import type { CaptionLink } from './captionRich.js';

/** Last non-empty path segment, skipping a trailing `index.html`. */
function lastSegment(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  let last = parts.pop() || '';
  if (/^index\.html?$/i.test(last)) last = parts.pop() || '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Muted "where it goes" text after a link's label.
 * - External http(s) URL: the host, without `www.` (`example.com`).
 * - Same-site link: the file or folder it opens. A query value that is a
 *   path (`?doc=../potholes/potholes.md`) wins over the page path.
 * - Hop link (`hopId`): empty, the label is enough.
 * Empty too when the label already says it.
 */
export function linkPopWhere(link: CaptionLink, base?: string): string {
  if (link.hopId) return '';
  const raw = link.href.trim();
  let u: URL;
  try {
    u = new URL(raw, base || 'https://same-site.invalid/');
  } catch {
    return '';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
  const absolute = /^https?:\/\//i.test(raw) || raw.startsWith('//');
  const baseOrigin = base ? originOf(base) : null;
  let where = '';
  if (absolute && u.origin !== baseOrigin) {
    where = u.hostname.replace(/^www\./i, '');
  } else {
    for (const v of u.searchParams.values()) {
      if (v.includes('/') || /\.[a-z0-9]{1,6}$/i.test(v)) {
        where = lastSegment(v);
        if (where) break;
      }
    }
    if (!where) where = lastSegment(u.pathname);
  }
  if (!where) return '';
  if (link.label.toLowerCase().includes(where.toLowerCase())) return '';
  return where;
}

type Box = { x: number; y: number; w: number; h: number };

/** Gap between the globe and the popover (px). */
export const LINK_POP_GAP = 8;
/** The popover stays this far inside the map (px). */
export const LINK_POP_INSET = 8;

/**
 * Popover placement in host-local px (0.2.33): to the right of the globe
 * with an 8 px gap, vertically centred on it. Never flipped or clamped: it
 * moves with the globe. `shift` is the camera pan (screen px, zoom unchanged)
 * that brings the whole popover inside the map with an `inset` margin; zero
 * when it already fits. A popover bigger than the map keeps its left and top
 * edges in.
 */
export function placeLinkPop(opts: {
  anchor: Box;
  panel: { w: number; h: number };
  menu: { w: number; h: number };
  gap?: number;
  inset?: number;
}): { left: number; top: number; shift: { x: number; y: number } } {
  const gap = opts.gap ?? LINK_POP_GAP;
  const inset = opts.inset ?? LINK_POP_INSET;
  const { anchor, panel, menu } = opts;
  const left = anchor.x + anchor.w + gap;
  const top = anchor.y + anchor.h / 2 - menu.h / 2;
  const fit = (start: number, size: number, span: number): number => {
    if (start < inset) return inset - start;
    if (start + size > span - inset) return Math.max(inset - start, span - inset - (start + size));
    return 0;
  };
  // Keep the globe in view too: the popover's left edge sits right of it.
  const shift = { x: fit(left, menu.w, panel.w), y: fit(top, menu.h, panel.h) };
  return {
    left: Math.round(left),
    top: Math.round(top),
    shift: { x: Math.round(shift.x), y: Math.round(shift.y) },
  };
}

export type LinkPopView = { el: HTMLElement; items: HTMLAnchorElement[] };

/**
 * `div.map-link-pop[role=menu]` with one `a.map-link-item[role=menuitem]`
 * row per link: label, then the muted destination. External links open in a
 * new tab with `rel="noopener noreferrer"`; a hop link carries `data-hop-id`.
 */
export function renderLinkPop(
  links: readonly CaptionLink[],
  opts: { fine: boolean; base?: string; nodeId?: string },
): LinkPopView {
  const el = document.createElement('div');
  el.className = 'map-link-pop';
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', 'Links');
  el.dataset.pointer = opts.fine ? 'fine' : 'coarse';
  if (opts.nodeId) el.dataset.nodeId = opts.nodeId;
  const items: HTMLAnchorElement[] = [];
  for (const link of links) {
    const a = document.createElement('a');
    a.className = 'map-link-item';
    a.setAttribute('role', 'menuitem');
    a.tabIndex = -1;
    a.href = link.href;
    a.title = link.href;
    const label = document.createElement('span');
    label.className = 'map-link-label';
    label.textContent = link.label;
    a.appendChild(label);
    const where = linkPopWhere(link, opts.base);
    if (where) {
      const w = document.createElement('span');
      w.className = 'map-link-where';
      w.textContent = where;
      a.appendChild(w);
    }
    if (link.hopId) {
      a.dataset.hopId = link.hopId;
    } else {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    el.appendChild(a);
    items.push(a);
  }
  return { el, items };
}
