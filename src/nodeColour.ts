/**
 * 0.5.19 node colours (Design UX 2026-11-04, EP-31…EP-37). A node stores a colour **role**
 * (`<color:moss>`), never hex. Each role paints through a CSS variable (`--node-moss` …).
 * The palette (host option `colourPalette`, default `forest`) decides what each role looks
 * like, so switching palettes recolours the map without editing the text. The same roles
 * colour named clouds (`<cloud:creek>`, EP-38).
 *
 * Role keys are the Forest names. A new palette is one token table (`NodePalette`): a label
 * plus a dark and a light hex per role, at the same contrast rules (>= 3:1 on the pill and
 * the canvas; label text >= 10:1 on the 16% wash). Register it with `registerNodePalette`.
 * The Highlighter group is shared by every palette.
 */
export const BASE_ROLES = ['moss', 'fern', 'pine', 'lichen', 'bark', 'creek', 'ember', 'slate', 'stone'] as const;
export const HIGHLIGHTER_COLOURS = ['lemon', 'lime', 'flamingo', 'tangerine', 'aqua'] as const;
/** @deprecated alias of BASE_ROLES. */
export const FOREST_COLOURS = BASE_ROLES;
/**
 * 0.5.23 Audroam palette: a fixed role group (like Highlighter) sampled from Audroam's
 * action buttons. Roles are namespaced `audroam-<role>` so they never clash with a base role,
 * a Highlighter role (`aqua`, `lemon`) or an alias (`red`, `grey`).
 */
/**
 * 0.5.30 rich Audroam colours, exact hex read from the Audroam app CSS (C:\\code\\audroam\\code\\app\\ui,
 * compiled dist/main-*.css and src/main.scss). Solid fills; listed before the soft tints.
 */
export const AUDROAM_RICH_COLOURS = ['audroam-danger', 'audroam-success', 'audroam-focus', 'audroam-steel', 'audroam-primary', 'audroam-white'] as const;
export const AUDROAM_RICH: Record<(typeof AUDROAM_RICH_COLOURS)[number], { label: string; source: string; fill: string }> = {
  'audroam-danger': { label: 'Sign-off red', source: 'main.css .btn-danger #d9534f', fill: '#d9534f' },
  'audroam-success': { label: 'Success green', source: 'main.css .btn-success #5cb85c', fill: '#5cb85c' },
  'audroam-focus': { label: 'Focus T green', source: 'main.scss .recent-row--focus-t border-left #2a8a2a', fill: '#2a8a2a' },
  'audroam-steel': { label: 'Steel blue', source: 'main.css .audroam-text / boxes #4682b4', fill: '#4682b4' },
  'audroam-primary': { label: 'Session blue', source: 'main.css .search-flow-pill--on (btn-primary) #337ab7', fill: '#337ab7' },
  'audroam-white': { label: 'White', source: '#ffffff', fill: '#ffffff' },
};
export const AUDROAM_COLOURS = [
  ...AUDROAM_RICH_COLOURS,
  'audroam-green', 'audroam-salmon', 'audroam-peach', 'audroam-sky', 'audroam-aqua',
  'audroam-lemon', 'audroam-red', 'audroam-lavender', 'audroam-grey',
] as const;
/** 0.5.30: white and black, as a border tint and as a solid fill. */
export const NEUTRAL_COLOURS = ['white', 'black'] as const;
const HUES = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;
/** 0.5.30 Bold: saturated, mid lightness. */
export const BOLD_COLOURS = ['bold-red', 'bold-orange', 'bold-yellow', 'bold-green', 'bold-teal', 'bold-blue', 'bold-purple', 'bold-pink'] as const;
/** 0.5.30 Pastel: light, soft. */
export const PASTEL_COLOURS = ['pastel-red', 'pastel-orange', 'pastel-yellow', 'pastel-green', 'pastel-teal', 'pastel-blue', 'pastel-purple', 'pastel-pink'] as const;
/** 0.5.30 Deep: dark, rich. */
export const DEEP_COLOURS = ['deep-red', 'deep-orange', 'deep-yellow', 'deep-green', 'deep-teal', 'deep-blue', 'deep-purple', 'deep-pink'] as const;
export const NODE_COLOURS = [...BASE_ROLES, ...HIGHLIGHTER_COLOURS, ...AUDROAM_COLOURS, ...NEUTRAL_COLOURS, ...BOLD_COLOURS, ...PASTEL_COLOURS, ...DEEP_COLOURS] as const;
export type BaseRole = (typeof BASE_ROLES)[number];
export type NodeColour = (typeof NODE_COLOURS)[number];

export interface PaletteSwatch { label: string; dark: string; light: string }
export interface NodePalette {
  /** Key used by `colourPalette` and the `of-palette-<name>` class. */
  name: string;
  /** Menu group caption (`Forest`). */
  label: string;
  roles: Record<BaseRole, PaletteSwatch>;
}

/** Forest: muted forest tones with brighter flicks of water (creek), fire (ember) and rock (slate, stone). */
export const FOREST_PALETTE: NodePalette = {
  name: 'forest',
  label: 'Forest',
  roles: {
    moss: { label: 'Moss', dark: '#a3b55a', light: '#6f7f2a' },
    fern: { label: 'Fern', dark: '#6cc070', light: '#3a8a43' },
    pine: { label: 'Pine', dark: '#45a882', light: '#22795a' },
    lichen: { label: 'Lichen', dark: '#e0b440', light: '#9a7400' }, // 0.5.30: gold, away from moss
    bark: { label: 'Bark', dark: '#c09a74', light: '#8a6440' },
    creek: { label: 'Creek', dark: '#4cc3c9', light: '#127f86' },
    ember: { label: 'Ember', dark: '#ff8a5c', light: '#c8501f' },
    slate: { label: 'Slate', dark: '#8f9cc4', light: '#6672a3' },
    stone: { label: 'Stone', dark: '#a3aab1', light: '#727a82' },
  },
};

/**
 * Highlighter (shared): `edge` is the border / bar / cloud stroke per theme; `wash` is the
 * fluoro fill (92%) under dark ink label text (>= 10:1 in both themes).
 */
export const HIGHLIGHTER: Record<(typeof HIGHLIGHTER_COLOURS)[number], { label: string; wash: string; dark: string; light: string }> = {
  lemon: { label: 'Lemon', wash: '#fff35c', dark: '#fff35c', light: '#8f8500' },
  lime: { label: 'Lime', wash: '#b6ff5c', dark: '#b6ff5c', light: '#5c9a00' },
  flamingo: { label: 'Flamingo', wash: '#ffc8f3', dark: '#ffc8f3', light: '#c9419f' },
  tangerine: { label: 'Tangerine', wash: '#ffd296', dark: '#ffd296', light: '#c46a00' },
  aqua: { label: 'Aqua', wash: '#7af4ff', dark: '#7af4ff', light: '#00879a' },
};

/**
 * Audroam (shared). Source: the action-pack `cssStyle.background` values in Audroam
 * `code/app/ui/js/data/*.ts` (release-20261027). They are rgba washes on a white page, so
 * `dark` is the colour as painted (rgba composited over #ffffff); Audroam has only the one
 * value, so `light` is that colour darkened (RGB scaled) until >= 3.2:1 on the light canvas.
 */
export const AUDROAM: Record<Exclude<(typeof AUDROAM_COLOURS)[number], (typeof AUDROAM_RICH_COLOURS)[number]>, { label: string; source: string; dark: string; light: string }> = {
  'audroam-green': { label: 'Soft green', source: "defaultActions1.ts:25 rgba(30,240,30,0.3)", dark: '#bcfbbc', light: '#6d916d' },
  'audroam-salmon': { label: 'Salmon', source: "actions2.ts:12 rgba(229,53,41,0.3)", dark: '#f7c2bf', light: '#a3807e' },
  'audroam-peach': { label: 'Peach', source: "defaultActions1.ts:332 rgba(240,80,30,0.3)", dark: '#fbcbbc', light: '#a08278' },
  'audroam-sky': { label: 'Sky blue', source: "reuseActions.ts:85 rgba(100,150,255,0.4)", dark: '#c1d5ff', light: '#7c88a3' },
  'audroam-aqua': { label: 'Aqua', source: "defaultActions1.ts:190 rgba(30,240,240,0.3)", dark: '#bcfbfb', light: '#6b8f8f' },
  'audroam-lemon': { label: 'Lemon', source: "reuseActions.ts:45 Yellow", dark: '#ffff00', light: '#8c8c00' },
  'audroam-red': { label: 'Red', source: "actions2.ts:358 rgba(240,40,40,0.6)", dark: '#f67e7e', light: '#d16b6b' },
  'audroam-lavender': { label: 'Lavender', source: "actions2.ts:510 rgba(200,200,255,0.8)", dark: '#d3d3ff', light: '#8787a3' },
  'audroam-grey': { label: 'Grey', source: "actions2.ts:487 rgba(140,140,140,0.4)", dark: '#d1d1d1', light: '#888888' },
};

/**
 * 0.5.30 solid-fill groups. `fill` is the colour of the swatch and of the `:fill` background
 * (solid, label ink picked by contrast). The border per theme is the fill pushed darker or
 * lighter until it reads >= 3:1 on that canvas, except Neutral: white stays white in the light
 * theme and black stays black in the dark theme, drawn with a subtle outline instead.
 */
export interface SolidGroup { key: string; label: string; roles: Record<string, { label: string; fill: string }> }
const solid = (key: string, label: string, fills: readonly string[]): SolidGroup => ({
  key, label, roles: Object.fromEntries(HUES.map((h, i) => [`${key}-${h}`, { label: `${label} ${h}`, fill: fills[i]! }])),
});
export const PALETTE_GROUPS: SolidGroup[] = [
  { key: 'neutral', label: 'Neutral', roles: { white: { label: 'White', fill: '#ffffff' }, black: { label: 'Black', fill: '#111417' } } },
  solid('bold', 'Bold', ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1', '#1e88e5', '#8e24aa', '#d81b60']),
  solid('pastel', 'Pastel', ['#ffb3b3', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#cdb4ff', '#ffadd6']),
  solid('deep', 'Deep', ['#8b1a1a', '#a14a00', '#7a6a00', '#1b5e20', '#00525e', '#0d3b8c', '#4a148c', '#880e4f']),
];
const SOLID = new Map<string, { label: string; fill: string; group: string }>(
  [
    ...PALETTE_GROUPS.flatMap((g) => Object.entries(g.roles).map(([k, v]) => [k, { ...v, group: g.key }] as const)),
    ...Object.entries(AUDROAM_RICH).map(([k, v]) => [k, { label: v.label, fill: v.fill, group: k === 'audroam-white' ? 'neutral' : 'audroam' }] as const),
  ],
);
export function isSolidColour(name: unknown): boolean {
  return typeof name === 'string' && SOLID.has(name);
}

// ── 0.5.30 colour maths (sRGB, WCAG 2 relative luminance, CIE76 Lab distance) ──
const rgb = (h: string): [number, number, number] => {
  const x = h.replace('#', '');
  const f = x.length === 3 ? x.split('').map((c) => c + c).join('') : x;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)) as [number, number, number];
};
const toHex = (c: number[]) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(lin) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio, 1…21. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
/** `color-mix(in srgb, a p%, b)`. */
export function mixHex(a: string, b: string, p: number): string {
  const A = rgb(a), B = rgb(b);
  return toHex(A.map((v, i) => v * p + B[i]! * (1 - p)));
}
function lab(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map(lin) as [number, number, number];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), Y = f(r * 0.2126 + g * 0.7152 + b * 0.0722), Z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
/** CIE76 ΔE between two colours (about 2.3 is a just-noticeable difference). */
export function colourDistance(a: string, b: string): number {
  const A = lab(a), B = lab(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}
/** Push `c` toward black or white (whichever gets there) until it is >= `min`:1 against `bg`. */
export function shadeFor(c: string, bg: string, min = 3): string {
  if (contrastRatio(c, bg) >= min) return c;
  const toward = luminance(bg) > 0.18 ? '#000000' : '#ffffff';
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const x = mixHex(toward, c, t);
    if (contrastRatio(x, bg) >= min) return x;
  }
  return toward;
}
/**
 * 0.5.30: checkbox box and tick on a filled node. A shade of the fill pushed to the darker or
 * lighter end, whichever reaches >= 3:1 (WCAG non-text) with the most room; black or white if
 * no shade does. Tinted to the fill, so it reads as part of the node rather than chrome.
 */
export function checkboxInk(fill: string, min = 3): string {
  const target = Math.max(min, 4.5);
  const pick = (to: string) => {
    for (let t = 0.5; t <= 1.0001; t += 0.05) {
      const x = mixHex(to, fill, t);
      if (contrastRatio(x, fill) >= target) return x;
    }
    return to;
  };
  const dark = pick('#000000');
  const light = pick('#ffffff');
  const best = contrastRatio(dark, fill) >= contrastRatio(light, fill) ? dark : light;
  return contrastRatio(best, fill) >= min ? best : contrastRatio('#000000', fill) > contrastRatio('#ffffff', fill) ? '#000000' : '#ffffff';
}
/** Label ink on a solid fill: the dark map ink or white, whichever contrasts more. */
export function labelInk(fill: string): string {
  return contrastRatio('#0b1a21', fill) >= contrastRatio('#ffffff', fill) ? '#0b1a21' : '#ffffff';
}

export const MAP_CANVAS = { dark: '#0a1f28', light: '#f3f6f9' } as const;
export type Theme = 'dark' | 'light';

/** Border / swatch colour of a role in a theme. */
export function swatchHex(role: string, theme: Theme, palette?: string | null): string {
  const r = resolveColour(role) ?? role;
  const s = SOLID.get(r);
  if (s) return s.group === 'neutral' ? s.fill : shadeFor(s.fill, MAP_CANVAS[theme]);
  if (r in HIGHLIGHTER) return HIGHLIGHTER[r as keyof typeof HIGHLIGHTER][theme];
  if (r in AUDROAM) return AUDROAM[r as keyof typeof AUDROAM][theme];
  return nodePalette(palette).roles[r as BaseRole]?.[theme] ?? '#888888';
}
/** The background a `:fill` node paints, as the CSS mixes it (see outline-fold.css). */
export function filledPaint(role: string, theme: Theme, palette?: string | null): string {
  const r = resolveColour(role) ?? role;
  const bg = MAP_CANVAS[theme];
  const s = SOLID.get(r);
  if (s) return s.fill;
  if (r in HIGHLIGHTER) return mixHex(HIGHLIGHTER[r as keyof typeof HIGHLIGHTER].wash, bg, 0.92);
  if (r in AUDROAM) return AUDROAM[r as keyof typeof AUDROAM].dark;
  return mixHex(swatchHex(r, theme, palette), bg, 0.16);
}

/**
 * 0.5.30 generated CSS (between the @gen-roles markers in outline-fold.css): the new roles'
 * tokens and classes, and every role's `--task-ink` on a filled node in both themes.
 * Regenerate with `node scripts/gen-palette-css.mjs` after a build.
 */
export function rolesCss(): string {
  const L: string[] = [];
  const solids = [...SOLID.keys()];
  L.push(`html { ${solids.map((r) => `--node-${r}: ${swatchHex(r, 'dark')}; --node-${r}-hl: ${SOLID.get(r)!.fill}; --node-${r}-ink: ${labelInk(SOLID.get(r)!.fill)};`).join(' ')} }`);
  L.push(`.of-theme-light:where(*) { ${solids.map((r) => `--node-${r}: ${swatchHex(r, 'light')};`).join(' ')} }`);
  for (const r of solids) {
    L.push(`.map-node.colour-${r}, .map-region-node.colour-${r}, .of-node.of-colour-${r} { --nc: var(--node-${r}); --nh: var(--node-${r}-hl); --ink: var(--node-${r}-ink); }`);
    L.push(`.swatch-${r} { --sw: var(--node-${r}-hl); }`);
    L.push(`.of-node.of-colour-fill.of-colour-${r} > .of-row > .of-title { background: var(--node-${r}-hl); color: var(--node-${r}-ink); border-radius: 3px; padding: 0 3px; }`);
  }
  for (const r of NODE_COLOURS) {
    L.push(`.map-node.colour-${r}.colour-fill, .map-region-node.colour-${r}.colour-fill { --task-ink: ${checkboxInk(filledPaint(r, 'dark'))}; }`);
    L.push(`.of-theme-light .map-node.colour-${r}.colour-fill, .of-theme-light .map-region-node.colour-${r}.colour-fill { --task-ink: ${checkboxInk(filledPaint(r, 'light'))}; }`);
  }
  return L.join('\n') + '\n';
}

const palettes = new Map<string, NodePalette>([['forest', FOREST_PALETTE]]);
export const DEFAULT_PALETTE = 'forest';

/** Add (or replace) a named palette; only a token table is needed. */
export function registerNodePalette(p: NodePalette): void {
  palettes.set(p.name, p);
}
export function nodePalette(name?: string | null): NodePalette {
  return palettes.get(name ?? DEFAULT_PALETTE) ?? FOREST_PALETTE;
}
export function nodePaletteNames(): string[] {
  return [...palettes.keys()];
}

/**
 * Menu / picker groups, one labelled row per palette: `<palette label>` (base roles, the
 * active base palette), `Highlighter`, `Audroam`. Other registered base palettes recolour the
 * same role keys, so they switch via `colourPalette` instead of adding duplicate rows.
 */
export function colourGroups(palette?: string | null): { name: string; colours: readonly NodeColour[] }[] {
  return [
    { name: nodePalette(palette).label, colours: BASE_ROLES },
    { name: 'Neutral', colours: NEUTRAL_COLOURS },
    { name: 'Bold', colours: BOLD_COLOURS },
    { name: 'Pastel', colours: PASTEL_COLOURS },
    { name: 'Deep', colours: DEEP_COLOURS },
    { name: 'Highlighter', colours: HIGHLIGHTER_COLOURS },
    { name: 'Audroam', colours: AUDROAM_COLOURS },
  ];
}
/** Default (Forest) groups. */
export const COLOUR_GROUPS = colourGroups();

/** Earlier generic names, read as aliases and written back as the role name. */
export const COLOUR_ALIASES: Readonly<Record<string, NodeColour>> = {
  red: 'ember', amber: 'lichen', green: 'fern', teal: 'pine', blue: 'creek', violet: 'slate', pink: 'flamingo', grey: 'stone', gray: 'stone',
};

export function isNodeColour(name: unknown): name is NodeColour {
  return typeof name === 'string' && (NODE_COLOURS as readonly string[]).includes(name);
}

/** Role or alias (any case) → role; anything else → null. */
export function resolveColour(name: unknown): NodeColour | null {
  if (typeof name !== 'string') return null;
  const n = name.trim().toLowerCase();
  return isNodeColour(n) ? n : COLOUR_ALIASES[n] ?? null;
}

export function isHighlighter(name: unknown): boolean {
  return typeof name === 'string' && (HIGHLIGHTER_COLOURS as readonly string[]).includes(name);
}

/** 0.5.23: an Audroam role (`audroam-*`); its fill paints the sampled button colour solid. */
export function isAudroam(name: unknown): boolean {
  return typeof name === 'string' && (AUDROAM_COLOURS as readonly string[]).includes(name);
}

/** Role → its label in a palette (`moss` → `Moss`; menu labels, live region, accessible name). */
export function colourLabel(name: string, palette?: string | null): string {
  const r = resolveColour(name);
  if (r && isHighlighter(r)) return HIGHLIGHTER[r as keyof typeof HIGHLIGHTER].label;
  if (r && r in AUDROAM) return AUDROAM[r as keyof typeof AUDROAM].label;
  if (r && SOLID.has(r)) return SOLID.get(r)!.label;
  if (r) return nodePalette(palette).roles[r as BaseRole].label;
  return name ? name[0]!.toUpperCase() + name.slice(1) : name;
}

/** `moss` → `var(--node-moss)`. */
export function colourVar(name: NodeColour | string): string {
  return `var(--node-${name})`;
}

/**
 * CSS for a non-default palette, scoped to `.of-palette-<name>` (dark) and the light theme.
 * Forest ships as the defaults in outline-fold.css, so it needs no injected style.
 */
export function paletteCss(name: string): string {
  const p = nodePalette(name);
  const sel = `.of-palette-${p.name}`;
  const block = (t: 'dark' | 'light') => BASE_ROLES.map((r) => `--node-${r}: ${p.roles[r][t]};`).join(' ');
  // 0.5.30: the checkbox ink on a filled base-role node follows this palette's wash.
  const ink = (t: 'dark' | 'light', pre: string) => BASE_ROLES.map((r) => `${pre} .map-node.colour-${r}.colour-fill, ${pre} .map-region-node.colour-${r}.colour-fill { --task-ink: ${checkboxInk(filledPaint(r, t, p.name))}; }`).join('\n');
  return `${sel} { ${block('dark')} }\n.of-theme-light ${sel}, .of-theme-light${sel} { ${block('light')} }\n${ink('dark', sel)}\n${ink('light', `.of-theme-light ${sel}`)}\n`;
}

/** Apply a palette to a host element: class plus (for non-default sets) one shared <style>. */
export function applyNodePalette(el: HTMLElement, name?: string | null): string {
  const p = nodePalette(name);
  for (const c of [...el.classList]) if (c.startsWith('of-palette-')) el.classList.remove(c);
  el.classList.add(`of-palette-${p.name}`);
  if (p.name !== DEFAULT_PALETTE && typeof document !== 'undefined') {
    const id = `of-palette-style-${p.name}`;
    if (!document.getElementById(id)) {
      const s = document.createElement('style');
      s.id = id;
      s.textContent = paletteCss(p.name);
      document.head.appendChild(s);
    }
  }
  return p.name;
}

/** 0.5.20: turn the opt-in wash (`<color:x:fill>`) on or off for a node that has a colour. */
export function setColourFill(node: { color?: string; colorFill?: boolean }, on: boolean): boolean {
  if (!node.color) return false;
  if (on) node.colorFill = true;
  else delete node.colorFill;
  return true;
}
