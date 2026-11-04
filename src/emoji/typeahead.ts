/**
 * 0.5.18 `:` shortcode typeahead (EP-2, EP-27…EP-29). Host-agnostic: a textarea / input via
 * `textareaTypeaheadHost`, CodeMirror via the editor's `iconTypeahead()` extension.
 */
import {
  colonQuery,
  createIconPrefs,
  emojiData,
  loadEmojiData,
  resolveTypedShortcode,
  typeaheadMatches,
  type IconItem,
  type IconPrefs,
} from './icons.js';

export interface TypeaheadHost {
  getText(): string;
  getCaret(): number;
  replace(from: number, to: number, insert: string): void;
  /** Client rect of the caret (left / top / bottom). */
  caretRect(): { left: number; top: number; bottom: number } | null;
}

export interface TypeaheadOptions {
  prefs?: IconPrefs;
  container?: HTMLElement;
  /** Force touch chips (default `(pointer: coarse)`). */
  touch?: boolean;
}

export interface TypeaheadHandle {
  /** Re-read text and caret (call after every input). */
  update(): void;
  /** Keys while open: returns true when handled (Up, Down, Enter, Tab, Escape). */
  key(e: { key: string; preventDefault(): void }): boolean;
  isOpen(): boolean;
  close(): void;
  destroy(): void;
}

let seq = 0;

export function createIconTypeahead(host: TypeaheadHost, opts: TypeaheadOptions = {}): TypeaheadHandle {
  const prefs = opts.prefs ?? createIconPrefs();
  const id = `of-ta-${++seq}`;
  let list: HTMLElement | null = null;
  let rows: IconItem[] = [];
  let active = 0;
  let span: { from: number; query: string } | null = null;
  // Esc leaves the typed text: stay closed until the query start moves.
  let dismissedAt: number | null = null;
  const touch = () => {
    if (opts.touch != null) return opts.touch;
    try { return matchMedia('(pointer: coarse)').matches; } catch { return false; }
  };

  function close(): void {
    list?.remove();
    list = null;
    rows = [];
    span = null;
  }

  function insert(it: IconItem): void {
    if (!span) return;
    const from = span.from;
    const to = host.getCaret();
    prefs.useRecent(it.insert);
    close();
    host.replace(from, to, it.insert);
  }

  function render(): void {
    if (!list) {
      list = document.createElement('div');
      list.className = `of-ta${touch() ? ' of-ta-touch' : ''}`;
      list.id = id;
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', 'Emoji and clipart');
      list.setAttribute('data-testid', 'of-ta');
      (opts.container ?? document.body).appendChild(list);
    }
    list.replaceChildren();
    rows.forEach((it, i) => {
      const r = document.createElement('div');
      r.className = `of-ta-row${i === active ? ' is-active' : ''}`;
      r.id = `${id}-${i}`;
      r.setAttribute('role', 'option');
      r.setAttribute('aria-selected', i === active ? 'true' : 'false');
      r.setAttribute('data-insert', it.insert);
      const g = document.createElement('span');
      g.className = 'of-ta-glyph';
      g.setAttribute('aria-hidden', 'true');
      if (it.svg) g.innerHTML = it.svg;
      else g.textContent = it.char;
      const n = document.createElement('span');
      n.className = 'of-ta-name';
      n.textContent = `:${it.code}:`;
      r.append(g, n);
      if (it.recent) {
        const tag = document.createElement('span');
        tag.className = 'of-ta-tag';
        tag.textContent = 'recent';
        r.appendChild(tag);
      }
      r.setAttribute('aria-label', `${it.name}${it.kind === 'clipart' ? ', clipart' : ''}`);
      r.addEventListener('mousedown', (e) => { e.preventDefault(); insert(it); });
      list!.appendChild(r);
    });
    const c = host.caretRect();
    if (c) {
      const h = list.offsetHeight || 200;
      // EP-28: under the caret; on touch above the keyboard (visual viewport bottom).
      if (touch()) {
        const vv = (window as { visualViewport?: VisualViewport }).visualViewport;
        list.style.left = '0px';
        list.style.right = '0px';
        list.style.top = `${Math.max(0, (vv ? vv.offsetTop + vv.height : window.innerHeight) - h)}px`;
      } else {
        const below = c.bottom + 4;
        list.style.left = `${Math.max(4, Math.min(c.left, window.innerWidth - (list.offsetWidth || 240) - 4))}px`;
        list.style.top = `${below + h > window.innerHeight - 4 ? Math.max(4, c.top - h - 4) : below}px`;
      }
    }
  }

  function update(): void {
    const text = host.getText();
    const caret = host.getCaret();
    // EP-29: `:pizza:` typed in full resolves like a pick.
    const typed = resolveTypedShortcode(text, caret);
    if (typed) {
      close();
      if (typed.insert !== text.slice(typed.from, typed.to)) {
        prefs.useRecent(typed.insert);
        host.replace(typed.from, typed.to, typed.insert);
      }
      return;
    }
    const q = colonQuery(text, caret);
    if (!q) { dismissedAt = null; close(); return; }
    if (dismissedAt === q.from) return;
    dismissedAt = null;
    if (!emojiData()) void loadEmojiData().then(() => { if (colonQuery(host.getText(), host.getCaret())) update(); });
    const next = typeaheadMatches(q.query, { prefs });
    if (!next.length) { close(); return; }
    const same = span && span.from === q.from && rows.length && rows[active] && next.includes(rows[active]!);
    span = q;
    rows = next;
    if (!same) active = 0;
    render();
  }

  return {
    update,
    key(e) {
      if (!list || !rows.length) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
        render();
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insert(rows[active]!);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissedAt = span?.from ?? null;
        close();
        return true;
      }
      return false;
    },
    isOpen: () => !!list,
    close,
    destroy: close,
  };
}

/** Caret client rect in a textarea / input, via a mirrored div. */
function textareaCaretRect(ta: HTMLTextAreaElement | HTMLInputElement): { left: number; top: number; bottom: number } {
  const cs = getComputedStyle(ta);
  const m = document.createElement('div');
  for (const p of ['font', 'letterSpacing', 'padding', 'border', 'boxSizing', 'lineHeight', 'whiteSpace', 'wordWrap', 'textIndent'] as const) {
    (m.style as unknown as Record<string, string>)[p] = (cs as unknown as Record<string, string>)[p]!;
  }
  m.style.position = 'absolute';
  m.style.visibility = 'hidden';
  m.style.whiteSpace = ta instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre';
  m.style.width = `${ta.clientWidth}px`;
  m.textContent = ta.value.slice(0, ta.selectionStart ?? 0);
  const mark = document.createElement('span');
  mark.textContent = '\u200b';
  m.appendChild(mark);
  document.body.appendChild(m);
  const r = ta.getBoundingClientRect();
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3 || 18;
  const left = r.left + mark.offsetLeft - ta.scrollLeft;
  const top = r.top + mark.offsetTop - ta.scrollTop;
  m.remove();
  return { left, top, bottom: top + lh };
}

export function textareaTypeaheadHost(ta: HTMLTextAreaElement | HTMLInputElement): TypeaheadHost {
  return {
    getText: () => ta.value,
    getCaret: () => ta.selectionStart ?? ta.value.length,
    replace(from, to, insert) {
      ta.setRangeText(insert, from, to, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    },
    caretRect: () => textareaCaretRect(ta),
  };
}

/** Wire the typeahead to a textarea / input. Returns a detach function. */
export function attachIconTypeahead(ta: HTMLTextAreaElement | HTMLInputElement, opts: TypeaheadOptions = {}): () => void {
  const t = createIconTypeahead(textareaTypeaheadHost(ta), opts);
  const onInput = () => t.update();
  const onKey = (e: Event) => { if (t.key(e as KeyboardEvent)) e.stopPropagation(); };
  const onBlur = () => t.close();
  ta.addEventListener('input', onInput);
  ta.addEventListener('keydown', onKey, true);
  ta.addEventListener('blur', onBlur);
  return () => {
    t.destroy();
    ta.removeEventListener('input', onInput);
    ta.removeEventListener('keydown', onKey, true);
    ta.removeEventListener('blur', onBlur);
  };
}
