/**
 * 0.4.13 (Colin, bug 4): Backspace on an empty list item is never a no-op. With the caret at
 * the end of a line that holds only indent and (maybe) a marker:
 *   1. a marker (`- `, `* `, `+ `, `1. `, with or without `[ ]`) is removed, indent kept;
 *   2. else the line outdents one unit;
 *   3. else (an empty top-level line) it joins the previous line, caret at that line's end.
 * Everything else is left to the default Backspace. Pure core + a CM command.
 */
import type { EditorView } from '@codemirror/view';
import { zoneIndentUnit } from './zoneIndent.js';

const EMPTY_ITEM = /^([ \t]*)((?:[-*+]|\d+\.)(?:[ \t]+\[[ xX]?\])?[ \t]*)?$/;

export interface BackspaceEdit { from: number; to: number; caret: number }

/** Pure: the edit for Backspace at `head` (empty selection), or null to use the default. */
export function emptyItemBackspace(text: string, head: number): BackspaceEdit | null {
  const ls = text.lastIndexOf('\n', head - 1) + 1;
  const le0 = text.indexOf('\n', head);
  const le = le0 < 0 ? text.length : le0;
  if (text.slice(head, le).trim()) return null; // text after the caret: a normal Backspace
  const line = text.slice(ls, le);
  const m = EMPTY_ITEM.exec(line);
  if (!m) return null;
  const indent = m[1]!;
  if (m[2]) return { from: ls + indent.length, to: le, caret: ls + indent.length };
  if (indent.length) {
    const cut = indent.endsWith('\t') ? 1 : Math.min(zoneIndentUnit(text), indent.length);
    const keep = indent.length - cut;
    return { from: ls + keep, to: le, caret: ls + keep };
  }
  if (ls === 0) return null;
  return { from: ls - 1, to: le, caret: ls - 1 };
}

export function backspaceEmptyItem(v: EditorView): boolean {
  const sel = v.state.selection.main;
  if (!sel.empty || v.state.readOnly) return false;
  const e = emptyItemBackspace(v.state.doc.toString(), sel.head);
  if (!e) return false;
  v.dispatch({ changes: { from: e.from, to: e.to }, selection: { anchor: e.caret }, scrollIntoView: true, userEvent: 'delete.backward' });
  return true;
}
