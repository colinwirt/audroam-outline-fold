/**
 * 0.5.30 (Colin): node borders looked thinner on some screens. A CSS width like 1.25px lands
 * on a fraction of a device pixel and gets antialiased to a faint line on 1x screens. Borders
 * now snap to whole device pixels (min 2: one pixel plus a bump) and a pill's edge is aligned
 * to the half-pixel when the device width is odd. Connectors are unchanged.
 */
/** Base node border, CSS px (was 1.25). */
export const BORDER_W = 1.5;
/** Open / in-progress task and coloured borders, CSS px. */
export const BORDER_W_STRONG = 2;
/** Fewest device pixels a border may use. */
export const BORDER_MIN_DEVICE_PX = 2;

const okDpr = (dpr: number) => (Number.isFinite(dpr) && dpr > 0 ? dpr : 1);

/** Whole device pixels for a CSS width at a devicePixelRatio. */
export function borderDevicePx(cssW: number, dpr: number): number {
  return Math.max(BORDER_MIN_DEVICE_PX, Math.round(cssW * okDpr(dpr)));
}
/** Stroke width in user units (CSS px divided by the camera zoom) that paints whole device pixels. */
export function borderStrokeW(cssW: number, dpr: number, zoom = 1): number {
  const d = okDpr(dpr);
  return borderDevicePx(cssW, d) / (d * (zoom > 0 ? zoom : 1));
}
/** Snap a rect edge so a stroke `devicePx` wide covers whole device pixels. */
export function snapEdge(v: number, devicePx: number, dpr: number): number {
  const d = okDpr(dpr);
  const off = devicePx % 2 === 1 ? 0.5 : 0;
  return (Math.round(v * d - off) + off) / d;
}
/** Device px for the strong border: at least one more than the base border, so open tasks stay heavier. */
export function strongDevicePx(dpr: number): number {
  const d = okDpr(dpr);
  return Math.max(borderDevicePx(BORDER_W, d) + 1, Math.round(BORDER_W_STRONG * d));
}
/** Custom properties set on the map host at paint. */
export function borderVars(dpr: number, zoom = 1): Record<'--map-border-w' | '--map-border-w-strong', string> {
  const d = okDpr(dpr), z = zoom > 0 ? zoom : 1;
  const f = (px: number) => `${+(px / (d * z)).toFixed(4)}px`;
  return { '--map-border-w': f(borderDevicePx(BORDER_W, d)), '--map-border-w-strong': f(strongDevicePx(d)) };
}
