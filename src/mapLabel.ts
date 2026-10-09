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
  readBareUrl,
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
/** Map checkbox. The lead is the inset, the box, and the gap before the caption. */
export const TASK_BOX = 14;
export const TASK_INSET = 8;
export const TASK_GAP = 6;
export const TASK_LEAD = TASK_INSET + TASK_BOX + TASK_GAP;
export const MIN_TEXT_W = 36;
/** Air between the caption and the pill border. A task box replaces the left pad. */
export const PILL_PAD_X = 16;
/** Gap, then `#id` labels, then air before the pill edge. Digits at 12px. */
const NOTE_CHIP_GAP = 6;
const NOTE_CHIP_TRAIL = 10;
const NOTE_CHIP_CHAR = 7.2;

export function noteChipLabel(pnid: string): string {
  return `#${pnid}`;
}

export interface NoteChipPiece {
  id: string;
  label: string;
  w: number;
}

export function noteChipPieces(ids: string[]): NoteChipPiece[] {
  return ids.map((id) => {
    const label = noteChipLabel(id);
    return { id, label, w: Math.ceil(label.length * NOTE_CHIP_CHAR) };
  });
}

/** Width after the caption: gap, chips, and a little air before the border. */
export function noteChipSpan(ids: string[]): number {
  return mapChipSpan({ noteLinks: ids });
}

/** Thread pill (0.2.34): drawn in the chip row after the caption, inside the node. */
export const THREAD_CHIP_LABEL = 'Thread';
export const THREAD_CHIP_H = 18;
const THREAD_CHIP_PAD = 8;
const THREAD_CHIP_FONT = 11;
/** Jump chips (`<r:x>`) at the `#N` chip size. */
const JUMP_CHIP_FONT = 12;
const CHIP_SPACE = 8;

/** Chips drawn after the caption, in this order: thread pill, `#N` notes, `<r:x>` jumps. */
export interface MapChipSpec {
  thread?: boolean;
  noteLinks?: string[];
  /** `<r:x>` jumps with the label to draw (the target's caption, or the id when it is not in the map). */
  jumps?: { id: string; label: string }[];
}

export interface MapChipPiece {
  kind: 'thread' | 'note' | 'jump';
  id: string;
  label: string;
  w: number;
}

function textW(text: string, px: number, bold: boolean, perChar: number): number {
  const measured = measureRunWidth({ text, bold }, px);
  return Math.ceil(measured ?? text.length * perChar);
}

export function mapChipPieces(spec: MapChipSpec): MapChipPiece[] {
  const out: MapChipPiece[] = [];
  if (spec.thread) {
    out.push({
      kind: 'thread',
      id: '',
      label: THREAD_CHIP_LABEL,
      w: textW(THREAD_CHIP_LABEL, THREAD_CHIP_FONT, false, 6.2) + THREAD_CHIP_PAD * 2,
    });
  }
  for (const p of noteChipPieces(spec.noteLinks || [])) out.push({ kind: 'note', ...p });
  for (const j of spec.jumps || []) {
    out.push({ kind: 'jump', id: j.id, label: j.label, w: textW(j.label, JUMP_CHIP_FONT, true, NOTE_CHIP_CHAR) });
  }
  return out;
}

/** Width the chip row adds after the caption: gap, chips, air before the border. */
export function mapChipSpan(spec: MapChipSpec): number {
  const pieces = mapChipPieces(spec);
  if (!pieces.length) return 0;
  let inner = 0;
  for (let i = 0; i < pieces.length; i++) {
    if (i) inner += CHIP_SPACE;
    inner += pieces[i]!.w;
  }
  return NOTE_CHIP_GAP + inner + NOTE_CHIP_TRAIL;
}
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

function charsText(chars: StyledChar[], start = 0): string {
  let s = '';
  for (let i = start; i < chars.length; i++) s += chars[i]!.c;
  return s;
}

/** If `breakAt` lands inside an http(s) URL, move it to the URL boundary. */
function avoidUrlSplit(chars: StyledChar[], breakAt: number): number {
  const head = charsText(chars.slice(0, breakAt));
  const at = head.search(/https?:\/\//i);
  if (at < 0) return breakAt;
  const url = readBareUrl(charsText(chars, at));
  if (!url || at + url.length <= breakAt) return breakAt;
  return at > 0 ? at : url.length;
}

function softWrapChars(chars: StyledChar[], ch: number): StyledChar[][] {
  if (chars.length === 0) return [[]];
  const lines: StyledChar[][] = [];
  let remaining = chars;
  while (remaining.length > ch) {
    const leadingUrl = readBareUrl(charsText(remaining));
    if (leadingUrl.length > ch) {
      lines.push(remaining.slice(0, leadingUrl.length));
      remaining = remaining.slice(leadingUrl.length);
      while (remaining.length && remaining[0]!.c === ' ') remaining = remaining.slice(1);
      continue;
    }
    let breakAt = -1;
    for (let i = Math.min(ch, remaining.length - 1); i >= 0; i--) {
      if (remaining[i]!.c === ' ') {
        breakAt = i;
        break;
      }
    }
    if (breakAt <= 0) breakAt = ch;
    breakAt = avoidUrlSplit(remaining, breakAt);
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
    const lastHasOpenUrl = readBareUrl(lastPlain) !== '' || /https?:\/\//i.test(lastPlain);
    if (lastHasOpenUrl && readBareUrl(lastPlain).length === lastPlain.length) {
      // A line that is only a URL stays whole. Cutting it breaks the link.
    } else if (lastPlain.length >= ch) {
      // Truncate last line runs to ch-1 + ellipsis
      let left = avoidUrlSplit(
        lastRuns.flatMap((r) =>
          [...r.text].map((c) => ({
            c,
            bold: r.bold,
            italic: r.italic,
            code: !!r.code,
          })),
        ),
        Math.max(1, ch - 1),
      );
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
  /** `<t:N>` ids drawn after the caption. They widen the pill; they do not wrap the caption. */
  noteLinks?: string[];
  /** Thread pill in the chip row (0.2.34). Widens the pill like a `#N` chip. */
  thread?: boolean;
  /** `<r:x>` jump chips after the `#N` chips (0.2.34). */
  jumps?: { id: string; label: string }[];
  /** Reserve height for more/less chrome when truncated or expanded-from-clip. */
  reserveMoreAffordance?: boolean;
  /** Measure the caption at 600, as an open or pending task paints it (0.2.38). */
  semibold?: boolean;
  fontSize?: number;
  /**
   * Compact pill (time leaves, 0.2.40 TL1): this vertical pad and no 44 px
   * minimum height, so the height follows from the font.
   */
  compactPadY?: number;
  /** Left pad before the caption in place of the default pad (time leaf kind letter). */
  padLeft?: number;
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

/**
 * Open and pending task labels paint at 600 (0.2.38, K4). Measurement inside
 * measurePill and the fit widths runs with this set, so a semibold caption
 * wraps and sizes its pill at the weight it is painted in.
 */
let semiboldScope = false;

function withSemibold<T>(on: boolean | undefined, fn: () => T): T {
  const prev = semiboldScope;
  semiboldScope = !!on;
  try {
    return fn();
  } finally {
    semiboldScope = prev;
  }
}

/** Painted width of one line. Uses SVG text when a document is available.
 * `semibold` measures non-bold runs at 600 (open task labels). */
export function lineWidth(runs: CaptionStyleRun[], fontPx: number, semibold = semiboldScope): number {
  const px = clampFontPx(fontPx);
  let measured = 0;
  let complete = true;
  for (const run of runs) {
    const width = measureRunWidth(
      { text: run.text, code: run.code, bold: run.bold, semibold, italic: run.italic },
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

function charWidth(ch: StyledChar, fontPx: number): number {
  const width = measureRunWidth(
    { text: ch.c, code: ch.code, bold: ch.bold, semibold: semiboldScope, italic: ch.italic },
    fontPx,
  );
  if (width != null) return width;
  const scale = clampFontPx(fontPx) / BASE_FONT_PX;
  return (ch.code ? CODE_CHAR_W : CHAR_W) * scale;
}

/** Break styled characters so each line's painted width stays within maxW. */
function wrapCharsToWidth(chars: StyledChar[], maxW: number, fontPx: number): StyledChar[][] {
  const lines: StyledChar[][] = [];
  let cur: StyledChar[] = [];
  let curW = 0;
  let softBreak = false;
  const push = (cs: StyledChar[]) => {
    while (cs.length && cs[cs.length - 1]!.c === ' ') cs = cs.slice(0, -1);
    lines.push(cs);
  };
  const takeUrl = (at: number): number => {
    if (chars[at]!.c !== 'h' && chars[at]!.c !== 'H') return 0;
    return readBareUrl(charsText(chars, at)).length;
  };
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch.c === '\n') {
      push(cur);
      cur = [];
      curW = 0;
      softBreak = false;
      continue;
    }
    // The rest of a run of spaces at a soft break belongs to the break.
    if (softBreak && ch.c === ' ' && cur.length === 0) continue;
    const urlLen = takeUrl(i);
    if (urlLen > 1) {
      let urlW = 0;
      const urlChars = chars.slice(i, i + urlLen);
      for (const part of urlChars) urlW += charWidth(part, fontPx);
      if (cur.length > 0 && curW + urlW > maxW) {
        push(cur);
        cur = urlChars;
        curW = urlW;
      } else {
        cur = cur.concat(urlChars);
        curW += urlW;
      }
      i += urlLen - 1;
      continue;
    }
    const nextW = curW + charWidth(ch, fontPx);
    if (cur.length > 0 && nextW > maxW) {
      softBreak = true;
      let breakAt = -1;
      for (let j = cur.length - 1; j > 0; j--) {
        if (cur[j]!.c === ' ') {
          breakAt = j;
          break;
        }
      }
      if (breakAt > 0) {
        push(cur.slice(0, breakAt));
        cur = cur.slice(breakAt + 1);
        while (cur.length && cur[0]!.c === ' ') cur = cur.slice(1);
        // The line broke at an earlier space, so `ch` is not at the break.
        // A space here separates the carried word from the next one: keep it.
        if (ch.c !== ' ' || cur.length) cur = cur.concat(ch);
      } else {
        push(cur);
        cur = ch.c === ' ' ? [] : [ch];
      }
      curW = 0;
      for (const part of cur) curW += charWidth(part, fontPx);
    } else {
      cur = cur.concat(ch);
      curW = nextW;
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
  padLeft = PILL_PAD_X,
  padRight = PILL_PAD_X,
): WrapResult {
  const loose = wrapLines(text, 100000, null);
  const inner = Math.max(48, widthPx - padLeft - padRight);
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

const pillCache = new Map<string, MeasuredPill>();

export function measurePill(
  label: string,
  opts: MeasurePillOpts = {},
): MeasuredPill {
  return withSemibold(opts.semibold, () => measurePillAt(label, opts));
}

function measurePillAt(label: string, opts: MeasurePillOpts): MeasuredPill {
  const wrapCh = opts.wrapCh ?? DEFAULT_WRAP_CH;
  const cacheKey = [
    label,
    wrapCh,
    opts.widthPx ?? '',
    opts.maxLines === null ? 'null' : (opts.maxLines ?? ''),
    opts.bodyExpanded ? 1 : 0,
    opts.reserveFold ? 1 : 0,
    opts.reserveTask ? 1 : 0,
    opts.foldSlot ?? '',
    opts.taskLead ?? '',
    (opts.noteLinks || []).join(','),
    opts.thread ? 1 : 0,
    (opts.jumps || []).map((j) => `${j.id}\u0002${j.label}`).join('\u0003'),
    opts.reserveMoreAffordance === false ? 0 : 1,
    opts.fontSize ?? '',
    opts.semibold ? 1 : 0,
    opts.compactPadY ?? '',
    opts.padLeft ?? '',
  ].join('\u0001');
  const cached = pillCache.get(cacheKey);
  if (cached) return cached;
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
  // The checkbox sits in the left pad. Do not add that pad again before the caption.
  const padLeft =
    typeof opts.padLeft === 'number' && opts.padLeft >= 0 ? opts.padLeft : taskLead > 0 ? 0 : PILL_PAD_X;
  const padRight = PILL_PAD_X;
  const wrapped = widthPx
    ? wrapLinesToWidth(label, widthPx, effectiveMaxLines, fontPx, padLeft, padRight)
    : balanceAutoWrap(label, wrapCh, effectiveMaxLines, fontPx);
  const widest = wrapped.richLines.reduce((max, line) => Math.max(max, lineWidth(line, fontPx)), 0);
  const textW = widthPx
    ? Math.round(widthPx)
    : Math.max(MIN_TEXT_W, Math.round(widest + padLeft + padRight));
  const roomAfter = Math.max(0, textW - padLeft - widest);
  const chipSpan = mapChipSpan({ thread: opts.thread, noteLinks: opts.noteLinks, jumps: opts.jumps });
  const noteExtra = Math.ceil(Math.max(0, chipSpan - roomAfter));
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

  const compact = typeof opts.compactPadY === 'number' && opts.compactPadY >= 0;
  const h =
    (compact
      ? Math.ceil(opts.compactPadY! * 2 + lineCount * box)
      : Math.max(44, PILL_PAD_Y * 2 + lineCount * box)) +
    (needsAffordance ? MORE_AFFORDANCE_H : 0);

  const measured: MeasuredPill = {
    w: textW + foldSlot + taskLead + noteExtra,
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
  pillCache.set(cacheKey, measured);
  return measured;
}

// ── Hold-to-fit widths (Design UX 2026-10-08, F4, F5, F5a) ─────────────────

/** F4: "Fit text" wraps at this many characters. */
export const FIT_TEXT_CH = 60;

export interface FitMeasureOpts {
  fontSize?: number;
  /** A task box replaces the left pad, as in measurePill. */
  reserveTask?: boolean;
  /** Auto width only: the node's own wrap and clip. */
  wrapCh?: number;
  maxLines?: number | null;
  bodyExpanded?: boolean;
  /** Open or pending task: measure at 600, as painted (0.2.38). */
  semibold?: boolean;
}

function trimTrailingSpaces(chars: StyledChar[]): StyledChar[] {
  let end = chars.length;
  while (end > 0 && chars[end - 1]!.c === ' ') end--;
  return end === chars.length ? chars : chars.slice(0, end);
}

/**
 * Widest of `lines` in px, measured the way the px wrap measures (one
 * character at a time), so a pill this wide never soft-wraps them.
 */
function widestForWrap(lines: CaptionStyleRun[][], fontPx: number): number {
  let widest = 0;
  for (const line of lines) {
    const chars = trimTrailingSpaces(runsToChars(line));
    let sum = 0;
    for (const ch of chars) sum += charWidth(ch, fontPx);
    widest = Math.max(widest, sum, lineWidth(line, fontPx));
  }
  return widest;
}

function fitPads(opts: FitMeasureOpts): number {
  return (opts.reserveTask ? 0 : PILL_PAD_X) + PILL_PAD_X;
}

/**
 * F5: the caption's natural one-line width (the pill's caption column, as
 * stored in `w`): the longest authored line, unwrapped, plus the pads. Each
 * authored line (newline, `<br>`) keeps its own row. Not clamped.
 */
export function naturalLineWidth(label: string, opts: FitMeasureOpts = {}): number {
  const fontPx = clampFontPx(opts.fontSize);
  const loose = wrapLines(label, 100000, null);
  return withSemibold(opts.semibold, () => Math.ceil(widestForWrap(loose.richLines, fontPx) + fitPads(opts)));
}

/** F4: the widest line after wrapping at 60ch, plus the pads. Not clamped. */
export function fitTextWidth(label: string, opts: FitMeasureOpts = {}): number {
  const fontPx = clampFontPx(opts.fontSize);
  const wrapped = wrapLines(label, FIT_TEXT_CH, null);
  return withSemibold(opts.semibold, () => Math.ceil(widestForWrap(wrapped.richLines, fontPx) + fitPads(opts)));
}

/** The caption column the pill has at Auto (no `w`). */
export function autoTextWidth(label: string, opts: FitMeasureOpts = {}): number {
  return measurePill(label, {
    wrapCh: opts.wrapCh ?? DEFAULT_WRAP_CH,
    maxLines: opts.maxLines,
    bodyExpanded: opts.bodyExpanded,
    reserveTask: opts.reserveTask,
    fontSize: opts.fontSize,
    semibold: opts.semibold,
  }).textW;
}
