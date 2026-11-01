/**
 * 0.4.13 (Colin, structural): the outline line keys, built on CodeMirror's standard commands.
 *
 * - Tab / Shift-Tab: `indentMore` / `indentLess` with the doc's `indentUnit`. Tab is refused
 *   (handled, no change) when it would nest a line more than one level under the line above,
 *   or under a line that cannot take children (`leaf`: a sealed `<enc:…>` line). Always handled,
 *   so the browser never moves focus.
 * - Enter: on a list item, continue the marker; on an empty item, outdent (or clear the marker
 *   at the top level); otherwise `insertNewlineAndIndent`.
 * - Backspace: on an empty item, marker → outdent → join (`emptyItemBackspace`); else default.
 *
 * Every command reads document lines only (no DOM, no row mapping). Same keys in the main text
 * and in every secure zone.
 */
import { indentMore, indentLess, insertNewlineAndIndent } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import { keymap, type EditorView, type KeyBinding } from '@codemirror/view';
import { emptyItemBackspace } from './emptyItem.js';

const leadOf = (line: string): number => /^[ \t]*/.exec(line)![0].length;

/** The doc's indent unit: tabs, 4 spaces, else 2 spaces (body before any trailer fence). */
export function detectIndentUnit(text: string): string {
  const cut = /^--- [a-z][a-z-]* ---[ \t]*$/m.exec(text);
  const leads = (cut ? text.slice(0, cut.index) : text).match(/^[ \t]+(?=\S)/gm) ?? [];
  if (!leads.length) return '  ';
  if (leads.every((w) => /^\t+$/.test(w))) return '\t';
  if (leads.every((w) => /^( {4})+$/.test(w))) return '    ';
  return '  ';
}

/** `indentUnit` follows the doc (the zone and the main text may differ). */
export const outlineIndentUnit: Extension = indentUnit.compute(['doc'], (s) => detectIndentUnit(s.doc.toString()));

/** Pure: may Tab indent every non-blank line touched by the selection? */
export function canIndent(state: EditorState, leaf?: (line: string) => boolean): boolean {
  const unit = state.facet(indentUnit).length;
  const doc = state.doc;
  for (const r of state.selection.ranges) {
    const first = doc.lineAt(r.from).number, last = doc.lineAt(r.to).number;
    let prev: { lead: number; leaf: boolean } | null = null;
    for (let n = first - 1; n >= 1; n--) {
      const t = doc.line(n).text;
      if (t.trim()) { prev = { lead: leadOf(t), leaf: !!leaf?.(t) }; break; }
    }
    for (let n = first; n <= last; n++) {
      const t = doc.line(n).text;
      if (!t.trim()) continue;
      const target = leadOf(t) + unit;
      if (!prev || prev.leaf || target > prev.lead + unit) return false;
      prev = { lead: target, leaf: !!leaf?.(t) };
    }
  }
  return true;
}

const ITEM = /^([ \t]*)(?:([-*+])|(\d+)\.)([ \t]+)/;

/** Enter on document lines. */
export function outlineEnter(v: EditorView): boolean {
  if (v.state.readOnly) return false;
  const sel = v.state.selection.main;
  if (!sel.empty || v.state.selection.ranges.length > 1) return insertNewlineAndIndent(v);
  const line = v.state.doc.lineAt(sel.head);
  const before = line.text.slice(0, sel.head - line.from);
  const m = ITEM.exec(before);
  if (!m) return insertNewlineAndIndent(v);
  if (m[0] === before && !line.text.slice(before.length).trim()) {
    // Empty item: outdent one unit, or clear the marker at the top level.
    if (!m[1]) { v.dispatch({ changes: { from: line.from, to: line.to, insert: '' }, userEvent: 'delete' }); return true; }
    return indentLess(v);
  }
  const marker = m[2] ? m[2] + m[4] : `${Number(m[3]) + 1}.${m[4]}`;
  const insert = `\n${m[1]}${marker}`;
  v.dispatch({ changes: { from: sel.head, insert }, selection: { anchor: sel.head + insert.length }, scrollIntoView: true, userEvent: 'input' });
  return true;
}

/** Backspace on an empty item (marker → outdent → join); else the default Backspace. */
export function outlineBackspace(v: EditorView): boolean {
  if (v.state.readOnly) return false;
  const sel = v.state.selection.main;
  if (!sel.empty || v.state.selection.ranges.length > 1) return false;
  const e = emptyItemBackspace(v.state.doc.toString(), sel.head);
  if (!e) return false;
  v.dispatch({ changes: { from: e.from, to: e.to, insert: '' }, selection: { anchor: e.caret }, scrollIntoView: true, userEvent: 'delete.backward' });
  return true;
}

export function outlineKeyBindings(leaf?: (line: string) => boolean): KeyBinding[] {
  return [
    { key: 'Enter', run: outlineEnter },
    { key: 'Backspace', run: outlineBackspace },
    { key: 'Tab', run: (v) => { if (canIndent(v.state, leaf)) indentMore(v); return true; } },
    { key: 'Shift-Tab', run: (v) => { indentLess(v); return true; } },
  ];
}

/** The outline keys + indent unit; put ahead of `defaultKeymap`. */
export function outlineKeys(leaf?: (line: string) => boolean): Extension[] {
  return [outlineIndentUnit, keymap.of(outlineKeyBindings(leaf))];
}
