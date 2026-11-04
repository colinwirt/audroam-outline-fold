/**
 * 0.5.18 emoji + Map clipart picker (Design UX 2026-11-04 EP-3…EP-21).
 *
 * Two states at one anchor: the quick row (6 items + `＋`, EP-4) and the compact panel
 * (320 × 360, EP-6): search, a 28px category strip, an 8-column grid with sticky section
 * headers (only the grid scrolls), and a footer with preview, name, Pin, Remove icon and `?`.
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
  /** Open on the panel instead of the quick row (node menu, toolbar, Ctrl/Cmd+.). */
  expanded?: boolean;
  prefs?: IconPrefs;
  /** Parent for the floating element. Default document.body. */
  container?: HTMLElement;
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

function coarse(): boolean {
  try {
    return matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** Opens the picker. One at a time: an open picker closes first. */
export function openIconPicker(opts: IconPickerOptions): IconPickerHandle {
  openPicker?.close(false);
  const id = `of-ep-${++seq}`;
  const prefs = opts.prefs ?? createIconPrefs();
  const returnTo = document.activeElement as HTMLElement | null;
  const sheet = opts.sheet ?? coarse();
  const cols = sheet ? 7 : 8;
  const root = h('div', `of-ep${sheet ? ' of-ep-sheet' : ''}`, { 'data-testid': 'of-ep', 'data-mode': opts.mode });
  const abort = new AbortController();
  const sig = abort.signal;
  let state: 'row' | 'panel' = 'row';
  let closed = false;

  const live = h('div', 'of-ep-live', { role: 'status', 'aria-live': 'polite', 'data-testid': 'of-ep-live' });

  const pick = (it: IconItem, keepOpen: boolean) => {
    prefs.useRecent(it.insert);
    opts.onPick(it.insert, { keepOpen, item: it });
    if (!keepOpen) handle.close(true);
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
  let grid!: HTMLElement;
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

    grid = h('div', 'of-ep-grid', { role: 'grid', id: `${id}-grid`, 'aria-label': 'Emoji and clipart', 'data-testid': 'of-ep-grid' });
    grid.addEventListener('keydown', onGridKey, { signal: sig });
    grid.addEventListener('scroll', () => syncTab(), { signal: sig, passive: true });

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

    root.append(search, strip, grid, footer, live);
    renderGrid();
    place();
    // EP-10: node mode opens on the Map tab.
    if (opts.mode === 'node') scrollToSection('map', false);
    search.focus({ preventScroll: true });
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
      if (hits.length) addSection('results', 'Results', hits);
      else grid.appendChild(h('div', 'of-ep-empty', { 'data-testid': 'of-ep-empty' }, 'No matches'));
      live.textContent = hits.length ? `${hits.length} result${hits.length === 1 ? '' : 's'}` : 'No matches';
      strip.classList.add('of-ep-strip-dim');
    } else {
      strip.classList.remove('of-ep-strip-dim');
      for (const s of sections()) if (s.items.length || s.key === 'map') addSection(s.key, s.label, s.items);
    }
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
    if (sec) grid.scrollTop = sec.offsetTop - grid.offsetTop;
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
    if (!sectionEls.length || search?.value) return;
    const top = grid.scrollTop + grid.offsetTop + 4;
    let cur = sectionEls[0]!.key;
    for (const s of sectionEls) if (s.el.offsetTop <= top) cur = s.key;
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
    const w = root.offsetWidth || (state === 'panel' ? 320 : 240);
    const hgt = root.offsetHeight || (state === 'panel' ? 360 : 36);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(4, Math.min(a.left, vw - w - 4));
    // EP-5: flip above when there is no room below.
    let top = a.bottom + 6;
    if (top + hgt > vh - 4 && a.top - hgt - 6 >= 4) top = a.top - hgt - 6;
    top = Math.max(4, Math.min(top, vh - hgt - 4));
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.dataset.flip = top < a.top ? 'above' : 'below';
  }

  // ── global keys: Tab cycle, Esc steps back (EP-15) ──
  root.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (help) { help.remove(); help = null; return; }
      if (state === 'panel') { state = 'row'; root.removeAttribute('role'); renderRow(); return; }
      handle.close(true);
      return;
    }
    if (e.key === 'Tab' && state === 'panel') {
      const zones: (() => HTMLElement | null)[] = [
        () => search,
        () => tabs.find((t) => t.tabIndex === 0) ?? tabs[0]!,
        () => cells[focusIndex] ?? null,
        () => footer.querySelector<HTMLElement>('button:not([disabled])'),
      ];
      const act = document.activeElement as HTMLElement;
      const cur = [search.contains(act), strip.contains(act), grid.contains(act), footer.contains(act)].indexOf(true);
      if (cur === 3 && !e.shiftKey && act !== footer.querySelector('.of-ep-help')) return; // move through footer buttons
      if (cur === 3 && e.shiftKey && act !== footer.querySelector('button:not([disabled])')) return;
      e.preventDefault();
      for (let step = 1; step <= 4; step++) {
        const z = zones[(((cur < 0 ? 0 : cur) + (e.shiftKey ? -step : step)) % 4 + 4) % 4]!();
        if (z) { z.focus({ preventScroll: true }); break; }
      }
    }
  }, { signal: sig });

  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (root.contains(t)) return;
    if (opts.anchor instanceof Element && opts.anchor.contains(t)) return; // the toggle button
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
  b.dataset.testid = 'of-ep-toolbar';
  b.setAttribute('data-testid', 'of-ep-toolbar');
  b.addEventListener('click', () => {
    if (currentIconPicker()) { currentIconPicker()!.close(true); return; }
    b.setAttribute('aria-expanded', 'true');
    openIconPicker({ ...opts, anchor: b, expanded: true, onClose: () => { b.setAttribute('aria-expanded', 'false'); opts.onClose?.(); } });
  });
  return b;
}
