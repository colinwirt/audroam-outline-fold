/**
 * 0.5.18 Map clipart (EP-10, EP-22, EP-30): a small built-in set of single-colour line icons
 * authored for this package (same licence as the package). Every path uses `currentColor`, so
 * an icon takes the text colour (T17) or the pill colour on the Map. Each entry declares the
 * Unicode emoji it falls back to (EP-24). No script, no href, no foreignObject (T16).
 */
export interface ClipartEntry {
  /** Stable `:name:` key. Never one of RESERVED_ICON_NAMES. */
  name: string;
  /** Display name (`Compass`). */
  label: string;
  keywords: string[];
  /** Unicode emoji shown where the SVG cannot be drawn and in `fallback` export. */
  fallback: string;
  /** Inner SVG markup for a 24×24 viewBox. */
  body: string;
  /** Full `<svg>` string (1em, currentColor stroke). */
  svg: string;
}

const RAW: [string, string, string, string, string][] = [
  ['flag', 'Flag', 'milestone goal finish mark', '🚩', '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'],
  ['check', 'Check', 'done tick ok yes complete', '✔️', '<path d="M4 12.5l5 5L20 6.5"/>'],
  ['star', 'Star', 'favourite favorite important best', '⭐', '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/>'],
  ['warning', 'Warning', 'caution alert risk danger', '⚠️', '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5"/><path d="M12 17.5v.01"/>'],
  ['target', 'Target', 'goal aim focus objective', '🎯', '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>'],
  ['link', 'Link', 'chain url reference connect', '🔗', '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'],
  ['list', 'List', 'items bullets checklist agenda', '📋', '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4.5 6v.01"/><path d="M4.5 12v.01"/><path d="M4.5 18v.01"/>'],
  ['clock', 'Clock', 'time schedule deadline hour', '🕒', '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'],
  ['compass', 'Compass', 'navigation direction explore orienteering', '🧭', '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>'],
  ['pin', 'Pin', 'location place marker map', '📍', '<path d="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/>'],
  ['map', 'Map', 'route area plan trip', '🗺️', '<path d="M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2z"/><path d="M9 4.5v13"/><path d="M15 6.5v13"/>'],
  ['home', 'Home', 'house start base', '🏠', '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>'],
  ['question', 'Question', 'help unknown ask', '❓', '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2-2.4 3.5"/><path d="M12 17v.01"/>'],
  ['info', 'Info', 'information note about', 'ℹ️', '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.5v.01"/>'],
  ['bolt', 'Bolt', 'lightning fast energy power', '⚡', '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>'],
  ['heart', 'Heart', 'love like care', '❤️', '<path d="M12 19.5s-7.5-4.6-7.5-10A4 4 0 0 1 12 7a4 4 0 0 1 7.5 2.5c0 5.4-7.5 10-7.5 10z"/>'],
  ['bookmark', 'Bookmark', 'save keep later read', '🔖', '<path d="M7 3.5h10V21l-5-3.5L7 21z"/>'],
  ['idea', 'Idea', 'bulb light think insight', '💡', '<path d="M9 17.5h6"/><path d="M10 21h4"/><path d="M12 3.5a6 6 0 0 0-3.5 10.9c.4.3.5.7.5 1.1v2h5v-2c0-.4.1-.8.5-1.1A6 6 0 0 0 12 3.5z"/>'],
  ['calendar', 'Calendar', 'date day event month', '📅', '<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10h16"/><path d="M8.5 3.5v4"/><path d="M15.5 3.5v4"/>'],
  ['eye', 'Eye', 'watch review look see', '👁️', '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'],
];

export function clipartSvg(body: string, label?: string): string {
  const a11y = label ? ` role="img" aria-label="${label}"` : ' aria-hidden="true"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em"${a11y} focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

export const CLIPART: readonly ClipartEntry[] = RAW.map(([name, label, kw, fallback, body]) => ({
  name,
  label,
  keywords: kw.split(' '),
  fallback,
  body,
  svg: clipartSvg(body),
}));

const BY_NAME = new Map(CLIPART.map((c) => [c.name, c]));

export function clipartByName(name: string): ClipartEntry | undefined {
  return BY_NAME.get(name.toLowerCase());
}

/**
 * T18 reserved names: the type-icon pack and security cues. A user icon can never take
 * these, so a `:lock:` / `<icon:mfa>` stays plain text (EP-30 "reserved names are errors").
 */
export const RESERVED_ICON_NAMES: readonly string[] = [
  'doc', 'ticket', 'globe', 'db', 'feature', 'form', 'bug', 'risk',
  'lock', 'encrypted', 'mfa', 'unlock', 'system-link', 'pending-approve',
  'sealed', 'secure', 'record',
];

export function isReservedIconName(name: string): boolean {
  const n = name.toLowerCase();
  return RESERVED_ICON_NAMES.includes(n) || n.startsWith('task-');
}
