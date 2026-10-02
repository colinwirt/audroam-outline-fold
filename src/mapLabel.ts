/**
 * Multi-line scrapbook label measure for Map pills.
 * Break tokens + tiny HTML normalized before wrap (0.2.13; literal \n 0.2.15);
 * measure counts visible characters only; richLines carry bold/italic/code for paint.
 * wrapCh is only the max line before a break. The pill border is the widest
 * measured line plus PILL_PAD_X, not a fixed column.
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
import { measureRunWidth } from './svgTextMeasure.js';

export const DEFAULT_WRAP_CH = 32;
/** Product default clip — generous journal leaf (~30 lines). */
export const DEFAULT_MAX_LINES = 30;
/** Soft engine safety (pathological paste) — above product clip. */
export const SOFT_SAFETY_MAX_LINES = 500;
export const SOFT_SAFETY_MAX_CHARS = 50_000;

/** Painted label size when frontmatter and the layout file omit fontSize. */
export const DEFAULT_FONT_PX = 16;
/** Advances below were tuned at this size. Other sizes scale from it. */
export const BASE_FONT_PX = 13;
export const CHAR_W = 7.2;
/** 13px monospace advance. Wider than the proportional average, so code lines grow the pill. */
export const CODE_CHAR_W = 8.4;
export const LINE_H = 16;
export const PILL_PAD_Y = 10;
export const TASK_LEAD = 28;
export const MIN_TEXT_W = 36;
/** Air between the glyphs and the pill border. The border is this plus the measured line. */
export const PILL_PAD_X = 16;
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
  /** Caption column width in px. When set, lines wrap to this instead of wrapCh. */
  widthPx?: number;
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
  fontSize?: number;
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
  fontPx: number;
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

export function clampFontPx(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_FONT_PX;
  return Math.min(48, Math.max(11, value));
}

/** Per-node layout, then the layout file, then outline frontmatter, then 16. */
export function resolveFontPx(
  node: number | undefined,
  layout: number | undefined,
  frontmatter: number | undefined,
): number {
  if (typeof node === 'number' && Number.isFinite(node)) return clampFontPx(node);
  if (typeof layout === 'number' && Number.isFinite(layout)) return clampFontPx(layout);
  if (typeof frontmatter === 'number' && Number.isFinite(frontmatter)) return clampFontPx(frontmatter);
  return DEFAULT_FONT_PX;
}

export function lineBox(fontPx: number): number {
  return (clampFontPx(fontPx) / BASE_FONT_PX) * LINE_H;
}

/** Predicted width when the document cannot measure painted SVG text. */
export function lineAdvance(runs: CaptionStyleRun[], fontPx = BASE_FONT_PX): number {
  const scale = clampFontPx(fontPx) / BASE_FONT_PX;
  let w = 0;
  for (const run of runs) {
    const advance = run.code ? CODE_CHAR_W : CHAR_W;
    w += run.text.length * advance * scale;
  }
  return w;
}

/** Painted width of one line. Uses SVG text when a document is available. */
export function lineWidth(runs: CaptionStyleRun[], fontPx: number): number {
  const px = clampFontPx(fontPx);
  let measured = 0;
  let complete = true;
  for (const run of runs) {
    const width = measureRunWidth(
      { text: run.text, code: run.code, bold: run.bold, italic: run.italic },
      px,
    );
    if (width == null) {
      complete = false;
      break;
    }
    measured += width;
  }
  return complete ? measured : lineAdvance(runs, px);
}

const MIN_COL_W = 96;

/** Break styled characters so each line's painted width stays within maxW. */
function wrapCharsToWidth(chars: StyledChar[], maxW: number, fontPx: number): StyledChar[][] {
  const lines: StyledChar[][] = [];
  let cur: StyledChar[] = [];
  const widthOf = (cs: StyledChar[]) => (cs.length ? lineWidth(charsToRuns(cs), fontPx) : 0);
  const push = (cs: StyledChar[]) => {
    while (cs.length && cs[cs.length - 1]!.c === ' ') cs = cs.slice(0, -1);
    lines.push(cs);
  };
  for (const ch of chars) {
    if (ch.c === '\n') {
      push(cur);
      cur = [];
      continue;
    }
    const next = cur.concat(ch);
    if (cur.length > 0 && widthOf(next) > maxW) {
      let breakAt = -1;
      for (let i = cur.length - 1; i > 0; i--) {
        if (cur[i]!.c === ' ') {
          breakAt = i;
          break;
        }
      }
      if (breakAt > 0) {
        push(cur.slice(0, breakAt));
        cur = cur.slice(breakAt + 1);
        while (cur.length && cur[0]!.c === ' ') cur = cur.slice(1);
        if (ch.c !== ' ') cur = cur.concat(ch);
      } else {
        push(cur);
        cur = ch.c === ' ' ? [] : [ch];
      }
    } else {
      cur = next;
    }
  }
  if (cur.length || lines.length === 0) push(cur);
  return lines;
}

function paragraphRuns(label: string): CaptionStyleRun[][] {
  const runs = captionStyleRuns(String(label ?? ''));
  const paragraphs: CaptionStyleRun[][] = [[]];
  for (const r of runs) {
    const parts = r.text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) paragraphs.push([]);
      const piece = parts[i] ?? '';
      if (piece.length) {
        paragraphs[paragraphs.length - 1]!.push({
          text: piece,
          bold: r.bold,
          italic: r.italic,
          code: r.code,
        });
      }
    }
  }
  return paragraphs;
}

function plainLine(runs: CaptionStyleRun[]): string {
  return runs.map((r) => r.text).join('');
}

function wordCount(text: string): number {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  return parts.length;
}

/**
 * Auto width only. Pull a leftover last word onto the line above when that
 * costs little width, and widen a 2–4 line block when its last line is much
 * shorter than the lines above it. Explicit line breaks stay separate.
 */
function widenToAvoidOrphan(
  paraRuns: CaptionStyleRun[],
  lines: CaptionStyleRun[][],
  fontPx: number,
): CaptionStyleRun[][] {
  if (lines.length < 2) return lines;
  const widths = lines.map((line) => lineWidth(line, fontPx));
  const col = Math.max(...widths);
  const lastW = widths[widths.length - 1] ?? 0;
  const earlier = widths.slice(0, -1);
  const avg = earlier.reduce((sum, w) => sum + w, 0) / earlier.length;
  const lastText = plainLine(lines[lines.length - 1] ?? []);
  const orphan = wordCount(lastText) === 1;
  const fewLines = lines.length >= 2 && lines.length <= 4;
  const unbalanced = fewLines && lastW < avg * 0.5;
  const chars = runsToChars(paraRuns);
  const full = lineWidth(charsToRuns(chars), fontPx);
  const nearFull = full > col && full - col <= Math.max(64, col * 0.22);
  if (!orphan && !unbalanced && !nearFull) return lines;
  if (nearFull || (orphan && lines.length === 2 && full - col <= lastW + 24)) {
    return [charsToRuns(chars)];
  }
  const cap = Math.min(full, orphan && !fewLines ? col + lastW + 16 : col * 1.4);
  const scoreOf = (ls: CaptionStyleRun[][], ws: number[]) => {
    if (ls.length <= 1) return 0;
    const tail = ws[ws.length - 1] ?? 0;
    const head = ws.slice(0, -1);
    const mean = head.reduce((sum, w) => sum + w, 0) / head.length;
    const lone = wordCount(plainLine(ls[ls.length - 1] ?? [])) === 1 ? 1000 : 0;
    const short = tail < mean * 0.5 ? mean - tail : 0;
    return ls.length * 20 + lone + short;
  };
  let best = lines;
  let bestScore = scoreOf(lines, widths);
  for (let w = Math.ceil(col + 8); w <= cap + 0.5; w += 8) {
    const next = wrapCharsToWidth(chars, w, fontPx).map((part) => charsToRuns(part));
    const nw = next.map((line) => lineWidth(line, fontPx));
    const score = scoreOf(next, nw);
    if (score < bestScore) {
      best = next;
      bestScore = score;
    }
  }
  return best;
}

function balanceAutoWrap(
  label: string,
  wrapCh: number,
  maxLines: number | null,
  fontPx: number,
): WrapResult {
  const base = wrapLines(label, wrapCh, maxLines);
  const paras = paragraphRuns(label);
  const rich: CaptionStyleRun[][] = [];
  let changed = false;
  for (const para of paras) {
    const plain = para.map((r) => r.text).join('');
    if (!plain) {
      rich.push([{ text: '', bold: false, italic: false, code: false }]);
      continue;
    }
    const wrappedPara = wrapLines(plain, wrapCh, null).richLines;
    const next = widenToAvoidOrphan(para, wrappedPara, fontPx);
    if (next.length !== wrappedPara.length || next.some((line, i) => line !== wrappedPara[i])) {
      changed = true;
    }
    for (const line of next) rich.push(line);
  }
  if (!changed) return base;

  const totalLines = rich.length;
  let cap: number;
  if (maxLines == null || !Number.isFinite(maxLines)) cap = SOFT_SAFETY_MAX_LINES;
  else cap = Math.min(SOFT_SAFETY_MAX_LINES, Math.max(1, Math.floor(maxLines)));
  let richLines = rich;
  let truncated = !!base.softSafetyHit;
  if (rich.length > cap) {
    truncated = true;
    richLines = rich.slice(0, cap);
  }
  return {
    lines: richLines.map((rs) => plainLine(rs)),
    richLines,
    truncated,
    fullText: base.fullText,
    softSafetyHit: base.softSafetyHit,
    totalLines,
  };
}

function wrapLinesToWidth(
  text: string,
  widthPx: number,
  maxLines: number | null,
  fontPx: number,
): WrapResult {
  const loose = wrapLines(text, 100000, null);
  const inner = Math.max(48, widthPx - PILL_PAD_X * 2);
  const rawRich: CaptionStyleRun[][] = [];
  for (const line of loose.richLines) {
    const parts = wrapCharsToWidth(runsToChars(line), inner, fontPx);
    for (const part of parts) rawRich.push(charsToRuns(part));
  }
  if (rawRich.length === 0) rawRich.push([{ text: '', bold: false, italic: false, code: false }]);
  const totalLines = rawRich.length;
  let cap: number;
  if (maxLines == null || !Number.isFinite(maxLines)) cap = SOFT_SAFETY_MAX_LINES;
  else cap = Math.min(SOFT_SAFETY_MAX_LINES, Math.max(1, Math.floor(maxLines)));
  let truncated = false;
  let richLines = rawRich;
  if (rawRich.length > cap) {
    truncated = true;
    richLines = rawRich.slice(0, cap);
  }
  return {
    lines: richLines.map((rs) => rs.map((r) => r.text).join('')),
    richLines,
    truncated,
    fullText: loose.fullText,
    softSafetyHit: loose.softSafetyHit,
    totalLines,
  };
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
  const fontPx = clampFontPx(opts.fontSize);
  const widthPx =
    typeof opts.widthPx === 'number' && opts.widthPx > 0
      ? Math.max(MIN_COL_W, opts.widthPx)
      : undefined;
  const wrapped = widthPx
    ? wrapLinesToWidth(label, widthPx, effectiveMaxLines, fontPx)
    : balanceAutoWrap(label, wrapCh, effectiveMaxLines, fontPx);
  const widest = wrapped.richLines.reduce((max, line) => Math.max(max, lineWidth(line, fontPx)), 0);
  const textW = widthPx
    ? Math.round(widthPx)
    : Math.max(MIN_TEXT_W, Math.round(widest + PILL_PAD_X * 2));
  const lineCount = Math.max(1, wrapped.lines.length);
  const box = lineBox(fontPx);

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
    Math.max(44, PILL_PAD_Y * 2 + lineCount * box) +
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
    fontPx,
  };
}
