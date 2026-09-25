import {
  isCollapsed,
  setExpandLevel,
  toggleFold,
  type ExpandLevel,
} from './fold.js';
import type { OutlineFoldDoc } from './types.js';

/** Live-region copy for expand-level keys (pure; unit-tested). */
export function expandLevelAnnouncement(
  level: ExpandLevel | number | string,
): string {
  if (level === '*' || level === 'all') return 'Expanded all';
  const n = typeof level === 'number' ? level : Number(level);
  if (n === 0) return 'Showing top level only';
  return `Showing through level ${n}`;
}

/** Live-region copy for single-node toggle (pure). */
export function foldToggleAnnouncement(
  expanded: boolean,
  title: string,
): string {
  return expanded ? `Expanded: ${title}` : `Collapsed: ${title}`;
}

export interface AttachOutlineTreeOptions {
  /** Current doc snapshot. */
  getDoc: () => OutlineFoldDoc;
  /** Replace doc after a fold mutation (session-local). */
  setDoc: (doc: OutlineFoldDoc) => void;
  /**
   * Re-paint the tree into `rootEl` (typically `innerHTML = toHtml(doc)`).
   * Called by the helper after mutations; also call `api.refresh()` after
   * your own initial / external paint so roving tabindex is applied.
   */
  render: () => void;
  /** Optional polite live region; created under rootEl if omitted. */
  liveEl?: HTMLElement | null;
  /** Class prefix matching toHtml. Default: "of" */
  classPrefix?: string;
  /** Host Unlock stub. If omitted, announces that host auth is required. */
  onUnlock?: (id: string) => void;
  /** Host Decrypt stub. If omitted, announces that host handler is required. */
  onDecrypt?: (id: string) => void;
}

export interface AttachOutlineTreeHandle {
  /** Re-apply roving tabindex + restore focus after an external paint. */
  refresh: (focusId?: string | null) => void;
  /** Remove listeners and live region created by the helper. */
  detach: () => void;
}

function findTree(rootEl: HTMLElement, prefix: string): HTMLElement | null {
  return (
    rootEl.querySelector<HTMLElement>(`[data-testid="of-tree"]`) ??
    rootEl.querySelector<HTMLElement>(`[role="tree"]`) ??
    rootEl.querySelector<HTMLElement>(`.${prefix}-outline`) ??
    (rootEl.getAttribute('role') === 'tree' ? rootEl : null)
  );
}

function isRowVisible(li: HTMLElement, prefix: string): boolean {
  let p: HTMLElement | null = li.parentElement;
  while (p) {
    if (p.classList.contains(`${prefix}-children`)) {
      const parentLi = p.parentElement;
      if (parentLi?.getAttribute('data-collapsed') === 'true') return false;
    }
    if (
      p.classList.contains(`${prefix}-outline`) ||
      p.getAttribute('role') === 'tree'
    ) {
      break;
    }
    p = p.parentElement;
  }
  return true;
}

function visibleTreeitems(tree: HTMLElement, prefix: string): HTMLElement[] {
  return Array.from(
    tree.querySelectorAll<HTMLElement>('[role="treeitem"]'),
  ).filter((li) => isRowVisible(li, prefix));
}

function nodeTitle(li: HTMLElement, prefix: string): string {
  const t = li.querySelector(`.${prefix}-title`);
  return (t?.textContent ?? li.getAttribute('data-id') ?? 'row').trim();
}

function hasChildren(li: HTMLElement): boolean {
  return li.hasAttribute('aria-expanded');
}

function ensureLiveRegion(
  rootEl: HTMLElement,
  provided: HTMLElement | null | undefined,
  created: { el: HTMLElement | null },
): HTMLElement {
  if (provided) return provided;
  if (created.el && created.el.isConnected) return created.el;
  const el = document.createElement('div');
  el.className = 'of-live visually-hidden';
  el.setAttribute('data-testid', 'of-live');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.style.cssText =
    'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';
  rootEl.prepend(el);
  created.el = el;
  return el;
}

function announce(live: HTMLElement, message: string): void {
  // Clear then set so polite SRs re-announce identical strings.
  live.textContent = '';
  requestAnimationFrame(() => {
    live.textContent = message;
  });
}

function syncRoving(
  tree: HTMLElement,
  prefix: string,
  focusId: string | null | undefined,
): void {
  const items = visibleTreeitems(tree, prefix);
  let focusTarget: HTMLElement | null = null;
  if (focusId) {
    focusTarget =
      items.find((li) => li.getAttribute('data-id') === focusId) ?? null;
    if (!focusTarget) {
      // Nearest visible ancestor: walk up from hidden node in full tree.
      const hidden = tree.querySelector<HTMLElement>(
        `[data-id="${CSS.escape(focusId)}"]`,
      );
      let p: HTMLElement | null = hidden?.parentElement ?? null;
      while (p && p !== tree) {
        if (
          p.getAttribute('role') === 'treeitem' &&
          items.includes(p)
        ) {
          focusTarget = p;
          break;
        }
        p = p.parentElement;
      }
    }
  }
  if (!focusTarget) {
    focusTarget =
      items.find((li) => li.tabIndex === 0) ?? items[0] ?? null;
  }
  for (const li of tree.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
    li.tabIndex = -1;
  }
  if (focusTarget) {
    focusTarget.tabIndex = 0;
  }
}

/**
 * Bind click + keyboard fold/nav on a `toHtml` tree (or a container that
 * holds one). Session-local only — never persists fold. No MFA/crypto.
 */
export function attachOutlineTree(
  rootEl: HTMLElement,
  opts: AttachOutlineTreeOptions,
): AttachOutlineTreeHandle {
  const prefix = opts.classPrefix ?? 'of';
  const createdLive: { el: HTMLElement | null } = { el: null };
  let lastFocusId: string | null = null;

  const getLive = () => ensureLiveRegion(rootEl, opts.liveEl, createdLive);

  const refresh = (focusId?: string | null) => {
    opts.render();
    const tree = findTree(rootEl, prefix);
    if (!tree) return;
    const id = focusId !== undefined ? focusId : lastFocusId;
    syncRoving(tree, prefix, id);
    if (id) {
      const items = visibleTreeitems(tree, prefix);
      const target =
        items.find((li) => li.getAttribute('data-id') === id) ??
        items.find((li) => li.tabIndex === 0);
      if (target) {
        // Restore focus after re-paint without scrolling the page.
        target.focus({ preventScroll: true });
        lastFocusId = target.getAttribute('data-id');
      }
    }
  };

  const commit = (
    next: OutlineFoldDoc,
    focusId: string | null,
    message?: string,
  ) => {
    opts.setDoc(next);
    lastFocusId = focusId;
    refresh(focusId);
    if (message) announce(getLive(), message);
  };

  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const foldBtn = target.closest<HTMLElement>('[data-toggle-fold]');
    if (foldBtn && rootEl.contains(foldBtn)) {
      e.preventDefault();
      const id = foldBtn.getAttribute('data-toggle-fold');
      if (!id) return;
      const doc = opts.getDoc();
      const wasCollapsed = isCollapsed(doc, id);
      const next = toggleFold(doc, id);
      const tree = findTree(rootEl, prefix);
      const li = tree?.querySelector<HTMLElement>(
        `[data-id="${CSS.escape(id)}"]`,
      );
      const title = li ? nodeTitle(li, prefix) : id;
      commit(
        next,
        id,
        foldToggleAnnouncement(wasCollapsed, title),
      );
      return;
    }

    const unlockBtn = target.closest<HTMLElement>('[data-unlock]');
    if (unlockBtn && rootEl.contains(unlockBtn)) {
      e.preventDefault();
      const id = unlockBtn.getAttribute('data-unlock') || '';
      if (opts.onUnlock) opts.onUnlock(id);
      else announce(getLive(), 'Unlock requires host authentication');
      return;
    }

    const decryptBtn = target.closest<HTMLElement>('[data-decrypt]');
    if (decryptBtn && rootEl.contains(decryptBtn)) {
      e.preventDefault();
      const id = decryptBtn.getAttribute('data-decrypt') || '';
      if (opts.onDecrypt) opts.onDecrypt(id);
      else announce(getLive(), 'Decrypt requires host handler');
      return;
    }

    // Click on row → move roving focus (does not toggle).
    const li = target.closest<HTMLElement>('[role="treeitem"]');
    if (li && rootEl.contains(li) && isRowVisible(li, prefix)) {
      const tree = findTree(rootEl, prefix);
      if (!tree) return;
      for (const item of tree.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
        item.tabIndex = -1;
      }
      li.tabIndex = 0;
      lastFocusId = li.getAttribute('data-id');
      // Don't steal focus from unlock/decrypt buttons.
      if (
        !target.closest('[data-unlock]') &&
        !target.closest('[data-decrypt]')
      ) {
        li.focus({ preventScroll: true });
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const tree = findTree(rootEl, prefix);
    if (!tree) return;

    // Only handle when focus is inside the tree (not unlock stubs as primary).
    const active = document.activeElement as HTMLElement | null;
    if (!active || !tree.contains(active)) return;
    // Unlock/Decrypt buttons: let them use Enter/Space natively; fold keys no-op.
    if (
      active.matches('[data-unlock], [data-decrypt], .of-unlock') ||
      active.closest('[data-unlock], [data-decrypt]')
    ) {
      return;
    }

    const items = visibleTreeitems(tree, prefix);
    if (!items.length) return;

    let current =
      active.closest<HTMLElement>('[role="treeitem"]') ??
      items.find((li) => li.tabIndex === 0) ??
      items[0];
    if (!current || !items.includes(current)) {
      current = items[0];
    }
    const idx = items.indexOf(current);
    const id = current.getAttribute('data-id');
    const doc = opts.getDoc();
    const key = e.key;

    const moveTo = (nextIdx: number) => {
      e.preventDefault();
      const next = items[nextIdx];
      if (!next) return;
      for (const li of items) li.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
      lastFocusId = next.getAttribute('data-id');
    };

    if (key === 'ArrowDown') {
      if (idx < items.length - 1) moveTo(idx + 1);
      else e.preventDefault();
      return;
    }
    if (key === 'ArrowUp') {
      if (idx > 0) moveTo(idx - 1);
      else e.preventDefault();
      return;
    }
    if (key === 'Home') {
      moveTo(0);
      return;
    }
    if (key === 'End') {
      moveTo(items.length - 1);
      return;
    }

    if (key === 'ArrowRight') {
      e.preventDefault();
      if (!id || !hasChildren(current)) return;
      if (isCollapsed(doc, id)) {
        const next = toggleFold(doc, id);
        commit(
          next,
          id,
          foldToggleAnnouncement(true, nodeTitle(current, prefix)),
        );
      } else {
        // Move to first visible child if any.
        const childIdx = idx + 1;
        if (
          childIdx < items.length &&
          current.contains(items[childIdx])
        ) {
          moveTo(childIdx);
        }
      }
      return;
    }

    if (key === 'ArrowLeft') {
      e.preventDefault();
      if (id && hasChildren(current) && !isCollapsed(doc, id)) {
        const next = toggleFold(doc, id);
        commit(
          next,
          id,
          foldToggleAnnouncement(false, nodeTitle(current, prefix)),
        );
        return;
      }
      // Move to parent row if any.
      let p: HTMLElement | null = current.parentElement;
      while (p && p !== tree) {
        if (p.getAttribute('role') === 'treeitem' && items.includes(p)) {
          moveTo(items.indexOf(p));
          return;
        }
        p = p.parentElement;
      }
      return;
    }

    if (key === 'Enter' || key === ' ' || key === '.') {
      if (!id || !hasChildren(current)) return;
      e.preventDefault();
      const wasCollapsed = isCollapsed(doc, id);
      const next = toggleFold(doc, id);
      commit(
        next,
        id,
        foldToggleAnnouncement(wasCollapsed, nodeTitle(current, prefix)),
      );
      return;
    }

    if (key === '*') {
      e.preventDefault();
      const next = setExpandLevel(doc, '*');
      commit(next, id, expandLevelAnnouncement('*'));
      return;
    }

    if (/^[0-9]$/.test(key)) {
      e.preventDefault();
      const level = Number(key) as ExpandLevel;
      const next = setExpandLevel(doc, level);
      commit(next, id, expandLevelAnnouncement(level));
      return;
    }
  };

  const onFocusIn = (e: FocusEvent) => {
    const t = e.target as HTMLElement | null;
    const li = t?.closest?.('[role="treeitem"]') as HTMLElement | null;
    if (li && rootEl.contains(li)) {
      lastFocusId = li.getAttribute('data-id');
    }
  };

  rootEl.addEventListener('click', onClick);
  rootEl.addEventListener('keydown', onKeyDown);
  rootEl.addEventListener('focusin', onFocusIn);

  // Initial sync if tree already painted.
  const tree0 = findTree(rootEl, prefix);
  if (tree0) syncRoving(tree0, prefix, lastFocusId);

  return {
    refresh,
    detach: () => {
      rootEl.removeEventListener('click', onClick);
      rootEl.removeEventListener('keydown', onKeyDown);
      rootEl.removeEventListener('focusin', onFocusIn);
      if (createdLive.el?.parentElement === rootEl) {
        createdLive.el.remove();
      }
      createdLive.el = null;
    },
  };
}
