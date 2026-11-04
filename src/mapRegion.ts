import { colourVar, resolveColour } from './nodeColour.js';
/**
 * Sub-instance regions: a separate source (a sealed payload opened in a viewer, or a
 * separate document record) drawn as a soft rounded "cloud" around its root node and
 * subtree in one shared Map. Each region keeps its own load/edit/save; the Map only
 * draws the boundary. Colour is themeable via CSS custom properties:
 *   --of-region-fill, --of-region-stroke, --of-region-label
 */
export type MapRegionKind = 'sealed' | 'record';

export interface MapRegion {
  /** Root node id in the painted doc that the region encloses (with its subtree). */
  rootId: string;
  kind: MapRegionKind;
  /** Visible label (a sealed region uses its public label, never the caption). */
  label?: string;
  /** Unlocked sealed region (`map-region-unlocked`): solid green border, 12px corners (mockup seal-edit 05). */
  unlocked?: boolean;
}

export interface RegionBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Padded bounding rectangle (MVP hull) of the given boxes. */
export function regionHull(boxes: RegionBox[], pad = 14): RegionBox | null {
  if (!boxes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0 - pad, y: y0 - pad - 14, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 + 14 };
}

const LOCK =
  '<path d="M-5 -1h10v8h-10z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M-3 -1v-3a3 3 0 0 1 6 0v3" fill="none" stroke="currentColor" stroke-width="1.5"/>';
const DOC =
  '<path d="M-5 -6h7l3 3v10h-10z" fill="none" stroke="currentColor" stroke-width="1.5"/>';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** SVG for one region (drawn under edges and pills). */
export function regionSvg(region: MapRegion, hull: RegionBox): string {
  const r = region.unlocked ? 12 : Math.min(28, hull.h / 2);
  const icon = region.unlocked ? '' : region.kind === 'sealed' ? LOCK : DOC;
  const label = region.label ? `<text x="14" y="4" class="map-region-label">${esc(region.label)}</text>` : '';
  return `<g class="map-region map-region-${region.kind}${region.unlocked ? ' map-region-unlocked' : ''}" data-region="${esc(region.rootId)}" data-region-kind="${region.kind}" aria-hidden="true">
  <rect x="${hull.x}" y="${hull.y}" width="${hull.w}" height="${hull.h}" rx="${r}" ry="${r}" ${region.unlocked
    ? 'fill="var(--of-unlocked-fill, rgba(61,138,95,0.06))" stroke="var(--of-unlocked-stroke, #3d8a5f)" stroke-width="1.5"'
    : 'fill="var(--of-region-fill, rgba(201,162,39,0.10))" stroke="var(--of-region-stroke, rgba(201,162,39,0.55))" stroke-width="1.5" stroke-dasharray="6 4"'}/>
  <g transform="translate(${hull.x + 18} ${hull.y + 14})" color="${region.unlocked ? 'var(--of-unlocked-ink, #245c3c)' : 'var(--of-region-label, #8a6d12)'}" style="fill: ${region.unlocked ? 'var(--of-unlocked-ink, #245c3c)' : 'var(--of-region-label, #8a6d12)'}">${icon}${label}</g>
</g>`;
}

/** Greedy word wrap at `ch` characters (region pill captions; matches the box sizing width). */
export function wrapPlain(text: string, ch: number): string[] {
  const max = Math.max(4, Math.floor(ch));
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= max) cur += ' ' + w;
    else { out.push(cur); cur = w; }
    while (cur.length > max) { out.push(cur.slice(0, max)); cur = cur.slice(max); }
  }
  if (cur) out.push(cur);
  return out;
}

// ── 0.5.18 user clouds (Design UX 2026-11-04 EP-38…EP-43) ──
// An angled hull: the convex hull of the subtree's padded, corner-chamfered boxes, drawn as a
// polygon with softly rounded vertices. Sealed / record regions keep `regionSvg` (dashed,
// rounded rect + lock/doc icon) and paint above every cloud, so a cloud never reads as a
// security cue.

export interface CloudPoint {
  x: number;
  y: number;
}

export interface MapCloud {
  rootId: string;
  /** Colour name from the line (`<cloud:teal>`), or `default`. A palette name (0.5.19) paints `--node-<name>`; anything else is neutral. */
  color: string;
  /** Nesting depth (0 = outermost). */
  depth: number;
}

/** Padding for a cloud at a nesting depth (EP-41: inner clouds inset by 6px). */
export function cloudPad(depth: number, pad = 12): number {
  return Math.max(4, pad - 6 * depth);
}

/** Angled hull points (clockwise in screen space) around the boxes, or null for none. */
export function cloudHull(boxes: RegionBox[], pad = 12): CloudPoint[] | null {
  if (!boxes.length) return null;
  const pts: CloudPoint[] = [];
  for (const b of boxes) {
    const x0 = b.x - pad, y0 = b.y - pad, x1 = b.x + b.w + pad, y1 = b.y + b.h + pad;
    // Chamfer each padded corner so the hull has angled corners, not right angles.
    const c = Math.min(pad * 0.8, (x1 - x0) / 3, (y1 - y0) / 3);
    pts.push(
      { x: x0 + c, y: y0 }, { x: x1 - c, y: y0 }, { x: x1, y: y0 + c }, { x: x1, y: y1 - c },
      { x: x1 - c, y: y1 }, { x: x0 + c, y: y1 }, { x: x0, y: y1 - c }, { x: x0, y: y0 + c },
    );
  }
  // Monotone chain convex hull.
  pts.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: CloudPoint, a: CloudPoint, b: CloudPoint) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: CloudPoint[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: CloudPoint[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  const hull = lower.concat(upper);
  return hull.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
}

/** SVG path for a polygon with every vertex rounded by about `r` px. */
export function cloudPath(pts: CloudPoint[], r = 6): string {
  const n = pts.length;
  if (n < 3) return '';
  const f = (v: number) => Math.round(v * 10) / 10;
  const toward = (a: CloudPoint, b: CloudPoint, d: number): CloudPoint => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = Math.min(d, len / 2) / len;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  let d = '';
  for (let i = 0; i < n; i++) {
    const p = pts[i]!, prev = pts[(i + n - 1) % n]!, next = pts[(i + 1) % n]!;
    const a = toward(p, prev, r), b = toward(p, next, r);
    d += `${i ? 'L' : 'M'}${f(a.x)} ${f(a.y)}Q${f(p.x)} ${f(p.y)} ${f(b.x)} ${f(b.y)}`;
  }
  return d + 'Z';
}

/** SVG for one user cloud (drawn under sealed / record regions, edges and pills). */
export function cloudSvg(cloud: MapCloud, pts: CloudPoint[]): string {
  // 0.5.19 (EP-38): a palette name tints fill (14%) and stroke with its node colour token.
  const cc = resolveColour(cloud.color);
  const paint = cc
    ? `fill="${colourVar(cc)}" fill-opacity="0.14" stroke="${colourVar(cc)}"`
    : 'fill="var(--of-cloud-fill, rgba(138,141,150,0.14))" stroke="var(--of-cloud-stroke, rgba(138,141,150,0.7))"';
  return `<g class="map-cloud map-cloud-${esc(cloud.color)}" data-cloud="${esc(cloud.rootId)}" data-cloud-color="${esc(cloud.color)}" data-cloud-depth="${cloud.depth}" aria-hidden="true"><path d="${cloudPath(pts)}" ${paint} stroke-width="1" stroke-linejoin="round"/></g>`;
}
