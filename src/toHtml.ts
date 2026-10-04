import { isCollapsed } from './fold.js';
import { captionToHtml } from './captionRich.js';
import { iconForNode, iconForTask } from './icons.js';
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
  const flags = node.flags ?? [];
  const locked =
    opts.lockedChrome &&
    (flags.includes('private') || flags.includes('encrypted'));
  const icon = iconForNode(node.kind, flags);
  const sealed = hasSealed(node);
  const hasKids = !!(node.children && node.children.length > 0);
  const ariaLevel = node.depth + 1;
  const interactiveTasks = opts.interactiveTasks !== false;

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
    node.task ? `data-task="${esc(node.task)}"` : '',
    node.action ? `data-action="${esc(node.action)}"` : '',
    node.thread ? `data-thread="${esc(node.thread)}"` : '',
    node.id ? `data-testid="of-node-${esc(node.id)}"` : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Presentational fold chrome — treeitem owns expand/collapse for a11y.
  // Always reserve the fold column so icon/title align for parents and leaves.
  // Chevron (not grammar "(+)") — collapsed points right, expanded rotates down.
  const chevron = `<svg class="${p}-chevron" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const foldBtn =
    node.id && hasKids
      ? `<button type="button" class="${p}-fold${collapsed ? '' : ` ${p}-fold-expanded`}" data-toggle-fold="${esc(node.id)}" data-testid="of-fold-${esc(node.id)}" tabindex="-1" aria-hidden="true">${chevron}</button>`
      : `<span class="${p}-fold ${p}-fold-leaf" aria-hidden="true"></span>`;

  const unlockBtn = locked
    ? flags.includes('encrypted')
      ? `<button type="button" class="${p}-unlock" data-decrypt="${esc(node.id ?? '')}" data-testid="of-decrypt-${esc(node.id ?? '')}">Decrypt</button>`
      : `<button type="button" class="${p}-unlock" data-unlock="${esc(node.id ?? '')}" data-testid="of-unlock-${esc(node.id ?? '')}">Unlock (MFA)</button>`
    : '';

  // Task SVG lead — ASCII `[ ]`/`[x]` stripped from title at parse time.
  let taskChrome = '';
  if (node.task && node.id) {
    const checked =
      node.task === 'done' ? 'true' : node.task === 'pending' ? 'mixed' : 'false';
    const taskLabel =
      node.task === 'done'
        ? 'Mark open'
        : node.task === 'pending'
          ? 'Mark done'
          : 'Mark in progress';
    const svg = iconForTask(node.task);
    if (interactiveTasks) {
      taskChrome = `<button type="button" class="${p}-task ${p}-task-${node.task}" data-toggle-task="${esc(node.id)}" data-testid="of-task-${esc(node.id)}" role="checkbox" aria-checked="${checked}" aria-label="${taskLabel}" tabindex="-1">${svg}</button>`;
    } else {
      taskChrome = `<span class="${p}-task ${p}-task-${node.task}" data-testid="of-task-${esc(node.id)}" role="checkbox" aria-checked="${checked}" aria-disabled="true">${svg}</span>`;
    }
  }

  const threadChip =
    node.thread && node.id
      ? `<button type="button" class="${p}-thread" data-thread="${esc(node.thread)}" data-thread-node="${esc(node.id)}" data-testid="of-thread-${esc(node.id)}" tabindex="-1">Thread</button>`
      : '';

  const noteChips = (node.noteLinks || [])
    .map(
      (pnid) =>
        `<button type="button" class="${p}-note-link" data-note-link="${esc(pnid)}" data-note-node="${esc(node.id ?? '')}" data-testid="of-note-link-${esc(pnid)}" tabindex="-1">#${esc(pnid)}</button>`,
    )
    .join('');

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

  return `<li role="treeitem" class="${p}-node${collapsed ? ` ${p}-collapsed` : ''}${locked ? ` ${p}-locked` : ''}${node.task ? ` ${p}-has-task` : ''}" tabindex="-1" aria-level="${ariaLevel}"${ariaExpanded} ${dataAttrs}>
  <div class="${p}-row">${foldBtn}${taskChrome}${icon}<span class="${p}-title">${captionToHtml(node.title)}</span>${threadChip}${noteChips}${unlockBtn}</div>
  ${body}${kids}
</li>`;
}

/**
 * Semantic HTML string for an outline doc. Wire via attachOutlineTree /
 * toggleFold / host onUnlock/onDecrypt — this function only emits markup.
 * Sealed ciphertext stays in the JS model; DOM gets `data-kid` / `data-sealed` only.
 * Leading `[ ]`/`[x]` become SVG task chrome (ASCII stripped from title at parse).
 */
export function toHtml(doc: OutlineFoldDoc, options: ToHtmlOptions = {}): string {
  const opts = {
    classPrefix: options.classPrefix ?? 'of',
    lockedChrome: options.lockedChrome ?? true,
    callbacks: options.callbacks,
    ariaLabel: options.ariaLabel,
    interactiveTasks: options.interactiveTasks,
  };
  const p = opts.classPrefix;
  const label = esc(opts.ariaLabel ?? 'Outline');
  const items = doc.nodes.map((n) => renderNode(n, doc, opts)).join('');
  return `<ul role="tree" aria-label="${label}" class="${p}-outline" data-testid="of-tree" data-fold-mode="${doc.fold.mode}">${items}</ul>`;
}
