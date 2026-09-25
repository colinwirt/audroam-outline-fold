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
  ]
    .filter(Boolean)
    .join(' ');

  const foldBtn =
    node.id && collapsed
      ? `<button type="button" class="${p}-fold" data-toggle-fold="${esc(node.id)}" aria-label="Expand">${esc(marker)}</button>`
      : node.id
        ? `<button type="button" class="${p}-fold ${p}-fold-expanded" data-toggle-fold="${esc(node.id)}" aria-label="Collapse"></button>`
        : '';

  const unlockBtn = locked
    ? flags.includes('encrypted')
      ? `<button type="button" class="${p}-unlock" data-decrypt="${esc(node.id ?? '')}">Decrypt</button>`
      : `<button type="button" class="${p}-unlock" data-unlock="${esc(node.id ?? '')}">Unlock (MFA)</button>`
    : '';

  const body = locked
    ? `<div class="${p}-locked-chrome" aria-hidden="true">•••• locked ••••</div>`
    : '';

  const kids =
    !collapsed && node.children?.length
      ? `<ul class="${p}-children">${node.children.map((c) => renderNode(c, doc, opts)).join('')}</ul>`
      : '';

  return `<li class="${p}-node${collapsed ? ` ${p}-collapsed` : ''}${locked ? ` ${p}-locked` : ''}" ${dataAttrs}>
  <div class="${p}-row">${icon}${foldBtn}<span class="${p}-title">${esc(node.title)}</span>${unlockBtn}</div>
  ${body}${kids}
</li>`;
}

/**
 * Semantic HTML string for an outline doc. Wire buttons to toggleFold /
 * host onUnlock/onDecrypt — this function only emits markup.
 * Sealed ciphertext stays in the JS model; DOM gets `data-kid` / `data-sealed` only.
 */
export function toHtml(doc: OutlineFoldDoc, options: ToHtmlOptions = {}): string {
  const opts = {
    classPrefix: options.classPrefix ?? 'of',
    lockedChrome: options.lockedChrome ?? true,
    callbacks: options.callbacks,
  };
  const p = opts.classPrefix;
  const items = doc.nodes.map((n) => renderNode(n, doc, opts)).join('');
  return `<ul class="${p}-outline" data-fold-mode="${doc.fold.mode}">${items}</ul>`;
}
