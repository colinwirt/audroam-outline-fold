/**
 * Map link popover (globe badge): rows built from `captionLinks`, styled as
 * the fold-level menu (0.2.33). Pure helpers plus one DOM builder; the map
 * view owns opening, placement, keys and dismissal.
 */
import type { CaptionLink } from './captionRich.js';
import { linkText } from './captionRich.js';

/** 0.6.5: shorten from the middle so both ends stay readable (`ab…yz`). */
export function shortenMiddle(s: string, max = 40): string {
  if (s.length <= max) return s;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return s.slice(0, head) + '\u2026' + s.slice(s.length - (keep - head));
}

/** 0.6.5: the stacked hint: domain (no www) and path (no query, middle-shortened). */
export function linkDomainPath(href: string, base?: string, max = 40): { domain: string; path: string } {
  try {
    const u = new URL(String(href).trim(), base || 'https://same-site.invalid/');
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { domain: '', path: '' };
    const domain = u.hostname === 'same-site.invalid' ? '' : u.hostname.replace(/^www\./i, '');
    return { domain, path: shortenMiddle(u.pathname.replace(/^\/+|\/+$/g, ''), max) };
  } catch {
    return { domain: '', path: '' };
  }
}

/** 0.6.5: popover second line: domain (no www) + path, no query, middle-shortened. */
export function linkUrlLine(href: string, max = 40): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#\s]*@)?([^/?#\s:]+)(?::\d+)?([^?#\s]*)/i.exec(String(href).trim());
  if (!m) return shortenMiddle(String(href).trim(), max);
  const path = m[2]!.replace(/\/+$/, '');
  return shortenMiddle(m[1]!.replace(/^www\./i, '') + path, max);
}

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
  // Not rounded: the globe sits at fractional px (fonts, camera), and a
  // rounded left would make the gap 7.5–8.5 px instead of 8.
  return { left, top, shift };
}

/**
 * Muted destination for a `#N` note link (0.2.34): the host when the
 * noteUri points off-site, else the path (`/notes/1004`).
 */
export function noteLinkWhere(href: string | null | undefined, base?: string): string {
  if (!href) return '';
  let u: URL;
  try {
    u = new URL(href, base || 'https://same-site.invalid/');
  } catch {
    return '';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
  const absolute = /^https?:\/\//i.test(href.trim());
  const baseOrigin = base ? originOf(base) : null;
  if (absolute && u.origin !== baseOrigin) return u.hostname.replace(/^www\./i, '');
  return u.pathname + u.search;
}

/**
 * One popover row. `href` + `newTab` opens in a new tab with
 * `rel="noopener noreferrer"`; `hopId` selects a node in this map; `kind`
 * names the row for the host and for tests (`link`, `hop`, `note-open`,
 * `note-map`, `note-details`, `thread`). `broken`: a hop whose node is not in
 * this map, drawn muted and inert.
 */
export type LinkPopRow = {
  label: string;
  where?: string;
  /** 0.6.5: stacked hint lines (domain, then path). */
  domain?: string;
  path?: string;
  href?: string | null;
  newTab?: boolean;
  hopId?: string | null;
  kind: string;
  broken?: boolean;
};

/**
 * Globe rows: one per caption link. A `#pnid:` link is left out (its `#N` chip
 * opens it). `hasNode` marks a hop to a node not in this map `broken`.
 */
export function captionLinkRows(
  links: readonly CaptionLink[],
  base?: string,
  hasNode?: (id: string) => boolean,
): LinkPopRow[] {
  return links
    .filter((link) => !link.pnid)
    .map((link0): LinkPopRow => {
      const link = { ...link0, label: linkText(link0.label, link0.href) };
      if (!link.hopId) {
        const abs = /^https?:\/\//i.test(link.href.trim());
        if (abs) {
          // 0.6.5: label (a bare URL shows its domain), then domain + path.
          return { label: link.label, href: link.href, newTab: true, where: linkUrlLine(link.href), kind: 'link', ...linkDomainPath(link.href, base) };
        }
        const dp = linkDomainPath(link.href, base);
        return { label: link.label, href: link.href, newTab: true, where: linkPopWhere(link, base), kind: 'link', ...(dp.domain ? dp : {}) };
      }
      const row: LinkPopRow = { label: link.label, href: link.href, hopId: link.hopId, kind: 'hop' };
      if (hasNode && !hasNode(link.hopId)) row.broken = true;
      return row;
    });
}

/**
 * `#N` chip rows (0.2.34): `Open #N` (new tab when the noteUri gives an href,
 * muted destination), then `Open map` and `Open details` when their templates
 * resolve (`noteLinkHrefs`). N is a note number, never a node id: there is no
 * in-map row.
 */
export function noteLinkRows(
  pnid: string,
  href: string | null | undefined,
  opts: { base?: string; mapHref?: string | null; detailsHref?: string | null } = {},
): LinkPopRow[] {
  const rows: LinkPopRow[] = [
    href
      ? { label: `Open #${pnid}`, href, newTab: true, where: noteLinkWhere(href, opts.base), kind: 'note-open' }
      : { label: `Open #${pnid}`, kind: 'note-open' },
  ];
  if (opts.mapHref) {
    rows.push({ label: 'Open map', href: opts.mapHref, newTab: true, where: noteLinkWhere(opts.mapHref, opts.base), kind: 'note-map' });
  }
  if (opts.detailsHref) {
    rows.push({
      label: 'Open details',
      href: opts.detailsHref,
      newTab: true,
      where: noteLinkWhere(opts.detailsHref, opts.base),
      kind: 'note-details',
    });
  }
  return rows;
}

/** Thread chip: one row. */
export function threadRows(): LinkPopRow[] {
  return [{ label: 'Open thread', kind: 'thread' }];
}

/** Trailing mark on rows that open a new window (node menu M4, K3). */
export const LINK_EXT_ARROW = '\u2197';
/** Added to the accessible name of a row that opens a new window. */
export const OPENS_NEW_WINDOW = 'opens in new window';

/**
 * True when the row opens a new window: an href with `newTab`, never a hop
 * (in-map jumps select a node here and never get ↗). `Open #N` with no
 * noteUri only fires `onNoteLink`, so it gets no ↗ either.
 */
export function opensNewWindow(row: LinkPopRow): boolean {
  return !!(row.href && row.newTab && !row.hopId);
}

export type LinkPopView = { el: HTMLElement; items: HTMLAnchorElement[] };

/**
 * `div.map-link-pop[role=menu]` with one `a.map-link-item[role=menuitem]`
 * per row: label, then the muted destination. Shared by the globe, `#N` and
 * thread chips (0.2.34).
 */
export function renderLinkPopRows(
  rows: readonly LinkPopRow[],
  opts: { fine: boolean; nodeId?: string; label?: string; kind?: string },
): LinkPopView {
  const el = document.createElement('div');
  el.className = 'map-link-pop';
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', opts.label || 'Links');
  el.dataset.pointer = opts.fine ? 'fine' : 'coarse';
  if (opts.kind) el.dataset.kind = opts.kind;
  if (opts.nodeId) el.dataset.nodeId = opts.nodeId;
  const items: HTMLAnchorElement[] = [];
  for (const row of rows) {
    const a = document.createElement('a');
    a.className = 'map-link-item';
    a.setAttribute('role', 'menuitem');
    a.tabIndex = -1;
    a.dataset.row = row.kind;
    if (row.href) {
      a.href = row.href;
      a.title = row.href;
    }
    // 0.6.5: label and destination stack in one text block; ↗ stays its own column.
    const text = document.createElement('span');
    text.className = 'map-link-text';
    const label = document.createElement('span');
    label.className = 'map-link-label';
    label.textContent = row.label;
    text.appendChild(label);
    if (row.domain) {
      // 0.6.5: stacked hint, domain then path; never the path alone.
      const w = document.createElement('span');
      w.className = 'map-link-where';
      for (const [cls, t] of [['map-link-domain', row.domain], ['map-link-path', row.path]] as const) {
        if (!t) continue;
        const l = document.createElement('span');
        l.className = cls;
        l.textContent = t;
        w.appendChild(l);
      }
      text.appendChild(w);
    } else if (row.where) {
      const w = document.createElement('span');
      w.className = 'map-link-where';
      w.textContent = row.where;
      text.appendChild(w);
    }
    a.appendChild(text);
    if (row.broken) {
      a.dataset.broken = 'true';
      a.setAttribute('aria-disabled', 'true');
      a.classList.add('is-broken');
    }
    if (row.hopId) {
      a.dataset.hopId = row.hopId;
    } else if (opensNewWindow(row)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      // K3 / M4 (0.2.38): a trailing muted ↗, hidden from AT; the name says it.
      const ext = document.createElement('span');
      ext.className = 'map-link-ext';
      ext.setAttribute('aria-hidden', 'true');
      ext.textContent = LINK_EXT_ARROW;
      a.appendChild(ext);
      // 0.6.5: a caption link row names its full URL; note rows keep their short destination.
      const dest = row.kind === 'link' ? row.href : row.where;
      a.setAttribute('aria-label', `${row.label}${dest ? `, ${dest}` : ''}, ${OPENS_NEW_WINDOW}`);
    }
    el.appendChild(a);
    items.push(a);
  }
  return { el, items };
}

/** Globe popover from caption links (0.2.33 API). */
export function renderLinkPop(
  links: readonly CaptionLink[],
  opts: { fine: boolean; base?: string; nodeId?: string; hasNode?: (id: string) => boolean },
): LinkPopView {
  return renderLinkPopRows(captionLinkRows(links, opts.base, opts.hasNode), { ...opts, kind: 'links' });
}

/**
 * 0.6.5 link preview (Colin: "preview the link before navigating out"). A click
 * on a caption link never navigates: it shows this block (label, domain, the full
 * URL wrapping, Open ↗ and Copy). Only Open navigates.
 */
export type LinkPreviewView = { el: HTMLElement; open: HTMLAnchorElement; copy: HTMLButtonElement };

export function isInternalLink(href: string, base?: string): boolean {
  const h = String(href).trim();
  if (h.startsWith('#')) return true;
  const b = base ?? (typeof location !== 'undefined' ? location.href : undefined);
  if (!b) return false;
  try {
    return new URL(h, b).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export function renderLinkPreview(opts: { label: string; href: string; base?: string }): LinkPreviewView {
  const { href } = opts;
  const el = document.createElement('div');
  el.className = 'map-link-preview';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `Link preview: ${opts.label}`);
  const mk = (cls: string, text: string) => {
    const s = document.createElement('div');
    s.className = cls;
    s.textContent = text;
    el.appendChild(s);
    return s;
  };
  mk('map-link-preview-label', opts.label);
  const dp = linkDomainPath(href, opts.base);
  mk('map-link-preview-domain', dp.domain || linkText('', href));
  if (dp.path) mk('map-link-preview-path', dp.path);
  mk('map-link-preview-url', href);
  if (isInternalLink(href, opts.base)) mk('map-link-preview-note', 'Opens in Audroam');
  const actions = document.createElement('div');
  actions.className = 'map-link-preview-actions';
  const open = document.createElement('a');
  open.className = 'map-link-preview-open';
  open.setAttribute('href', href);
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.textContent = `Open ${LINK_EXT_ARROW}`;
  open.setAttribute('aria-label', `Open ${href}, ${OPENS_NEW_WINDOW}`);
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'map-link-preview-copy';
  copy.textContent = 'Copy';
  copy.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const done = () => (copy.textContent = 'Copied');
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    if (nav?.clipboard?.writeText) void nav.clipboard.writeText(href).then(done, () => undefined);
  });
  actions.appendChild(open);
  actions.appendChild(copy);
  el.appendChild(actions);
  return { el, open, copy };
}
