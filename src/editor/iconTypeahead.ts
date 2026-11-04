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
