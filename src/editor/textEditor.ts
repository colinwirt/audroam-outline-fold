/**
 * 0.4.1 text-mode editor for hosts: one call mounts a CodeMirror 6 editor over a host
 * `<textarea>` with the outline secure zones built in. Shipped in `dist/editor.bundle.js`
 * with CodeMirror inside, so a host imports only outline-fold and never CodeMirror.
 *
 * - The textarea stays the source of truth for the host: its `value` reads and writes the
 *   editor, edits fire a bubbling `input` event, and `focus()` focuses the editor.
 * - Sealed `<enc:KEYID>` lines whose session is unlocked get a secure zone (nested editor
 *   on the child doc, Save & re-seal / Lock / Remove seal). Plaintext never enters the
 *   main document, its undo history or the textarea.
 * - The zone wraps at the layout's `autoWidth:` (`autoWrapCh`), read live from `autoWidth()`.
 * - Edits past the first trailing fence (payloads, keyring, layout…) are kept above it.
 * - `setRegions()` still accepts host block widgets (e.g. notes) keyed by a line substring.
 */
import { EditorState, StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, keymap, drawSelection, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { outlineEditor, refreshZones, type OutlineEditorOptions } from './index.js';
import { autoWrapCh } from '../mapFit.js';
import { DEFAULT_WRAP_CH } from '../mapLabel.js';
import type { RegionId } from '../hostApi.js';

/** A host block widget placed after the first line containing `line`. */
export interface HostRegion {
  id: string;
  line: string;
  rev?: number | string;
  mount?: (el: HTMLElement) => void;
}

export interface TextEditorOptions extends Partial<Omit<OutlineEditorOptions, 'textWidthCh'>> {
  /** Layout `autoWidth:` value now (`32ch`, `fit-view`…). Secure zones wrap to it. */
  autoWidth?: () => string | null | undefined;
  /** Explicit per-region wrap in ch; wins over `autoWidth`. */
  textWidthCh?: (region: RegionId) => number | undefined;
  /** Host key hooks; return true when handled. */
  onEnter?: (view: EditorView) => boolean;
  onTab?: (view: EditorView, shift: boolean) => boolean;
  onEsc?: () => void;
  onBlur?: () => void;
  /** Keep edits above the trailing fences (default true). */
  protectTrailer?: boolean;
  /** Dark theme colours (default true). */
  dark?: boolean;
  readOnly?: boolean;
  /** Extra extensions for the main editor. */
  extensions?: Extension[];
}

export interface TextEditorHandle {
  view: EditorView;
  host: HTMLElement;
  hasFocus(): boolean;
  isShown(): boolean;
  show(on: boolean): void;
  hostEl(): HTMLElement;
  scrollerEl(): HTMLElement;
  selectionEnd(): number;
  lineBox(pos: number): { top: number; bottom: number };
  selectRange(from: number, to: number): void;
  markLine(from: number, to: number): void;
  setRegions(list: HostRegion[]): void;
  /** Re-scan secure zones (session state or autoWidth changed). */
  refresh(): void;
  dispatchText(edit: { start: number; end: number; text?: string; selStart: number }): void;
  destroy(): void;
}

class HostRegionWidget extends WidgetType {
  constructor(readonly region: HostRegion) { super(); }
  eq(o: HostRegionWidget): boolean { return o.region.id === this.region.id && o.region.rev === this.region.rev; }
  toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-region';
    el.dataset.region = this.region.id;
    this.region.mount?.(el);
    return el;
  }
  ignoreEvent(): boolean { return true; }
}

function hostRegionDeco(doc: Text, regions: HostRegion[]): DecorationSet {
  if (!regions.length) return Decoration.none;
  const out = [];
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const hit = regions.find((r) => r.line && line.text.includes(r.line));
    if (hit) out.push(Decoration.widget({ widget: new HostRegionWidget(hit), block: true, side: 1 }).range(line.to));
  }
  return Decoration.set(out, true);
}

const FENCE_RE = /(?:^|\n)---\s*(?:payloads|sealed|enc|keyring|keys|layout)\s*---/i;
/** Offset of the first trailing fence; doc length when there is none. */
export function trailerCut(text: string): number {
  const m = FENCE_RE.exec(text);
  return m ? m.index : text.length;
}

const setHostRegions = StateEffect.define<HostRegion[]>();

/**
 * Smallest single replace turning `prev` into `next` (common prefix and suffix kept).
 * Used for host writes to `textarea.value` so CodeMirror maps the selection instead of
 * dropping it to the start or end of the doc.
 */
export function minimalChange(prev: string, next: string): { from: number; to: number; insert: string } {
  let a = 0;
  const max = Math.min(prev.length, next.length);
  while (a < max && prev.charCodeAt(a) === next.charCodeAt(a)) a += 1;
  let b = 0;
  while (b < max - a && prev.charCodeAt(prev.length - 1 - b) === next.charCodeAt(next.length - 1 - b)) b += 1;
  return { from: a, to: prev.length - b, insert: next.slice(a, next.length - b) };
}

export function mountTextEditor(textarea: HTMLTextAreaElement, opts: TextEditorOptions = {}): TextEditorHandle {
  const host = document.createElement('div');
  host.className = 'cm-host of-text-editor source';
  textarea.insertAdjacentElement('afterend', host);
  let writing = false;
  const hostRegions = StateField.define<{ list: HostRegion[]; deco: DecorationSet }>({
    create: (s) => ({ list: [], deco: hostRegionDeco(s.doc, []) }),
    update(v, tr) {
      let list = v.list;
      let changed = false;
      for (const e of tr.effects) if (e.is(setHostRegions)) { list = e.value; changed = true; }
      if (changed || tr.docChanged) return { list, deco: hostRegionDeco(tr.state.doc, list) };
      return v;
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });
  const widthCh = (region: RegionId): number | undefined => {
    const own = opts.textWidthCh?.(region);
    if (own) return own;
    if (!opts.autoWidth) return undefined;
    return autoWrapCh(opts.autoWidth(), { viewportW: host.clientWidth || null, fallback: DEFAULT_WRAP_CH });
  };
  const ext: Extension[] = [
    history(),
    drawSelection(),
    keymap.of([
      { key: 'Enter', run: (v) => !!opts.onEnter?.(v) },
      { key: 'Tab', run: (v) => !!opts.onTab?.(v, false) },
      { key: 'Shift-Tab', run: (v) => !!opts.onTab?.(v, true) },
      { key: 'Escape', run: () => { opts.onEsc?.(); return !!opts.onEsc; } },
    ]),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    hostRegions,
    EditorView.updateListener.of((u) => {
      if (!u.docChanged || writing) return;
      const next = u.state.doc.toString();
      if (valueDesc.get!.call(textarea) !== next) {
        valueDesc.set!.call(textarea, next);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }),
    EditorView.domEventHandlers({ blur: () => { opts.onBlur?.(); } }),
  ];
  if (opts.dark !== false) {
    ext.push(EditorView.theme({
      '&': { backgroundColor: 'transparent', color: '#e7ecf1' },
      '.cm-content': { caretColor: '#9ecbff' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#9ecbff' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgba(108, 182, 255, 0.28)' },
    }, { dark: true }));
  }
  if (opts.readOnly) ext.push(EditorState.readOnly.of(true));
  if (opts.protectTrailer !== false) {
    ext.push(EditorState.transactionFilter.of((tr) => {
      if (writing || !tr.docChanged) return tr;
      const cut = trailerCut(tr.startState.doc.toString());
      if (cut >= tr.startState.doc.length) return tr;
      let blocked = false;
      tr.changes.iterChanges((_f, to) => { if (to > cut) blocked = true; });
      if (!blocked) return tr;
      const parts: { from: number; to: number; insert: string }[] = [];
      let anchor = cut;
      tr.changes.iterChanges((from, to, _fb, _tb, ins) => {
        const text = ins.toString();
        if (from >= cut) {
          if (text) { parts.push({ from: cut, to: cut, insert: text }); anchor = cut + text.length; }
        } else {
          parts.push({ from, to: Math.min(to, cut), insert: text });
          anchor = from + text.length;
        }
      });
      if (!parts.length) return { selection: { anchor: cut } };
      return { changes: parts, selection: { anchor } };
    }));
  }
  if (opts.sessions) {
    ext.push(outlineEditor({
      sessions: opts.sessions,
      askPassphrase: opts.askPassphrase,
      childExtensions: [history(), keymap.of([...defaultKeymap, ...historyKeymap]), ...(opts.childExtensions ?? [])],
      textWidthCh: widthCh,
      focus: opts.focus,
      followInText: opts.followInText,
      onUnlockZone: opts.onUnlockZone,
    }));
  }
  if (opts.extensions) ext.push(...opts.extensions);

  const valueDesc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!;
  const view = new EditorView({ parent: host, state: EditorState.create({ doc: textarea.value || '', extensions: ext }) });
  const setDoc = (value: unknown): void => {
    const next = value == null ? '' : String(value);
    if (view.state.doc.toString() === next) return;
    writing = true;
    // 0.4.3: minimal change, so the caret (mapped through it) stays where the user typed.
    try { view.dispatch({ changes: minimalChange(view.state.doc.toString(), next) }); } finally { writing = false; }
  };
  Object.defineProperty(textarea, 'value', {
    configurable: true,
    get: () => view.state.doc.toString(),
    set: (v) => { valueDesc.set!.call(textarea, v == null ? '' : String(v)); setDoc(v); },
  });
  const ownFocus = Object.getOwnPropertyDescriptor(textarea, 'focus');
  textarea.focus = () => view.focus();
  const clamp = (p: number) => Math.max(0, Math.min(p, view.state.doc.length));

  return {
    view,
    host,
    hasFocus: () => view.hasFocus,
    isShown: () => !host.hidden,
    show(on) { host.hidden = !on; },
    hostEl: () => host,
    scrollerEl: () => view.scrollDOM,
    selectionEnd: () => view.state.selection.main.head,
    lineBox(pos) { const b = view.lineBlockAt(clamp(pos)); return { top: b.top, bottom: b.bottom }; },
    selectRange(from, to) { view.focus(); view.dispatch({ selection: { anchor: clamp(from), head: clamp(to) }, scrollIntoView: true }); },
    markLine(from, to) { view.dispatch({ selection: { anchor: clamp(from), head: clamp(to) }, scrollIntoView: true }); },
    setRegions(list) { view.dispatch({ effects: setHostRegions.of(list || []) }); },
    refresh() { view.dispatch({ effects: refreshZones.of(null) }); },
    dispatchText(edit) {
      writing = true;
      try {
        view.dispatch({ changes: { from: edit.start, to: edit.end, insert: edit.text || '' }, selection: { anchor: edit.selStart } });
      } finally { writing = false; }
      valueDesc.set!.call(textarea, view.state.doc.toString());
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    },
    destroy() {
      view.destroy();
      host.remove();
      delete (textarea as unknown as Record<string, unknown>).value;
      if (ownFocus) Object.defineProperty(textarea, 'focus', ownFocus);
      else delete (textarea as unknown as Record<string, unknown>).focus;
    },
  };
}
