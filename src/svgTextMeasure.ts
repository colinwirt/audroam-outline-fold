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
let svg: SVGSVGElement | null = null;
let textEl: SVGTextElement | null = null;

function domMeasurer(run: RunMeasure, fontPx: number): number | null {
  if (typeof document === 'undefined') return null;
  const parent = document.body;
  if (!parent) return null;
  if (!svg || !textEl) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    svg.style.left = '-9999px';
    svg.style.top = '0';
    textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    svg.appendChild(textEl);
    parent.appendChild(svg);
  }
  textEl.textContent = run.text.length ? run.text : ' ';
  textEl.setAttribute('font-size', String(fontPx));
  textEl.setAttribute('font-family', run.code ? CODE_FONT_FAMILY : LABEL_FONT_FAMILY);
  textEl.setAttribute('font-weight', run.bold ? '700' : '400');
  textEl.setAttribute('font-style', run.italic ? 'italic' : 'normal');
  const width = textEl.getBBox().width;
  return width > 0 ? width : null;
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
