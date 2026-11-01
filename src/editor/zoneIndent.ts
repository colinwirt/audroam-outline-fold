/**
 * Tab / Shift+Tab inside a secure zone always indent / outdent in the zone, with the zone's own
 * indent unit, and never move focus.
 *
 * 0.4.13 (Colin, bug 1): the zone owns its grammar, so the built-in edit always runs (a host
 * hook built for the main text indented blindly). Tab moves a line by exactly one unit and
 * never deeper than the previous line + 1 unit; the zone's root line never indents.
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

const leadOf = (line: string): number => /^ */.exec(line)![0].length;

/**
 * Pure: changes that indent (or outdent) every line touched by [from, to]. `leaf(line)` marks
 * lines that cannot take children in this text (0.4.13: a sealed `<enc:…>` line in the main
 * text keeps its children inside the payload), so Tab under one stops at its level.
 */
export function zoneIndentChanges(text: string, from: number, to: number, outdent: boolean, leaf?: (line: string) => boolean): IndentChange[] {
  const unit = zoneIndentUnit(text);
  const lo = Math.min(from, to), hi = Math.max(from, to);
  const out: IndentChange[] = [];
  let start = 0;
  let prevLead: number | null = null; // lead (after this edit) of the previous outline line
  let prevLeaf = false;
  for (const line of text.split('\n')) {
    const end = start + line.length;
    const blank = !line.trim();
    let lead = leadOf(line);
    if (end >= lo && start <= hi && !blank) {
      if (outdent) {
        const cut = Math.min(unit, lead);
        if (cut) { out.push({ from: start, to: start + cut, insert: '' }); lead -= cut; }
      } else if (prevLead != null) {
        const target = Math.min(lead + unit, prevLead + (prevLeaf ? 0 : unit));
        if (target > lead) { out.push({ from: start, to: start, insert: ' '.repeat(target - lead) }); lead = target; }
      }
    }
    if (!blank) { prevLead = lead; prevLeaf = !!leaf?.(line); }
    start = end + 1;
  }
  return out;
}

/** Key handler: the built-in zone edit; always handled so focus stays in the zone. */
export function zoneTab(outdent: boolean) {
  return (v: EditorView): boolean => {
    const sel = v.state.selection.main;
    const changes = zoneIndentChanges(v.state.doc.toString(), sel.from, sel.to, outdent);
    if (changes.length) v.dispatch({ changes, scrollIntoView: true, userEvent: outdent ? 'delete.dedent' : 'input.indent' });
    return true;
  };
}

const lineLead = (text: string, at: number): { lead: number; prev: { lead: number; text: string } | null } => {
  const ls = text.lastIndexOf('\n', at - 1) + 1;
  const le = text.indexOf('\n', ls);
  const line = text.slice(ls, le < 0 ? text.length : le);
  let prev: { lead: number; text: string } | null = null;
  let p = ls - 1;
  while (p > 0) {
    const ps = text.lastIndexOf('\n', p - 1) + 1;
    const t = text.slice(ps, p);
    if (t.trim()) { prev = { lead: leadOf(t), text: t }; break; }
    p = ps - 1;
  }
  return { lead: leadOf(line), prev };
};

/**
 * 0.4.13: does a host's Tab edit break the tree? `before` / `after` are the whole text, `from`
 * the first touched line. Broken when a line that is already a child of the line above goes
 * deeper (more than one level under its parent), or a line lands under a `leaf` line.
 */
export function indentBreaksTree(before: string, after: string, from: number, to: number, leaf: (line: string) => boolean): boolean {
  const was = lineLead(before, from);
  const now = lineLead(after, from);
  if (now.lead > was.lead && was.prev && was.lead > was.prev.lead) return true;
  // Every touched line in the new text: its parent (nearest shallower line above) is no leaf.
  const lines = after.split('\n');
  let start = 0;
  const stack: { lead: number; text: string }[] = [];
  for (const line of lines) {
    const end = start + line.length;
    if (line.trim()) {
      const lead = leadOf(line);
      while (stack.length && stack[stack.length - 1]!.lead >= lead) stack.pop();
      if (end >= from && start <= to && stack.length && leaf(stack[stack.length - 1]!.text)) return true;
      stack.push({ lead, text: line });
    }
    if (start > to) break;
    start = end + 1;
  }
  return false;
}
