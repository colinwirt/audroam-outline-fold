/**
 * Multi-line scrapbook label measure for Map pills.
 * Break tokens + tiny HTML normalized before wrap (0.2.13; literal \n 0.2.15);
 * measure counts visible characters only; richLines carry bold/italic for paint.
 *
 * Product lock (Design 2026-09-29 compromise):
 * - Default maxLines ≈ **30** + “more” / “less” (not harsh 6, not unlimited)
 * - Soft engine safety ~500 lines / ~50k chars ABOVE product clip
 * - bodyExpanded → measure with maxLines null (up to soft safety)
 */

import {
  captionStyleRuns,
  captionVisibleText,
  type CaptionStyleRun,
} from './captionRich.js';

export const DEFAULT_WRAP_CH = 32;
/** Product default clip — generous journal leaf (~30 lines). */
export const DEFAULT_MAX_LINES = 30;
/** Soft engine safety (pathological paste) — above product clip. */
export const SOFT_SAFETY_MAX_LINES = 500;
export const SOFT_SAFETY_MAX_CHARS = 50_000;

export const CHAR_W = 7.2;
export const LINE_H = 16;
export const PILL_PAD_Y = 10;
export const TASK_LEAD = 28;
export const MIN_TEXT_W = 88;
/** Extra height reserved for “more”/“less” affordance when clipped or expanded. */
export const MORE_AFFORDANCE_H = 18;

export interface WrapResult {
  lines: string[];
  /** Same lines as styled runs for Map SVG paint (bold/italic). */
  richLines: CaptionStyleRun[][];
  truncated: boolean;
  fullText: string;
  softSafetyHit?: boolean;
  /** Total soft-wrapped lines before product/safety clip (for more affordance). */
  totalLines: number;
}

type StyledChar = { c: string; bold: boolean; italic: boolean; code: boolean };

function runsToChars(runs: CaptionStyleRun[]): StyledChar[] {
  const chars: StyledChar[] = [];
  for (const r of runs) {
    for (const c of r.text) {
      chars.push({ c, bold: r.bold, italic: r.italic, code: r.code });
    }
  }
  return chars;
}

function charsToRuns(chars: StyledChar[]): CaptionStyleRun[] {
  if (!chars.length) return [{ text: '', bold: false, italic: false, code: false }];
  const runs: CaptionStyleRun[] = [];
  let cur: CaptionStyleRun = {
    text: chars[0]!.c,
    bold: chars[0]!.bold,
    italic: chars[0]!.italic,
    code: chars[0]!.code,
  };
  for (let i = 1; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch.bold === cur.bold && ch.italic === cur.italic && ch.code === cur.code) {
      cur.text += ch.c;
    } else {
      runs.push(cur);
      cur = { text: ch.c, bold: ch.bold, italic: ch.italic, code: ch.code };
    }
  }
  runs.push(cur);
  return runs;
}

function softWrapChars(chars: StyledChar[], ch: number): StyledChar[][] {
  if (chars.length === 0) return [[]];
  const lines: StyledChar[][] = [];
  let remaining = chars;
  while (remaining.length > ch) {
    let breakAt = -1;
    for (let i = Math.min(ch, remaining.length - 1); i >= 0; i--) {
      if (remaining[i]!.c === ' ') {
        breakAt = i;
        break;
      }
    }
    if (breakAt <= 0) breakAt = ch;
    let piece = remaining.slice(0, breakAt);
    while (piece.length && piece[piece.length - 1]!.c === ' ') piece = piece.slice(0, -1);
    lines.push(piece);
    remaining = remaining.slice(breakAt);
    while (remaining.length && remaining[0]!.c === ' ') remaining = remaining.slice(1);
  }
  if (remaining.length || lines.length === 0) lines.push(remaining);
  return lines;
}

/**
 * Soft-wrap `text` at ~wrapCh.
 * Normalizes breaks + strips/allowlists tiny HTML first (visible measure).
 * `maxLines`: number = product/hard clip; `null` = full body up to soft safety.
 */
export function wrapLines(
  text: string,
  wrapCh: number = DEFAULT_WRAP_CH,
  maxLines: number | null = DEFAULT_MAX_LINES,
): WrapResult {
  const original = String(text ?? '');
  let runs = captionStyleRuns(original);
  // Soft-safety on visible length
  let visible = captionVisibleText(original);
  let softSafetyHit = false;
  if (visible.length > SOFT_SAFETY_MAX_CHARS) {
    softSafetyHit = true;
    // Truncate runs to soft char budget
    let left = SOFT_SAFETY_MAX_CHARS;
    const trimmed: CaptionStyleRun[] = [];
    for (const r of runs) {
      if (left <= 0) break;
      if (r.text.length <= left) {
        trimmed.push(r);
        left -= r.text.length;
      } else {
        trimmed.push({ ...r, text: r.text.slice(0, left) });
        left = 0;
      }
    }
    runs = trimmed;
    visible = captionVisibleText(
      // rebuild approx — visible from trimmed runs
      runs.map((r) => r.text).join(''),
    );
  }

  const ch = Math.max(8, Math.floor(wrapCh) || DEFAULT_WRAP_CH);

  // Split runs into paragraphs on LF inside run text
  const paragraphs: CaptionStyleRun[][] = [[]];
  for (const r of runs) {
    const parts = r.text.split('\n');
    for (let pi = 0; pi < parts.length; pi++) {
      if (pi > 0) paragraphs.push([]);
      const piece = parts[pi]!;
      if (piece.length || (pi === 0 && parts.length === 1)) {
        paragraphs[paragraphs.length - 1]!.push({
          text: piece,
          bold: r.bold,
          italic: r.italic,
          code: r.code,
        });
      }
    }
  }

  const rawRich: CaptionStyleRun[][] = [];
  for (const para of paragraphs) {
    const paraText = para.map((r) => r.text).join('');
    if (paraText === '' && para.length === 0) {
      rawRich.push([{ text: '', bold: false, italic: false, code: false }]);
      continue;
    }
    if (paraText === '') {
      rawRich.push([{ text: '', bold: false, italic: false, code: false }]);
      continue;
    }
    const wrapped = softWrapChars(runsToChars(para), ch);
    for (const lineChars of wrapped) {
      rawRich.push(charsToRuns(lineChars));
    }
  }
  if (rawRich.length === 0) {
    rawRich.push([{ text: '', bold: false, italic: false, code: false }]);
  }

  const totalLines = rawRich.length;

  let cap: number;
  if (maxLines == null || !Number.isFinite(maxLines)) {
    cap = SOFT_SAFETY_MAX_LINES;
  } else {
    cap = Math.max(1, Math.floor(maxLines));
    cap = Math.min(cap, SOFT_SAFETY_MAX_LINES);
  }

  let truncated = softSafetyHit;
  let richLines = rawRich;
  if (rawRich.length > cap) {
    truncated = true;
    if (maxLines == null || !Number.isFinite(maxLines)) softSafetyHit = true;
    richLines = rawRich.slice(0, cap);
    const lastRuns = richLines[cap - 1] ?? [{ text: '', bold: false, italic: false, code: false }];
    const lastPlain = lastRuns.map((r) => r.text).join('');
    if (lastPlain.length >= ch) {
      // Truncate last line runs to ch-1 + ellipsis
      let left = Math.max(1, ch - 1);
      const cut: CaptionStyleRun[] = [];
      for (const r of lastRuns) {
        if (left <= 0) break;
        if (r.text.length <= left) {
          cut.push(r);
          left -= r.text.length;
        } else {
          cut.push({ ...r, text: r.text.slice(0, left) });
          left = 0;
        }
      }
      const ellipsisBold = cut.length ? cut[cut.length - 1]!.bold : false;
      const ellipsisItalic = cut.length ? cut[cut.length - 1]!.italic : false;
      cut.push({ text: '…', bold: ellipsisBold, italic: ellipsisItalic, code: false });
      richLines[cap - 1] = cut;
    } else {
      const ellipsisBold = lastRuns.length
        ? lastRuns[lastRuns.length - 1]!.bold
        : false;
      const ellipsisItalic = lastRuns.length
        ? lastRuns[lastRuns.length - 1]!.italic
        : false;
      richLines[cap - 1] = [
        ...lastRuns,
        { text: '…', bold: ellipsisBold, italic: ellipsisItalic, code: false },
      ];
    }
  } else if (softSafetyHit && richLines.length) {
    const last = richLines[richLines.length - 1]!;
    const plain = last.map((r) => r.text).join('');
    if (!plain.endsWith('…')) {
      richLines[richLines.length - 1] = [
        ...last,
        {
          text: '…',
          bold: last.length ? last[last.length - 1]!.bold : false,
          italic: last.length ? last[last.length - 1]!.italic : false,
          code: false,
        },
      ];
    }
  }

  const lines = richLines.map((rs) => rs.map((r) => r.text).join(''));

  return {
    lines,
    richLines,
    truncated,
    fullText: original,
    softSafetyHit,
    totalLines,
  };
}

export interface MeasurePillOpts {
  wrapCh?: number;
  /** Product clip; null = expanded / unlimited up to soft safety. */
  maxLines?: number | null;
  /** When true, measure as expanded (maxLines null) regardless of opts.maxLines. */
  bodyExpanded?: boolean;
  reserveFold?: boolean;
  reserveTask?: boolean;
  foldSlot?: number;
  taskLead?: number;
  /** Reserve height for more/less chrome when truncated or expanded-from-clip. */
  reserveMoreAffordance?: boolean;
}

export interface MeasuredPill {
  w: number;
  h: number;
  textW: number;
  foldSlot: number;
  taskLead: number;
  lines: string[];
  richLines: CaptionStyleRun[][];
  truncated: boolean;
  fullText: string;
  softSafetyHit?: boolean;
  totalLines: number;
  showMore: boolean;
  showLess: boolean;
  bodyExpanded: boolean;
  effectiveMaxLines: number | null;
}

/**
 * Resolve effective maxLines for measure/paint.
 * Expanded → null (soft safety only). Else authored or DEFAULT_MAX_LINES (30).
 */
export function resolveEffectiveMaxLines(
  opts: { maxLines?: number | null; bodyExpanded?: boolean } = {},
): number | null {
  if (opts.bodyExpanded) return null;
  if (opts.maxLines === null) return null;
  if (typeof opts.maxLines === 'number' && Number.isFinite(opts.maxLines)) {
    return Math.max(1, Math.floor(opts.maxLines));
  }
  return DEFAULT_MAX_LINES;
}

export function measurePill(
  label: string,
  opts: MeasurePillOpts = {},
): MeasuredPill {
  const wrapCh = opts.wrapCh ?? DEFAULT_WRAP_CH;
  const bodyExpanded = !!opts.bodyExpanded;
  const effectiveMaxLines = resolveEffectiveMaxLines({
    maxLines: opts.maxLines,
    bodyExpanded,
  });
  const foldSlot = opts.reserveFold ? (opts.foldSlot ?? 34) : 0;
  const taskLead = opts.reserveTask ? (opts.taskLead ?? TASK_LEAD) : 0;
  const wrapped = wrapLines(label, wrapCh, effectiveMaxLines);
  const textW = Math.max(MIN_TEXT_W, Math.round(wrapCh * CHAR_W));
  const lineCount = Math.max(1, wrapped.lines.length);

  // “more” when product-clipped (not only soft-safety); “less” when expanded and
  // content would exceed default/authored skim.
  const productCap =
    typeof opts.maxLines === 'number' && Number.isFinite(opts.maxLines)
      ? Math.max(1, Math.floor(opts.maxLines))
      : DEFAULT_MAX_LINES;
  const showMore = !bodyExpanded && wrapped.truncated && !wrapped.softSafetyHit;
  const showLess =
    bodyExpanded && wrapped.totalLines > productCap && !wrapped.softSafetyHit;
  // Soft-safety truncated while expanded: still offer less if over productCap
  const showLessSoft =
    bodyExpanded &&
    wrapped.totalLines > productCap &&
    !!wrapped.softSafetyHit;
  const needsAffordance =
    opts.reserveMoreAffordance !== false &&
    (showMore || showLess || showLessSoft);

  const h =
    Math.max(44, PILL_PAD_Y * 2 + lineCount * LINE_H) +
    (needsAffordance ? MORE_AFFORDANCE_H : 0);

  return {
    w: textW + foldSlot + taskLead,
    h,
    textW,
    foldSlot,
    taskLead,
    lines: wrapped.lines,
    richLines: wrapped.richLines,
    truncated: wrapped.truncated,
    fullText: wrapped.fullText,
    softSafetyHit: wrapped.softSafetyHit,
    totalLines: wrapped.totalLines,
    showMore,
    showLess: showLess || showLessSoft,
    bodyExpanded,
    effectiveMaxLines,
  };
}
