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
  /** Unlocked sealed region (adds `map-region-unlocked`; the dashed border stays as is). */
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
  const r = Math.min(28, hull.h / 2);
  const icon = region.unlocked ? '' : region.kind === 'sealed' ? LOCK : DOC;
  const label = region.label ? `<text x="14" y="4" class="map-region-label">${esc(region.label)}</text>` : '';
  return `<g class="map-region map-region-${region.kind}${region.unlocked ? ' map-region-unlocked' : ''}" data-region="${esc(region.rootId)}" data-region-kind="${region.kind}" aria-hidden="true">
  <rect x="${hull.x}" y="${hull.y}" width="${hull.w}" height="${hull.h}" rx="${r}" ry="${r}" fill="var(--of-region-fill, rgba(201,162,39,0.10))" stroke="var(--of-region-stroke, rgba(201,162,39,0.55))" stroke-width="1.5" stroke-dasharray="6 4"/>
  <g transform="translate(${hull.x + 18} ${hull.y + 14})" color="var(--of-region-label, #8a6d12)" style="fill: var(--of-region-label, #8a6d12)">${icon}${label}</g>
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
