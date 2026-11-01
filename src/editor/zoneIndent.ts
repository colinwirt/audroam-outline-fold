/**
 * 0.4.10 (Colin): Tab / Shift+Tab inside a secure zone always indent / outdent in the zone,
 * with the zone's own indent unit. The host hook goes first; when it declines (returns null /
 * false, e.g. "Tab would leave the line") this built-in edit runs. Neither key ever moves focus.
 */
import type { EditorView } from '@codemirror/view';

/** Smallest positive leading-space run among the zone's lines (2 when none). */
export function zoneIndentUnit(text: string): number {
  let unit = 0;
  for (const line of text.split('\n')) {
    const m = /^( +)\S/.exec(line);
    if (m && (unit === 0 || m[1]!.length < unit)) unit = m[1]!.length;
  }
  return unit || 2;
}

export interface IndentChange { from: number; to: number; insert: string }

/** Pure: changes that indent (or outdent) every line touched by [from, to]. */
export function zoneIndentChanges(text: string, from: number, to: number, outdent: boolean): IndentChange[] {
  const unit = zoneIndentUnit(text);
  const out: IndentChange[] = [];
  let start = 0;
  for (const line of text.split('\n')) {
    const end = start + line.length;
    if (end >= Math.min(from, to) && start <= Math.max(from, to)) {
      if (outdent) {
        const lead = /^ */.exec(line)![0].length;
        const cut = Math.min(unit, lead);
        if (cut) out.push({ from: start, to: start + cut, insert: '' });
      } else out.push({ from: start, to: start, insert: ' '.repeat(unit) });
    }
    start = end + 1;
  }
  return out;
}

/** Key handler: host first, built-in fallback; always handled so focus stays in the zone. */
export function zoneTab(host: ((v: EditorView, outdent: boolean) => unknown) | undefined, outdent: boolean) {
  return (v: EditorView): boolean => {
    if (host && host(v, outdent)) return true;
    const sel = v.state.selection.main;
    const changes = zoneIndentChanges(v.state.doc.toString(), sel.from, sel.to, outdent);
    if (changes.length) v.dispatch({ changes, scrollIntoView: true });
    return true;
  };
}
