/**
 * Shared outline renderer: doc → toHtml + attachOutlineTree.
 * All Pages demos use this — no per-page HTML tree builders.
 */
import {
  toHtml,
  attachOutlineTree,
  serialize,
} from '../../dist/index.js';
import { injectReveals } from './unlockStub.js';

/**
 * @typedef {object} OutlineViewOptions
 * @property {() => import('../../dist/index.js').OutlineFoldDoc} getDoc
 * @property {(d: import('../../dist/index.js').OutlineFoldDoc) => void} setDoc
 * @property {string} [ariaLabel]
 * @property {boolean} [lockedChrome]
 * @property {boolean} [markCues] tint cue-like nodes
 * @property {(id: string) => void} [onUnlock]
 * @property {(id: string) => void} [onDecrypt]
 * @property {Record<string, string>} [revealed]
 * @property {(host: HTMLElement) => void} [afterPaint]
 * @property {HTMLElement | null} [serializeTarget] optional <pre> for serialize(doc)
 */

/**
 * @param {HTMLElement} host
 * @param {OutlineViewOptions} opts
 */
export function createOutlineView(host, opts) {
  const {
    getDoc,
    setDoc,
    ariaLabel = 'Outline',
    lockedChrome = true,
    markCues = false,
    onUnlock,
    onDecrypt,
    revealed,
    afterPaint,
    serializeTarget = null,
  } = opts;

  function paintOutline() {
    const doc = getDoc();
    host.innerHTML = toHtml(doc, { ariaLabel, lockedChrome });
    if (markCues) {
      host.querySelectorAll('[role="treeitem"]').forEach((li) => {
        const id = li.getAttribute('data-id') || '';
        const title = li.querySelector('.of-title')?.textContent || '';
        if (/^cue/i.test(id) || /^\s*cue\s*:/i.test(title)) {
          li.classList.add('of-cue');
        }
      });
    }
    if (revealed) injectReveals(host, revealed);
    if (serializeTarget) serializeTarget.textContent = serialize(doc);
    afterPaint?.(host);
  }

  /** @type {import('../../dist/index.js').AttachOutlineTreeHandle} */
  const treeApi = attachOutlineTree(host, {
    getDoc,
    setDoc,
    render: paintOutline,
    onUnlock,
    onDecrypt,
  });

  return {
    /** Re-render outline (and sync serialize panel). */
    paint: paintOutline,
    treeApi,
    refresh(focusId) {
      paintOutline();
      treeApi.refresh?.(focusId ?? null);
    },
  };
}

export { toHtml, attachOutlineTree, serialize };
