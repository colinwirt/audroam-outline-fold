/**
 * Multi-line scrapbook label measure for Map pills.
 * Newlines preserved; soft-wrap at wrapCh; maxLines + ellipsis.
 */

export const DEFAULT_WRAP_CH = 32;
export const DEFAULT_MAX_LINES = 6;
/** Approx ch width used by historic single-line measure. */
export const CHAR_W = 7.2;
export const LINE_H = 16;
export const PILL_PAD_Y = 10;
/** Lead slot for task SVG (~28px; touch hit pad ≥44 separately). */
export const TASK_LEAD = 28;
/** Min text region width. */
export const MIN_TEXT_W = 88;

export interface WrapResult {
  lines: string[];
  truncated: boolean;
  /** Full text for tooltip when truncated (or always useful). */
  fullText: string;
}

/**
 * Soft-wrap `text` at ~wrapCh, honouring explicit newlines.
 * Blank line (paragraph gap) kept as empty string in the line list.
 */
export function wrapLines(
  text: string,
  wrapCh: number = DEFAULT_WRAP_CH,
  maxLines: number = DEFAULT_MAX_LINES,
): WrapResult {
  const fullText = String(text ?? '');
  const ch = Math.max(8, Math.floor(wrapCh) || DEFAULT_WRAP_CH);
  const cap = Math.max(1, Math.floor(maxLines) || DEFAULT_MAX_LINES);

  const paragraphs = fullText.split(/\n/);
  const raw: string[] = [];

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const para = paragraphs[pi];
    if (para === '') {
      raw.push('');
      continue;
    }
    // Soft wrap on spaces; long tokens may mid-break
    let remaining = para;
    while (remaining.length > ch) {
      let breakAt = remaining.lastIndexOf(' ', ch);
      if (breakAt <= 0) breakAt = ch; // mid-break long token
      raw.push(remaining.slice(0, breakAt).trimEnd());
      remaining = remaining.slice(breakAt).replace(/^\s+/, '');
    }
    if (remaining.length || para.length === 0) raw.push(remaining);
  }

  if (raw.length === 0) raw.push('');

  let truncated = false;
  let lines = raw;
  if (raw.length > cap) {
    truncated = true;
    lines = raw.slice(0, cap);
    const last = lines[cap - 1] ?? '';
    lines[cap - 1] =
      last.length >= ch
        ? last.slice(0, Math.max(1, ch - 1)) + '…'
        : last + '…';
  }

  return { lines, truncated, fullText };
}

export interface MeasurePillOpts {
  wrapCh?: number;
  maxLines?: number;
  reserveFold?: boolean;
  reserveTask?: boolean;
  /** Fold slot width (caller passes FOLD_SLOT). */
  foldSlot?: number;
  taskLead?: number;
}

export interface MeasuredPill {
  w: number;
  h: number;
  textW: number;
  foldSlot: number;
  taskLead: number;
  lines: string[];
  truncated: boolean;
  fullText: string;
}

export function measurePill(
  label: string,
  opts: MeasurePillOpts = {},
): MeasuredPill {
  const wrapCh = opts.wrapCh ?? DEFAULT_WRAP_CH;
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;
  const foldSlot = opts.reserveFold ? (opts.foldSlot ?? 34) : 0;
  const taskLead = opts.reserveTask ? (opts.taskLead ?? TASK_LEAD) : 0;
  const wrapped = wrapLines(label, wrapCh, maxLines);
  const textW = Math.max(MIN_TEXT_W, Math.round(wrapCh * CHAR_W));
  const lineCount = Math.max(1, wrapped.lines.length);
  const h = Math.max(44, PILL_PAD_Y * 2 + lineCount * LINE_H);
  return {
    w: textW + foldSlot + taskLead,
    h,
    textW,
    foldSlot,
    taskLead,
    lines: wrapped.lines,
    truncated: wrapped.truncated,
    fullText: wrapped.fullText,
  };
}
