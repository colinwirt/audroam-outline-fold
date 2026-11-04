/**
 * 0.5.21: minimal Map node thumbnails (spec 20261006-map-node-thumbnails-ux, T1–T6, T13, T16).
 *
 * - `<img:key>` on a node line names an entry in the trailing `--- assets ---` block.
 * - Asset entries: `key:` then indented `field: value` lines (`src`, `w`, `h`, `alt`, …).
 *   Entries read from text are written back byte-for-byte unless a field changed (T3, R1).
 * - Sources (T4): `att:<id>` (host resolves), `https://…`, or `data:image/…` inside the
 *   assets block only. `javascript:`, `//`, other schemes are refused. SVG is checked
 *   against an allowlist and fails closed (T16).
 */

export interface AssetEntry {
  key: string;
  src?: string;
  w?: number;
  h?: number;
  alt?: string;
  /** Other fields, kept as written (R5). */
  extra?: Record<string, string>;
  /** Text the entry was read from (no trailing newline). Written back while unchanged. */
  raw?: string;
  /** Canonical form at read time: a mismatch means the entry changed. */
  rawCanon?: string;
}

/** T5: default thumbnail column width when the node has no stored `w`. */
export const THUMB_DEFAULT_W = 264;
/** T5: inset around the image inside the pill (each side). */
export const THUMB_INSET = 8;
/** T5: image corner radius. */
export const THUMB_RADIUS = 11;
/** T6: tallest image is 1.25× its width; beyond that it is centre-cropped. */
export const THUMB_MAX_ASPECT = 1.25;
/** Width clamp for a thumbnail node's handle drag. Min matches the map's MIN_COL. */
export const THUMB_MIN_W = 120;
export const THUMB_MAX_W = 480;

export const ASSET_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const RASTER_DATA = /^data:image\/(png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/i;
const SVG_DATA = /^data:image\/svg\+xml(;base64)?,/i;
/** Cap for an embedded asset (T15): about 256 KB of data URL text. */
export const MAX_EMBEDDED_CHARS = 256 * 1024 * 4 / 3 + 64;

export function clampThumbWidth(w: number): number {
  if (!Number.isFinite(w)) return THUMB_DEFAULT_W;
  return Math.max(THUMB_MIN_W, Math.min(THUMB_MAX_W, Math.round(w)));
}

/** T6: displayed image height for an image `imgW` wide; `crop` when the cap applies. */
export function thumbBox(imgW: number, natW?: number, natH?: number): { w: number; h: number; crop: boolean } {
  const w = Math.max(1, Math.round(imgW));
  const ratio = natW && natH && natW > 0 && natH > 0 ? natH / natW : 3 / 4;
  const full = w * ratio;
  const cap = w * THUMB_MAX_ASPECT;
  return full > cap ? { w, h: Math.round(cap), crop: true } : { w, h: Math.round(full), crop: false };
}

const SVG_OK_TAGS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs',
  'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'symbol', 'use', 'title', 'desc',
]);
const SVG_OK_ATTR = /^(?:xmlns(?::xlink)?|id|d|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|points|viewbox|preserveaspectratio|fill|stroke|stroke-[a-z-]+|opacity|fill-opacity|fill-rule|clip-rule|clip-path|mask|transform|offset|stop-color|stop-opacity|gradientunits|gradienttransform|href|xlink:href|version)$/i;

/**
 * T16 SVG allowlist. Comments are removed; anything else outside the allowlist (script,
 * foreignObject, style, on*, external href or url(), SMIL, DOCTYPE/entities, PIs) makes
 * it fail closed: returns null.
 */
export function sanitizeSvg(text: string): string | null {
  if (typeof text !== 'string' || text.length > MAX_EMBEDDED_CHARS) return null;
  let s = text.replace(/<!--[\s\S]*?-->/g, '').trim();
  if (/<!|<\?|&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(s)) return null;
  if (!/^<svg[\s>]/i.test(s)) return null;
  const tagRe = /<\/?([A-Za-z][\w:-]*)([^>]*)>/g;
  let m: RegExpExecArray | null;
  let seen = 0;
  while ((m = tagRe.exec(s))) {
    seen += m[0].length;
    const tag = m[1]!.toLowerCase();
    if (!SVG_OK_TAGS.has(tag)) return null;
    const attrs = m[2]!.replace(/\/\s*$/, '');
    const attrRe = /\s*([^\s=]+)\s*=\s*("[^"]*"|'[^']*')/g;
    let a: RegExpExecArray | null;
    let rest = attrs;
    while ((a = attrRe.exec(attrs))) {
      const name = a[1]!.toLowerCase();
      const val = a[2]!.slice(1, -1);
      if (!SVG_OK_ATTR.test(name)) return null;
      if ((name === 'href' || name === 'xlink:href') && !/^#[\w-]+$/.test(val)) return null;
      if (/url\s*\(/i.test(val) && !/^\s*url\(\s*#[\w-]+\s*\)\s*$/i.test(val)) return null;
      if (/javascript:|expression\s*\(/i.test(val)) return null;
      rest = rest.replace(a[0], '');
    }
    if (rest.trim()) return null;
  }
  if (!seen) return null;
  // Text between tags must be plain (title/desc); no stray `<`.
  if (/<(?![A-Za-z/])/.test(s)) return null;
  s = s.replace(/\s+$/, '');
  return s;
}

function decodeSvgData(src: string): string | null {
  const comma = src.indexOf(',');
  const head = src.slice(0, comma);
  const body = src.slice(comma + 1);
  try {
    if (/;base64$/i.test(head)) return atob(body);
    return decodeURIComponent(body);
  } catch {
    return null;
  }
}

/**
 * T4: the source as it may be stored (and rendered). `att:` and `https:` anywhere; `data:`
 * only when `inAssets` (it always is for the map, since `<img:key>` is the only route).
 * SVG data is re-encoded from the sanitised text. Null when refused.
 */
export function safeAssetSrc(src: string | undefined, inAssets = true): string | null {
  if (typeof src !== 'string') return null;
  const s = src.trim();
  if (!s || /[\u0000-\u0008\u000b-\u001f\u007f\\]/.test(s)) return null;
  if (/^att:[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(s)) return s;
  if (/^https:\/\/[^\s/?#@]+(?:[/?#][^\s]*)?$/i.test(s)) return s;
  if (!inAssets || s.length > MAX_EMBEDDED_CHARS) return null;
  if (RASTER_DATA.test(s)) return s.replace(/\s+/g, '');
  if (SVG_DATA.test(s)) {
    const text = decodeSvgData(s);
    const clean = text == null ? null : sanitizeSvg(text);
    return clean ? `data:image/svg+xml,${encodeURIComponent(clean)}` : null;
  }
  return null;
}

/** `key:` then `  field: value` lines. Blank and `#` lines stay with the entry before them. */
export function parseAssetsBlock(inner: string): AssetEntry[] {
  const out: AssetEntry[] = [];
  let cur: AssetEntry | null = null;
  let rawLines: string[] = [];
  let lead: string[] = [];
  const close = () => {
    if (!cur) return;
    while (rawLines.length && !rawLines[rawLines.length - 1]!.trim()) rawLines.pop();
    cur.raw = rawLines.join('\n');
    cur.rawCanon = formatAssetEntry({ ...cur, raw: undefined });
    out.push(cur);
  };
  for (const line of inner.split(/\r?\n/)) {
    const top = line.match(/^([A-Za-z0-9][A-Za-z0-9_-]*):\s*$/);
    if (top) {
      close();
      cur = { key: top[1]! };
      rawLines = [...lead, line];
      lead = [];
      continue;
    }
    if (!cur) {
      lead.push(line);
      continue;
    }
    rawLines.push(line);
    const f = line.match(/^\s+([A-Za-z][\w-]*):\s?(.*)$/);
    if (!f) continue;
    const name = f[1]!;
    const value = f[2]!.trim();
    if (name === 'src') cur.src = value;
    else if ((name === 'w' || name === 'h') && /^\d+$/.test(value)) cur[name] = Number(value);
    else if (name === 'alt') cur.alt = value.replace(/^"(.*)"$/, '$1');
    else (cur.extra ??= {})[name] = value;
  }
  close();
  return out;
}

export function formatAssetEntry(e: AssetEntry): string {
  if (e.raw != null && e.rawCanon != null && formatAssetEntry({ ...e, raw: undefined, rawCanon: undefined }) === e.rawCanon) {
    return e.raw;
  }
  const lines = [`${e.key}:`];
  if (e.src) lines.push(`  src: ${e.src}`);
  if (e.w != null) lines.push(`  w: ${e.w}`);
  if (e.h != null) lines.push(`  h: ${e.h}`);
  if (e.alt) lines.push(`  alt: "${e.alt.replace(/"/g, "'")}"`);
  for (const [k, v] of Object.entries(e.extra ?? {})) lines.push(`  ${k}: ${v}`);
  return lines.join('\n');
}

export function formatAssetsBlock(entries: AssetEntry[] | undefined): string {
  if (!entries?.length) return '';
  return ['--- assets ---', ...entries.map(formatAssetEntry), '---'].join('\n');
}

/** T3: kebab-case key from the file name, with a numeric suffix when taken. */
export function assetKeyFor(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    name
      .replace(/\.[A-Za-z0-9]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'image';
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

export interface ImageAddResult {
  src: string;
  w: number;
  h: number;
  alt?: string;
}

/** Host hook: store the file and return its source and pixel size. */
export type ImageAddHook = (file: File, node: { key: string }) => Promise<ImageAddResult>;

function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

function imageDims(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') return resolve({ w: 0, h: 0 });
    const img = new Image();
    let settled = false;
    const finish = (v: { w: number; h: number }) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    // Some environments never fire load for a data URL: fall back to unknown size.
    const timer = setTimeout(() => finish({ w: 0, h: 0 }), 1500);
    img.onload = () => {
      clearTimeout(timer);
      finish({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
    };
    img.onerror = () => {
      clearTimeout(timer);
      finish({ w: 0, h: 0 });
    };
    img.src = src;
  });
}

/** Default `onImageAdd`: an embedded data URL (T4 item 3) with the decoded pixel size. */
export const defaultImageAdd: ImageAddHook = async (file) => {
  const src = await readDataUrl(file);
  const { w, h } = await imageDims(src);
  return { src, w, h };
};

/** Image files only, from a picker / paste / drop list. */
export function imageFilesOf(list: ArrayLike<File> | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter((f) => /^image\/(png|jpe?g|gif|webp|avif|svg\+xml)$/i.test(f.type || ''));
}
