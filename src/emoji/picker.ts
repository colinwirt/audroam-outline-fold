/**
 * 0.5.18 emoji + Map clipart picker (Design UX 2026-11-04 EP-3…EP-21).
 *
 * Two states at one anchor: the quick row (6 items + `＋`, EP-4) and the compact panel
 * (320 × 360, EP-6): search, a 28px category strip, an 8-column grid with sticky section
 * headers, a scroll body for the grid + colour palettes (0.6.1), and a footer with preview, name, Pin, Remove icon and `?`.
 * Coarse pointers get a full-width bottom sheet with 7 columns (EP-17).
 */
import { CLIPART } from './clipart.js';
import {
  allIconItems,
  clipartItem,
  createIconPrefs,
  emojiData,
  itemForToken,
  loadEmojiData,
  searchIcons,
  type IconItem,
  type IconPrefs,
} from './icons.js';

import { colourGroups, colourLabel, colourMatchesQuery, matchingColourGroups, resolveColour } from '../nodeColour.js';

export type PickerMode = 'node' | 'text';

export interface IconPickerOptions {
  /** Viewport point (client px) or element to anchor under. */
  anchor: { x: number; y: number } | Element;
  mode: PickerMode;
  /** Called with the stored token (`🧭` or `:compass:`). `keepOpen` for Shift+Enter. */
  onPick: (token: string, how: { keepOpen: boolean; item: IconItem }) => void;
  /** Node mode with an icon set: footer shows `Remove icon` (EP-12). */
  onRemove?: () => void;
  onClose?: () => void;
  /**
   * 0.5.19 (EP-31): node mode `Colours` row above the footer: 8 swatches + None.
   * Click or Enter sets the colour (`undefined` for None); the picker stays open.
   */
  colour?: { value?: string; palette?: string; onColour: (color: string | undefined) => void };
  /**
   * 0.5.30: picks keep the picker open (a toolbar toggle owns closing it). Esc then closes
   * outright instead of stepping back to the quick row.
   */
  stayOpen?: boolean;
  /**
   * 0.5.30: the host's toggle button. A pointerdown on it is not an "outside" press, so the
   * button's own click can close the picker instead of the press closing and the click reopening.
   */
  toggle?: Element | null;
  /** Open on the panel instead of the quick row (node menu, toolbar, Ctrl/Cmd+.). */
  expanded?: boolean;
  prefs?: IconPrefs;
  /** Parent for the floating element. Default document.body. */
  container?: HTMLElement;
  /**
   * 0.6.2: clamp the popover inside this element's box as well as the viewport
   * (e.g. the map host). When omitted, only the viewport is used.
   */
  bounds?: Element | { getBoundingClientRect(): DOMRectReadOnly };
  /** Force the touch sheet (default: `(pointer: coarse)`). */
  sheet?: boolean;
}

export interface IconPickerHandle {
  el: HTMLElement;
  /** `'row' | 'panel'`. */
  state(): 'row' | 'panel';
  expand(): void;
  close(returnFocus?: boolean): void;
}

export const PICKER_CATEGORIES: { key: string; label: string; tab: string }[] = [
  { key: 'recent', label: 'Recent', tab: '🕘' },
  { key: 'pinned', label: 'Pinned', tab: '📌' },
  { key: 'smileys', label: 'Smileys', tab: '😀' },
  { key: 'people', label: 'People', tab: '🧑' },
  { key: 'nature', label: 'Nature', tab: '🌿' },
  { key: 'food', label: 'Food', tab: '🍎' },
  { key: 'objects', label: 'Objects', tab: '💼' },
  { key: 'symbols', label: 'Symbols', tab: '🔣' },
  { key: 'map', label: 'Map clipart', tab: '◇ Map' },
];

const HELP =
  'Click or Enter inserts · Shift+Enter inserts and stays open · P pins · Arrows move · Tab: search → tabs → grid → footer · Esc steps back · Type “:” in text for shortcodes · Ctrl/⌘+. opens on a selected node · Emoji are stored as the character, clipart as :name:';

let seq = 0;
let openPicker: IconPickerHandle | null = null;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
}

function glyphEl(it: IconItem, cls: string): HTMLElement {
  const g = h('span', cls, { 'aria-hidden': 'true' });
  if (it.svg) g.innerHTML = it.svg; // built-in, sanitized-by-construction SVG
  else g.textContent = it.char;
  return g;
}

function anchorRect(a: IconPickerOptions['anchor']): { left: number; top: number; bottom: number } {
  if (a instanceof Element) {
    const r = a.getBoundingClientRect();
    return { left: r.left, top: r.top, bottom: r.bottom };
  }
  return { left: a.x, top: a.y, bottom: a.y };
}

/** 0.5.30: viewport widths at or under this get the bottom sheet; tablets keep the popover. */
export const PICKER_SHEET_MAX_W = 600;
function coarse(): boolean {
  try {
    // Phone only: a coarse pointer AND a narrow viewport. A tablet gets the compact popover.
    // screen.width too: a phone without a viewport meta lays out at 980 css px.
    return matchMedia('(pointer: coarse)').matches && Math.min(window.innerWidth, screen.width || Infinity) <= PICKER_SHEET_MAX_W;
  } catch {
    return false;
  }
}

/**
 * 0.6.2: place a floating popover under `anchor`, never past the viewport or an
 * optional map/container `bounds`. Prefers below the anchor; flips above when needed.
 */
export function clampPopoverPlace(opts: {
  anchor: { left: number; top: number; bottom: number };
  size: { w: number; h: number };
  viewport: { w: number; h: number };
  bounds?: { left: number; top: number; right: number; bottom: number };
  inset?: number;
}): { left: number; top: number; flip: 'above' | 'below' } {
  const inset = opts.inset ?? 4;
  const { anchor: a, size, viewport: vp } = opts;
  const minL = opts.bounds ? Math.max(inset, opts.bounds.left + inset) : inset;
  const maxR = opts.bounds ? Math.min(vp.w - inset, opts.bounds.right - inset) : vp.w - inset;
  const minT = opts.bounds ? Math.max(inset, opts.bounds.top + inset) : inset;
  const maxB = opts.bounds ? Math.min(vp.h - inset, opts.bounds.bottom - inset) : vp.h - inset;
  const maxLeft = Math.max(minL, maxR - size.w);
  let left = Math.min(Math.max(a.left, minL), maxLeft);
  let top = a.bottom + 6;
  let flip: 'above' | 'below' = 'below';
  if (top + size.h > maxB && a.top - size.h - 6 >= minT) {
    top = a.top - size.h - 6;
    flip = 'above';
  }
  const maxTop = Math.max(minT, maxB - size.h);
  top = Math.min(Math.max(top, minT), maxTop);
  return { left: Math.round(left), top: Math.round(top), flip };
}

/** Opens the picker. One at a time: an open picker closes first. */
export function openIconPicker(opts: IconPickerOptions): IconPickerHandle {
  openPicker?.close(false);
  const id = `of-ep-${++seq}`;
  const prefs = opts.prefs ?? createIconPrefs();
  const returnTo = document.activeElement as HTMLElement | null;
  const sheet = opts.sheet ?? coarse();
  const cols = 7;
  const root = h('div', `of-ep${sheet ? ' of-ep-sheet' : ''}`, { 'data-testid': 'of-ep', 'data-mode': opts.mode });
  const abort = new AbortController();
  const sig = abort.signal;
  let state: 'row' | 'panel' = 'row';
  let closed = false;

  const live = h('div', 'of-ep-live', { role: 'status', 'aria-live': 'polite', 'data-testid': 'of-ep-live' });

  const pick = (it: IconItem, keepOpen: boolean) => {
    prefs.useRecent(it.insert);
    opts.onPick(it.insert, { keepOpen, item: it });
    if (!keepOpen && !opts.stayOpen) handle.close(true);
    else if (state === 'panel') renderGrid();
  };

  // ── quick row (EP-4) ──
  function renderRow(): void {
    root.className = `of-ep of-ep-row-state${sheet ? ' of-ep-sheet-row' : ''}`;
    root.replaceChildren();
    const row = h('div', 'of-ep-row', { role: 'toolbar', 'aria-label': opts.mode === 'node' ? 'Node icon' : 'Insert emoji', 'data-testid': 'of-ep-row' });
    const items = prefs.quickRow().map(itemForToken).filter((x): x is IconItem => !!x);
    const btns: HTMLButtonElement[] = [];
    for (const it of items) {
      const b = h('button', 'of-ep-cell', { type: 'button', 'aria-label': it.name, title: it.name, tabindex: '-1' });
      b.appendChild(glyphEl(it, 'of-ep-glyph'));
      b.addEventListener('click', () => pick(it, false), { signal: sig });
      btns.push(b);
      row.appendChild(b);
    }
    const plus = h('button', 'of-ep-cell of-ep-plus', { type: 'button', 'aria-label': 'More emoji and clipart', 'aria-expanded': 'false', 'data-testid': 'of-ep-plus', tabindex: '-1' }, '＋');
    plus.addEventListener('click', () => handle.expand(), { signal: sig });
    btns.push(plus);
    row.appendChild(plus);
    row.addEventListener('keydown', (e) => {
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length;
        roving(btns, n);
      }
    }, { signal: sig });
    root.appendChild(row);
    root.appendChild(live);
    roving(btns, 0);
    place();
  }

  // ── panel (EP-6…EP-13) ──
  let search!: HTMLInputElement;
  let strip!: HTMLElement;
  let body!: HTMLElement;
  let grid!: HTMLElement;
  let colourHost: HTMLElement | null = null;
  let colourOpts: NonNullable<IconPickerOptions['colour']> | null = null;
  let footer!: HTMLElement;
  let preview!: HTMLElement;
  let nameEl!: HTMLElement;
  let pinBtn!: HTMLButtonElement;
  let help: HTMLElement | null = null;
  let cells: HTMLElement[] = [];
  let cellItems: IconItem[] = [];
  let focusIndex = 0;
  let sectionEls: { key: string; el: HTMLElement }[] = [];
  let tabs: HTMLButtonElement[] = [];

  function renderPanel(): void {
    root.className = `of-ep of-ep-panel${sheet ? ' of-ep-sheet' : ''}`;
    root.style.setProperty('--of-ep-cols', String(cols));
    root.replaceChildren();
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', opts.mode === 'node' ? 'Node icon picker' : 'Emoji picker');

    search = h('input', 'of-ep-search', {
      type: 'search',
      placeholder: opts.mode === 'node' ? 'Search · node icon' : 'Search · text',
      'aria-label': opts.mode === 'node' ? 'Search node icons' : 'Search emoji',
      'aria-controls': `${id}-grid`,
      'data-testid': 'of-ep-search',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    search.addEventListener('input', () => renderGrid(), { signal: sig });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || (e.key === 'Enter' && cells.length)) {
        e.preventDefault();
        if (e.key === 'Enter') pick(cellItems[0]!, e.shiftKey);
        else focusCell(0);
      }
    }, { signal: sig });

    strip = h('div', 'of-ep-strip', { role: 'tablist', 'aria-label': 'Categories', 'data-testid': 'of-ep-strip' });
    tabs = PICKER_CATEGORIES.map((c, i) => {
      const t = h('button', `of-ep-tab${c.key === 'map' ? ' of-ep-tab-map' : ''}`, { type: 'button', role: 'tab', 'aria-label': c.label, title: c.label, 'aria-selected': 'false', 'data-cat': c.key, tabindex: i === 0 ? '0' : '-1', 'data-testid': `of-ep-tab-${c.key}` }, c.tab);
      t.addEventListener('click', () => scrollToSection(c.key, true), { signal: sig });
      return t;
    });
    strip.append(...tabs);
    strip.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        roving(tabs, n);
        scrollToSection(tabs[n]!.dataset.cat!, false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusCell(firstCellOf(tabs[Math.max(0, i)]!.dataset.cat!));
      }
    }, { signal: sig });
    // EP-18: a horizontal swipe on the strip changes category.
    let sx: number | null = null;
    strip.addEventListener('touchstart', (e) => { sx = e.touches[0]?.clientX ?? null; }, { signal: sig, passive: true });
    strip.addEventListener('touchend', (e) => {
      const x = e.changedTouches[0]?.clientX;
      if (sx == null || x == null || Math.abs(x - sx) < 40) return;
      const cur = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
      const n = Math.min(tabs.length - 1, Math.max(0, cur + (x < sx ? 1 : -1)));
      scrollToSection(tabs[n]!.dataset.cat!, true);
    }, { signal: sig });

    body = h('div', 'of-ep-body', { 'data-testid': 'of-ep-body' });
    body.addEventListener('scroll', () => syncTab(), { signal: sig, passive: true });

    grid = h('div', 'of-ep-grid', { role: 'grid', id: `${id}-grid`, 'aria-label': 'Emoji and clipart', 'data-testid': 'of-ep-grid' });
    grid.addEventListener('keydown', onGridKey, { signal: sig });

    footer = h('div', 'of-ep-footer', { 'data-testid': 'of-ep-footer' });
    preview = h('span', 'of-ep-preview', { 'aria-hidden': 'true' });
    nameEl = h('span', 'of-ep-name', { 'data-testid': 'of-ep-name' });
    pinBtn = h('button', 'of-ep-btn', { type: 'button', 'data-testid': 'of-ep-pin' }, 'Pin');
    pinBtn.addEventListener('click', () => togglePin(cellItems[focusIndex]), { signal: sig });
    footer.append(preview, nameEl, pinBtn);
    if (opts.mode === 'node' && opts.onRemove) {
      const rm = h('button', 'of-ep-btn of-ep-remove', { type: 'button', 'data-testid': 'of-ep-remove' }, 'Remove icon');
      rm.addEventListener('click', () => { opts.onRemove!(); handle.close(true); }, { signal: sig });
      footer.appendChild(rm);
    }
    const q = h('button', 'of-ep-btn of-ep-help', { type: 'button', 'aria-label': 'Picker help', 'aria-expanded': 'false', 'data-testid': 'of-ep-help' }, '?');
    q.addEventListener('click', () => {
      if (help) { help.remove(); help = null; q.setAttribute('aria-expanded', 'false'); return; }
      help = h('div', 'of-ep-help-pop', { role: 'note', 'data-testid': 'of-ep-help-pop' }, HELP);
      root.appendChild(help);
      q.setAttribute('aria-expanded', 'true');
    }, { signal: sig });
    footer.appendChild(q);

    colourOpts = opts.mode === 'node' && opts.colour ? opts.colour : null;
    colourHost = colourOpts ? h('div', 'of-ep-colours-host', { 'data-testid': 'of-ep-colours-host' }) : null;
    body.append(grid, ...(colourHost ? [colourHost] : []));
    root.append(search, strip, body, footer, live);
    renderGrid();
    place();
    // EP-10: node mode opens on the Map tab.
    if (opts.mode === 'node') scrollToSection('map', false);
    search.focus({ preventScroll: true });
  }

  /**
   * Rebuild the colour row. Default / browse (empty query) hides colour sections;
   * a search that matches a colour name, alias (`red`), or group (`pastel`,
   * `forest`, `highlighter`) shows the matching swatches.
   */
  function syncColours(query = ''): void {
    if (!colourHost || !colourOpts) return;
    const q = query.trim();
    if (!q) {
      colourHost.replaceChildren();
      colourHost.hidden = true;
      return;
    }
    const row = renderColourRow(colourOpts, q);
    colourHost.hidden = !!row.hidden;
    colourHost.replaceChildren(row);
  }

  function colourMatches(query: string, groupName: string, colourName: string, label: string): boolean {
    return colourMatchesQuery(query, groupName, colourName, label);
  }

  function renderColourRow(c: NonNullable<IconPickerOptions['colour']>, query = ''): HTMLElement {
    const row = h('div', 'of-ep-colours', { role: 'radiogroup', 'aria-label': 'Colours', 'data-testid': 'of-ep-colours' });
    let cur: string = resolveColour(c.value) ?? 'none';
    const q = query.trim();
    const groups = colourGroups(c.palette);
    const visible: { name: string; colours: string[]; includeNone: boolean }[] = [];
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi]!;
      const cols = g.colours.filter((name) => colourMatches(q, g.name, name, colourLabel(name, c.palette)));
      const noneHit = gi === 0 && (!q || 'none'.includes(q.toLowerCase()) || colourMatches(q, g.name, 'none', 'None'));
      if (cols.length || noneHit) visible.push({ name: g.name, colours: [...cols], includeNone: gi === 0 && (!q || noneHit) });
    }
    if (!visible.length) {
      row.hidden = true;
      return row;
    }
    const flat: { name: string; btn: HTMLButtonElement }[] = [];
    const mk = (name: string) => {
      const label = name === 'none' ? 'None' : colourLabel(name, c.palette);
      const b = h('button', `of-ep-swatch swatch-${name}`, { type: 'button', role: 'radio', 'aria-label': label, title: label, 'aria-checked': String(name === cur), tabindex: name === cur ? '0' : '-1', 'data-swatch': name, 'data-testid': `of-ep-swatch-${name}` }, name === 'none' ? '∅' : '') as HTMLButtonElement;
      b.addEventListener('click', () => {
        cur = name;
        for (const x of flat) { x.btn.setAttribute('aria-checked', String(x.btn === b)); x.btn.tabIndex = x.btn === b ? 0 : -1; }
        c.onColour(name === 'none' ? undefined : name);
        live.textContent = name === 'none' ? 'Colour removed' : `Colour: ${label}`;
      }, { signal: sig });
      flat.push({ name, btn: b });
      return b;
    };
    for (const g of visible) {
      row.appendChild(h('span', 'of-ep-colours-cap', { 'aria-hidden': 'true' }, g.name));
      if (g.includeNone) row.appendChild(mk('none'));
      for (const name of g.colours) row.appendChild(mk(name));
    }
    const btns = flat.map((x) => x.btn);
    row.addEventListener('keydown', (e) => {
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      e.preventDefault();
      const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length;
      btns[n]!.focus();
    }, { signal: sig });
    return row;
  }

  function sections(): { key: string; label: string; items: IconItem[] }[] {
    const data = emojiData() ?? [];
    const all = allIconItems();
    const res: { key: string; label: string; items: IconItem[] }[] = [];
    const pinned = prefs.pinned().map(itemForToken).filter((x): x is IconItem => !!x).map((x) => ({ ...x, pinned: true }));
    const recent = prefs.recent().map(itemForToken).filter((x): x is IconItem => !!x);
    res.push({ key: 'pinned', label: 'Pinned', items: pinned });
    res.push({ key: 'recent', label: 'Recent', items: recent });
    // Map clipart near the top in node mode (mockup: Pinned, Recent, Map clipart).
    const map = { key: 'map', label: 'Map clipart', items: CLIPART.map(clipartItem) };
    if (opts.mode === 'node') res.push(map);
    for (const c of PICKER_CATEGORIES) {
      if (c.key === 'recent' || c.key === 'pinned' || c.key === 'map') continue;
      res.push({ key: c.key, label: c.label, items: all.filter((it) => it.kind === 'emoji' && it.category === c.key) });
    }
    if (opts.mode !== 'node') res.push(map);
    void data;
    return res;
  }

  function renderGrid(): void {
    const q = search?.value.trim() ?? '';
    grid.replaceChildren();
    cells = [];
    cellItems = [];
    sectionEls = [];
    const addSection = (key: string, label: string, items: IconItem[]) => {
      const sec = h('div', 'of-ep-section', { role: 'rowgroup', 'data-section': key });
      const head = h('div', 'of-ep-section-head', { role: 'row' });
      head.appendChild(h('span', '', { role: 'columnheader' }, label));
      sec.appendChild(head);
      for (let r = 0; r < items.length; r += cols) {
        const row = h('div', 'of-ep-grid-row', { role: 'row' });
        for (const it of items.slice(r, r + cols)) {
          const i = cells.length;
          const b = h('button', `of-ep-cell${it.kind === 'clipart' ? ' of-ep-clip' : ''}`, {
            type: 'button',
            role: 'gridcell',
            tabindex: '-1',
            'aria-label': it.kind === 'clipart' ? `${it.name}, clipart` : it.name,
            'data-insert': it.insert,
            'data-testid': `of-ep-cell-${it.kind === 'clipart' ? it.code : 'e'}`,
          });
          b.appendChild(glyphEl(it, 'of-ep-glyph'));
          b.addEventListener('click', (e) => pick(it, (e as MouseEvent).shiftKey), { signal: sig });
          b.addEventListener('mouseenter', () => showFooter(it), { signal: sig });
          b.addEventListener('focus', () => { focusIndex = i; showFooter(it); }, { signal: sig });
          // EP-18: long-press previews with Pin (no right-click on touch).
          let timer: ReturnType<typeof setTimeout> | null = null;
          b.addEventListener('touchstart', () => { timer = setTimeout(() => { focusIndex = i; showFooter(it); b.classList.add('of-ep-pressed'); timer = null; }, 450); }, { signal: sig, passive: true });
          b.addEventListener('touchend', (e) => { if (timer) clearTimeout(timer); else { e.preventDefault(); b.classList.remove('of-ep-pressed'); } }, { signal: sig });
          b.addEventListener('contextmenu', (e) => { e.preventDefault(); focusCell(i); }, { signal: sig });
          cells.push(b);
          cellItems.push(it);
          row.appendChild(b);
        }
        sec.appendChild(row);
      }
      grid.appendChild(sec);
      sectionEls.push({ key, el: sec });
    };
    if (q) {
      const hits = searchIcons(q, { prefs });
      const hasColours = !!colourOpts && matchingColourGroups(q, colourOpts.palette).length > 0;
      if (hits.length) addSection('results', 'Results', hits);
      else if (!hasColours) grid.appendChild(h('div', 'of-ep-empty', { 'data-testid': 'of-ep-empty' }, 'No matches'));
      live.textContent = hits.length
        ? `${hits.length} result${hits.length === 1 ? '' : 's'}`
        : hasColours
          ? 'Colour matches'
          : 'No matches';
      strip.classList.add('of-ep-strip-dim');
      // 0.6.2: node mode opens scrolled to Map; keep Results at the top of the scrollport
      // (Colin phone: typed Clo while colours were in view — Results were above the fold).
      if (body) body.scrollTop = 0;
    } else {
      strip.classList.remove('of-ep-strip-dim');
      for (const s of sections()) if (s.items.length || s.key === 'map') addSection(s.key, s.label, s.items);
    }
    syncColours(q);
    focusIndex = Math.min(focusIndex, Math.max(0, cells.length - 1));
    cells.forEach((c, i) => (c.tabIndex = i === focusIndex ? 0 : -1));
    if (cellItems[focusIndex]) showFooter(cellItems[focusIndex]!);
    else showFooter(null);
    syncTab();
  }

  function showFooter(it: IconItem | null): void {
    preview.replaceChildren();
    if (!it) {
      nameEl.textContent = '';
      pinBtn.disabled = true;
      return;
    }
    preview.appendChild(glyphEl(it, 'of-ep-glyph'));
    nameEl.textContent = it.kind === 'clipart' ? `${it.name} · clipart` : it.name;
    pinBtn.disabled = false;
    pinBtn.textContent = prefs.isPinned(it.insert) ? 'Unpin' : 'Pin';
    pinBtn.setAttribute('aria-pressed', prefs.isPinned(it.insert) ? 'true' : 'false');
  }

  function togglePin(it: IconItem | undefined): void {
    if (!it) return;
    const on = prefs.togglePin(it.insert);
    live.textContent = on ? `Pinned ${it.name}` : `Unpinned ${it.name}`;
    const keep = it.insert;
    const hadFocus = grid.contains(document.activeElement);
    renderGrid();
    const i = cellItems.findIndex((c) => c.insert === keep && !c.pinned);
    const j = i >= 0 ? i : cellItems.findIndex((c) => c.insert === keep);
    if (j >= 0) {
      focusIndex = j;
      if (hadFocus) focusCell(j);
      else showFooter(cellItems[j]!);
    }
  }

  function focusCell(i: number): void {
    if (!cells.length) return;
    const n = Math.max(0, Math.min(cells.length - 1, i));
    focusIndex = n;
    roving(cells, n);
    cells[n]!.scrollIntoView?.({ block: 'nearest' });
  }

  function firstCellOf(key: string): number {
    const sec = sectionEls.find((s) => s.key === key)?.el;
    const first = sec?.querySelector('.of-ep-cell');
    return first ? Math.max(0, cells.indexOf(first as HTMLElement)) : 0;
  }

  function rowStarts(): number[] {
    // Index of the first cell in every visual row (sections break rows).
    const starts: number[] = [];
    grid.querySelectorAll('.of-ep-grid-row').forEach((r) => {
      const f = r.firstElementChild;
      if (f) starts.push(cells.indexOf(f as HTMLElement));
    });
    return starts;
  }

  function onGridKey(e: KeyboardEvent): void {
    const i = cells.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const starts = rowStarts();
    let r = 0;
    while (r + 1 < starts.length && starts[r + 1]! <= i) r++;
    const col = i - starts[r]!;
    const rowLen = (k: number) => (k + 1 < starts.length ? starts[k + 1]! : cells.length) - starts[k]!;
    if (e.key === 'ArrowRight') { e.preventDefault(); focusCell(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); focusCell(i - 1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (r + 1 < starts.length) focusCell(starts[r + 1]! + Math.min(col, rowLen(r + 1) - 1)); }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (r === 0) search.focus();
      else focusCell(starts[r - 1]! + Math.min(col, rowLen(r - 1) - 1));
    } else if (e.key === 'Home') { e.preventDefault(); focusCell(starts[r]!); }
    else if (e.key === 'End') { e.preventDefault(); focusCell(starts[r]! + rowLen(r) - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(cellItems[i]!, e.shiftKey); }
    else if (e.key === ' ') { e.preventDefault(); pick(cellItems[i]!, false); }
    else if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); togglePin(cellItems[i]); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // EP-16: typing moves focus to search, keeping the character.
      e.preventDefault();
      search.focus();
      search.value += e.key;
      renderGrid();
    }
  }

  function scrollToSection(key: string, focusTab: boolean): void {
    if (search.value) { search.value = ''; renderGrid(); }
    const sec = sectionEls.find((s) => s.key === key)?.el;
    if (sec && body) {
      const top = sec.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
      body.scrollTop = Math.max(0, top - 4);
    }
    setTab(key);
    if (focusTab) tabs.find((t) => t.dataset.cat === key)?.focus({ preventScroll: true });
  }

  function setTab(key: string): void {
    for (const t of tabs) {
      const on = t.dataset.cat === key;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      t.classList.toggle('is-active', on);
    }
  }

  function syncTab(): void {
    if (!sectionEls.length || search?.value || !body) return;
    const top = body.scrollTop + 4;
    let cur = sectionEls[0]!.key;
    for (const s of sectionEls) {
      const y = s.el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
      if (y <= top) cur = s.key;
    }
    setTab(cur);
  }

  function roving(list: HTMLElement[], n: number): void {
    list.forEach((b, i) => (b.tabIndex = i === n ? 0 : -1));
    list[n]?.focus({ preventScroll: true });
  }

  function place(): void {
    if (sheet && state === 'panel') {
      root.style.left = '0px';
      root.style.right = '0px';
      root.style.top = '';
      root.style.bottom = '0px';
      return;
    }
    const a = anchorRect(opts.anchor);
    const br = root.getBoundingClientRect();
    // Prefer measured size; fall back to the design defaults when layout has not run yet.
    // Under-estimating width used to leave a right-edge toolbar row past the viewport.
    const w = Math.max(root.offsetWidth || 0, br.width || 0, state === 'panel' ? 320 : 240);
    const hgt = Math.max(root.offsetHeight || 0, br.height || 0, state === 'panel' ? 360 : 36);
    let bounds: { left: number; top: number; right: number; bottom: number } | undefined;
    if (opts.bounds) {
      const r = opts.bounds.getBoundingClientRect();
      bounds = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
    const placed = clampPopoverPlace({
      anchor: a,
      size: { w, h: hgt },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      bounds,
    });
    root.style.left = `${placed.left}px`;
    root.style.top = `${placed.top}px`;
    root.dataset.flip = placed.flip;
  }

  // ── global keys: Tab cycle, Esc steps back (EP-15) ──
  root.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (help) { help.remove(); help = null; return; }
      if (state === 'panel' && !opts.stayOpen) { state = 'row'; root.removeAttribute('role'); renderRow(); return; }
      handle.close(true);
      return;
    }
    if (e.key === 'Tab' && state === 'panel') {
      const zones: (() => HTMLElement | null)[] = [
        () => search,
        () => tabs.find((t) => t.tabIndex === 0) ?? tabs[0]!,
        () => cells[focusIndex] ?? null,
        () => root.querySelector<HTMLElement>('.of-ep-swatch[tabindex="0"]'),
        () => footer.querySelector<HTMLElement>('button:not([disabled])'),
      ];
      const act = document.activeElement as HTMLElement;
      const colours = root.querySelector('.of-ep-colours');
      const cur = [search.contains(act), strip.contains(act), grid.contains(act), !!colours?.contains(act), footer.contains(act)].indexOf(true);
      if (cur === 4 && !e.shiftKey && act !== footer.querySelector('.of-ep-help')) return; // move through footer buttons
      if (cur === 4 && e.shiftKey && act !== footer.querySelector('button:not([disabled])')) return;
      e.preventDefault();
      for (let step = 1; step <= 5; step++) {
        const z = zones[(((cur < 0 ? 0 : cur) + (e.shiftKey ? -step : step)) % 5 + 5) % 5]!();
        if (z) { z.focus({ preventScroll: true }); break; }
      }
    }
  }, { signal: sig });

  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (root.contains(t)) return;
    if (opts.anchor instanceof Element && opts.anchor.contains(t)) return; // the toggle button
    if (opts.toggle && opts.toggle.contains(t)) return; // 0.5.30 host toggle
    handle.close(false);
  }, { capture: true, signal: sig });

  const handle: IconPickerHandle = {
    el: root,
    state: () => state,
    expand() {
      if (closed) return;
      state = 'panel';
      renderPanel();
      if (!emojiData()) {
        void loadEmojiData().then(() => { if (!closed && state === 'panel') { renderGrid(); if (opts.mode === 'node' && !search.value) scrollToSection('map', false); } });
      }
    },
    close(returnFocus = true) {
      if (closed) return;
      closed = true;
      abort.abort();
      root.remove();
      if (openPicker === handle) openPicker = null;
      if (returnFocus) {
        try { returnTo?.focus({ preventScroll: true }); } catch { /* gone */ }
      }
      opts.onClose?.();
    },
  };

  (opts.container ?? document.body).appendChild(root);
  openPicker = handle;
  void loadEmojiData();
  if (opts.expanded) handle.expand();
  else renderRow();
  return handle;
}

/** The open picker, if any (tests, hosts closing on navigation). */
export function currentIconPicker(): IconPickerHandle | null {
  return openPicker;
}

/**
 * Toolbar button (EP-29 browse path): `☺` that opens the panel under itself. `onPick`
 * receives the token; the host decides where it goes (caret in text, or the selected node).
 */
export function createIconToolbarButton(opts: Omit<IconPickerOptions, 'anchor' | 'expanded'> & { label?: string }): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'of-ep-toolbar-btn';
  b.textContent = '☺';
  b.title = opts.label ?? 'Emoji and clipart';
  b.setAttribute('aria-label', opts.label ?? 'Emoji and clipart');
  b.setAttribute('aria-haspopup', 'dialog');
  // 0.5.30: a toggle. Pressed while the picker is open; picks keep it open; press again or Esc closes.
  b.setAttribute('aria-pressed', 'false');
  b.setAttribute('aria-expanded', 'false');
  b.dataset.testid = 'of-ep-toolbar';
  b.setAttribute('data-testid', 'of-ep-toolbar');
  let mine: IconPickerHandle | null = null;
  const set = (on: boolean) => { b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-expanded', String(on)); };
  b.addEventListener('click', () => {
    if (mine && currentIconPicker() === mine) { mine.close(true); return; }
    set(true);
    mine = openIconPicker({
      stayOpen: true,
      ...opts,
      anchor: b,
      toggle: b,
      expanded: true,
      onClose: () => { mine = null; set(false); opts.onClose?.(); },
    });
  });
  return b;
}
