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
 * - The locked trailer (payloads, keyring, layout…) stays in the note. It is hidden behind
 *   one pill until opened, and an open trailer is read-only.
 * - `setRegions()` still accepts host block widgets (e.g. notes) keyed by a line substring.
 */
import { outlineKeys } from './outlineKeys.js';
import { iconTypeahead, shortcodeGlyphs } from './iconTypeahead.js';

const isSealedLine = (line: string): boolean => /<enc:[A-Za-z0-9_.-]+>/.test(line);
import { Compartment, EditorState, StateEffect, Transaction, StateField, type Extension, type Text } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, keymap, drawSelection, highlightActiveLine, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { taskGlyphs, outlineEditor, refreshZones, missingZones, zoneRenderFailures, scrollFocusedZone, ZONE_ERROR_EVENT, type OutlineEditorOptions } from './index.js';
export { missingZones, zoneRenderFailures, ZONE_ERROR_EVENT };
import { autoWrapCh } from '../mapFit.js';
import { DEFAULT_WRAP_CH } from '../mapLabel.js';
import type { RegionId } from '../hostApi.js';
import type { OutlineDocHandle } from '../outlineDoc.js';

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
  /** @deprecated 0.4.13: ignored. Enter / Tab / Backspace are the package's outline keys. */
  onEnter?: unknown;
  /** @deprecated 0.4.13: ignored. */
  onTab?: unknown;
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
  /**
   * 0.4.6: unlocked regions with an `<enc>` line here but no working secure zone. Non-empty
   * means the Text pane cannot show an open branch: the host must hold saves and autosaves.
   */
  zoneProblems(): RegionId[];
  /** A user-level edit (undoable, like typing): Enter / Tab helpers. */
  applyEdit(edit: TextEdit): void;
  /** @deprecated 0.4.8: use `applyEdit`. */
  dispatchText(edit: TextEdit): void;
  /** Current caret / selection. */
  selection(): { from: number; to: number };
  /** 0.4.8: toggle read-only after mount (host learns edit rights late). */
  setReadOnly(on: boolean): void;
  destroy(): void;
}

export interface TextEdit { start: number; end: number; text?: string; selStart: number; selEnd?: number }

/** 0.4.8 host hooks for the doc-bound editor: key handlers get plain text + selection, no CodeMirror. */
export interface DocEditorOptions extends Omit<TextEditorOptions, 'sessions' | 'extensions'> {
  /** Every keydown / pointerup in the main editor (typing pause, Follow from text). */
  onKey?: (e: KeyboardEvent) => void;
  onPointerUp?: () => void;
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
const FENCE_KIND_RE = /(?:^|\n)---\s*(payloads|sealed|enc|keyring|keys|layout)\s*---/gi;
const FENCE_NAME: Record<string, string> = {
  payloads: 'Payloads',
  sealed: 'Sealed',
  enc: 'Enc',
  keyring: 'Keyring',
  keys: 'Keys',
  layout: 'Layout',
};
/** Offset of the first trailing fence; doc length when there is none. The match includes the newline before the fence when there is one. */
export function trailerCut(text: string): number {
  const m = FENCE_RE.exec(text);
  return m ? m.index : text.length;
}

/** Start of the fence line. Same as `trailerCut` when the fence is the start of the text. */
export function trailerFenceFrom(text: string): number {
  const cut = trailerCut(text);
  if (cut >= text.length || cut === 0) return cut;
  return text.charCodeAt(cut) === 10 ? cut + 1 : cut;
}

/** Pill label for the locked block, in the order the fences appear. Empty when there is none. */
export function trailerLabel(text: string): string {
  const from = trailerFenceFrom(text);
  if (from >= text.length) return '';
  const seen = new Set<string>();
  const names: string[] = [];
  for (const m of text.slice(from).matchAll(FENCE_KIND_RE)) {
    const k = m[1]!.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    names.push(FENCE_NAME[k] ?? k);
  }
  return names.join(' · ');
}

const setTrailerOpen = StateEffect.define<boolean>();

/** One pill for the whole locked trailer. Opening it does not change the note. */
class TrailerPill extends WidgetType {
  constructor(readonly label: string, readonly open: boolean) { super(); }
  eq(o: TrailerPill): boolean { return o.label === this.label && o.open === this.open; }
  get estimatedHeight(): number { return 28; }
  toDOM(view: EditorView): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'of-trailer-pill';
    btn.setAttribute('aria-expanded', this.open ? 'true' : 'false');
    btn.title = this.open
      ? 'Hide the locked block. The note still stores it.'
      : 'Show the locked block. It stays read-only.';
    const mark = document.createElement('span');
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = this.open ? '\u25be' : '\u25b8';
    const text = document.createElement('span');
    text.textContent = this.label;
    btn.append(mark, text);
    // Keep the editor focused so a host blur handler does not treat this as leaving the pane.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const fence = trailerFenceFrom(view.state.doc.toString());
      const head = view.state.selection.main.head;
      view.dispatch({
        effects: setTrailerOpen.of(!this.open),
        selection: this.open && head >= fence ? { anchor: fence } : undefined,
      });
    });
    return btn;
  }
  ignoreEvent(): boolean { return true; }
}

function trailerBlock(doc: Text): { from: number; label: string } | null {
  const text = doc.toString();
  const from = trailerFenceFrom(text);
  if (from >= doc.length) return null;
  const line = doc.lineAt(from);
  if (line.from !== from) return null;
  if (!/^---\s*(?:payloads|sealed|enc|keyring|keys|layout)\s*---/i.test(line.text)) return null;
  return { from, label: trailerLabel(text) || 'Locked' };
}

function trailerDeco(doc: Text, open: boolean): DecorationSet {
  const block = trailerBlock(doc);
  if (!block) return Decoration.none;
  const pill = new TrailerPill(block.label, open);
  if (!open) {
    return Decoration.set([Decoration.replace({ widget: pill, block: true }).range(block.from, doc.length)]);
  }
  return Decoration.set([
    Decoration.widget({ widget: pill, block: true, side: -1 }).range(block.from),
    Decoration.mark({ class: 'of-trailer-locked' }).range(block.from, doc.length),
  ]);
}

const trailerFold = StateField.define<{ open: boolean; deco: DecorationSet }>({
  create: (s) => ({ open: false, deco: trailerDeco(s.doc, false) }),
  update(v, tr) {
    let open = v.open;
    for (const e of tr.effects) if (e.is(setTrailerOpen)) open = e.value;
    if (open !== v.open || tr.docChanged) return { open, deco: trailerDeco(tr.state.doc, open) };
    return v;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

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

interface CoreHooks {
  onLocal: (next: string) => void;
  onSelection?: (head: number) => void;
}

/** Apply a host key edit to a view like typing (one history step). */
export function applyEditTo(view: EditorView, edit: TextEdit): void {
  const len = view.state.doc.length;
  const c = (p: number) => Math.max(0, Math.min(p, len));
  const from = c(edit.start), to = c(edit.end);
  const ins = edit.text || '';
  const after = len - (to - from) + ins.length;
  const cl = (p: number) => Math.max(0, Math.min(p, after));
  view.dispatch({
    changes: { from, to, insert: ins },
    selection: { anchor: cl(edit.selStart), head: cl(edit.selEnd ?? edit.selStart) },
    scrollIntoView: true,
    userEvent: 'input',
  });
}

function buildEditor(host: HTMLElement, initial: string, opts: TextEditorOptions, hooks: CoreHooks) {
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
    // Grey caret row. Follow in text moves this caret when Map focus changes.
    highlightActiveLine(),
    taskGlyphs,
    // 0.5.18: `:` emoji / clipart typeahead (EP-2).
    iconTypeahead(),
    shortcodeGlyphs(),
    // 0.4.13: standard CM commands behind the outline keys (Enter, Tab, Backspace); one
    // keymap for the main text and every zone. A sealed `<enc:…>` line takes no children here.
    ...outlineKeys(isSealedLine),
    keymap.of([
      { key: 'Escape', run: () => { opts.onEsc?.(); return !!opts.onEsc; } },
    ]),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    hostRegions,
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !writing) hooks.onLocal(u.state.doc.toString());
      if (u.selectionSet || u.docChanged) hooks.onSelection?.(u.state.selection.main.head);
    }),
    EditorView.domEventHandlers({ blur: () => { opts.onBlur?.(); } }),
  ];
  if (opts.dark !== false) {
    ext.push(EditorView.theme({
      '&': { backgroundColor: 'transparent', color: '#e7ecf1' },
      '.cm-content': { caretColor: '#9ecbff' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#9ecbff' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgba(108, 182, 255, 0.28)' },
      '.cm-activeLine': { backgroundColor: 'rgba(232, 236, 241, 0.08)' },
    }, { dark: true }));
  }
  const ro = new Compartment();
  ext.push(ro.of(EditorState.readOnly.of(!!opts.readOnly)));
  if (opts.protectTrailer !== false) {
    ext.push(trailerFold);
    // No vertical margin: CodeMirror measures a block widget with getBoundingClientRect.
    ext.push(EditorView.baseTheme({
      '& .cm-content > .of-trailer-pill': { marginTop: '0', marginBottom: '0' },
      '.of-trailer-pill': {
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        margin: '0', padding: '2px 10px', minHeight: '28px',
        border: '1px solid rgba(158, 203, 255, 0.4)', borderRadius: '999px',
        background: 'rgba(158, 203, 255, 0.1)', color: '#d5e4f4',
        font: '12px/1.4 ui-sans-serif, system-ui, sans-serif', cursor: 'pointer',
      },
      '.of-trailer-locked': { color: 'rgba(231, 236, 241, 0.55)' },
    }));
    ext.push(EditorState.transactionFilter.of((tr) => {
      if (writing || !tr.docChanged) return tr;
      const start = tr.startState.doc.toString();
      const cut = trailerCut(start);
      if (cut >= tr.startState.doc.length) return tr;
      const fence = trailerFenceFrom(start);
      let blocked = false;
      tr.changes.iterChanges((_f, to) => { if (to > cut) blocked = true; });
      if (!blocked) return tr;
      // A change that starts on the fence is dropped. Showing the block is not a way to edit it.
      // A change that starts in the outline and reaches the fence keeps only the outline part.
      const parts: { from: number; to: number; insert: string }[] = [];
      let anchor = Math.min(tr.startState.selection.main.head, fence);
      tr.changes.iterChanges((from, to, _fb, _tb, ins) => {
        if (from >= fence) return;
        const text = ins.toString();
        parts.push({ from, to: Math.min(to, cut), insert: text });
        anchor = from + text.length;
      });
      if (!parts.length) return { selection: { anchor } };
      return { changes: parts, selection: { anchor } };
    }));
  }
  if (opts.sessions) {
    ext.push(outlineEditor({
      sessions: opts.sessions,
      askPassphrase: opts.askPassphrase,
      childExtensions: [history(), highlightActiveLine(), iconTypeahead(), shortcodeGlyphs(), ...outlineKeys(), keymap.of([...defaultKeymap, ...historyKeymap]), ...(opts.childExtensions ?? [])],
      textWidthCh: widthCh,
      focus: opts.focus,
      followInText: opts.followInText,
      lineOf: opts.lineOf,
      onUnlockZone: opts.onUnlockZone,
    }));
  }
  if (opts.extensions) ext.push(...opts.extensions);

  const view = new EditorView({ parent: host, state: EditorState.create({ doc: initial, extensions: ext }) });
  /** Programmatic write: minimal change so the caret maps through it; no echo to onLocal. */
  const setDoc = (value: unknown): void => {
    const next = value == null ? '' : String(value);
    if (view.state.doc.toString() === next) return;
    writing = true;
    try { view.dispatch({ changes: minimalChange(view.state.doc.toString(), next), annotations: Transaction.remote.of(true) }); } finally { writing = false; }
  };
  const clamp = (p: number) => Math.max(0, Math.min(p, view.state.doc.length));
  const applyEdit = (edit: TextEdit): void => {
    // A user edit: goes through the update listener like typing (one history step).
    view.dispatch({
      changes: { from: edit.start, to: edit.end, insert: edit.text || '' },
      selection: { anchor: edit.selStart, head: edit.selEnd ?? edit.selStart },
      scrollIntoView: true,
      userEvent: 'input',
    });
  };
  const base = {
    view,
    host,
    // 0.4.17 (zone focus): the caret in an open sealed zone (a nested EditorView inside this
    // editor's DOM) counts as editor focus. CM's view.hasFocus is false there, so hosts that gate
    // "move focus elsewhere" on hasFocus() pulled focus out after every debounced save.
    hasFocus: () => view.hasFocus || (typeof document !== 'undefined' && !!document.activeElement && view.dom.contains(document.activeElement)),
    isShown: () => !host.hidden,
    show(on: boolean) { host.hidden = !on; },
    hostEl: () => host,
    scrollerEl: () => view.scrollDOM,
    selectionEnd: () => view.state.selection.main.head,
    selection: () => ({ from: view.state.selection.main.from, to: view.state.selection.main.to }),
    lineBox(pos: number) { const b = view.lineBlockAt(clamp(pos)); return { top: b.top, bottom: b.bottom }; },
    selectRange(from: number, to: number) { view.focus(); view.dispatch({ selection: { anchor: clamp(from), head: clamp(to) }, scrollIntoView: true }); },
    // The zone has its own caret. Scrolling the outer selection reveals the sealed
    // line and, on a phone, pans the window. Nearest on the zone caret instead.
    markLine(from: number, to: number) {
      if (scrollFocusedZone(view)) return;
      view.dispatch({ selection: { anchor: clamp(from), head: clamp(to) }, scrollIntoView: true });
    },
    setRegions(list: HostRegion[]) { view.dispatch({ effects: setHostRegions.of(list || []) }); },
    refresh() { view.dispatch({ effects: refreshZones.of(null) }); },
    zoneProblems(): RegionId[] { return opts.sessions ? missingZones(view.state.doc, opts.sessions) : []; },
    applyEdit,
    setReadOnly(on: boolean) { view.dispatch({ effects: ro.reconfigure(EditorState.readOnly.of(!!on)) }); },
  };
  return { view, setDoc, base };
}

/**
 * 0.4.8: mount the text editor on a doc handle (`createOutlineDoc`). No textarea: the
 * handle is the one source of truth. Local typing → `doc.setText(…, {source:'text'})`;
 * every other writer (Map, zone re-seal, host) → minimal change into CodeMirror.
 * `doc.reveal()` selects / scrolls; caret moves go to `doc.setCaret()` (no doc change).
 *
 * @deprecated form: `mountTextEditor(textarea, opts)` still works for 0.4.x hosts.
 */
export function mountTextEditor(container: HTMLElement, doc: OutlineDocHandle, opts?: DocEditorOptions): TextEditorHandle;
/** @deprecated 0.4.8: pass a container and a `createOutlineDoc` handle. Removed in v1. */
export function mountTextEditor(textarea: HTMLTextAreaElement, opts?: TextEditorOptions): TextEditorHandle;
export function mountTextEditor(
  a: HTMLElement,
  b?: OutlineDocHandle | TextEditorOptions,
  c?: DocEditorOptions,
): TextEditorHandle {
  if (typeof HTMLTextAreaElement !== 'undefined' && a instanceof HTMLTextAreaElement) {
    return mountTextareaEditor(a, (b as TextEditorOptions) ?? {});
  }
  const doc = b as OutlineDocHandle;
  const o: DocEditorOptions = c ?? {};
  const host = document.createElement('div');
  host.className = 'cm-host of-text-editor source';
  a.append(host);
  let handleRef: TextEditorHandle | null = null;
  const core = buildEditor(host, doc.getText(), {
    ...o,
    sessions: doc.sessions,
    focus: o.focus ?? doc.focusLink,
  }, {
    onLocal: (next) => doc.setText(next, { source: 'text', reason: 'text' }),
    onSelection: (head) => doc.setCaret(head),
  });
  const { view, setDoc, base } = core;
  if (o.onKey) view.dom.addEventListener('keydown', o.onKey);
  if (o.onKey) view.dom.addEventListener('keyup', o.onKey);
  const pointerUp = () => o.onPointerUp?.();
  view.dom.addEventListener('pointerup', pointerUp);
  const offs = [
    doc.on('change', (e) => { if (e.source !== 'text') setDoc(e.text); }),
    doc.on('reveal', (r) => (r.select ? base.selectRange(r.from, r.to) : base.markLine(r.from, r.to))),
  ];
  doc.setZoneProbe(() => (handleRef && handleRef.isShown() ? base.zoneProblems() : []));
  // Zones follow every unlock / lock / save, whichever pane did it.
  offs.push(doc.on('seal', (e) => {
    if (e.type === 'unlock' || e.type === 'lock' || e.type === 'save') queueMicrotask(() => { try { base.refresh(); } catch { /* gone */ } });
  }));
  handleRef = {
    ...base,
    dispatchText: base.applyEdit,
    destroy() {
      offs.forEach((f) => f());
      doc.setZoneProbe(null);
      view.destroy();
      host.remove();
    },
  };
  return handleRef;
}

function mountTextareaEditor(textarea: HTMLTextAreaElement, opts: TextEditorOptions): TextEditorHandle {
  const host = document.createElement('div');
  host.className = 'cm-host of-text-editor source';
  textarea.insertAdjacentElement('afterend', host);
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!;
  const fire = (next: string) => {
    if (valueDesc.get!.call(textarea) !== next) {
      valueDesc.set!.call(textarea, next);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
  const { view, setDoc, base } = buildEditor(host, textarea.value || '', opts, { onLocal: fire });
  Object.defineProperty(textarea, 'value', {
    configurable: true,
    get: () => view.state.doc.toString(),
    set: (v) => { valueDesc.set!.call(textarea, v == null ? '' : String(v)); setDoc(v); },
  });
  const ownFocus = Object.getOwnPropertyDescriptor(textarea, 'focus');
  textarea.focus = () => view.focus();
  return {
    ...base,
    dispatchText: base.applyEdit,
    destroy() {
      view.destroy();
      host.remove();
      delete (textarea as unknown as Record<string, unknown>).value;
      if (ownFocus) Object.defineProperty(textarea, 'focus', ownFocus);
      else delete (textarea as unknown as Record<string, unknown>).focus;
    },
  };
}
