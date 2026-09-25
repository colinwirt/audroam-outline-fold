import { isCollapsed } from './fold.js';
import { iconForNode } from './icons.js';
import { hasSealed } from './sealed.js';
import type { OutlineFoldDoc, OutlineNode, ToHtmlOptions } from './types.js';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderNode(
  node: OutlineNode,
  doc: OutlineFoldDoc,
  opts: Required<Pick<ToHtmlOptions, 'classPrefix' | 'lockedChrome'>> &
    ToHtmlOptions,
): string {
  const p = opts.classPrefix;
  const collapsed = node.id ? isCollapsed(doc, node.id) : false;
  const marker =
    doc.frontmatter?.collapsedMarker ?? '(+)';
  const flags = node.flags ?? [];
  const locked =
    opts.lockedChrome &&
    (flags.includes('private') || flags.includes('encrypted'));
  const icon = iconForNode(node.kind, flags);
  const sealed = hasSealed(node);
  const hasKids = !!(node.children && node.children.length > 0);
  const ariaLevel = node.depth + 1;

  // data-kid only — never put raw ciphertext in the DOM / accessible name.
  const dataAttrs = [
    node.id ? `data-id="${esc(node.id)}"` : '',
    `data-collapsed="${collapsed}"`,
    flags.length ? `data-flags="${esc(flags.join(','))}"` : '',
    node.dbRef ? `data-db-ref="${esc(node.dbRef)}"` : '',
    sealed ? `data-sealed="true"` : '',
    sealed && node.sealed?.kid ? `data-kid="${esc(node.sealed.kid)}"` : '',
    sealed && node.sealed?.uri ? `data-sealed-uri="${esc(node.sealed.uri)}"` : '',
    sealed
      ? `data-sealed-mode="${node.sealed?.uri && !node.sealed?.ciphertext ? 'remote' : 'inline'}"`
      : '',
    node.id ? `data-testid="of-node-${esc(node.id)}"` : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Presentational fold chrome — treeitem owns expand/collapse for a11y.
  const foldBtn =
    node.id && hasKids
      ? `<button type="button" class="${p}-fold${collapsed ? '' : ` ${p}-fold-expanded`}" data-toggle-fold="${esc(node.id)}" data-testid="of-fold-${esc(node.id)}" tabindex="-1" aria-hidden="true">${collapsed ? esc(marker) : ''}</button>`
      : '';

  const unlockBtn = locked
    ? flags.includes('encrypted')
      ? `<button type="button" class="${p}-unlock" data-decrypt="${esc(node.id ?? '')}" data-testid="of-decrypt-${esc(node.id ?? '')}">Decrypt</button>`
      : `<button type="button" class="${p}-unlock" data-unlock="${esc(node.id ?? '')}" data-testid="of-unlock-${esc(node.id ?? '')}">Unlock (MFA)</button>`
    : '';

  const body = locked
    ? `<div class="${p}-locked-chrome" aria-hidden="true">•••• locked ••••</div>`
    : '';

  // Keep children in the DOM when collapsed (CSS hides). Focus + a11y stable.
  const kids = hasKids
    ? `<ul class="${p}-children" role="group">${node.children!.map((c) => renderNode(c, doc, opts)).join('')}</ul>`
    : '';

  const ariaExpanded = hasKids
    ? ` aria-expanded="${collapsed ? 'false' : 'true'}"`
    : '';

  return `<li role="treeitem" class="${p}-node${collapsed ? ` ${p}-collapsed` : ''}${locked ? ` ${p}-locked` : ''}" tabindex="-1" aria-level="${ariaLevel}"${ariaExpanded} ${dataAttrs}>
  <div class="${p}-row">${icon}${foldBtn}<span class="${p}-title">${esc(node.title)}</span>${unlockBtn}</div>
  ${body}${kids}
</li>`;
}

/**
 * Semantic HTML string for an outline doc. Wire via attachOutlineTree /
 * toggleFold / host onUnlock/onDecrypt — this function only emits markup.
 * Sealed ciphertext stays in the JS model; DOM gets `data-kid` / `data-sealed` only.
 */
export function toHtml(doc: OutlineFoldDoc, options: ToHtmlOptions = {}): string {
  const opts = {
    classPrefix: options.classPrefix ?? 'of',
    lockedChrome: options.lockedChrome ?? true,
    callbacks: options.callbacks,
    ariaLabel: options.ariaLabel,
  };
  const p = opts.classPrefix;
  const label = esc(opts.ariaLabel ?? 'Outline');
  const items = doc.nodes.map((n) => renderNode(n, doc, opts)).join('');
  return `<ul role="tree" aria-label="${label}" class="${p}-outline" data-testid="of-tree" data-fold-mode="${doc.fold.mode}">${items}</ul>`;
}
