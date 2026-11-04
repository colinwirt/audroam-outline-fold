/** 0.5.18 EP-2 / EP-27: `:` emoji / clipart typeahead in the CodeMirror text editor. */
import { Prec, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
import { createIconTypeahead, type TypeaheadHandle } from '../emoji/typeahead.js';

export function iconTypeahead(): Extension {
  const handles = new WeakMap<EditorView, TypeaheadHandle>();
  const plugin = ViewPlugin.fromClass(
    class {
      t: TypeaheadHandle;
      constructor(readonly view: EditorView) {
        this.t = createIconTypeahead({
          getText: () => {
            const line = view.state.doc.lineAt(view.state.selection.main.head);
            return line.text;
          },
          getCaret: () => {
            const head = view.state.selection.main.head;
            return head - view.state.doc.lineAt(head).from;
          },
          replace: (from, to, insert) => {
            const base = view.state.doc.lineAt(view.state.selection.main.head).from;
            view.dispatch({
              changes: { from: base + from, to: base + to, insert },
              selection: { anchor: base + from + insert.length },
              userEvent: 'input.complete',
            });
          },
          caretRect: () => view.coordsAtPos(view.state.selection.main.head),
        });
        handles.set(view, this.t);
      }
      update(u: ViewUpdate) {
        const typed = u.transactions.some((tr) => tr.isUserEvent('input.type') || tr.isUserEvent('delete'));
        if (typed) queueMicrotask(() => this.t.update());
        else if (u.selectionSet || u.focusChanged) this.t.close();
      }
      destroy() {
        this.t.destroy();
      }
    },
  );
  const run = (key: string) => (view: EditorView) =>
    handles.get(view)?.key({ key, preventDefault: () => {} }) ?? false;
  return [
    plugin,
    Prec.highest(
      keymap.of(['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].map((k) => ({ key: k, run: run(k) }))),
    ),
  ];
}

// ── 0.5.26: stored `:code:` shows as its emoji (display only) ─────────────────
import { Decoration, WidgetType, type DecorationSet } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { displayShortcodes, emojiByCode, loadEmojiData } from '../emoji/icons.js';

class GlyphWidget extends WidgetType {
  constructor(readonly ch: string, readonly code: string) { super(); }
  eq(o: GlyphWidget): boolean { return o.ch === this.ch; }
  toDOM(): HTMLElement {
    const s = document.createElement('span');
    s.className = 'of-shortcode-glyph';
    s.textContent = this.ch;
    s.title = `:${this.code}:`;
    return s;
  }
  ignoreEvent(): boolean { return false; }
}

const CODE_RE = /:([a-z0-9][a-z0-9_+-]*):/gi;

function glyphDecos(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const sel = view.state.selection.main;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      if (line.text.includes(':')) {
        CODE_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = CODE_RE.exec(line.text))) {
          const a = line.from + m.index, z = a + m[0].length;
          // Same rules as the Map/Outline: word boundaries, not clipart, not inside a `code span`.
          const pre = line.text.slice(0, m.index);
          if ((pre.match(/`/g)?.length ?? 0) % 2) continue;
          const ctx = (pre.slice(-1) || ' ') + m[0] + (line.text[m.index + m[0].length] ?? ' ');
          if (displayShortcodes(ctx) === ctx) continue;
          const e = emojiByCode(m[1]!.toLowerCase());
          if (!e) continue;
          if (sel.from <= z && sel.to >= a) continue; // caret on the code: show it raw for editing
          b.add(a, z, Decoration.replace({ widget: new GlyphWidget(e.char, m[1]!) }));
        }
      }
      pos = line.to + 1;
    }
  }
  return b.finish();
}

/** Display a known `:code:` as its emoji; the doc keeps the code. Clipart / unknown / code spans stay text. */
export function shortcodeGlyphs(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      gone = false;
      constructor(readonly view: EditorView) {
        this.decorations = glyphDecos(view);
        void loadEmojiData().then(() => { if (!this.gone) view.dispatch({}); });
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.transactions.length) this.decorations = glyphDecos(u.view);
      }
      destroy(): void { this.gone = true; }
    },
    { decorations: (v) => v.decorations },
  );
}
