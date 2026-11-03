/**
 * Optional CodeMirror 6 editor module: `@audroam/outline-fold/editor` (spec 20261101 §4, P4).
 * CodeMirror is a peer dependency; the core package never imports this file. Load it lazily
 * with `loadOutlineEditor()` only when the text editor is opened (§8.4).
 *
 * Secure zone: a block widget after each `<enc:KEYID>` line whose session is unlocked. It
 * hosts a nested EditorView bound to the child doc (green frame, Save / Lock / Remove seal).
 * The main document only ever holds the `<enc>` tag, so copy, paste and undo in the main
 * editor never contain plaintext. The `<enc>` tag is atomic and cannot be edited by hand.
 */
import { indentLess, indentMore } from '@codemirror/commands';
import { EditorState, RangeSetBuilder, Transaction, StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, drawSelection, keymap, type DecorationSet } from '@codemirror/view';
import { canIndent, canOutdent, detectIndentUnit } from './outlineKeys.js';
import { parseZoneText } from '../zoneText.js';
import { normalizeTaskMarkers } from '../taskChrome.js';
import { editTaskMarker, taskMarkAt } from '../task.js';
import { serialize } from '../serialize.js';
import type { SealSessions } from '../sealSession.js';
import type { RegionId } from '../hostApi.js';
import { secureZoneChrome } from '../sealUi.js';
import type { FocusLink } from '../focusLink.js';
import { parseScopedId } from '../scopedId.js';

export interface OutlineEditorOptions {
  sessions: SealSessions;
  /** Passphrase prompt for Remove seal (always asked, §8.6). Null = cancelled. */
  askPassphrase?: (region: RegionId) => string | null | Promise<string | null>;
  /** Extra extensions for the nested secure-zone editor. */
  childExtensions?: Extension[];
  /**
   * Wrap width in ch for the secure zone (host map's `autoWidth:` → `autoWrapCh`). Host doc
   * wins over the inner doc's own layout block, which is kept untouched in the payload.
   */
  textWidthCh?: (region: RegionId) => number | undefined;
  /** Shared focus (Map ⇄ Outline ⇄ editor). With `followInText` the cursor follows it. */
  focus?: FocusLink;
  /** "Follow in text": default on (`resolveFollowInText`). Pauses while the user types. */
  followInText?: () => boolean;
  /**
   * 0.4.3 (QA D): click on a locked `<enc>` line (shown as a green secure zone) asks the host
   * to unlock that region with the same prompt as the Map and Outline.
   */
  onUnlockZone?: (region: RegionId, anchor: HTMLElement) => void;
}

const ENC_RE = /<enc:[A-Za-z0-9_.-]+>/;
const TRAILER_RE = /(?:^|\n)---\s*(?:payloads|sealed|enc|keyring|keys|layout)\s*---/i;

/**
 * 0.4.5 (Colin): the zone edits only the branch's outline text. Trailing blocks (payloads of
 * nested seals, keyring, keys, layout) are split off and re-attached on every edit, so the
 * keyring never shows in, or can be typed into, the editable zone.
 */
export function splitZoneText(text: string): { body: string; trailer: string } {
  const m = TRAILER_RE.exec(text);
  if (!m) return { body: text, trailer: '' };
  return { body: text.slice(0, m.index).replace(/\s+$/, ''), trailer: text.slice(m.index).replace(/^\n/, '') };
}
/**
 * 0.4.9 (bug C): the zone's first line is the anchor's own row (its secret caption). It shows
 * without `<id:N>`: that id is the anchor's, and showing it invited a second node with it.
 */
export function zoneShowRoot(body: string, anchorId: string): string {
  // 0.4.14: no blank lines above the root row (they showed as empty space at the zone top).
  body = body.replace(/^(?:[ \t]*\n)+/, '');
  const nl = body.indexOf('\n');
  const first = nl < 0 ? body : body.slice(0, nl);
  const tag = new RegExp(`\\s*<id:${anchorId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>`);
  return first.replace(tag, '') + (nl < 0 ? '' : body.slice(nl));
}
/** The parsed zone keeps exactly the anchor id on its root row. */
export function zoneRootId(doc: { nodes: { id?: string }[] }, anchorId: string): void {
  const r = doc.nodes[0];
  if (doc.nodes.length === 1 && r && !r.id) r.id = anchorId;
}

type ZoneNode = { id?: string; children?: ZoneNode[] };

/**
 * 1-based preorder place of `local` in a zone doc. Serialize writes one line per node,
 * and a session id (`autoId`) is not written as `<id:>`, so the zone row is this place.
 */
export function zoneLineForLocal(doc: { nodes?: ZoneNode[] } | null | undefined, local: string): number | null {
  if (!doc || !local) return null;
  let n = 0;
  let found: number | null = null;
  const walk = (list: ZoneNode[] | undefined): void => {
    for (const node of list ?? []) {
      if (found != null) return;
      n += 1;
      if (node.id === local) { found = n; return; }
      walk(node.children);
    }
  };
  walk(doc.nodes);
  return found;
}

/** Smallest single replace of `prev` into `next`, so a caret outside the edit stays put. */
function smallestReplace(prev: string, next: string): { from: number; to: number; insert: string } {
  let a = 0;
  const max = Math.min(prev.length, next.length);
  while (a < max && prev.charCodeAt(a) === next.charCodeAt(a)) a += 1;
  let b = 0;
  while (b < max - a && prev.charCodeAt(prev.length - 1 - b) === next.charCodeAt(next.length - 1 - b)) b += 1;
  return { from: a, to: prev.length - b, insert: next.slice(a, next.length - b) };
}

/** How far to move a scroller so the caret line sits in view. `center` is for an explicit follow. */
function caretDelta(top: number, bottom: number, viewTop: number, viewHeight: number, y?: string): number {
  if (viewHeight < 1 || bottom - top < 1) return 0;
  const margin = 8;
  if (y === 'center' && bottom - top <= viewHeight) return (top + bottom) / 2 - (viewTop + viewHeight / 2);
  if (top < viewTop + margin) return top - (viewTop + margin);
  if (bottom > viewTop + viewHeight - margin) return bottom - (viewTop + viewHeight - margin);
  return 0;
}

/**
 * Screen box of one zone line from the height map. Works for a line CodeMirror
 * has not drawn. Sharing the widget's box by line count does not: a later row
 * in a tall zone is then placed on the first row, and the pane scrolls there.
 */
function lineScreenBox(zone: EditorView, pos: number): { top: number; bottom: number } | null {
  try {
    const line = zone.state.doc.lineAt(pos);
    const block = zone.lineBlockAt(pos);
    // An unmeasured map reports every line at the top. That is not a place to scroll.
    if (line.number > 1 && block.top < 1) return null;
    const top = zone.documentTop + block.top;
    const bottom = zone.documentTop + block.bottom;
    if (bottom - top < 1) return null;
    return { top, bottom };
  } catch {
    return null;
  }
}

/**
 * Which box is the caret. A rect that sits on the first row while the caret is
 * on a later line is the undrawn-line placeholder, not the row being edited.
 * Trusting it scrolls the pane to the top of the zone.
 */
export function zoneCaretBox(
  lineNo: number,
  docTop: number,
  drawn: { top: number; bottom: number } | null,
  mapped: { top: number; bottom: number } | null,
): { top: number; bottom: number } | null {
  if (drawn && drawn.bottom - drawn.top >= 1) {
    if (!(lineNo > 1 && Math.abs(drawn.top - docTop) < 4)) return drawn;
  }
  return mapped;
}

/** Screen box of the zone caret. A drawn line uses its real coordinates. */
function caretViewport(zone: EditorView): { top: number; bottom: number } | null {
  const head = zone.state.selection.main.head;
  const lineNo = zone.state.doc.lineAt(head).number;
  let drawn: { top: number; bottom: number } | null = null;
  if (head >= zone.viewport.from && head <= zone.viewport.to) {
    try {
      const coords = zone.coordsAtPos(head);
      if (coords && coords.bottom - coords.top >= 1) drawn = { top: coords.top, bottom: coords.bottom };
    } catch { /* not measured yet */ }
  }
  let docTop = 0;
  try { docTop = zone.documentTop; } catch { /* view gone */ }
  return zoneCaretBox(lineNo, docTop, drawn, lineScreenBox(zone, head));
}

/**
 * The pane that actually scrolls. A zone scroller is overflow:visible, so it is
 * not this pane; the outer text scroller is. Nested zones keep walking until an
 * ancestor really scrolls.
 */
function textPane(view: EditorView): HTMLElement | null {
  const own = view.scrollDOM;
  if (own?.isConnected) {
    const oy = getComputedStyle(own).overflowY;
    if (oy === 'auto' || oy === 'scroll') return own;
  }
  let n: HTMLElement | null = view.dom.parentElement;
  while (n) {
    if (n.classList.contains('cm-scroller')) {
      const oy = getComputedStyle(n).overflowY;
      if (oy === 'auto' || oy === 'scroll') return n;
    }
    n = n.parentElement;
  }
  return own?.isConnected ? own : null;
}

/** 0.5.15: per region, the caret row's place in the pane (px from its top) before a save. */
const caretAnchorAt = new Map<string, number>();
function caretRowInPane(zone: EditorView): number | undefined {
  const pane = textPane(zone);
  const caret = pane ? caretViewport(zone) : null;
  if (!pane || !caret) return undefined;
  const box = pane.getBoundingClientRect();
  if (box.height < 1) return undefined;
  return caret.top - box.top;
}
/** Put the caret row back at `row` px from the pane top (by row, not a pixel guess of the
 *  pane); with no saved row, only keep it on screen. */
function zoneHoldRow(zone: EditorView, row?: number): boolean {
  if (row === undefined) return zoneKeepCaret(zone);
  const now = caretRowInPane(zone);
  const pane = textPane(zone);
  if (now === undefined || !pane) return zoneKeepCaret(zone);
  const dy = now - row;
  if (Math.abs(dy) > 1) pane.scrollTop += dy;
  return true;
}

/**
 * Scroll the outer text pane so the zone caret line stays visible. Returns true so
 * CodeMirror does not walk ancestors itself. `center` is for an explicit follow;
 * typing uses `nearest` and does not move when the line is already on screen.
 */
function zoneKeepCaret(zone: EditorView, y?: string): boolean {
  const pane = textPane(zone);
  if (!pane) return true;
  const caret = caretViewport(zone);
  if (!caret) return true;
  const box = pane.getBoundingClientRect();
  const dy = caretDelta(caret.top, caret.bottom, box.top, box.height, y);
  if (dy) pane.scrollTop += dy;
  return true;
}

/**
 * The zone view's layout pass treats the outer text scroller as its own and, while
 * the zone is focused, pins that scroller to the bottom of the zone widget. Put the
 * pane back where it was, then keep the caret line on screen. A wheel, touch, or
 * pointer in the last moment is the user moving the pane: undo the pin, and do not
 * pull the caret back on screen.
 */
export function zoneScrollAfterMeasure(o: {
  before: number;
  after: number;
  focused: boolean;
  userScrollAt: number;
  now?: number;
  caretTop?: number;
  caretBottom?: number;
  viewTop?: number;
  viewHeight?: number;
  /** `center` is a map follow. It runs even when the zone does not have focus. */
  y?: string;
  /** 0.5.15: where the caret row sat in the pane (px from the pane top) before a save
   *  rewrote the zone. The row is put back there, not just "on screen". */
  caretAnchor?: number;
}): number {
  // 0.5.15: the zone's own layout pass never moves the text pane, focused or not. Save blurs
  // the zone (Save button / autosave re-render), and the old early return kept the pin to the
  // widget's bottom: the flash to the bottom on save.
  const top = Math.abs(o.after - o.before) > 1 ? o.before : o.after;
  if (!o.focused && o.y !== 'center') return top;
  if ((o.now ?? 0) - o.userScrollAt < 200) return top;
  if (o.caretAnchor !== undefined && o.caretTop !== undefined && o.viewTop !== undefined) {
    return top + (o.caretTop - o.viewTop - o.caretAnchor);
  }
  const dy = caretDelta(o.caretTop ?? 0, o.caretBottom ?? 0, o.viewTop ?? 0, o.viewHeight ?? 0, o.y);
  return top + dy;
}

/**
 * How far to move the pane so a zone block comes on screen. A block taller than
 * the pane is the open zone widget: reveal its top edge. Centering that block,
 * or aligning its end, leaves the lower half on screen and a top row above it.
 */
export function zoneRevealDelta(blockTop: number, blockBottom: number, viewTop: number, viewHeight: number): number {
  if (viewHeight < 1 || blockBottom - blockTop < 1) return 0;
  const bottom = blockBottom - blockTop > viewHeight ? blockTop + 20 : blockBottom;
  return caretDelta(blockTop, bottom, viewTop, viewHeight, 'center');
}

/** Caret offset on 1-based line `lineNo` of `text`, clamped to that line. */
function caretOnLine(text: string, lineNo: number, col: number): number {
  const lines = text.split('\n');
  const n = Math.max(1, Math.min(lineNo, Math.max(1, lines.length)));
  let at = 0;
  for (let i = 0; i < n - 1; i++) at += lines[i]!.length + 1;
  const line = lines[n - 1] ?? '';
  return at + Math.max(0, Math.min(col, line.length));
}
/** `[ ]` / `[]` / `[x]` / `[-]` on a line → glyph, with or without a leading `-`. */
export function zoneTaskMarks(line: string): { from: number; to: number; glyph: string } | null {
  const t = taskMarkAt(line);
  if (!t) return null;
  return { from: t.from, to: t.to, glyph: t.state === 'open' ? '\u2610' : t.state === 'pending' ? '\u25A3' : '\u2611' };
}
class TaskGlyph extends WidgetType {
  constructor(readonly glyph: string) { super(); }
  eq(o: TaskGlyph): boolean { return o.glyph === this.glyph; }
  toDOM(): HTMLElement {
    const s = document.createElement('span');
    s.className = 'of-zone-task';
    s.textContent = this.glyph;
    s.setAttribute('role', 'checkbox');
    s.setAttribute('aria-checked', this.glyph === '\u2610' ? 'false' : this.glyph === '\u25A3' ? 'mixed' : 'true');
    return s;
  }
  // 0.4.15: let the view's mousedown handler see clicks on the glyph (CodeMirror checkbox-widget pattern).
  ignoreEvent(): boolean { return false; }
}
/** Cycle the task marker on the line holding `pos`. A normal user edit, so it saves like typing. */
export function toggleTaskAt(view: EditorView, pos: number): boolean {
  const line = view.state.doc.lineAt(pos);
  const edited = editTaskMarker(line.text);
  if (!edited) return false;
  view.dispatch({
    changes: { from: line.from + edited.innerFrom, to: line.from + edited.innerTo, insert: edited.mark },
    userEvent: 'input.toggle',
  });
  return true;
}
const taskDecos = (v: EditorView): DecorationSet => {
  const b = new RangeSetBuilder<Decoration>();
  for (const { from, to } of v.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = v.state.doc.lineAt(pos);
      const t = zoneTaskMarks(line.text);
      if (t) b.add(line.from + t.from, line.from + t.to, Decoration.replace({ widget: new TaskGlyph(t.glyph) }));
      pos = line.to + 1;
    }
  }
  return b.finish();
};
/**
 * Task markers render as ☐ / ☑ / ▣ (display only; the text stays `[ ]` / `[x]` / `[-]`).
 * 0.4.12: one decoration for the main editor and every zone editor.
 */
export const taskGlyphs = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(v: EditorView) { this.decorations = taskDecos(v); }
  update(u: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) { if (u.docChanged || u.viewportChanged) this.decorations = taskDecos(u.view); }
}, {
  decorations: (p) => p.decorations,
  eventHandlers: {
    mousedown(e: MouseEvent, view: EditorView) {
      const el = e.target as HTMLElement | null;
      if (e.button !== 0 || !el?.closest?.('.of-zone-task') || view.state.readOnly) return false;
      e.preventDefault();
      return toggleTaskAt(view, view.posAtDOM(el.closest('.of-zone-task')!));
    },
  },
});

/** @deprecated 0.4.12 alias of `taskGlyphs`. */
export const zoneTaskGlyphs = taskGlyphs;

export function joinZoneText(body: string, trailer: string): string {
  return trailer ? `${body.replace(/\s+$/, '')}\n\n${trailer}` : body;
}

/** Zone views by region, so the main editor's ↑ can land on the zone's last line. */
const zoneViews = new Map<RegionId, EditorView>();
/** Until this time, a map follow owns the pane: keep that zone's caret line centered. */
const followSnapUntil = new Map<RegionId, number>();
/**
 * Until this time, typing, a format write-back, or a save refresh owns the pane.
 * Keep that caret line on screen (nearest), even if Save moved DOM focus out of
 * the zone. A wheel, touch, or drag still wins for a moment.
 */
const keepCaretUntil = new Map<RegionId, number>();
/** The zone was focused this recently, so a save that blurs it first still has a caret to keep. */
const zoneCaretHold = new Map<RegionId, number>();

/** 0.4.5: caret and selection for the nested zone editor (the parent's drawSelection hides the native caret). */
const zoneCaret = EditorView.theme({
  '.cm-content': { caretColor: 'var(--of-caret, #9ecbff)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--of-caret, #9ecbff)', borderLeftWidth: '2px' },
});
const ID_RE = /<id:([^>\s]+)>/;
/** Re-scan zones (session state or wrap width changed). */
export const refreshZones = StateEffect.define<null>();
const refresh = refreshZones;

interface EncLine {
  /** Line end (widget position). */
  to: number;
  tagFrom: number;
  tagTo: number;
  region: RegionId | null;
}

export function scanEnc(doc: Text, sessions: SealSessions): EncLine[] {
  const out: EncLine[] = [];
  // Track the enclosing sealed id per indent to build nested region ids.
  const stack: { indent: number; region: RegionId }[] = [];
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const m = ENC_RE.exec(line.text);
    if (!m) continue;
    const indent = line.text.length - line.text.trimStart().length;
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const id = ID_RE.exec(line.text)?.[1];
    const region = id ? sessions.regionFor(id, stack[stack.length - 1]?.region ?? '') : null;
    if (region) stack.push({ indent, region });
    out.push({ to: line.to, tagFrom: line.from + m.index, tagTo: line.from + m.index + m[0].length, region });
  }
  return out;
}

class SecureZone extends WidgetType {
  constructor(readonly region: RegionId, readonly opts: OutlineEditorOptions, readonly ch?: number) {
    super();
  }
  eq(o: SecureZone): boolean {
    return o.region === this.region && o.ch === this.ch && !zoneRenderFailures.has(this.region);
  }
  toDOM(outer?: EditorView): HTMLElement {
    // 0.4.6 (Colin QA, data safety): a zone that cannot render never throws out of CM (that
    // aborted the refresh and left the Text pane on the raw <enc> line while the Map showed
    // the open branch). It shows a recoverable error instead and tells the host to hold saves.
    try {
      return this.render(outer);
    } catch (err) {
      return zoneErrorDom(this.region, err, outer);
    }
  }
  private render(outer?: EditorView): HTMLElement {
    const { sessions } = this.opts;
    const region = this.region;
    const host = document.createElement('div');
    host.className = 'of-secure-zone-editor';
    const ch = this.ch;
    if (ch) host.style.maxWidth = `${ch}ch`;
    const zone = secureZoneChrome(host, { sessions, region, askPassphrase: this.opts.askPassphrase });
    const wrap = zone.el;
    const s = sessions.get(region);
    const child = s.doc;
    let applying = false;
    const leave = (v: EditorView, dir: -1 | 1): boolean => {
      const sel = v.state.selection.main;
      if (!sel.empty || !outer) return false;
      const ln = v.state.doc.lineAt(sel.head).number;
      if (dir < 0 ? ln !== 1 : ln !== v.state.doc.lines) return false;
      let pos: number | null = null;
      try { pos = outer.posAtDOM(wrap); } catch { pos = null; }
      if (pos == null) return false;
      // The widget replaces the whole anchor line: land on the line above / below it.
      const d = outer.state.doc;
      const anchorLine = d.lineAt(pos);
      const target = dir < 0
        ? (anchorLine.number > 1 ? d.line(anchorLine.number - 1).from : anchorLine.from)
        : (anchorLine.number < d.lines ? d.line(anchorLine.number + 1).from : anchorLine.to);
      outer.focus();
      outer.dispatch({ selection: { anchor: target }, scrollIntoView: true });
      return true;
    };
    const anchorId = s.branchId;
    const shown = (t: string) => { const sp = splitZoneText(t); return { body: zoneShowRoot(sp.body, anchorId), trailer: sp.trailer }; };
    let split = shown(child ? serialize(child) : '');
    let ownText = child ? serialize(child) : '';
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: split.body,
        extensions: [
          // Boundary hook (zone side): ↑ on the first zone line / ↓ on the last hand the caret
          // back to the main text. Ahead of the child keymaps; everything else is default motion.
          keymap.of([
            { key: 'ArrowUp', run: (v) => leave(v, -1) },
            { key: 'ArrowDown', run: (v) => leave(v, 1) },
          ]),
          ...(this.opts.childExtensions ?? []),
          drawSelection(),
          zoneCaret,
          taskGlyphs,
          EditorView.updateListener.of((u) => {
            if (!u.docChanged || applying) return;
            const d = sessions.get(region).doc;
            if (!d) return;
            // 0.4.13: always one root (malformed indents nest under it) and every row keyed.
            const next = parseZoneText(joinZoneText(u.state.doc.toString(), split.trailer), anchorId, d);
            normalizeTaskMarkers(next.nodes); // a typed ☑ / ☐ is stored as [x] / [ ]
            d.nodes.splice(0, d.nodes.length, ...next.nodes); // keep viewer identity
            ownText = serialize(d);
            sessions.markChanged(region);
            sessions.touch();
          }),
          EditorView.lineWrapping,
          // Typing scrolls the caret. The default walk treats a tall zone block as the
          // target and pins its bottom to the text pane. Scroll the caret line only.
          EditorView.scrollHandler.of((zv, _range, target) => zoneKeepCaret(zv, target?.y)),
        ],
      }),
    });
    // The host rule `.cm-host .cm-editor { height: 100% }` also matches this nested
    // editor, which stretches the zone to the pane and makes every keystroke scroll
    // to the bottom. Inline styles win over that rule.
    view.dom.style.height = 'auto';
    view.scrollDOM.style.height = 'auto';
    view.scrollDOM.style.overflow = 'visible';
    // 0.4.7 (Colin QA, data safety): the child doc can change outside this view (Map / Outline
    // [ ] toggle, restore). Re-sync the zone text, else the next keystroke here would write the
    // stale text back over that change.
    const offSync = sessions.get(region).subscribe(() => {
      const d = sessions.get(region).doc;
      if (!d || gone) return;
      let now: string;
      try { now = serialize(d); } catch { return; }
      if (now === ownText) return;
      ownText = now;
      split = shown(now);
      const cur = view.state.doc.toString();
      if (split.body === cur) return;
      const here = view.state.selection.main;
      const docNow = view.state.doc;
      const headLine = docNow.lineAt(here.head);
      const anchorLine = docNow.lineAt(here.anchor);
      const row = caretRowInPane(view);
      if (row !== undefined) caretAnchorAt.set(region, row);
      applying = true;
      try {
        view.dispatch({
          changes: smallestReplace(cur, split.body),
          selection: {
            anchor: caretOnLine(split.body, anchorLine.number, here.anchor - anchorLine.from),
            head: caretOnLine(split.body, headLine.number, here.head - headLine.from),
          },
        });
      } finally { applying = false; }
      // A format write-back replaces the zone text. Keep the restored caret row
      // on screen. This runs without DOM focus when Save already blurred the zone.
      if (view.hasFocus || (zoneCaretHold.get(region) ?? 0) > Date.now()) {
        keepCaretUntil.set(region, Date.now() + 600);
        const snap = () => { try { if (!gone && view.dom.isConnected) zoneHoldRow(view, caretAnchorAt.get(region)); } catch { /* zone gone */ } };
        queueMicrotask(snap);
        requestAnimationFrame(() => { snap(); requestAnimationFrame(snap); });
      }
    });
    const holdCaret = () => { zoneCaretHold.set(region, Date.now() + 2000); };
    view.dom.addEventListener('focusin', holdCaret);
    view.dom.addEventListener('focusout', holdCaret);
    // 0.4.9 (bug B1): a re-render (width change, refresh after a session transition) keeps
    // the caret: the new view takes the old one's selection and focus.
    const prev = zoneViews.get(region);
    if (prev && prev !== view) {
      // The Save button sits outside the zone editor. A re-seal refresh must keep
      // that focus in the zone, or the next Tab leaves for the page.
      const zoneEl = prev.dom.closest('.of-secure-zone');
      const had = prev.hasFocus || (typeof document !== 'undefined' && !!document.activeElement && (prev.contentDOM.contains(document.activeElement) || !!zoneEl?.contains(document.activeElement)));
      const recent = (zoneCaretHold.get(region) ?? 0) > Date.now();
      const sel = prev.state.selection.main;
      const prevDoc = prev.state.doc;
      const headLine = prevDoc.lineAt(sel.head);
      const anchorLine = prevDoc.lineAt(sel.anchor);
      const body = view.state.doc.toString();
      const row = caretRowInPane(prev);
      if (row !== undefined) caretAnchorAt.set(region, row);
      const paneTop = textPane(prev)?.scrollTop;
      // Line and column, not a raw offset: a format refresh rewrites the text.
      view.dispatch({
        selection: {
          anchor: caretOnLine(body, anchorLine.number, sel.anchor - anchorLine.from),
          head: caretOnLine(body, headLine.number, sel.head - headLine.from),
        },
      });
      if (had || recent) {
        keepCaretUntil.set(region, Date.now() + 600);
        const snap = () => { try { if (view.dom.isConnected) { const p = textPane(view); if (p && paneTop !== undefined && Math.abs(p.scrollTop - paneTop) > 1) p.scrollTop = paneTop; zoneHoldRow(view, caretAnchorAt.get(region)); } } catch { /* zone gone */ } };
        queueMicrotask(snap);
        requestAnimationFrame(() => { snap(); requestAnimationFrame(snap); });
      }
      if (had) queueMicrotask(() => { try { view.focus(); } catch { /* gone */ } });
    }
    zoneViews.set(region, view);
    zoneRenderFailures.delete(region);
    // Chrome moves focus on Tab inside a nested contenteditable before the zone keymap
    // runs, so Tab left the zone and landed on the next page control. Capture it here.
    // Shift-Tab at the zone's left edge outdents the sealed line in the host note.
    const outdentAnchor = (): void => {
      if (!outer) return;
      const doc = outer.state.doc;
      let line = null;
      for (let i = 1; i <= doc.lines; i++) {
        const ln = doc.line(i);
        if (ln.text.includes(`<id:${anchorId}>`)) { line = ln; break; }
      }
      if (!line) return;
      const unit = detectIndentUnit(doc.toString());
      const lead = /^[ \t]*/.exec(line.text)![0].length;
      if (lead < unit.length) return;
      // Not userEvent "input": that filter blocks every edit of an open zone's anchor line,
      // including the leading whitespace. This change stays in front of the <enc> tag.
      outer.dispatch({ changes: { from: line.from, to: line.from + unit.length, insert: '' } });
    };
    const onZoneTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (!(t instanceof Node) || !wrap.contains(t)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!view.dom.contains(t)) { view.focus(); return; }
      if (e.shiftKey) {
        if (canOutdent(view.state)) indentLess(view);
        else outdentAnchor();
      } else if (canIndent(view.state)) indentMore(view);
    };
    wrap.addEventListener('keydown', onZoneTab, true);
    // The zone scroller is overflow:visible, so CodeMirror's measure treats the outer
    // text scroller as its scroll parent and, on each keystroke, sets that scroller to
    // its bottom. The caret, higher in the zone, leaves the screen. Put the pane back.
    let userScrollAt = 0;
    let measuring = false;
    let gone = false;
    const markUserScroll = () => { userScrollAt = Date.now(); };
    if (outer) {
      outer.scrollDOM.addEventListener('wheel', markUserScroll, { capture: true, passive: true });
      outer.scrollDOM.addEventListener('touchstart', markUserScroll, { capture: true, passive: true });
      outer.scrollDOM.addEventListener('pointerdown', markUserScroll, true);
      // measure() runs on each layout pass but is omitted from the public types.
      const zoneView = view as EditorView & { measure(flush?: boolean): void };
      const origMeasure = zoneView.measure.bind(zoneView);
      zoneView.measure = (flush?: boolean) => {
        if (measuring) return;
        measuring = true;
        const scroller = outer.scrollDOM;
        const before = scroller.scrollTop;
        // Sample the caret before the layout pass. That pass moves the pane, and the
        // caret's screen box moves with it.
        const follow = (followSnapUntil.get(region) ?? 0) > Date.now();
        const keep = (keepCaretUntil.get(region) ?? 0) > Date.now();
        const track = view.hasFocus || follow || keep;
        const caret = track ? caretViewport(view) : null;
        const box = track ? scroller.getBoundingClientRect() : null;
        try {
          origMeasure(flush);
          if (gone || !scroller.isConnected) return;
          const anchor = keep ? caretAnchorAt.get(region) : undefined;
          const next = zoneScrollAfterMeasure({
            caretAnchor: anchor,
            before,
            after: scroller.scrollTop,
            focused: view.hasFocus || follow || keep,
            userScrollAt,
            now: Date.now(),
            caretTop: caret?.top,
            caretBottom: caret?.bottom,
            viewTop: box?.top,
            viewHeight: box?.height,
            y: follow ? 'center' : undefined,
          });
          if (Math.abs(scroller.scrollTop - next) > 1) scroller.scrollTop = next;
        } finally { measuring = false; }
      };
    }
    // 0.4.14: the outer height map must follow the zone's real height (vertical motion reads
    // it). Re-measure once mounted and whenever the zone resizes (typing, wrap, buttons).
    // A resize that throws the pane to the bottom of the widget is put back; a one-line
    // nudge while already at the bottom is left alone.
    const ro = outer && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      const before = outer.scrollDOM.scrollTop;
      outer.requestMeasure();
      requestAnimationFrame(() => {
        const follow = (followSnapUntil.get(region) ?? 0) > Date.now();
        const keep = (keepCaretUntil.get(region) ?? 0) > Date.now();
        if (gone || (!view.hasFocus && !follow && !keep) || !outer.scrollDOM.isConnected) return;
        if (Date.now() - userScrollAt < 200) return;
        if (Math.abs(outer.scrollDOM.scrollTop - before) <= 48) return;
        outer.scrollDOM.scrollTop = before;
        zoneKeepCaret(view, follow ? 'center' : undefined);
      });
    }) : null;
    ro?.observe(wrap);
    if (outer) queueMicrotask(() => { try { outer.requestMeasure(); } catch { /* gone */ } });
    (wrap as HTMLElement & { _ofDestroy?: () => void })._ofDestroy = () => {
      if (gone) return; // CM may destroy a widget DOM twice across a fast lock/unlock
      gone = true;
      offSync();
      wrap.removeEventListener('keydown', onZoneTab, true);
      if (outer) {
        outer.scrollDOM.removeEventListener('wheel', markUserScroll, true);
        outer.scrollDOM.removeEventListener('touchstart', markUserScroll, true);
        outer.scrollDOM.removeEventListener('pointerdown', markUserScroll, true);
      }
      if (zoneViews.get(region) === view) zoneViews.delete(region);
      zone.destroy();
      applying = true;
      ro?.disconnect();
      view.destroy(); // drops the nested undo history with the plaintext
    };
    return wrap;
  }
  destroy(dom: HTMLElement): void {
    (dom as HTMLElement & { _ofDestroy?: () => void })._ofDestroy?.();
  }
  ignoreEvent(): boolean {
    return true;
  }
  /** Lets CM's height map place lines below the zone before it is measured. */
  get estimatedHeight(): number {
    return 160;
  }
}

/**
 * 0.4.6: unlocked regions on `<enc>` lines of this doc that have no live zone editor
 * (render failed, or the refresh after unlock never landed). Hosts hold saves while any.
 */
export function missingZones(doc: Text, sessions: SealSessions): RegionId[] {
  const out: RegionId[] = [];
  for (const e of scanEnc(doc, sessions)) {
    if (!e.region || sessions.get(e.region).locked) continue;
    const v = zoneViews.get(e.region);
    if (!v || zoneRenderFailures.has(e.region) || !v.dom.isConnected) out.push(e.region);
  }
  return out;
}

/** Regions whose Text zone failed to render (host: hold saves while non-empty). */
export const zoneRenderFailures = new Map<RegionId, string>();
export const ZONE_ERROR_EVENT = 'of-zone-error';

function zoneErrorDom(region: RegionId, err: unknown, outer?: EditorView): HTMLElement {
  const msg = err instanceof Error ? err.message : String(err);
  zoneRenderFailures.set(region, msg);
  const box = document.createElement('div');
  box.className = 'of-secure-zone of-secure-zone-error';
  box.setAttribute('role', 'alert');
  box.setAttribute('data-region', region);
  const p = document.createElement('span');
  p.textContent = 'Could not show this sealed branch here. The encrypted text is unchanged; saving is paused. ';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'of-sz-btn of-sz-retry';
  retry.textContent = 'Retry';
  retry.addEventListener('click', () => {
    zoneRenderFailures.delete(region);
    try { outer?.dispatch({ effects: refresh.of(null) }); } catch { /* view gone */ }
  });
  box.append(p, retry);
  queueMicrotask(() => {
    try { (outer?.dom ?? box).dispatchEvent(new CustomEvent(ZONE_ERROR_EVENT, { bubbles: true, detail: { region, message: msg } })); } catch { /* no DOM */ }
  });
  return box;
}

/** CM6 extensions: syntax marks, atomic `<enc>` tags, and the secure-zone widget. */
export function outlineEditor(opts: OutlineEditorOptions): Extension[] {
  const { sessions } = opts;
  const build = (state: EditorState): { zones: DecorationSet; tags: DecorationSet; lines: DecorationSet } => {
    const enc = scanEnc(state.doc, sessions);
    const zb = new RangeSetBuilder<Decoration>();
    const tb = new RangeSetBuilder<Decoration>();
    const lb = new RangeSetBuilder<Decoration>();
    for (const e of enc) {
      const st = e.region ? sessions.get(e.region) : null;
      // Locked: the whole line reads as a green secure zone; a click unlocks (QA D).
      if (st && st.locked) lb.add(state.doc.lineAt(e.tagFrom).from, state.doc.lineAt(e.tagFrom).from, Decoration.line({ class: 'of-cm-sealed-line', attributes: { 'data-region': e.region!, title: 'Sealed branch: click to unlock' } }));
      tb.add(e.tagFrom, e.tagTo, Decoration.mark({ class: 'of-cm-enc', atomic: true }));
      // 0.4.13: an open zone is a block replace decoration over the whole anchor line (the
      // zone shows that line as its root), so CM's own vertical motion steps over it.
      if (st && !st.locked) zb.add(state.doc.lineAt(e.tagFrom).from, e.to, Decoration.replace({ widget: new SecureZone(e.region!, opts, opts.textWidthCh?.(e.region!)), block: true }));
    }
    return { zones: zb.finish(), tags: tb.finish(), lines: lb.finish() };
  };
  const field = StateField.define<{ zones: DecorationSet; tags: DecorationSet; lines: DecorationSet }>({
    create: build,
    update(v, tr) {
      return tr.docChanged || tr.effects.some((e) => e.is(refresh)) ? build(tr.state) : v;
    },
    provide: (f) => [
      EditorView.decorations.from(f, (v) => v.zones),
      EditorView.decorations.from(f, (v) => v.tags),
      EditorView.decorations.from(f, (v) => v.lines),
      EditorView.atomicRanges.of((view) => view.state.field(f).tags),
    ],
  });
  // The `<enc>` tag cannot be typed over or deleted by hand (Remove seal does that).
  // 0.4.18: a host write (doc → editor, e.g. a Map caption rename that also moves the payload's
  // pub line) is not typing; its minimal diff may span the tag and must not be dropped.
  const guard = EditorState.changeFilter.of((tr) => {
    if (!tr.docChanged || tr.annotation(Transaction.remote)) return true;
    const enc = scanEnc(tr.startState.doc, sessions);
    let ok = true;
    tr.changes.iterChanges((fromA, toA) => {
      for (const e of enc) if (fromA < e.tagTo && toA > e.tagFrom) ok = false;
    });
    return ok;
  });
  const marks = EditorView.decorations.of((view) => {
    const b = new RangeSetBuilder<Decoration>();
    const re = /<(id|r|t):[^>]+>/g;
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      for (let m; (m = re.exec(text)); ) b.add(from + m.index, from + m.index + m[0].length, Decoration.mark({ class: `of-cm-${m[1]}` }));
    }
    return b.finish();
  });
  // Rebuild zones whenever a session transitions (unlock, lock, change, remove seal).
  const live = ViewPlugin.define((view) => {
    // 0.4.3 (QA G): coalesce the kicks and skip a view that is gone or mid-update; a
    // late refresh after unlock re-rendered a zone widget whose DOM was already replaced.
    let queued = false;
    let dead = false;
    const kick = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (dead) return; // hidden panes still refresh, so the zone is there when Text opens
        try { view.dispatch({ effects: refresh.of(null) }); } catch { /* view torn down mid-flight */ }
      });
    };
    const offs = (['unlock', 'lock', 'change', 'error', 'save'] as const).map((t) => sessions.api.on(t, kick));
    return { destroy: () => { dead = true; offs.forEach((o) => o()); } };
  });
  /**
   * Bring an unmounted zone onto the pane so its widget can be built. Does not
   * move the caret or take focus. An open zone is left where it is: scrolling
   * the block's end (`e.to`, y center) shows the lower half of a tall widget.
   */
  const scrollToRegion = (view: EditorView, region: string): boolean => {
    if (zoneViews.get(region)?.dom.isConnected) return true;
    for (const e of scanEnc(view.state.doc, sessions)) {
      if (e.region !== region) continue;
      const line = view.state.doc.lineAt(e.tagFrom);
      const block = view.lineBlockAt(line.from);
      const pane = textPane(view);
      if (!pane) return true;
      const top = view.documentTop + block.top;
      const bottom = view.documentTop + block.bottom;
      if (bottom - top < 1) {
        pane.scrollTop = Math.max(0, block.top - 8);
        return true;
      }
      const box = pane.getBoundingClientRect();
      const dy = zoneRevealDelta(top, bottom, box.top, box.height);
      if (dy) pane.scrollTop += dy;
      return true;
    }
    return false;
  };
  /** Outermost seal first, so a nested zone's widget is mounted before we look inside it. */
  const revealSealed = (outer: EditorView, region: string): void => {
    const parts = region.split('/');
    let view: EditorView | undefined = outer;
    for (let i = 0; i < parts.length; i++) {
      if (!view) return;
      const r = parts.slice(0, i + 1).join('/');
      scrollToRegion(view, r);
      if (r !== region) view = zoneViews.get(r);
    }
  };
  /**
   * Caret on the zone row for `local`, without taking DOM focus (map keys stay on the map).
   * A written `<id:>` wins. A session id is not in the text; it is the Nth outline row.
   * The anchor row hides its `<id:>`, so the branch id lands on the zone's first line.
   */
  const placeInZone = (region: string, local: string): boolean => {
    const z = zoneViews.get(region);
    if (!z?.dom.isConnected) return false;
    const known = sessions.list().find((s) => s.region === region);
    if (!known) return false;
    const doc = z.state.doc;
    const needle = `<id:${local}>`;
    let pos: number | null = null;
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      if (line.text.includes(needle)) { pos = line.from; break; }
    }
    if (pos == null) {
      const ordinal = zoneLineForLocal(known.doc, local);
      if (ordinal != null) {
        let seen = 0;
        for (let i = 1; i <= doc.lines; i++) {
          const line = doc.line(i);
          if (!line.text.trim()) continue;
          seen += 1;
          if (seen === ordinal) { pos = line.from; break; }
        }
      }
    }
    if (pos == null && local === known.branchId && doc.lines) pos = doc.line(1).from;
    if (pos == null) return false;
    // Map focus must not take DOM focus. The scroll target is this row, not the
    // zone widget: a tall widget's end would sit on the lower half of the pane.
    followSnapUntil.set(region, Date.now() + 500);
    z.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    const snap = () => { try { if (z.dom.isConnected) zoneKeepCaret(z, 'center'); } catch { /* zone gone */ } };
    snap();
    requestAnimationFrame(() => { snap(); requestAnimationFrame(snap); });
    return true;
  };
  /** A scoped id (`s:4:6`) or a region root (`s:4`). Null for a host-note id. Does not create a session. */
  const sealedTarget = (id: string): { region: string; local: string } | null => {
    const p = parseScopedId(id);
    if (p.region.startsWith('s:')) {
      const known = sessions.list().find((s) => s.region === p.region);
      return known ? { region: p.region, local: p.id } : null;
    }
    if (id.startsWith('s:')) {
      const known = sessions.list().find((s) => s.region === id);
      return known?.branchId ? { region: id, local: known.branchId } : null;
    }
    return null;
  };
  const follow = ViewPlugin.define((view) => {
    let typedAt = 0;
    const onKey = () => (typedAt = Date.now());
    view.dom.addEventListener('keydown', onKey);
    const off = opts.focus?.subscribe((id, source) => {
      if (source === 'editor' || !(opts.followInText?.() ?? true)) return;
      if (Date.now() - typedAt < 1500) return; // paused while typing
      const sealed = sealedTarget(id);
      if (sealed) {
        const place = (): boolean => {
          revealSealed(view, sealed.region);
          return placeInZone(sealed.region, sealed.local);
        };
        if (!place()) requestAnimationFrame(() => { try { place(); } catch { /* zone gone */ } });
        return;
      }
      const local = id.includes(':') ? id.slice(id.lastIndexOf(':') + 1) : id;
      const doc = view.state.doc;
      for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        if (line.text.includes(`<id:${local}>`)) {
          view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
          return;
        }
      }
    });
    return { destroy: () => { off?.(); view.dom.removeEventListener('keydown', onKey); } };
  });
  const unlockClick = EditorView.domEventHandlers({
    mousedown(e) {
      const line = (e.target as Element | null)?.closest?.('.of-cm-sealed-line') as HTMLElement | null;
      const region = line?.getAttribute('data-region');
      if (!line || !region || !opts.onUnlockZone || !sessions.get(region).locked) return false;
      e.preventDefault();
      opts.onUnlockZone(region, line);
      return true;
    },
  });
  // Boundary hook (main side), the only zone key logic here. CM's default vertical motion
  // (cursorLineUp / Down) steps over the replaced anchor line or stops on its edge; when a
  // keyboard move starts on the line right below / above an open zone and lands on or past
  // it, focus the zone instead: its last line coming from below, its first line from above.
  const enterZone = EditorView.updateListener.of((u) => {
    if (u.docChanged || !u.selectionSet || !u.transactions.some((t) => t.annotation(Transaction.userEvent) === 'select')) return;
    const doc = u.state.doc;
    const head = u.state.selection.main.head;
    const was = u.startState.selection.main.head;
    if (head === was) return;
    const wasLine = doc.lineAt(was).number;
    const up = head < was;
    const n = up ? wasLine - 1 : wasLine + 1;
    if (n < 1 || n > doc.lines) return;
    const zl = doc.line(n);
    if (up ? head > zl.to : head < zl.from) return; // did not reach the zone line
    let region: RegionId | null = null;
    u.state.field(field).zones.between(zl.from, zl.to, (from, to, d) => {
      const w = d.spec.widget;
      if (from === zl.from && w instanceof SecureZone) { region = w.region; return false; }
      return undefined;
    });
    if (!region) return;
    const placeEnd = up;
    const anchor = zl.from;
    queueMicrotask(() => {
      const focusZone = (): boolean => {
        const z = zoneViews.get(region!);
        if (!z?.dom.isConnected) return false;
        z.focus();
        z.dispatch({ selection: { anchor: placeEnd ? z.state.doc.line(z.state.doc.lines).from : 0 }, scrollIntoView: true });
        return true;
      };
      try {
        if (focusZone()) return;
        // The move stepped over the zone before its height was in the map, and the
        // off-screen widget was dropped. Land on the anchor line so the zone mounts.
        u.view.dispatch({ selection: { anchor }, scrollIntoView: true });
        queueMicrotask(() => { try { focusZone(); } catch { /* zone gone */ } });
      } catch { /* view gone */ }
    });
  });
  // Typing cannot land on the hidden anchor line of an open zone (caret at its edge).
  const zoneEdge = EditorState.changeFilter.of((tr) => {
    if (!tr.docChanged || !tr.isUserEvent('input') && !tr.isUserEvent('delete') && !tr.isUserEvent('paste')) return true;
    const zones = tr.startState.field(field).zones;
    let ok = true;
    tr.changes.iterChanges((fromA, toA) => {
      zones.between(Math.max(0, fromA - 1), toA + 1, (from, to) => {
        if (toA >= from && fromA <= to) ok = false;
      });
    });
    return ok;
  });
  return [field, guard, marks, live, follow, unlockClick, enterZone, zoneEdge, theme];
}

const theme = EditorView.baseTheme({
  // 0.4.14: a block widget has no vertical margin. CM measures widget height with
  // getBoundingClientRect (margins excluded), so a margin left every line below the zone
  // off by its size in the height map and ↑ skipped up to the top of the doc.
  '& .cm-content > .of-secure-zone': { marginTop: '0', marginBottom: '0' },
  '.of-secure-zone': { border: '2px solid rgba(46,160,67,0.7)', borderRadius: '8px', margin: '0 0 0 1.5em', background: 'rgba(46,160,67,0.06)' },
  // Beat a host `.cm-host .cm-editor { height: 100% }` so the nested editor stays content-sized.
  '.of-secure-zone .cm-editor': { height: 'auto' },
  '.of-secure-zone .cm-scroller': { height: 'auto', overflow: 'visible' },
  '.of-secure-zone-bar': { display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '4px 6px', alignItems: 'center', fontSize: '12px' },
  '.of-secure-zone-status': { marginLeft: 'auto', color: '#1f7a35' },
  '.of-secure-zone-end': { borderTop: '1px dashed rgba(46,160,67,0.7)', margin: '0 6px' },
  '.of-sz-btn': { minHeight: '44px', color: 'var(--of-sz-btn-ink, var(--of-text, #e7ecf1))', background: 'var(--of-sz-btn-bg, #132028)' },
  '.of-cm-enc': { color: '#1f7a35', fontWeight: '600' },
  '.of-cm-sealed-line': { background: 'var(--of-seal-zone-bg, rgba(46,160,67,0.08))', borderLeft: '3px solid var(--of-seal-stroke, #3d8a5f)', cursor: 'pointer' },
  '.of-cm-id': { opacity: '0.55' },
  '.of-cm-r, .of-cm-t': { textDecoration: 'underline dotted' },
});
