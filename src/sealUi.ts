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
  const title = el('div', 'of-unlock-title', `🔒 Unlock · ${s0.kid ?? 'key'}`);
  title.id = `of-unlock-t-${Math.random().toString(36).slice(2, 8)}`;
  card.setAttribute('aria-labelledby', title.id);
  const sub = el('div', 'of-unlock-sub', o.label || 'Sealed branch');
  const form = el('form', 'of-unlock-form');
  const input = el('input', 'of-unlock-pass');
  input.type = 'password';
  input.autocomplete = 'current-password';
  input.setAttribute('aria-label', 'Passphrase');
  input.placeholder = 'Passphrase';
  const row = el('div', 'of-unlock-row');
  const paste = o.onPasteFromManager ? el('button', 'of-unlock-paste', 'Paste from 1Password') : null;
  if (paste) paste.type = 'button';
  const cancel = el('button', 'of-unlock-cancel', 'Cancel');
  cancel.type = 'button';
  const ok = el('button', 'of-unlock-ok', 'Unlock');
  ok.type = 'submit';
  const msg = el('div', 'of-unlock-msg');
  msg.setAttribute('role', 'status');
  msg.setAttribute('aria-live', 'polite');
  if (paste) row.append(paste);
  row.append(cancel, ok);
  form.append(input, row, msg);
  card.append(title, sub, form);
  (o.container ?? document.body).appendChild(card);

  let resolve!: (v: boolean) => void;
  const done = new Promise<boolean>((r) => (resolve = r));
  let closed = false;
  let tick: ReturnType<typeof setInterval> | null = null;

  const place = () => {
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
    if (deriving) msg.textContent = 'Deriving…';
    else if (s.state === 'error' && s.error) {
      msg.textContent = backing ? `${s.error.message}. Try again in ${Math.ceil(s.retryAfterMs / 1000)}s` : s.error.message;
      if (!tick && backing) tick = setInterval(() => show(sessions.get(region)), 500);
    } else if (s.state === 'sealed') {
      if (tick) { clearInterval(tick); tick = null; }
      if (msg.textContent?.startsWith('Deriving')) msg.textContent = '';
      else if (msg.textContent?.includes('Try again')) msg.textContent = 'Wrong passphrase. Try again';
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

/** Secure-zone header + dashed end line around `body`. Returns the wrapper and a destroy fn. */
export function secureZoneChrome(body: HTMLElement, o: SecureZoneChromeOptions): { el: HTMLElement; destroy: () => void } {
  const { sessions, region } = o;
  const wrap = el('div', 'of-secure-zone');
  wrap.dataset.region = region;
  wrap.setAttribute('role', 'region');
  const head = el('div', 'of-secure-zone-bar');
  const s0 = sessions.get(region);
  const title = el('span', 'of-secure-zone-title', `Secure zone · ${s0.kid ?? 'key'} · memory only`);
  wrap.setAttribute('aria-label', title.textContent!);
  const help = el('button', 'of-secure-zone-help', '?');
  help.type = 'button';
  help.setAttribute('aria-label', 'About the secure zone');
  const note = el('div', 'of-secure-zone-note', 'Plaintext lives in this tab only. Save re-seals it into the parent; the note text only ever holds the <enc> tag. Locks when idle.');
  note.hidden = true;
  help.addEventListener('click', () => (o.onHelp ? o.onHelp() : (note.hidden = !note.hidden)));
  const idle = el('span', 'of-secure-zone-idle');
  const status = el('span', 'of-secure-zone-status');
  status.setAttribute('aria-live', 'polite');
  const btns = el('span', 'of-secure-zone-btns');
  const btn = (label: string, cls: string, fn: () => void) => {
    const b = el('button', `of-sz-btn ${cls}`, label);
    b.type = 'button';
    b.addEventListener('click', fn);
    btns.appendChild(b);
    return b;
  };
  btn('Lock now', 'of-sz-lock', () => void sessions.lock(region, 'user'));
  const save = o.canSave === false ? null : btn('Save & re-seal', 'of-sz-save', () => void sessions.save(region));
  btn('Remove seal', 'of-sz-remove', async () => {
    const pass = await o.askPassphrase?.(region);
    if (pass) await sessions.removeSeal(region, pass);
  });
  head.append(title, help, idle, status, btns);
  const end = el('div', 'of-secure-zone-end');
  end.setAttribute('aria-hidden', 'true');
  wrap.append(head, note, body, end);

  const show = () => {
    const cur = sessions.get(region);
    const st = draftStatus(cur);
    status.textContent = st === 'saving' ? 'Saving…' : st === 'error' ? (cur.error?.message ?? 'Error') : st;
    status.dataset.status = st;
    if (save) save.disabled = cur.state === 'saving';
    const left = sessions.idleRemainingMs();
    idle.textContent = left == null ? '' : `Idle lock ${formatIdle(left)}`;
  };
  const off = s0.subscribe(show);
  const timer = setInterval(show, 1000);
  show();
  return { el: wrap, destroy: () => { off(); clearInterval(timer); } };
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

/** Global chip: "Unlocked · k1 · re-seals on save", plus unsaved / saved. Hidden while all locked. */
export function mountSealStatusChip(host: HTMLElement, sessions: SealSessions): () => void {
  const chip = el('span', 'of-seal-chip');
  chip.setAttribute('role', 'status');
  host.appendChild(chip);
  const show = () => {
    const open = sessions.list().filter((s) => !s.locked);
    chip.hidden = !open.length;
    if (!open.length) return void (chip.textContent = '');
    const kids = [...new Set(open.map((s) => s.kid ?? 'key'))].join(', ');
    const st = open.some((s) => s.dirty) ? 'unsaved' : open.some((s) => s.saved) ? 'saved' : '';
    chip.textContent = `🔓 Unlocked · ${kids} · re-seals on save${st ? ` · ${st}` : ''}`;
    chip.dataset.status = st;
  };
  const offs = (['unlock', 'lock', 'change', 'save', 'error'] as const).map((t) => sessions.api.on(t, show));
  show();
  return () => { offs.forEach((f) => f()); chip.remove(); };
}
