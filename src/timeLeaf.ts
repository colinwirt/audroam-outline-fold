/**
 * Map time leaves (0.2.40, Design UX 2026-10-09 "map time leaf", TL1–TL8).
 *
 * A line with `<kind:time>` or `<kind:session>` and no children is a time leaf
 * on the Map: a compact, single-line, green pill with a bold `T` / `S` kind
 * letter. A record line with children stays a normal note pill (TL6).
 *
 * What the package formats (and nothing else):
 * - the kind letter (`T` for time, `S` for session), drawn before the caption
 *   from the kind, with the accessible name "Time record" / "Session record";
 * - the node's accessible name: "Time record, <caption>";
 * - one line: authored line breaks become spaces and a caption longer than
 *   `TIME_LEAF_MAX_CH` characters is cut with `…` (the full caption stays in
 *   the tooltip);
 * - a `●` in the caption is painted in the kind letter's green (the running
 *   record's `● open`).
 *
 * The date, the duration and `● open` are the host's caption: the package does
 * not read or reformat dates or times (TL3).
 */
import type { OutlineNode } from './types.js';

export type TimeLeafKind = 'time' | 'session';

/** TL1: time leaves paint at 0.85× the map font (13.5 px on 16). */
export const TIME_LEAF_FONT_SCALE = 0.85;
/** TL1: vertical pad inside a time leaf (a note pill uses 10, and at least 44 px). */
export const TIME_LEAF_PAD_Y = 8;
/** TL3: a caption longer than this is cut to one line with `…`. */
export const TIME_LEAF_MAX_CH = 48;
/** TL5: the gap between two consecutive time leaves under one parent. */
export const TIME_LEAF_GAP_Y = 6;
/** Left pad before the kind letter, and the gap between letter and caption. */
export const TIME_LEAF_PAD_X = 12;
export const TIME_LEAF_LETTER_GAP = 5;

export const TIME_LEAF_LETTER: Record<TimeLeafKind, string> = { time: 'T', session: 'S' };
export const TIME_LEAF_NAME: Record<TimeLeafKind, string> = {
  time: 'Time record',
  session: 'Session record',
};

/** `time` / `session` for a kind string (any case), else null. */
export function timeKindOf(kind: string | null | undefined): TimeLeafKind | null {
  const k = typeof kind === 'string' ? kind.toLowerCase() : '';
  return k === 'time' || k === 'session' ? k : null;
}

/** The node's time-leaf kind: a `time` / `session` kind on a line with no children. */
export function timeLeafKind(n: Pick<OutlineNode, 'kind' | 'children'> | null | undefined): TimeLeafKind | null {
  if (!n || (n.children && n.children.length > 0)) return null;
  return timeKindOf(n.kind);
}

/**
 * TL1: the time leaf font from the map font: 0.85×, rounded to the nearest
 * 0.5 px (16 → 13.5).
 */
export function timeLeafFontPx(mapFontPx: number): number {
  return Math.round(mapFontPx * TIME_LEAF_FONT_SCALE * 2) / 2;
}

/**
 * TL3: the one line a time leaf shows. Line breaks (`\n`, `<br>`) become a
 * space, runs of spaces collapse, and a caption over `max` characters is cut
 * at `max - 1` plus `…`.
 */
export function timeLeafCaption(label: string, max = TIME_LEAF_MAX_CH): string {
  const one = String(label ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  const chars = Array.from(one);
  if (chars.length <= max) return one;
  return chars.slice(0, Math.max(1, max - 1)).join('').trimEnd() + '…';
}

/** The node's accessible name: "Time record, Thu 8 Oct · 1:25". */
export function timeLeafAriaLabel(kind: TimeLeafKind, caption: string): string {
  const c = caption.trim();
  return c ? `${TIME_LEAF_NAME[kind]}, ${c}` : TIME_LEAF_NAME[kind];
}
