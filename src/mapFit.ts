/**
 * Pill widths for reading (Design UX 2026-10-08 "hold to fit", F4–F8, F12,
 * F13; F14 P1): the pure parts of the width popover's fit row, the `w` key
 * and the undo steps. `createMapView` measures the captions and applies the
 * result as ordinary `w` layout entries (plus `w-auto: single-line`, F5a).
 */

/** Narrowest stored caption column (same as a drag). */
export const WIDTH_MIN_COL = 120;
/** Widest stored caption column (same as a drag). */
export const WIDTH_MAX_COL = 1400;
/** F4: a fit within this many px of Auto deletes the entry instead (no id minted). */
export const WIDTH_AUTO_TOLERANCE = 4;
/** F5a: the single-line cap leaves this much of the map's width at 100% zoom. */
export const SINGLE_LINE_MARGIN = 48;
/** Slim / Wider step (the popover's existing items). */
export const WIDTH_STEP = 56;
/** F7: the undo toast stays about this long (D5 pattern). */
export const WIDTH_TOAST_MS = 8000;
/** F5a: the one known `w-auto` mode. */
export const W_AUTO_SINGLE_LINE = 'single-line';

/** The popover's items, in order (fit row, then the width row). */
export type WidthPickKind = 'fit' | 'line' | 'siblings' | 'slim' | 'wider' | 'auto';

/** A pill's stored width: `w` null is Auto; `wAuto` is the F5a mode. */
export interface WidthEntry {
  w: number | null;
  wAuto: string | null;
}

export function clampCol(w: number, max = WIDTH_MAX_COL): number {
  return Math.max(WIDTH_MIN_COL, Math.min(Math.max(WIDTH_MIN_COL, max), Math.round(w)));
}

/**
 * F5a cap for a single-line pill: min(1400, the map's visible width at 100%
 * zoom − 48). An unknown width (no layout yet) uses 1400.
 */
export function singleLineCap(viewportW: number | null | undefined): number {
  if (typeof viewportW !== 'number' || !Number.isFinite(viewportW) || viewportW <= 0) return WIDTH_MAX_COL;
  return Math.max(WIDTH_MIN_COL, Math.min(WIDTH_MAX_COL, Math.floor(viewportW - SINGLE_LINE_MARGIN)));
}

/** F5 / F5a: the stored px for a single-line pill (natural width, capped, floored). */
export function singleLineWidth(natural: number, cap: number): number {
  return Math.max(WIDTH_MIN_COL, Math.min(cap, Math.ceil(natural)));
}

/**
 * F4 "Fit text": the widest line at 60ch (+ pads), floored at 120 and capped
 * at 1400. Within 4 px of Auto (or narrower than Auto) the entry is deleted.
 */
export function fitTextEntry(m: { fit: number; auto: number }): WidthEntry {
  // Compared before the 120 floor: a caption that already sits on one line at
  // Auto (Auto at or wider than the fit) stays Auto, never a floored 120.
  if (Math.ceil(m.fit) <= m.auto + WIDTH_AUTO_TOLERANCE) return { w: null, wAuto: null };
  const w = Math.max(WIDTH_MIN_COL, Math.min(WIDTH_MAX_COL, Math.ceil(m.fit)));
  if (Math.abs(w - m.auto) <= WIDTH_AUTO_TOLERANCE) return { w: null, wAuto: null };
  return { w, wAuto: null };
}

/**
 * F5 / F5a "1 line": the natural one-line width with the cap, saved with
 * `w-auto: single-line`. Lines past the cap wrap there (`capped`), never "…".
 * A caption that already sits on one line at Auto (natural ≤ Auto + 4 px)
 * keeps Auto: nothing is written and no id is minted (F8).
 */
export function oneLineEntry(m: { natural: number; auto: number; cap: number }): WidthEntry & { capped: boolean } {
  const capped = Math.ceil(m.natural) > m.cap;
  if (!capped && m.natural <= m.auto + WIDTH_AUTO_TOLERANCE) return { w: null, wAuto: null, capped: false };
  return { w: singleLineWidth(m.natural, m.cap), wAuto: W_AUTO_SINGLE_LINE, capped };
}

/** Slim / Wider from the painted caption column. A hand-set width drops `w-auto` (F5a). */
export function stepEntry(textW: number, dir: -1 | 1): WidthEntry {
  return { w: clampCol(textW + dir * WIDTH_STEP), wAuto: null };
}

export function sameWidth(a: WidthEntry, b: WidthEntry): boolean {
  return (a.w ?? null) === (b.w ?? null) && (a.wAuto || null) === (b.wAuto || null);
}

/**
 * F6 siblings scope: the children of the same parent (forest roots are
 * siblings of each other), the pressed node first, never descendants.
 */
export function siblingScope<T>(pressed: T, parentKids: readonly T[] | null | undefined): T[] {
  const kids = parentKids && parentKids.includes(pressed) ? parentKids : [pressed];
  return [pressed, ...kids.filter((k) => k !== pressed)];
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
}

/** F7 toast text: "4 widths changed". */
export function widthToastText(changed: number): string {
  return `${plural(changed, 'width', 'widths')} changed`;
}

/**
 * F12 live-region text for a pick. `title` is the pressed node's caption,
 * `count` the pills in scope, `capped` how many still wrap at the cap.
 */
export function widthPickAnnouncement(
  kind: WidthPickKind,
  p: { title: string; count?: number; capped?: number; auto?: boolean },
): string {
  const title = p.title.replace(/\s+/g, ' ').trim() || 'Node';
  const capped = p.capped ?? 0;
  const capText =
    capped > 0 ? ` ${capped.toLocaleString('en')} ${capped === 1 ? 'wraps' : 'wrap'} at the cap.` : '';
  switch (kind) {
    case 'line':
      return `${title} on 1 line.${capText}`;
    case 'siblings': {
      const others = Math.max(0, (p.count ?? 1) - 1);
      const who = others > 0 ? `${title} and ${plural(others, 'sibling', 'siblings')}` : title;
      return `${who} on 1 line.${capText}`;
    }
    case 'fit':
      return p.auto ? `${title} at default width.` : `${title} wraps at 60 characters.`;
    case 'slim':
      return `${title} narrower.`;
    case 'wider':
      return `${title} wider.`;
    case 'auto':
      return `${title} at default width.`;
  }
}

/** F12: after Undo / Redo of a width step. */
export const WIDTHS_RESTORED = 'Widths restored.';
export const WIDTHS_REDONE = 'Widths changed again.';

/**
 * F13 help lines for a host's `?` help, P1 only (the grip hold and the
 * fold-handle Child widths row are P2). No on-page copy.
 */
export const WIDTH_HELP_LINES: readonly string[] = [
  'Fit text: wrap at 60 characters. 1 line: no wrapping.',
  'Auto: default width.',
  'w: width menu. Ctrl/⌘+Z: undo widths.',
];

/** Popover mnemonics (F11): `t` Fit text, `l` 1 line, `s` 1 line siblings, `a` Auto. */
export const WIDTH_MENU_KEYS: Readonly<Partial<Record<WidthPickKind, string>>> = {
  fit: 't',
  line: 'l',
  siblings: 's',
  auto: 'a',
};

/** Popover item whose mnemonic is `key`, or null. */
export function widthMenuKeyItem(key: string): WidthPickKind | null {
  const k = key.length === 1 ? key.toLowerCase() : '';
  for (const [kind, hint] of Object.entries(WIDTH_MENU_KEYS)) {
    if (hint === k) return kind as WidthPickKind;
  }
  return null;
}
