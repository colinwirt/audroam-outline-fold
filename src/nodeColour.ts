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
export const AUDROAM_COLOURS = [
  'audroam-green', 'audroam-salmon', 'audroam-peach', 'audroam-sky', 'audroam-aqua',
  'audroam-lemon', 'audroam-red', 'audroam-lavender', 'audroam-grey',
] as const;
export const NODE_COLOURS = [...BASE_ROLES, ...HIGHLIGHTER_COLOURS, ...AUDROAM_COLOURS] as const;
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
    lichen: { label: 'Lichen', dark: '#c9b866', light: '#8a7a1e' },
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
export const AUDROAM: Record<(typeof AUDROAM_COLOURS)[number], { label: string; source: string; dark: string; light: string }> = {
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
  return `${sel} { ${block('dark')} }\n.of-theme-light ${sel}, .of-theme-light${sel} { ${block('light')} }\n`;
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
