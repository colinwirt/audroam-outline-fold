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
import { SealError, type SealedViewer } from './sealedBranch.js';

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
 * Secure zone (seal-edit 05), top to bottom:
 *   header  "🔓 Secure zone [k1] ……… memory only (?)"
 *   body    (editor lines / viewer)
 *   hint    "↵ new child stays in zone · ⇧Tab at edge leaves zone" (editor only)
 *   bar     [🔓 Unlocked · k1] Idle lock 4:32 · status ……… More ▾ (Remove seal… → confirm → passphrase) · Lock now · [Save & re-seal]
 *   end     dashed line labelled "zone end"
 * The mockup puts the bar in the app footer; hosts can move `.of-secure-zone-actions` there.
 */
export function secureZoneChrome(body: HTMLElement, o: SecureZoneChromeOptions & { hint?: boolean }): { el: HTMLElement; destroy: () => void } {
  const { sessions, region } = o;
  const s0 = sessions.get(region);
  const kid = s0.kid ?? 'key';
  const wrap = el('div', 'of-secure-zone');
  wrap.dataset.region = region;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', `Secure zone · ${kid} · memory only`);
  const head = el('div', 'of-secure-zone-bar');
  const title = el('span', 'of-secure-zone-title', '🔓 Secure zone');
  const kchip = el('span', 'of-chip of-chip-k', kid);
  const sp = el('span', 'of-sp');
  const mem = el('span', 'of-mut', 'memory only');
  const help = el('button', 'of-q of-secure-zone-help', '?');
  help.type = 'button';
  help.setAttribute('aria-label', 'About the secure zone');
  const note = el('div', 'of-secure-zone-note', 'Plaintext lives in this tab only. Save re-seals it into the parent; the note text only ever holds the <enc> tag. Draft autosave and search exclude the zone. Locks when idle.');
  note.hidden = true;
  help.addEventListener('click', () => (o.onHelp ? o.onHelp() : (note.hidden = !note.hidden)));
  head.append(title, kchip, sp, mem, help);

  const hint = o.hint === false || o.canSave === false ? null : el('div', 'of-secure-zone-hint of-mut', '↵ new child stays in zone · ⇧Tab at edge leaves zone');
  const actions = el('div', 'of-secure-zone-actions');
  const chip = el('span', 'of-chip of-chip-g', `🔓 Unlocked · ${kid}`);
  const idle = el('span', 'of-secure-zone-idle of-mut');
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
  // More ▾ holds the rare, destructive action (Remove seal) behind a confirm step.
  const more = el('span', 'of-sz-more');
  const moreBtn = btn('More ▾', 'of-sz-more-btn', () => (menu.hidden ? openMenu() : closeMenu(true)));
  more.appendChild(moreBtn);
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
  more.appendChild(menu);
  const openMenu = () => { menu.hidden = false; moreBtn.setAttribute('aria-expanded', 'true'); removeItem.focus(); };
  const closeMenu = (refocus: boolean) => { menu.hidden = true; moreBtn.setAttribute('aria-expanded', 'false'); if (refocus) moreBtn.focus(); };
  moreBtn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); openMenu(); } });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') e.preventDefault(); closeMenu(e.key === 'Escape'); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') { e.preventDefault(); removeItem.focus(); }
  });
  const onDocDown = (e: Event) => { if (!menu.hidden && !more.contains(e.target as Node)) closeMenu(false); };
  document.addEventListener('pointerdown', onDocDown);

  // Confirm step: "This stores the branch as plain text", red confirm, then the passphrase.
  const confirm = el('div', 'of-sz-confirm');
  confirm.setAttribute('role', 'alertdialog');
  confirm.setAttribute('aria-modal', 'false');
  const cmsgId = `${menuId}-confirm`;
  const cmsg = el('p', 'of-sz-confirm-msg', 'Remove seal? This stores the branch as plain text.');
  cmsg.id = cmsgId;
  confirm.setAttribute('aria-labelledby', cmsgId);
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

  btns.append(more);
  btn('Lock now', 'of-sz-lock', () => void sessions.lock(region, 'user'));
  const save = o.canSave === false ? null : btn('Save & re-seal', 'of-sz-save of-btn-p', () => void sessions.save(region));
  actions.append(chip, idle, status, el('span', 'of-sp'), btns, confirm);

  const end = el('div', 'of-secure-zone-end');
  end.append(el('span', undefined, 'zone end'));
  end.setAttribute('aria-hidden', 'true');
  wrap.append(head, note, body, ...(hint ? [hint] : []), actions, end);

  const show = () => {
    const cur = sessions.get(region);
    const st = draftStatus(cur);
    status.textContent = st === 'saving' ? 'Saving…' : st === 'error' ? (cur.error?.message ?? 'Error') : st === 'unsaved' ? '● Unsaved' : st === 'saved' ? 'Saved' : '';
    status.dataset.status = st;
    if (save) save.disabled = cur.state === 'saving';
    const left = sessions.idleRemainingMs();
    idle.textContent = left == null ? '' : `Idle lock ${formatIdle(left)}`;
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

/** Global chip: "Unlocked · k1 · re-seals on save", plus unsaved / saved. Hidden while all locked. */
export function mountSealStatusChip(host: HTMLElement, sessions: SealSessions): () => void {
  const wrapEl = el('span', 'of-seal-status');
  const st = el('span', 'of-seal-draft');
  const chip = el('span', 'of-chip of-chip-g of-seal-chip');
  chip.setAttribute('role', 'status');
  wrapEl.append(st, chip);
  host.appendChild(wrapEl);
  const show = () => {
    const open = sessions.list().filter((s) => !s.locked);
    wrapEl.hidden = !open.length;
    if (!open.length) return void (chip.textContent = st.textContent = '');
    const kids = [...new Set(open.map((s) => s.kid ?? 'key'))].join(', ');
    const d = open.some((s) => s.dirty) ? 'unsaved' : open.some((s) => s.saved) ? 'saved' : '';
    st.innerHTML = d === 'unsaved' ? '<span class="of-dot"></span><span class="of-mut">Unsaved</span>' : d === 'saved' ? '<span class="of-mut">Saved</span>' : '';
    chip.textContent = `🔓 Unlocked · ${kids} · re-seals on save`;
    wrapEl.dataset.status = d;
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

// ---------- SEAL-DRAFT (spec 20261101 SD-5, SD-9, SD-10) ----------

/** One line op of a version preview. Text only; never persisted. */
export interface VersionDiffOp {
  op: 'same' | 'add' | 'del';
  line: string;
}

/** Line diff (LCS) from `a` to `b`. Inputs are plaintexts held in memory. */
export function versionDiff(a: string, b: string): VersionDiffOp[] {
  const A = a.split('\n'), B = b.split('\n');
  const n = A.length, m = B.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) L[i]![j] = A[i] === B[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const out: VersionDiffOp[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ op: 'same', line: A[i]! }); i++; j++; }
    else if (L[i + 1]![j]! >= L[i]![j + 1]!) out.push({ op: 'del', line: A[i++]! });
    else out.push({ op: 'add', line: B[j++]! });
  }
  while (i < n) out.push({ op: 'del', line: A[i++]! });
  while (j < m) out.push({ op: 'add', line: B[j++]! });
  return out;
}

/** Inner viewer JSON → readable lines (caption, then the outline body). */
function versionLines(inner: string): string {
  try {
    const v = JSON.parse(inner) as { caption: string; body: string };
    return `${v.caption}\n${v.body.replace(/\n+$/, '')}`;
  } catch {
    return inner;
  }
}

/** `+3/−1 lines` between the loaded and autosave texts (counts only). */
export function diffCounts(a: string, b: string): { add: number; del: number } {
  let add = 0, del = 0;
  for (const o of versionDiff(versionLines(a), versionLines(b))) {
    if (o.op === 'add') add++;
    else if (o.op === 'del') del++;
  }
  return { add, del };
}

export interface VersionLabelOptions {
  now?: Date;
  /** Host locale for times (default: runtime locale). */
  locale?: string;
  timeZone?: string;
  /**
   * Label for an autosave not written in this session, e.g. `other device` (the host decides,
   * e.g. from its own 30-day cross-device lookback). Return undefined to show nothing.
   */
  otherDeviceLabel?: (viewer: SealedViewer) => string | undefined;
}

export interface VersionLabels {
  saved: string;
  autosave?: string;
  discarded?: string;
  /** True when Save needs an explicit choice. */
  conflict: boolean;
}

export const CANT_TELL_LABEL = "Can't tell which is newer";

function clock(iso: string | undefined, o: VersionLabelOptions): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const s = new Intl.DateTimeFormat(o.locale, { hour: 'numeric', minute: '2-digit', ...(o.timeZone ? { timeZone: o.timeZone } : {}) }).format(d);
  return s.replace(/\s*([AaPp])\.?\s*[Mm]\.?$/, (_m, x: string) => `${x.toLowerCase()}m`);
}

/**
 * Plain-string labels for the version chooser:
 * `Autosave · 2:12pm · this device · +3 lines` and `Saved · 1:40pm`.
 * In conflict both carry `Can't tell which is newer`.
 */
export function versionLabels(viewer: SealedViewer, o: VersionLabelOptions = {}): VersionLabels {
  const p = findPayload(viewer);
  const conflict = viewer.draftState === 'conflict';
  const join = (...xs: (string | undefined)[]) => xs.filter(Boolean).join(' · ');
  const saved = join('Saved', clock(p?.at, o), conflict ? CANT_TELL_LABEL : undefined);
  const out: VersionLabels = { saved, conflict };
  if (p?.autosave) {
    const t = viewer.draftTexts();
    let delta: string | undefined;
    if (t.autosave !== undefined) {
      const { add, del } = diffCounts(t.loaded, t.autosave);
      const parts = [add ? `+${add}` : '', del ? `\u2212${del}` : ''].filter(Boolean);
      delta = parts.length ? `${parts.join('/')} line${add + del === 1 ? '' : 's'}` : 'no changes';
    }
    const where = viewer.autosaveWrittenHere ? 'this device' : o.otherDeviceLabel?.(viewer);
    out.autosave = join('Autosave', clock(p.autosave.at, o), where, conflict ? CANT_TELL_LABEL : delta);
  }
  if (p?.discarded) out.discarded = join('Discarded', clock(p.discarded.at, o));
  return out;
}

function findPayload(viewer: SealedViewer) {
  const host = (viewer as SealedViewer & { host?: import('./types.js').OutlineFoldDoc }).host;
  let hit: import('./types.js').SealedPayload | undefined;
  const walk = (ns: import('./types.js').OutlineNode[] | undefined) => {
    for (const n of ns ?? []) {
      if (hit) return;
      if (n.id === viewer.branchId && n.sealed) hit = n.sealed;
      walk(n.children);
    }
  };
  walk(host?.nodes);
  return hit;
}

export interface SealMenuItem {
  id: 'restore-discarded' | 'discard-autosave';
  label: string;
  run: () => Promise<void>;
}

/** More ▾ items for a viewer. `Restore discarded version` shows only while a discarded slot exists. */
export function sealMenuItems(viewer: SealedViewer): SealMenuItem[] {
  const p = findPayload(viewer);
  const items: SealMenuItem[] = [];
  if (viewer.closed || !p) return items;
  if (p.autosave) items.push({ id: 'discard-autosave', label: 'Discard autosave', run: () => viewer.discardAutosave() });
  if (p.discarded) items.push({ id: 'restore-discarded', label: 'Restore discarded version', run: () => viewer.restoreDiscarded() });
  return items;
}

/** Minimal event target (window / document). */
interface Listenable {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

export interface SealAutosaveOptions {
  /** Typing pause before a flush (default 1500 ms). */
  idleMs?: number;
  /** Cap during continuous typing (default 10 s). */
  maxMs?: number;
  /** Minimum gap between flushes when saves are fast (default 5 s). */
  minGapMs?: number;
  /** Back-off ceiling on slow or failed saves (default 30 s). */
  maxGapMs?: number;
  /** A save slower than this counts as slow (default 1000 ms). */
  slowMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  /** `pagehide` source (window). */
  win?: Listenable;
  /** `visibilitychange` source (document); flushes when `visibilityState` is hidden. */
  doc?: Listenable & { visibilityState?: string };
  /** Called with the error when a flush throws (locked stops the scheduler). */
  onError?: (e: unknown) => void;
}

export interface SealAutosaveScheduler {
  /** Call on every edit. */
  edit(): void;
  /** Flush now (ignores the gap). */
  flush(): Promise<void>;
  /** Flush, then stop (call before clearKeys / auto-lock). */
  lock(): Promise<void>;
  stop(): void;
  /** Host hook: how long the host's persistence of the last autosave took, and whether it worked. */
  reportSaveResult(ms: number, ok: boolean): void;
  readonly gapMs: number;
  readonly stopped: boolean;
}

/**
 * Autosave cadence for a sealed viewer (host-owned). Debounces on a typing pause, caps at
 * `maxMs` during continuous typing, and keeps at least `gapMs` between flushes. The gap is
 * `minGapMs` (~5 s) while saves are fast and doubles on slow or failed saves up to `maxGapMs`
 * (30 s); fast saves bring it back down. Lock, `pagehide` and a hidden tab flush at once.
 */
export function scheduleSealAutosave(viewer: SealedViewer, o: SealAutosaveOptions = {}): SealAutosaveScheduler {
  const idleMs = o.idleMs ?? 1500, maxMs = o.maxMs ?? 10_000;
  const minGap = o.minGapMs ?? 5000, maxGap = o.maxGapMs ?? 30_000, slowMs = o.slowMs ?? 1000;
  const now = o.now ?? (() => Date.now());
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let gap = minGap;
  let timer: unknown = null;
  let firstEdit: number | null = null;
  let lastEdit = 0;
  let lastFlush = -Infinity;
  let pending = false;
  let inflight: Promise<void> | null = null;
  let stopped = false;

  const backoff = () => { gap = Math.min(maxGap, gap * 2); };
  const arm = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (stopped || !pending || firstEdit === null) return;
    const due = Math.max(Math.min(lastEdit + idleMs, firstEdit + maxMs), lastFlush + gap);
    timer = setTimer(() => { timer = null; void run(); }, Math.max(0, due - now()));
  };
  const run = async (): Promise<void> => {
    if (stopped && !pending) return;
    if (inflight) { await inflight; if (!pending) return; }
    pending = false;
    firstEdit = null;
    lastFlush = now();
    inflight = (async () => {
      try {
        await viewer.autosave();
      } catch (e) {
        if (e instanceof SealError && e.code === 'locked') stop();
        else backoff();
        o.onError?.(e);
      }
    })();
    try { await inflight; } finally { inflight = null; }
    arm();
  };
  const onHide = () => { if (!o.doc || o.doc.visibilityState === 'hidden') void api.flush(); };
  const onPagehide = () => void api.flush();
  o.win?.addEventListener('pagehide', onPagehide);
  o.doc?.addEventListener('visibilitychange', onHide);
  function stop() {
    stopped = true;
    pending = false;
    if (timer !== null) clearTimer(timer);
    timer = null;
    o.win?.removeEventListener('pagehide', onPagehide);
    o.doc?.removeEventListener('visibilitychange', onHide);
  }
  const api: SealAutosaveScheduler = {
    edit() {
      if (stopped) return;
      const t = now();
      lastEdit = t;
      if (firstEdit === null) firstEdit = t;
      pending = true;
      arm();
    },
    async flush() {
      if (stopped) return;
      if (timer !== null) clearTimer(timer);
      timer = null;
      pending = true;
      await run();
    },
    async lock() {
      if (!stopped) await api.flush();
      stop();
    },
    stop,
    reportSaveResult(ms: number, ok: boolean) {
      if (!ok || ms > slowMs) backoff();
      else gap = Math.max(minGap, gap / 2);
      arm();
    },
    get gapMs() { return gap; },
    get stopped() { return stopped; },
  };
  return api;
}
