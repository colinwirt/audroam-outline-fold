/**
 * Multi-line scrapbook label measure for Map pills.
 * Newlines preserved; soft-wrap at wrapCh.
 *
 * Product lock (Design 2026-09-29 compromise):
 * - Default maxLines ≈ **30** + “more” / “less” (not harsh 6, not unlimited)
 * - Soft engine safety ~500 lines / ~50k chars ABOVE product clip
 * - bodyExpanded → measure with maxLines null (up to soft safety)
 */

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
  truncated: boolean;
  fullText: string;
  softSafetyHit?: boolean;
  /** Total soft-wrapped lines before product/safety clip (for more affordance). */
  totalLines: number;
}

/**
 * Soft-wrap `text` at ~wrapCh.
 * `maxLines`: number = product/hard clip; `null` = full body up to soft safety.
 */
export function wrapLines(
  text: string,
  wrapCh: number = DEFAULT_WRAP_CH,
  maxLines: number | null = DEFAULT_MAX_LINES,
): WrapResult {
  let source = String(text ?? '');
  let softSafetyHit = false;
  if (source.length > SOFT_SAFETY_MAX_CHARS) {
    source = source.slice(0, SOFT_SAFETY_MAX_CHARS);
    softSafetyHit = true;
  }

  const ch = Math.max(8, Math.floor(wrapCh) || DEFAULT_WRAP_CH);
  const paragraphs = source.split(/\n/);
  const raw: string[] = [];

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const para = paragraphs[pi];
    if (para === '') {
      raw.push('');
      continue;
    }
    let remaining = para;
    while (remaining.length > ch) {
      let breakAt = remaining.lastIndexOf(' ', ch);
      if (breakAt <= 0) breakAt = ch;
      raw.push(remaining.slice(0, breakAt).trimEnd());
      remaining = remaining.slice(breakAt).replace(/^\s+/, '');
    }
    if (remaining.length || para.length === 0) raw.push(remaining);
  }
  if (raw.length === 0) raw.push('');

  const totalLines = raw.length;

  let cap: number;
  if (maxLines == null || !Number.isFinite(maxLines)) {
    cap = SOFT_SAFETY_MAX_LINES;
  } else {
    cap = Math.max(1, Math.floor(maxLines));
    cap = Math.min(cap, SOFT_SAFETY_MAX_LINES);
  }

  let truncated = softSafetyHit;
  let lines = raw;
  if (raw.length > cap) {
    truncated = true;
    if (maxLines == null || !Number.isFinite(maxLines)) softSafetyHit = true;
    lines = raw.slice(0, cap);
    const last = lines[cap - 1] ?? '';
    lines[cap - 1] =
      last.length >= ch
        ? last.slice(0, Math.max(1, ch - 1)) + '…'
        : last + '…';
  } else if (softSafetyHit && lines.length) {
    const last = lines[lines.length - 1] ?? '';
    if (!last.endsWith('…')) lines[lines.length - 1] = last + '…';
  }

  return {
    lines,
    truncated,
    fullText: String(text ?? ''),
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
