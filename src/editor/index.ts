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
import { EditorState, RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import { parse } from '../parse.js';
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
    return o.region === this.region && o.ch === this.ch;
  }
  toDOM(): HTMLElement {
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
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: child ? serialize(child) : '',
        extensions: [
          ...(this.opts.childExtensions ?? []),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged || applying) return;
            const d = sessions.get(region).doc;
            if (!d) return;
            const next = parse(u.state.doc.toString());
            d.nodes.splice(0, d.nodes.length, ...next.nodes); // keep viewer identity
            sessions.markChanged(region);
            sessions.touch();
          }),
          EditorView.lineWrapping,
        ],
      }),
    });
    let gone = false;
    (wrap as HTMLElement & { _ofDestroy?: () => void })._ofDestroy = () => {
      if (gone) return; // CM may destroy a widget DOM twice across a fast lock/unlock
      gone = true;
      zone.destroy();
      applying = true;
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
      if (st && !st.locked) zb.add(e.to, e.to, Decoration.widget({ widget: new SecureZone(e.region!, opts, opts.textWidthCh?.(e.region!)), block: true, side: 1 }));
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
    const offs = (['unlock', 'lock', 'change', 'error'] as const).map((t) => sessions.api.on(t, kick));
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
  return [field, guard, marks, live, follow, unlockClick, theme];
}

const theme = EditorView.baseTheme({
  '.of-secure-zone': { border: '2px solid rgba(46,160,67,0.7)', borderRadius: '8px', margin: '4px 0 8px 1.5em', background: 'rgba(46,160,67,0.06)' },
  '.of-secure-zone-bar': { display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '4px 6px', alignItems: 'center', fontSize: '12px' },
  '.of-secure-zone-status': { marginLeft: 'auto', color: '#1f7a35' },
  '.of-secure-zone-end': { borderTop: '1px dashed rgba(46,160,67,0.7)', margin: '0 6px' },
  '.of-sz-btn': { minHeight: '44px' },
  '.of-cm-enc': { color: '#1f7a35', fontWeight: '600' },
  '.of-cm-sealed-line': { background: 'var(--of-seal-zone-bg, rgba(46,160,67,0.08))', borderLeft: '3px solid var(--of-seal-stroke, #3d8a5f)', cursor: 'pointer' },
  '.of-cm-id': { opacity: '0.55' },
  '.of-cm-r, .of-cm-t': { textDecoration: 'underline dotted' },
});
