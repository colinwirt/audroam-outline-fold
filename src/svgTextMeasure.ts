/**
 * Width of a label run from the same SVG text the map paints.
 * Node tests have no document, so they keep the character advance.
 */

export const LABEL_FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const CODE_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export interface RunMeasure {
  text: string;
  code?: boolean;
  bold?: boolean;
  italic?: boolean;
}

export type RunMeasurer = (run: RunMeasure, fontPx: number) => number | null;

let measurer: RunMeasurer | null = null;
let canvas: HTMLCanvasElement | null = null;
let canvasCtx: CanvasRenderingContext2D | null = null;
const widthCache = new Map<string, number>();

/**
 * Canvas measureText matches the painted font and does not flush layout.
 * getBBox on every prefix of a large map is what made fold take seconds.
 */
function domMeasurer(run: RunMeasure, fontPx: number): number | null {
  if (typeof document === 'undefined') return null;
  const family = run.code ? CODE_FONT_FAMILY : LABEL_FONT_FAMILY;
  const key = `${fontPx}|${run.bold ? 1 : 0}|${run.italic ? 1 : 0}|${run.code ? 1 : 0}|${run.text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvasCtx = canvas.getContext('2d');
  }
  if (!canvasCtx) return null;
  const style = run.italic ? 'italic' : 'normal';
  const weight = run.bold ? '700' : '400';
  canvasCtx.font = `${style} ${weight} ${fontPx}px ${family}`;
  const width = canvasCtx.measureText(run.text.length ? run.text : ' ').width;
  const stored = width > 0 ? width : 0;
  widthCache.set(key, stored);
  return stored > 0 ? stored : null;
}

/** Tests inject a measurer. Pass null to use the document again. */
export function setRunMeasurer(next: RunMeasurer | null): void {
  measurer = next;
}

export function measureRunWidth(run: RunMeasure, fontPx: number): number | null {
  const fn = measurer ?? domMeasurer;
  try {
    return fn(run, fontPx);
  } catch {
    return null;
  }
}
