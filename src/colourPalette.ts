/**
 * Dedicated colour palette popover: the main way to pick a node colour from a
 * host toolbar button (next to fill / cloud / emoji). Compact 2-row + `…` on
 * narrow or coarse viewports; stay-open picks so the host's undo / style-preview
 * path can run; dismiss with ×, backdrop, tap-outside, or Escape.
 */
import {
  renderNodeMenu,
  isCompactSwatchMenu,
  placeNodeMenu,
  type NodeMenuEntry,
  type NodeMenuView,
} from './nodeMenu.js';
import { bindTap } from './mapTap.js';
import { colourGroups, colourLabel, resolveColour } from './nodeColour.js';
import { recentColours, rememberColour } from './colourRecent.js';

export type ColourPaletteOptions = {
  /** Anchor element (toolbar button) or a client-point. */
  anchor?: Element | { x: number; y: number } | null;
  value?: string;
  palette?: string;
  recent?: string[];
  compact?: boolean;
  fine?: boolean;
  onColour: (color: string | undefined) => void;
  onClose?: () => void;
  /** Parent for the floating element. Default `document.body`. */
  container?: HTMLElement;
  /** Optional clip box (e.g. the map host). */
  bounds?: Element | null;
  /** Host toggle button: its own press is not an outside press. */
  toggle?: Element | null;
  /** Stay open across picks (toolbar preview). Default true. */
  stayOpen?: boolean;
};

export type ColourPaletteHandle = {
  el: HTMLElement;
  close: (returnFocus?: boolean) => void;
};

let current: ColourPaletteHandle | null = null;

export function currentColourPalette(): ColourPaletteHandle | null {
  return current;
}

/** Menu entries for every palette group (None on the first). */
export function colourMenuEntries(opts: {
  current?: string;
  palette?: string;
  keyPrefix?: string;
  row?: string;
}): NodeMenuEntry[] {
  const prefix = opts.keyPrefix ?? 'color';
  const row = opts.row ?? 'Colour';
  const cur = resolveColour(opts.current) ?? 'none';
  const out: NodeMenuEntry[] = [];
  colourGroups(opts.palette).forEach((g, gi) => {
    const r = `${row} · ${g.name}`;
    if (gi === 0) {
      out.push({
        key: `${prefix}:none`,
        label: 'None',
        group: 'Edit',
        swatch: 'none',
        row: r,
        checked: cur === 'none',
      });
    }
    for (const c of g.colours) {
      out.push({
        key: `${prefix}:${c}`,
        label: colourLabel(c, opts.palette),
        group: 'Edit',
        swatch: c,
        row: r,
        checked: cur === c,
      });
    }
  });
  return out;
}

function coarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)')?.matches;
  } catch {
    return false;
  }
}

function bindItems(view: NodeMenuView, apply: (key: string) => void, sig: AbortSignal): void {
  for (const b of view.items) {
    const key = b.dataset.item;
    if (!key) continue;
    bindTap(
      b,
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        apply(key);
      },
      { signal: sig },
    );
  }
}

/**
 * Open a compact (or full, on a wide fine pointer) colour palette.
 * Closes any previously open palette.
 */
export function openColourPalette(opts: ColourPaletteOptions): ColourPaletteHandle {
  current?.close(false);

  const fine = opts.fine ?? !coarsePointer();
  const compact = isCompactSwatchMenu({ fine, compact: opts.compact });
  const stayOpen = opts.stayOpen !== false;
  const container = opts.container ?? document.body;
  const abort = new AbortController();
  const sig = abort.signal;

  let cur: string = resolveColour(opts.value) ?? 'none';
  const entries = colourMenuEntries({ current: cur, palette: opts.palette });

  const rebuild = () =>
    renderNodeMenu({
      title: 'Colour',
      entries: colourMenuEntries({ current: cur, palette: opts.palette }),
      fine,
      compact,
      recent: opts.recent ?? recentColours(),
      closable: true,
      backdrop: true,
      onItemsChange: (items) => {
        view.items = items;
        bindItems(view, apply, sig);
      },
    });

  let view = rebuild();
  view.el.classList.add('of-colour-palette');
  view.el.setAttribute('data-testid', 'of-colour-palette');

  const apply = (itemKey: string): void => {
    const name = itemKey.includes(':') ? itemKey.slice(itemKey.indexOf(':') + 1) : itemKey;
    const next = name === 'none' ? undefined : (resolveColour(name) ?? name);
    cur = next ?? 'none';
    rememberColour(next);
    opts.onColour(next);
    // Update checked state in place (stay-open preview).
    for (const b of view.items) {
      const k = b.dataset.swatch;
      if (!k) continue;
      const on = k === cur;
      b.setAttribute('aria-checked', String(on));
    }
    if (!stayOpen) handle.close(true);
  };

  bindItems(view, apply, sig);

  if (view.closeBtn) {
    bindTap(
      view.closeBtn,
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        handle.close(true);
      },
      { signal: sig },
    );
  }

  if (getComputedStyle(container).position === 'static' && container !== document.body) {
    container.style.position = 'relative';
  }
  if (view.backdrop) container.appendChild(view.backdrop);
  container.appendChild(view.el);

  const cr = container === document.body
    ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    : container.getBoundingClientRect();
  let at = { x: 8, y: 8 };
  if (opts.anchor && typeof (opts.anchor as Element).getBoundingClientRect === 'function') {
    const r = (opts.anchor as Element).getBoundingClientRect();
    at = { x: r.left - cr.left, y: r.bottom - cr.top + 4 };
  } else if (opts.anchor && typeof (opts.anchor as { x: number }).x === 'number') {
    const p = opts.anchor as { x: number; y: number };
    at = { x: p.x - cr.left, y: p.y - cr.top };
  }
  const panel = {
    w: container === document.body ? window.innerWidth : container.clientWidth || cr.width,
    h: container === document.body ? window.innerHeight : container.clientHeight || cr.height,
  };
  const pos = placeNodeMenu({ at, panel, menu: { w: view.el.offsetWidth, h: view.el.offsetHeight } });
  // When mounted on body, placeNodeMenu used client coords already (cr is 0,0).
  if (container === document.body) {
    view.el.style.position = 'fixed';
    view.el.style.left = `${pos.left}px`;
    view.el.style.top = `${pos.top}px`;
  } else {
    view.el.style.left = `${pos.left}px`;
    view.el.style.top = `${pos.top}px`;
  }

  const isInside = (t: EventTarget | null): boolean => {
    const n = t as Node | null;
    if (!n) return false;
    if (view.el.contains(n)) return true;
    if (opts.toggle && opts.toggle.contains(n as Node)) return true;
    return false;
  };

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (isInside(e.target)) return;
      handle.close(false);
    },
    { capture: true, signal: sig },
  );
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      handle.close(true);
    },
    { capture: true, signal: sig },
  );

  const handle: ColourPaletteHandle = {
    el: view.el,
    close: (_returnFocus = true) => {
      if (current === handle) current = null;
      abort.abort();
      view.backdrop?.remove();
      view.el.remove();
      opts.onClose?.();
    },
  };
  current = handle;
  return handle;
}

/**
 * A toolbar Colour button. Pass a map handle to toggle the focused node's
 * palette (stay-open, existing undo / style-preview). Or pass `onColour` for a
 * standalone picker.
 */
export function createColourToolbarButton(opts: {
  label?: string;
  map?: {
    toggleColourPalette: (id?: string, how?: { toggle?: Element | null }) => boolean;
    onColourPaletteChange: (fn: (open: boolean) => void) => () => void;
  };
  value?: () => string | undefined;
  palette?: string;
  onColour?: (color: string | undefined) => void;
  container?: HTMLElement;
}): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'of-colour-toolbar-btn';
  b.textContent = opts.label ?? 'Colour';
  b.title = opts.label ?? 'Colour';
  b.setAttribute('aria-label', opts.label ?? 'Colour');
  b.setAttribute('aria-haspopup', 'menu');
  b.setAttribute('aria-pressed', 'false');
  b.setAttribute('aria-expanded', 'false');
  b.setAttribute('data-testid', 'of-colour-toolbar');
  const set = (on: boolean) => {
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-expanded', String(on));
  };
  if (opts.map) {
    b.addEventListener('click', () => {
      opts.map!.toggleColourPalette(undefined, { toggle: b });
    });
    opts.map.onColourPaletteChange(set);
  } else {
    let mine: ColourPaletteHandle | null = null;
    b.addEventListener('click', () => {
      if (mine && currentColourPalette() === mine) {
        mine.close(true);
        return;
      }
      set(true);
      mine = openColourPalette({
        anchor: b,
        toggle: b,
        value: opts.value?.(),
        palette: opts.palette,
        onColour: (c) => opts.onColour?.(c),
        container: opts.container,
        stayOpen: true,
        onClose: () => {
          mine = null;
          set(false);
        },
      });
    });
  }
  return b;
}
