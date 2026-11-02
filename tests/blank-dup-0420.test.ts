// 0.4.20: a Map commitView of a view parsed with session ids must not duplicate a blank
// `- ` line. Invented data. parse() used to drop that line, so mergeKeeping inserted
// the view's serialised copy beside the original on every tick or fold.
import { it, expect } from 'vitest';
import { parse, nextAutoId, peelTrailingSections, toggleFold, type OutlineNode } from '../src/index.js';
// @ts-ignore host copy of Audroam's outlineFoldHost
import { mountOutlineFold } from './_host.mjs';

const START = '- node 4\n  - [ ] Blank nodes\n    - before 1 blank node\n    - \n    - Duplicates insert\n';

function idTags(line: string): string[] {
  return [...line.matchAll(/<\s*id\s*:\s*([A-Za-z0-9][A-Za-z0-9_-]*)\s*>/g)].map((m) => m[1]!);
}

/** Same mint the outline-view host uses so a blank `- ` line becomes an empty-title node. */
function mintIds(text: string): { text: string; ids: Set<string> } {
  const raw = text.replace(/\s+$/, '');
  const peeled = peelTrailingSections(raw);
  const lines = String(peeled.outline).split(/\r?\n/);
  const used = new Set<string>();
  const minted = new Set<string>();
  for (const line of lines) for (const id of idTags(line)) used.add(id);
  for (const id of Object.keys(peeled.payloads || {})) used.add(id);
  for (const id of Object.keys(peeled.layouts || {})) used.add(id);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.trim() || idTags(lines[i]!).length) continue;
    const fresh = nextAutoId(used, '');
    minted.add(fresh);
    const tag = '<id:' + fresh + '>';
    lines[i] = /\(\+\)\s*$/.test(lines[i]!)
      ? lines[i]!.replace(/\s*\(\+\)\s*$/, ' ' + tag + ' (+)')
      : lines[i]!.replace(/\s*$/, '') + ' ' + tag;
  }
  return { text: lines.join('\n') + raw.slice(peeled.outline.length), ids: minted };
}

function markSession(nodes: OutlineNode[] | undefined, ids: Set<string>): void {
  for (const n of nodes || []) {
    if (n.id && ids.has(n.id)) n.autoId = true;
    if (n.children) markSession(n.children, ids);
  }
}

function findTitle(nodes: OutlineNode[] | undefined, title: string): OutlineNode | null {
  for (const n of nodes || []) {
    if (n.title === title) return n;
    const hit = findTitle(n.children, title);
    if (hit) return hit;
  }
  return null;
}

const blankLines = (text: string) => text.split('\n').filter((l) => /^\s*-\s*$/.test(l));

it('ticking or folding a minted view keeps one blank list line', () => {
  const fh = mountOutlineFold({ text: START, debounceMs: 1e9 });
  let text = START;
  for (let k = 0; k < 4; k++) {
    const minted = mintIds(fh.getText());
    const view = parse(minted.text);
    markSession(view.nodes, minted.ids);
    const task = findTitle(view.nodes, 'Blank nodes');
    if (!task?.task || !task.id) throw new Error('missing task');
    task.task = task.task === 'open' ? 'pending' : task.task === 'pending' ? 'done' : 'open';
    fh.markView();
    fh.commitView(view, 'map');
    fh.markView();
    fh.commitView(toggleFold(view, task.id), 'map');
    text = fh.getText();
  }
  expect(blankLines(text)).toEqual(['    - ']);
  expect(text.startsWith('- node 4\n  - [')).toBe(true);
  expect(text).toContain('    - before 1 blank node\n    - \n    - Duplicates insert\n');
});
