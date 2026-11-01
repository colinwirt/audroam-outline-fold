/**
 * Unsealed-editing UI (mockups seal-edit 04/05, mpe1 Unlock card). DOM only; every state is
 * read from `SealSessions` (never copied). No secrets are stored here: the passphrase lives in
 * the input until submit, then is cleared.
 *
 *  - `mountUnlockPrompt`  inline unlock card (replaces window.prompt), clamped on screen.
 *  - `secureZoneChrome`   header "Secure zone · k1 · memory only", idle countdown, buttons, dashed end.
 *  - `mountMemoryViewer`  read-only memory-only viewer of an unlocked region with the same chrome.
 *  - `mountSealStatusChip` global chip "Unlocked · k1 · re-seals on save" (+ unsaved / saved).
 */
import type { RegionId } from './hostApi.js';
import type { SealSessions, SealSessionSnapshot } from './sealSession.js';
import { serialize } from './serialize.js';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/** "m:ss" for the idle countdown. */
export function formatIdle(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Draft status from a snapshot: what the secure zone and chip show. */
export function draftStatus(s: Pick<SealSessionSnapshot, 'state' | 'dirty' | 'saved' | 'error'>): 'saving' | 'unsaved' | 'saved' | 'error' | '' {
  if (s.state === 'saving') return 'saving';
  if (s.state === 'error' && s.error?.code === 'save-failed') return 'error';
  if (s.dirty) return 'unsaved';
  if (s.saved) return 'saved';
  return '';
}

/**
 * Clamp a popover box into the viewport (8px margin). Below 480px wide it becomes a centred
 * sheet; otherwise it sits under the anchor, shifted left/up so it never runs off an edge.
 */
export function clampPromptBox(
  anchor: { left: number; top: number; bottom: number } | null,
  size: { w: number; h: number },
  vp: { w: number; h: number },
  margin = 8,
): { left: number; top: number; width: number; sheet: boolean } {
  const width = Math.min(size.w, vp.w - margin * 2);
  if (!anchor || vp.w < 480) {
    return { left: Math.round((vp.w - width) / 2), top: Math.max(margin, Math.round(vp.h - size.h - margin)), width, sheet: true };
  }
  const left = Math.min(Math.max(margin, anchor.left), vp.w - width - margin);
  let top = anchor.bottom + 6;
  if (top + size.h > vp.h - margin) top = Math.max(margin, anchor.top - size.h - 6);
  return { left: Math.round(left), top: Math.round(top), width, sheet: false };
}

export interface UnlockPromptOptions {
  sessions: SealSessions;
  region: RegionId;
  /** Element to sit by (pill or row). Omit for a centred sheet. */
  anchorEl?: Element | null;
  /** Public label (never the caption). */
  label?: string;
  /** Host hook: "Paste from 1Password". Resolve to the text to paste, or null. The package keeps nothing. */
  onPasteFromManager?: () => string | null | Promise<string | null>;
  /** Called after unlock or cancel. Focus returns to `anchorEl`. */
  onClose?: (unlocked: boolean) => void;
  /** Mount point (default document.body). */
  container?: HTMLElement;
  /** Render in flow inside `container` (the text-pane card of seal-edit 04) instead of a floating card. */
  inline?: boolean;
  /** "?" help click. */
  onHelp?: () => void;
}

export interface UnlockPromptHandle {
  el: HTMLElement;
  close(unlocked?: boolean): void;
  /** Resolves true when the region unlocked, false on cancel. */
  done: Promise<boolean>;
}

/** Inline unlock card. Drives `sessions.open`; Unlock is disabled while "Deriving…". */
export function mountUnlockPrompt(o: UnlockPromptOptions): UnlockPromptHandle {
  const { sessions, region } = o;
  const card = el('div', 'of-unlock');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'false');
  card.dataset.region = region;
  const s0 = sessions.get(region);
  // seal-edit 04: "🔒 Unlock k1 (?)" / [passphrase][Paste from 1Password] / Deriving… ▬▬ [Unlock]
  const title = el('div', 'of-unlock-title');
  const tt = el('b', undefined, `Unlock ${s0.kid ?? 'key'}`);
  title.append('🔒 ', tt);
  tt.id = `of-unlock-t-${Math.random().toString(36).slice(2, 8)}`;
  card.setAttribute('aria-labelledby', tt.id);
  if (o.label) card.setAttribute('aria-description', o.label);
  const qh = el('button', 'of-q', '?');
  qh.type = 'button';
  qh.setAttribute('aria-label', 'About unlocking');
  qh.addEventListener('click', () => o.onHelp?.());
  title.append(qh);
  const form = el('form', 'of-unlock-form');
  const input = el('input', 'of-unlock-pass');
  input.type = 'password';
  input.autocomplete = 'current-password';
  input.setAttribute('aria-label', 'Passphrase');
  input.placeholder = 'Passphrase';
  const row1 = el('div', 'of-unlock-field');
  const row = el('div', 'of-unlock-row');
  const bar = el('div', 'of-unlock-bar');
  bar.append(el('i'));
  const paste = o.onPasteFromManager ? el('button', 'of-unlock-paste', 'Paste from 1Password') : null;
  if (paste) paste.type = 'button';
  const cancel = el('button', 'of-unlock-cancel', 'Cancel');
  cancel.type = 'button';
  const ok = el('button', 'of-unlock-ok', 'Unlock');
  ok.type = 'submit';
  const msg = el('div', 'of-unlock-msg');
  msg.setAttribute('role', 'status');
  msg.setAttribute('aria-live', 'polite');
  row1.append(input);
  if (paste) row1.append(paste);
  row.append(msg, bar, cancel, ok);
  form.append(row1, row);
  card.append(title, form);
  if (o.inline) card.classList.add('of-unlock-inline');
  (o.container ?? document.body).appendChild(card);

  let resolve!: (v: boolean) => void;
  const done = new Promise<boolean>((r) => (resolve = r));
  let closed = false;
  let tick: ReturnType<typeof setInterval> | null = null;

  const place = () => {
    if (o.inline) return;
    const r = o.anchorEl?.getBoundingClientRect?.() ?? null;
    const vp = { w: window.visualViewport?.width ?? window.innerWidth, h: window.visualViewport?.height ?? window.innerHeight };
    const box = clampPromptBox(r, { w: 320, h: card.offsetHeight || 170 }, vp);
    Object.assign(card.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, maxWidth: 'calc(100vw - 16px)' });
    card.classList.toggle('of-unlock-sheet', box.sheet);
  };

  const show = (s: SealSessionSnapshot) => {
    const deriving = s.state === 'unlocking';
    const backing = s.state === 'error' && s.retryAfterMs > 0;
    ok.disabled = deriving || backing;
    input.disabled = deriving;
    card.classList.toggle('is-deriving', deriving);
    card.classList.toggle('is-error', s.state === 'error');
    if (deriving) msg.textContent = 'Deriving…';
    else if (s.state === 'error' && s.error) {
      msg.textContent = s.error.code === 'bad-pass'
        ? (backing ? `Couldn't unlock. Try again in ${Math.ceil(s.retryAfterMs / 1000)}s.` : "Couldn't unlock. Try again.")
        : s.error.message;
      if (!tick && backing) tick = setInterval(() => show(sessions.get(region)), 500);
    } else if (s.state === 'sealed') {
      if (tick) { clearInterval(tick); tick = null; }
      if (msg.textContent?.startsWith('Deriving')) msg.textContent = '';
      else if (msg.textContent?.includes('Try again in')) msg.textContent = "Couldn't unlock. Try again.";
    } else if (s.state === 'unlocked') close(true);
  };
  const off = sessions.get(region).subscribe(show);

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(false); } };
  const onResize = () => place();
  card.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);

  function close(unlocked = false): void {
    if (closed) return;
    closed = true;
    off();
    if (tick) clearInterval(tick);
    input.value = '';
    window.removeEventListener('resize', onResize);
    window.visualViewport?.removeEventListener('resize', onResize);
    card.remove();
    (o.anchorEl as HTMLElement | null | undefined)?.focus?.({ preventScroll: true });
    o.onClose?.(unlocked);
    resolve(unlocked);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (ok.disabled) return;
    const pass = input.value;
    if (!pass) return void input.focus();
    input.value = ''; // never kept in the DOM after submit
    await sessions.open(region, pass);
    if (!closed) input.focus();
  });
  cancel.addEventListener('click', () => close(false));
  paste?.addEventListener('click', async () => {
    const v = await o.onPasteFromManager!();
    if (v) { input.value = v; input.focus(); }
  });

  show(sessions.get(region));
  place();
  input.focus({ preventScroll: true });
  return { el: card, close, done };
}

export interface SecureZoneChromeOptions {
  sessions: SealSessions;
  region: RegionId;
  /** Remove seal always re-asks for the passphrase (§8.6). Null = cancelled. */
  askPassphrase?: (region: RegionId) => string | null | Promise<string | null>;
  /** "?" help click. Default: toggles an inline note. */
  onHelp?: () => void;
  /** Show the "Save & re-seal" button (false for a read-only viewer). Default true. */
  canSave?: boolean;
}

/**
 * Secure zone, minimal chrome (one control per zone):
 *   header  "Secure zone ……… ● [Save & re-seal] [🔒] [⋯]"
 *     - ● faint unsaved dot; Save & re-seal only while there are unsaved edits.
 *     - 🔒 icon button (aria-label "Lock"); its tooltip holds the key id and idle countdown.
 *     - ⋯ More menu: "Remove seal…" → confirm ("This stores the branch as plain text") → passphrase.
 *   body, then a dashed end line. No "Unlocked · k1" chip, no "Lock now" text button.
 */
export function secureZoneChrome(body: HTMLElement, o: SecureZoneChromeOptions & { hint?: boolean }): { el: HTMLElement; destroy: () => void } {
  const { sessions, region } = o;
  const s0 = sessions.get(region);
  const kid = s0.kid ?? 'key';
  const wrap = el('div', 'of-secure-zone');
  wrap.dataset.region = region;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', `Secure zone, ${kid}, memory only`);
  const head = el('div', 'of-secure-zone-bar');
  const title = el('span', 'of-secure-zone-title', 'Secure zone');
  const sp = el('span', 'of-sp');
  const dot = el('span', 'of-dot of-secure-zone-dot');
  dot.setAttribute('role', 'status');
  const save = o.canSave === false ? null : el('button', 'of-sz-btn of-sz-save of-btn-p', 'Save & re-seal');
  if (save) { save.type = 'button'; save.addEventListener('click', () => void sessions.save(region)); }
  const lock = el('button', 'of-sz-icon of-sz-lock', '🔒');
  lock.type = 'button';
  lock.setAttribute('aria-label', 'Lock');
  lock.addEventListener('click', () => void sessions.lock(region, 'user'));

  // ⋯ More: the rare, destructive Remove seal behind a confirm step.
  const more = el('span', 'of-sz-more');
  const moreBtn = el('button', 'of-sz-icon of-sz-more-btn', '⋯');
  moreBtn.type = 'button';
  moreBtn.title = 'More';
  moreBtn.setAttribute('aria-label', 'More');
  const menuId = `of-sz-menu-${region.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  moreBtn.setAttribute('aria-haspopup', 'menu');
  moreBtn.setAttribute('aria-expanded', 'false');
  moreBtn.setAttribute('aria-controls', menuId);
  const menu = el('div', 'of-sz-menu');
  menu.id = menuId;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'More secure zone actions');
  menu.hidden = true;
  const removeItem = el('button', 'of-sz-menu-item of-sz-remove', 'Remove seal…');
  removeItem.type = 'button';
  removeItem.setAttribute('role', 'menuitem');
  menu.appendChild(removeItem);
  more.append(moreBtn, menu);
  const openMenu = () => { menu.hidden = false; moreBtn.setAttribute('aria-expanded', 'true'); removeItem.focus(); };
  const closeMenu = (refocus: boolean) => { menu.hidden = true; moreBtn.setAttribute('aria-expanded', 'false'); if (refocus) moreBtn.focus(); };
  moreBtn.addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu(true)));
  moreBtn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); openMenu(); } });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') e.preventDefault(); closeMenu(e.key === 'Escape'); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') { e.preventDefault(); removeItem.focus(); }
  });
  const onDocDown = (e: Event) => { if (!menu.hidden && !more.contains(e.target as Node)) closeMenu(false); };
  document.addEventListener('pointerdown', onDocDown);

  const confirm = el('div', 'of-sz-confirm');
  confirm.setAttribute('role', 'alertdialog');
  const cmsg = el('p', 'of-sz-confirm-msg', 'Remove seal? This stores the branch as plain text.');
  cmsg.id = `${menuId}-confirm`;
  confirm.setAttribute('aria-labelledby', cmsg.id);
  const cRow = el('div', 'of-sz-confirm-row');
  const cCancel = el('button', 'of-sz-btn of-sz-confirm-cancel', 'Keep sealed');
  cCancel.type = 'button';
  const cOk = el('button', 'of-sz-btn of-btn-danger of-sz-confirm-ok', 'Remove seal');
  cOk.type = 'button';
  cRow.append(cCancel, cOk);
  confirm.append(cmsg, cRow);
  confirm.hidden = true;
  const closeConfirm = () => { confirm.hidden = true; moreBtn.focus(); };
  removeItem.addEventListener('click', () => { closeMenu(false); confirm.hidden = false; cCancel.focus(); });
  cCancel.addEventListener('click', closeConfirm);
  confirm.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeConfirm(); } });
  cOk.addEventListener('click', async () => {
    confirm.hidden = true;
    const pass = await o.askPassphrase?.(region); // always re-asks (§8.6)
    if (pass) await sessions.removeSeal(region, pass);
    else moreBtn.focus();
  });

  head.append(title, sp, dot, ...(save ? [save] : []), lock, more);
  const end = el('div', 'of-secure-zone-end');
  end.setAttribute('aria-hidden', 'true');
  wrap.append(head, confirm, body, end);

  const show = () => {
    const cur = sessions.get(region);
    const st = draftStatus(cur);
    const dirty = st === 'unsaved' || st === 'saving' || st === 'error';
    dot.hidden = !dirty;
    dot.setAttribute('aria-label', st === 'error' ? (cur.error?.message ?? 'Save failed') : dirty ? 'Unsaved changes' : '');
    dot.title = st === 'error' ? (cur.error?.message ?? 'Save failed') : 'Unsaved';
    if (save) { save.hidden = !dirty; save.disabled = cur.state === 'saving'; }
    const left = sessions.idleRemainingMs();
    lock.title = `Lock ${kid}${left == null ? '' : ` · idle lock in ${formatIdle(left)}`}`;
  };
  const off = s0.subscribe(show);
  const timer = setInterval(show, 1000);
  show();
  return { el: wrap, destroy: () => { off(); clearInterval(timer); document.removeEventListener('pointerdown', onDocDown); } };
}

/** Read-only memory-only viewer of an unlocked region (same chrome; Save hidden). */
export function mountMemoryViewer(host: HTMLElement, o: Omit<SecureZoneChromeOptions, 'canSave'> & { textWidthCh?: number }): () => void {
  const pre = el('pre', 'of-secure-zone-view');
  if (o.textWidthCh) pre.style.maxWidth = `${o.textWidthCh}ch`;
  const fill = () => { pre.textContent = o.sessions.get(o.region).doc ? serialize(o.sessions.get(o.region).doc!) : ''; };
  fill();
  const z = secureZoneChrome(pre, { ...o, canSave: false });
  const offs = [o.sessions.api.on('change', (e) => e.region === o.region && fill())];
  host.appendChild(z.el);
  return () => { offs.forEach((f) => f()); z.destroy(); z.el.remove(); pre.textContent = ''; };
}

/** Global status: a faint unsaved dot only while an unlocked region has unsaved edits. No "Unlocked · k1" chip. */
export function mountSealStatusChip(host: HTMLElement, sessions: SealSessions): () => void {
  const wrapEl = el('span', 'of-seal-status');
  const dot = el('span', 'of-dot');
  wrapEl.setAttribute('role', 'status');
  wrapEl.appendChild(dot);
  host.appendChild(wrapEl);
  const show = () => {
    const dirty = sessions.list().some((s) => !s.locked && s.dirty);
    wrapEl.hidden = !dirty;
    wrapEl.title = dirty ? 'Unsaved' : '';
    wrapEl.setAttribute('aria-label', dirty ? 'Unsaved changes' : '');
    wrapEl.dataset.status = dirty ? 'unsaved' : '';
  };
  const offs = (['unlock', 'lock', 'change', 'save', 'error'] as const).map((t) => sessions.api.on(t, show));
  show();
  return () => { offs.forEach((f) => f()); wrapEl.remove(); };
}

export interface PassphrasePromptOptions {
  /** Key id shown in the title ("🔒 Unlock k1"). */
  kid?: string | null;
  label?: string;
  anchorEl?: Element | null;
  container?: HTMLElement;
  inline?: boolean;
  /** Prefill (demo password only). */
  initial?: string;
  /** Try the passphrase; resolve true when it opened. "Deriving…" shows while pending. */
  attempt: (pass: string) => Promise<boolean>;
  onPasteFromManager?: () => string | null | Promise<string | null>;
  /** Back-off after the nth failure (ms). Default 0. */
  backoffMs?: (failures: number) => number;
}

/**
 * Session-free variant of the unlock card (same DOM and look as `mountUnlockPrompt`) for hosts
 * and demos that open payloads directly. Resolves true on success, false on cancel.
 */
export function promptPassphrase(o: PassphrasePromptOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let state: SealSessionSnapshot['state'] = 'sealed';
    let failures = 0;
    let retryAt = 0;
    const subs = new Set<(s: SealSessionSnapshot) => void>();
    const snap = (): SealSessionSnapshot => ({
      region: 'prompt', kid: o.kid ?? null, state, locked: state !== 'unlocked', dirty: false, saved: false, doc: null,
      error: state === 'error' ? { code: 'bad-pass', message: "Couldn't unlock" } : null,
      retryAfterMs: Math.max(0, retryAt - Date.now()),
    } as unknown as SealSessionSnapshot);
    const set = (s: typeof state) => { state = s; subs.forEach((f) => f(snap())); };
    const fake = {
      get: () => ({ ...snap(), subscribe: (f: (s: SealSessionSnapshot) => void) => { subs.add(f); return () => subs.delete(f); } }),
      open: async (_r: string, pass: string) => {
        if (Date.now() < retryAt) return;
        set('unlocking');
        let ok = false;
        try { ok = await o.attempt(pass); } catch { ok = false; }
        if (ok) { failures = 0; return set('unlocked'); }
        const wait = o.backoffMs?.(++failures) ?? 0;
        retryAt = Date.now() + wait;
        set('error');
        if (wait > 0) setTimeout(() => state === 'error' && set('sealed'), wait);
      },
    } as unknown as SealSessions;
    const h = mountUnlockPrompt({ sessions: fake, region: 'prompt' as RegionId, anchorEl: o.anchorEl, label: o.label, container: o.container, inline: o.inline, onPasteFromManager: o.onPasteFromManager });
    if (o.initial) (h.el.querySelector('.of-unlock-pass') as HTMLInputElement).value = o.initial;
    void h.done.then(resolve);
  });
}
