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
import { EditorState, RangeSetBuilder, Transaction, StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, drawSelection, keymap, type DecorationSet } from '@codemirror/view';
import { parseZoneText } from '../zoneText.js';
import { normalizeTaskMarkers } from '../taskChrome.js';
import { serialize } from '../serialize.js';
import type { SealSessions } from '../sealSession.js';
import type { RegionId } from '../hostApi.js';
import { secureZoneChrome } from '../sealUi.js';
import type { FocusLink } from '../focusLink.js';

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
/** 0.4.9 (bug B2): `[ ]` / `[x]` / `[-]` task markers in a zone line → glyph, else null. */
export function zoneTaskMarks(line: string): { from: number; to: number; glyph: string } | null {
  const m = /^(\s*[-*+]\s+)\[( |x|X|-)\]/.exec(line);
  if (!m) return null;
  const from = m[1]!.length;
  return { from, to: from + 3, glyph: m[2] === ' ' ? '\u2610' : m[2] === '-' ? '\u25A3' : '\u2611' };
}
class TaskGlyph extends WidgetType {
  constructor(readonly glyph: string) { super(); }
  eq(o: TaskGlyph): boolean { return o.glyph === this.glyph; }
  toDOM(): HTMLElement {
    const s = document.createElement('span');
    s.className = 'of-zone-task';
    s.textContent = this.glyph;
    return s;
  }
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
}, { decorations: (p) => p.decorations });

/** @deprecated 0.4.12 alias of `taskGlyphs`. */
export const zoneTaskGlyphs = taskGlyphs;

export function joinZoneText(body: string, trailer: string): string {
  return trailer ? `${body.replace(/\s+$/, '')}\n\n${trailer}` : body;
}

/** Zone views by region, so the main editor's ↑ can land on the zone's last line. */
const zoneViews = new Map<RegionId, EditorView>();

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
        ],
      }),
    });
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
      applying = true;
      try { view.dispatch({ changes: { from: 0, to: cur.length, insert: split.body } }); } finally { applying = false; }
    });
    // 0.4.9 (bug B1): a re-render (width change, refresh after a session transition) keeps
    // the caret: the new view takes the old one's selection and focus.
    const prev = zoneViews.get(region);
    if (prev && prev !== view) {
      const had = prev.hasFocus || (typeof document !== 'undefined' && prev.contentDOM.contains(document.activeElement));
      const sel = prev.state.selection.main;
      const len = view.state.doc.length;
      if (had) {
        view.dispatch({ selection: { anchor: Math.min(sel.anchor, len), head: Math.min(sel.head, len) } });
        queueMicrotask(() => { try { view.focus(); } catch { /* gone */ } });
      }
    }
    zoneViews.set(region, view);
    zoneRenderFailures.delete(region);
    // 0.4.14: the outer height map must follow the zone's real height (vertical motion reads
    // it). Re-measure once mounted and whenever the zone resizes (typing, wrap, buttons).
    const ro = outer && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => outer.requestMeasure()) : null;
    ro?.observe(wrap);
    if (outer) queueMicrotask(() => { try { outer.requestMeasure(); } catch { /* gone */ } });
    let gone = false;
    (wrap as HTMLElement & { _ofDestroy?: () => void })._ofDestroy = () => {
      if (gone) return; // CM may destroy a widget DOM twice across a fast lock/unlock
      gone = true;
      offSync();
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
  const guard = EditorState.changeFilter.of((tr) => {
    if (!tr.docChanged) return true;
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
  const follow = ViewPlugin.define((view) => {
    let typedAt = 0;
    const onKey = () => (typedAt = Date.now());
    view.dom.addEventListener('keydown', onKey);
    const off = opts.focus?.subscribe((id, source) => {
      if (source === 'editor' || !(opts.followInText?.() ?? true)) return;
      if (Date.now() - typedAt < 1500) return; // paused while typing
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
    const z = region ? zoneViews.get(region) : null;
    if (!z) return;
    queueMicrotask(() => {
      try {
        z.focus();
        z.dispatch({ selection: { anchor: up ? z.state.doc.line(z.state.doc.lines).from : 0 }, scrollIntoView: true });
      } catch { /* zone gone */ }
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
  '.of-secure-zone-bar': { display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '4px 6px', alignItems: 'center', fontSize: '12px' },
  '.of-secure-zone-status': { marginLeft: 'auto', color: '#1f7a35' },
  '.of-secure-zone-end': { borderTop: '1px dashed rgba(46,160,67,0.7)', margin: '0 6px' },
  '.of-sz-btn': { minHeight: '44px', color: 'var(--of-sz-btn-ink, var(--of-text, #e7ecf1))', background: 'var(--of-sz-btn-bg, #132028)' },
  '.of-cm-enc': { color: '#1f7a35', fontWeight: '600' },
  '.of-cm-sealed-line': { background: 'var(--of-seal-zone-bg, rgba(46,160,67,0.08))', borderLeft: '3px solid var(--of-seal-stroke, #3d8a5f)', cursor: 'pointer' },
  '.of-cm-id': { opacity: '0.55' },
  '.of-cm-r, .of-cm-t': { textDecoration: 'underline dotted' },
});
