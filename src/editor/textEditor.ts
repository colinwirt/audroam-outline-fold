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
import { zoneTab } from './zoneIndent.js';
import { Compartment, EditorState, StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, keymap, drawSelection, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { taskGlyphs, outlineEditor, refreshZones, missingZones, zoneRenderFailures, ZONE_ERROR_EVENT, type OutlineEditorOptions } from './index.js';
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
export interface DocEditorOptions extends Omit<TextEditorOptions, 'onEnter' | 'onTab' | 'sessions' | 'extensions'> {
  onEnter?: (text: string, from: number, to: number) => TextEdit | null | false;
  onTab?: (text: string, from: number, to: number, shift: boolean) => TextEdit | null | false;
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
  // 0.4.9 (bug B4): the same line keys (Enter, Tab, Shift-Tab) run in the main view and in
  // every secure zone view; each hook gets the view the key was pressed in.
  const lineKeys = [
    { key: 'Enter', run: (v: EditorView) => !!opts.onEnter?.(v) },
    { key: 'Tab', run: (v: EditorView) => !!opts.onTab?.(v, false) },
    { key: 'Shift-Tab', run: (v: EditorView) => !!opts.onTab?.(v, true) },
  ];
  // Zone keys: Enter as the main editor; Tab/Shift-Tab never leave the zone (zoneTab fallback).
  const zoneKeys = [
    lineKeys[0]!,
    { key: 'Tab', run: zoneTab(opts.onTab, false) },
    { key: 'Shift-Tab', run: zoneTab(opts.onTab, true) },
  ];
  const ext: Extension[] = [
    history(),
    drawSelection(),
    taskGlyphs,
    keymap.of([
      ...lineKeys,
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
    }, { dark: true }));
  }
  const ro = new Compartment();
  ext.push(ro.of(EditorState.readOnly.of(!!opts.readOnly)));
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
      childExtensions: [history(), keymap.of(zoneKeys), keymap.of([...defaultKeymap, ...historyKeymap]), ...(opts.childExtensions ?? [])],
      textWidthCh: widthCh,
      focus: opts.focus,
      followInText: opts.followInText,
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
    try { view.dispatch({ changes: minimalChange(view.state.doc.toString(), next) }); } finally { writing = false; }
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
    hasFocus: () => view.hasFocus,
    isShown: () => !host.hidden,
    show(on: boolean) { host.hidden = !on; },
    hostEl: () => host,
    scrollerEl: () => view.scrollDOM,
    selectionEnd: () => view.state.selection.main.head,
    selection: () => ({ from: view.state.selection.main.from, to: view.state.selection.main.to }),
    lineBox(pos: number) { const b = view.lineBlockAt(clamp(pos)); return { top: b.top, bottom: b.bottom }; },
    selectRange(from: number, to: number) { view.focus(); view.dispatch({ selection: { anchor: clamp(from), head: clamp(to) }, scrollIntoView: true }); },
    markLine(from: number, to: number) { view.dispatch({ selection: { anchor: clamp(from), head: clamp(to) }, scrollIntoView: true }); },
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
  // The edit lands in the view the key was pressed in (main text or a secure zone).
  const keyEdit = (v: EditorView, fn: () => TextEdit | null | false | undefined): boolean => {
    const edit = fn();
    if (!edit) return false;
    if (handleRef && v === handleRef.view) { handleRef.applyEdit(edit); return true; }
    applyEditTo(v, edit);
    return true;
  };
  const core = buildEditor(host, doc.getText(), {
    ...o,
    sessions: doc.sessions,
    focus: o.focus ?? doc.focusLink,
    onEnter: o.onEnter ? (v) => keyEdit(v, () => o.onEnter!(v.state.doc.toString(), v.state.selection.main.from, v.state.selection.main.to)) : undefined,
    onTab: o.onTab ? (v, shift) => keyEdit(v, () => o.onTab!(v.state.doc.toString(), v.state.selection.main.from, v.state.selection.main.to, shift)) : undefined,
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
