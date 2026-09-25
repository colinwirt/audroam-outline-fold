/**
 * Gold type icon pack — lightweight inline SVG strings.
 * Host may swap assets; these are defaults for demos / toHtml.
 */

export type IconName =
  | 'doc'
  | 'ticket'
  | 'globe'
  | 'db'
  | 'feature'
  | 'form'
  | 'bug'
  | 'risk'
  | 'lock'
  | 'encrypted'
  | 'mfa'
  | 'unlock'
  | 'system-link'
  | 'pending-approve';

const gold = '#C9A227';
const stroke = gold;

function svg(body: string, label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" aria-label="${label}" fill="none" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

export const ICONS: Record<IconName, string> = {
  doc: svg(
    '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    'document',
  ),
  ticket: svg(
    '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
    'ticket',
  ),
  globe: svg(
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    'website',
  ),
  db: svg(
    '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    'database',
  ),
  feature: svg(
    '<path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
    'feature',
  ),
  form: svg(
    '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    'form field',
  ),
  bug: svg(
    '<circle cx="12" cy="14" r="5"/><path d="M12 9V5M9 5h6M7 12H4m16 0h-3M8 18l-2 2m10-2 2 2"/>',
    'bug',
  ),
  risk: svg(
    '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v4M12 17h.01"/>',
    'risk warning',
  ),
  lock: svg(
    '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    'private lock',
  ),
  encrypted: svg(
    '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><path d="M12 15v2"/>',
    'encrypted',
  ),
  mfa: svg(
    '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><circle cx="12" cy="16" r="1.5"/>',
    'MFA challenge',
  ),
  'system-link': svg(
    '<path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4.76"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L13 19.24"/>',
    'system link',
  ),
  'pending-approve': svg(
    '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h3M8 16l2 2 5-5"/>',
    'pending approval',
  ),
  unlock: svg(

    '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    'unlock',
  ),
};

export function iconForNode(kind?: string, flags?: string[]): string {
  if (flags?.includes('encrypted')) return ICONS.encrypted;
  if (flags?.includes('private')) return ICONS.lock;
  if (flags?.includes('db') || kind === 'db') return ICONS.db;
  if (kind === 'system-link') return ICONS['system-link'];
  if (kind && kind in ICONS) return ICONS[kind as IconName];
  return ICONS.doc;
}
