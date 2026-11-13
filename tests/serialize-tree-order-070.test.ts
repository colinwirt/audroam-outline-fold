/**
 * 0.7.0: mergeKeeping pairs body lines by node identity, which is only safe if
 * serialize always emits nodes in tree (document) pre-order, including blank
 * `- ` nodes at their line-index place. This file locks that contract in with
 * a deterministic sibling-swap case and a seeded property trial.
 */
import { describe, expect, it } from 'vitest';
import {
  parse,
  serialize,
  portableCopy,
  cleanCopy,
  mergeKeeping,
  toggleFold,
  setTask,
  nextTaskCycle,
  type OutlineFoldDoc,
  type OutlineNode,
  type TaskState,
} from '../src/index.js';
// @ts-ignore — test host helper
import { mountOutlineFold } from './_host.mjs';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function preorder(nodes: OutlineNode[] | undefined, out: OutlineNode[] = []): OutlineNode[] {
  for (const n of nodes ?? []) {
    out.push(n);
    preorder(n.children, out);
  }
  return out;
}

/** Clone a doc the same way fold/task helpers do, so tree mutations are isolated. */
function cloneDoc(doc: OutlineFoldDoc): OutlineFoldDoc {
  return {
    frontmatter: doc.frontmatter
      ? { ...doc.frontmatter, foldIds: doc.frontmatter.foldIds ? [...doc.frontmatter.foldIds] : undefined }
      : undefined,
    nodes: structuredClone(doc.nodes),
    fold: { mode: doc.fold.mode, ids: [...doc.fold.ids] },
  };
}

/** Outline body (stops at the first trailing `--- … ---` block). */
function bodyLines(text: string): string[] {
  const lines: string[] = [];
  for (const l of text.split('\n')) {
    if (/^---\s/.test(l)) break;
    lines.push(l);
  }
  return lines;
}

/** Same rule parse uses: a blank list item (`- `, or a lone `-`) is a node; a bare empty line is not. */
function isNodeLine(line: string): boolean {
  if (!line.trim()) return false;
  const trimmedStart = line.trimStart();
  if (/^(?:fold[-+]\s*:|collapsedMarker\s*:|expandedMarker\s*:)/i.test(trimmedStart)) return false;
  if (/^[-*+]\s*$/.test(trimmedStart)) return true;
  const content = trimmedStart.replace(/^[-*+]\s+/, '');
  if (!content.trim() && !/^[-*+]\s+$/.test(trimmedStart)) return false;
  return true;
}

function nodeLines(text: string): string[] {
  return bodyLines(text).filter(isNodeLine);
}

/** Slot sequence of the outline body, trailing empty lines dropped. */
function bodySlots(text: string): Array<'empty' | 'node'> {
  const lines = bodyLines(text);
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  return lines.map((l) => (!l.trim() ? 'empty' : 'node'));
}

function bodyHasLayoutLeak(text: string): boolean {
  return bodyLines(text).some((l) =>
    /^(?:fold[-+]\s*:|collapsedMarker\s*:|expandedMarker\s*:)/i.test(l.trimStart()),
  );
}

/** Structural signature in pre-order: depth, caption, task, authored id, blankness. */
function treeSig(doc: OutlineFoldDoc): string[] {
  return preorder(doc.nodes).map((n) => {
    const authored = n.id && !n.autoId ? n.id : '';
    const blank = !String(n.title ?? '').trim() && !n.task ? 'blank' : 'row';
    return `${n.depth}\0${n.title}\0${n.task ?? ''}\0${authored}\0${blank}`;
  });
}

function parseSession(text: string): OutlineFoldDoc {
  return parse(text, { sessionIds: true });
}

/** serialize / parse round-trip must keep the same pre-order structure. */
function assertPreorder(label: string, doc: OutlineFoldDoc): string {
  const text = serialize(doc);
  expect(portableCopy(doc), `${label}: portableCopy is serialize`).toBe(text);
  if (!doc.keyring && !doc.keys && !preorder(doc.nodes).some((n) => n.sealed)) {
    expect(cleanCopy(doc), `${label}: cleanCopy is serialize when nothing is sealed`).toBe(text);
  }
  const lines = nodeLines(text);
  const nodes = preorder(doc.nodes);
  expect(
    { label, count: lines.length },
    `${label}: one serialized body line per tree node`,
  ).toEqual({ label, count: nodes.length });
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    const line = lines[i]!;
    const indent = '  '.repeat(n.depth);
    expect(line.startsWith(`${indent}- `), `${label}: line ${i} indent is depth ${n.depth}`).toBe(true);
    if (n.id && !n.autoId) {
      expect(line, `${label}: line ${i} keeps <id:${n.id}>`).toContain(`<id:${n.id}>`);
    }
    if (n.task === 'open') expect(line, `${label}: line ${i} open task`).toMatch(/\[\s*\]/);
    else if (n.task === 'pending') expect(line, `${label}: line ${i} pending task`).toContain('[-]');
    else if (n.task === 'done') expect(line, `${label}: line ${i} done task`).toMatch(/\[x\]/i);
    if (!String(n.title ?? '').trim() && !n.task && !n.icon && !n.cloud && !n.img) {
      expect(line, `${label}: line ${i} is a blank-list node`).toMatch(/^\s*-\s+(?:\(\+\)\s*)?$/);
    } else if (String(n.title ?? '').trim()) {
      // Caption (or a glued mid-caption tag) appears on this line, in this tree slot.
      const cap = String(n.title).replace(/\s*<\s*(?:t\s*:\s*\d+|r\s*:\s*[A-Za-z0-9][A-Za-z0-9_-]*)\s*>\s*/gi, ' ').replace(/\s+/g, ' ').trim();
      if (cap) expect(line, `${label}: line ${i} caption`).toContain(cap.split(' ')[0]!);
    }
  }
  const back = parseSession(text);
  expect({ label, sig: treeSig(back) }).toEqual({ label, sig: treeSig(doc) });
  return text;
}

type GenNode = {
  title: string;
  task?: TaskState;
  id?: string;
  fold?: boolean;
  blankAfter?: boolean;
  children: GenNode[];
};

function emitGen(n: GenNode, depth: number, lines: string[]): void {
  const indent = '  '.repeat(depth);
  const lead = n.task ? (n.task === 'done' ? '[x] ' : n.task === 'pending' ? '[-] ' : '[ ] ') : '';
  const id = n.id ? ` <id:${n.id}>` : '';
  const fold = n.fold ? ' (+)' : '';
  lines.push(`${indent}- ${lead}${n.title}${id}${fold}`);
  if (n.blankAfter) lines.push('');
  for (const c of n.children) emitGen(c, depth + 1, lines);
}

function randomOutline(rng: () => number): string {
  let nextId = 1;
  const captions = ['Alpha', 'Beta', '3.92', '4.16', 'Item', 'Notes', 'Same', 'Same'];
  const tagged = (): string => {
    const base = pick(rng, ['3.92', '4.16', 'Row', 'Same']);
    const kind = rng();
    if (kind < 0.25) return `${base}<r:5>`;
    if (kind < 0.45) return `${base} <r:15>`;
    if (kind < 0.55) return `${base} <t:1>`;
    return base;
  };
  const make = (depth: number, remaining: { n: number }): GenNode => {
    remaining.n -= 1;
    const roll = rng();
    let title = tagged();
    let task: TaskState | undefined;
    let fold = false;
    let id: string | undefined;
    if (roll < 0.12 && depth > 0) {
      title = '';
    } else {
      if (rng() < 0.2) title = pick(rng, captions);
      if (rng() < 0.3) task = pick(rng, ['open', 'pending', 'done'] as TaskState[]);
      if (rng() < 0.35) id = String(nextId++);
      if (rng() < 0.25) fold = true;
    }
    const children: GenNode[] = [];
    if (remaining.n > 0 && depth < 4 && rng() < (depth === 0 ? 0.9 : 0.55)) {
      const maxKids = Math.min(4, remaining.n);
      const count = 1 + Math.floor(rng() * maxKids);
      for (let i = 0; i < count && remaining.n > 0; i++) children.push(make(depth + 1, remaining));
    }
    // Guarantee a same-caption sibling pair on some parents, plus a blank child.
    if (depth === 1 && children.length >= 1 && rng() < 0.5) {
      children.push({ title: 'Same', children: [] });
      children.push({ title: 'Same<r:5>', children: [] });
    }
    return { title, task, id, fold, blankAfter: rng() < 0.2, children };
  };
  const remaining = { n: 8 + Math.floor(rng() * 10) };
  const roots: GenNode[] = [];
  // A target for <r:5> jumps so serialize does not need to mint a written id.
  roots.push({ title: 'Target', id: '5', children: [] });
  remaining.n -= 1;
  while (remaining.n > 0) roots.push(make(0, remaining));
  // Colin's charging shape: identical captions, glued + spaced tags, a blank line node.
  roots.push({
    title: 'Charging',
    children: [
      { title: '4.16 <r:15>', children: [] },
      { title: '3.92<r:5>', children: [] },
      { title: '', children: [] },
    ],
  });
  const lines: string[] = [];
  for (const r of roots) emitGen(r, 0, lines);
  if (!lines[lines.length - 1]) lines.push('');
  else lines.push('');
  return lines.join('\n');
}

function parentsWithSiblings(nodes: OutlineNode[], parent: OutlineNode | null = null, out: Array<{ parent: OutlineNode | null; siblings: OutlineNode[] }> = []): typeof out {
  if (nodes.length >= 2) out.push({ parent, siblings: nodes });
  for (const n of nodes) if (n.children?.length) parentsWithSiblings(n.children, n, out);
  return out;
}

function swapSiblings(doc: OutlineFoldDoc, rng: () => number): { doc: OutlineFoldDoc; changed: boolean } {
  const next = cloneDoc(doc);
  const spots = parentsWithSiblings(next.nodes);
  if (!spots.length) return { doc: next, changed: false };
  const spot = pick(rng, spots);
  const i = Math.floor(rng() * spot.siblings.length);
  let j = Math.floor(rng() * spot.siblings.length);
  if (j === i) j = (j + 1) % spot.siblings.length;
  const tmp = spot.siblings[i]!;
  spot.siblings[i] = spot.siblings[j]!;
  spot.siblings[j] = tmp;
  return { doc: next, changed: true };
}

function editCaption(doc: OutlineFoldDoc, rng: () => number): { doc: OutlineFoldDoc; changed: boolean } {
  const next = cloneDoc(doc);
  const rows = preorder(next.nodes).filter((n) => String(n.title ?? '').trim());
  if (!rows.length) return { doc: next, changed: false };
  const n = pick(rng, rows);
  n.title = `${n.title}~`;
  return { doc: next, changed: true };
}

function insertLeaf(doc: OutlineFoldDoc, rng: () => number): { doc: OutlineFoldDoc; changed: boolean } {
  const next = cloneDoc(doc);
  const hosts = preorder(next.nodes);
  const host = pick(rng, hosts);
  const child: OutlineNode = { title: `ins-${Math.floor(rng() * 1000)}`, depth: host.depth + 1 };
  if (!host.children) host.children = [];
  host.children.push(child);
  return { doc: next, changed: true };
}

function deleteLeaf(doc: OutlineFoldDoc): { doc: OutlineFoldDoc; changed: boolean; removed: number } {
  const next = cloneDoc(doc);
  const walk = (list: OutlineNode[]): boolean => {
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i]!;
      if (n.children?.length) {
        if (walk(n.children)) return true;
      } else if (list.length > 1 || next.nodes !== list) {
        // Never delete the last remaining root; prefer a leaf.
        list.splice(i, 1);
        return true;
      }
    }
    return false;
  };
  const changed = walk(next.nodes);
  return { doc: next, changed, removed: changed ? 1 : 0 };
}

type OpKind = 'fold' | 'task' | 'edit' | 'reorder' | 'insert' | 'delete';

function applyOp(doc: OutlineFoldDoc, rng: () => number): { doc: OutlineFoldDoc; kind: OpKind; delta: number } {
  const kind = pick(rng, ['fold', 'task', 'edit', 'reorder', 'insert', 'delete'] as OpKind[]);
  if (kind === 'fold') {
    const ids = preorder(doc.nodes).map((n) => n.id).filter((id): id is string => !!id);
    if (!ids.length) return { doc, kind, delta: 0 };
    return { doc: toggleFold(doc, pick(rng, ids)), kind, delta: 0 };
  }
  if (kind === 'task') {
    const rows = preorder(doc.nodes).filter((n) => n.id && String(n.title ?? '').trim());
    if (!rows.length) return { doc, kind, delta: 0 };
    const n = pick(rng, rows);
    const from = n.task ?? null;
    // Simulate focus-in: include none only when the node had no check at the start of this press cycle.
    const includeNone = from === null || rng() < 0.5;
    const to = nextTaskCycle(from, includeNone);
    const r = setTask(doc, n.id!, to);
    return { doc: r?.doc ?? doc, kind, delta: 0 };
  }
  if (kind === 'edit') {
    const r = editCaption(doc, rng);
    return { doc: r.doc, kind, delta: 0 };
  }
  if (kind === 'reorder') {
    const r = swapSiblings(doc, rng);
    return { doc: r.doc, kind, delta: 0 };
  }
  if (kind === 'insert') {
    const r = insertLeaf(doc, rng);
    return { doc: r.doc, kind, delta: r.changed ? 1 : 0 };
  }
  const r = deleteLeaf(doc);
  return { doc: r.doc, kind, delta: r.changed ? -r.removed : 0 };
}

describe('serialize emits nodes in tree pre-order', () => {
  const CHARGING = [
    '- Charging <cloud>',
    '  - 4.16 <r:15>',
    '  - 3.92<r:5>',
    '  - ',
    '',
  ].join('\n');

  it('writes body lines as a pre-order walk, keeping a blank `- ` node in place', () => {
    const doc = parseSession(CHARGING);
    const text = assertPreorder('charging', doc);
    expect(nodeLines(text)).toEqual([
      '- Charging <cloud>',
      '  - 4.16 <r:15>',
      '  - 3.92<r:5>',
      '  - ',
    ]);
  });

  it('a last-line blank `- ` stays a blank node, not a caption of "-"', () => {
    for (const src of [
      '- Root\n  - \n',
      '- Root\n  -\n',
      '- Root\n  - \n\n--- layout ---\nfold-: \n---\n',
    ]) {
      const doc = parseSession(src);
      const blank = doc.nodes[0]!.children?.[0];
      expect({ src, title: blank?.title, depth: blank?.depth }).toEqual({
        src,
        title: '',
        depth: 1,
      });
      const text = assertPreorder(`last-blank:${JSON.stringify(src)}`, doc);
      expect(nodeLines(text)).toEqual(['- Root', '  - ']);
      const folded = toggleFold(doc, blank!.id!);
      const merged = mergeKeeping(src, serialize(parseSession(src)), serialize(folded));
      expect(nodeLines(merged).some((l) => /\s-\s*-\s*(\(\+\))?\s*$/.test(l))).toBe(false);
      expect(merged).toMatch(/  -  \(\+\)/);
    }
  });

  it('folding an authored id does not leak fold-: into the body (layout stays a trailer)', () => {
    const prev = ['- Target <id:5>', '- Keep <id:1> (+)', '  - child', ''].join('\n');
    const doc = parseSession(prev);
    const nextDoc = toggleFold(doc, '5');
    const norm = serialize(parseSession(prev));
    const next = serialize(nextDoc);
    const merged = mergeKeeping(prev, norm, next);
    expect(bodyHasLayoutLeak(merged)).toBe(false);
    expect(merged).toContain('- Target <id:5> (+)');
    expect(merged).toMatch(/---\s*layout\s*---/);
    expect(parseSession(merged).nodes.map((n) => n.title)).toEqual(['Target', 'Keep']);
  });

  it('deleting a folded session-id node does not leak fold-: or a session id into the body', () => {
    const prev = ['- Root <id:r> (+)', '  - Keep <id:k> (+)', '  - ', ''].join('\n');
    const doc = parseSession(prev);
    const blank = doc.nodes[0]!.children!.find((n) => !String(n.title ?? '').trim());
    if (!blank?.id) throw new Error('missing blank');
    const folded = toggleFold(doc, blank.id); // may already be folded; toggle twice-safe below
    // Ensure the blank is collapsed, then drop it, leaving a stale fold id in memory.
    const live = cloneDoc(folded);
    const still = live.nodes[0]!.children!;
    const i = still.findIndex((n) => !String(n.title ?? '').trim());
    const gone = still.splice(i, 1)[0]!;
    if (gone.id && !live.fold.ids.includes(gone.id)) live.fold.ids.push(gone.id);
    const next = assertPreorder('delete-folded-blank', live);
    expect(next).not.toMatch(/__tmp-|__sid-/);
    expect(bodyHasLayoutLeak(next)).toBe(false);
    const merged = mergeKeeping(prev, serialize(parseSession(prev)), next);
    expect(nodeLines(merged)).toEqual(nodeLines(next));
    expect(bodyHasLayoutLeak(merged)).toBe(false);
    expect(parseSession(merged).nodes[0]!.children!.map((n) => n.title)).toEqual(['Keep']);
  });

  it('sibling swap is written in the new tree order; blank node stays in its slot; merge adds no copy', () => {
    const prev = [
      '- Root <id:r>',
      '  - A <id:a>',
      '  - ',
      '  - B <id:b>',
      '  - 3.92<r:5>',
      '  - 3.92 <r:5>',
      '',
    ].join('\n');
    const doc = parseSession(prev);
    const kids = doc.nodes[0]!.children!;
    expect(kids).toHaveLength(5);
    // Swap first and third (A and B); the blank node between them stays in slot 1.
    const tmp = kids[0]!;
    kids[0] = kids[2]!;
    kids[2] = tmp;
    const next = assertPreorder('swap', doc);
    expect(nodeLines(next)).toEqual([
      '- Root <id:r>',
      '  - B <id:b>',
      '  - ',
      '  - A <id:a>',
      '  - 3.92<r:5>',
      '  - 3.92 <r:5>',
    ]);
    const norm = serialize(parseSession(prev));
    const merged = mergeKeeping(prev, norm, next);
    expect(nodeLines(merged)).toEqual(nodeLines(next));
    expect(merged.split('\n').filter((l) => /^\s*-\s*$/.test(l))).toEqual(['  - ']);
    expect(merged).toContain('  - 3.92<r:5>\n');
    expect(merged).toContain('  - 3.92 <r:5>\n');
  });

  it('sealed-inner serialize (the snapshot path) is the same pre-order walk', () => {
    // sealedBranch.snapshot / innerText call serialize({ nodes, fold }) after
    // shifting the branch children to depth 0. No ciphertext needed to check order.
    const inner = [
      '- first <id:f>',
      '  - child',
      '- second',
      '  - ',
      '  - last <id:l>',
      '',
    ].join('\n');
    const doc = parse(inner);
    expect(doc.nodes.map((n) => n.depth)).toEqual([0, 0]);
    assertPreorder('sealed-inner', doc);
  });

  it('commitView fold / task cycle keeps body line count and blank slots', () => {
    const fh = mountOutlineFold({ text: CHARGING, debounceMs: 1e9 });
    const before = fh.getText();
    const view = parseSession(before);
    const glued = preorder(view.nodes).find((n) => String(n.title).includes('3.92'));
    if (!glued?.id) throw new Error('missing 3.92');
    fh.markView();
    expect(fh.commitView(toggleFold(view, glued.id), 'map')).toBe(true);
    const folded = fh.getText();
    expect(bodySlots(folded)).toEqual(bodySlots(before));
    expect(nodeLines(folded).length).toBe(nodeLines(before).length);
    expect(folded).toContain('  - 3.92<r:5> (+)\n');

    const view2 = parseSession(folded);
    const row = preorder(view2.nodes).find((n) => String(n.title).includes('4.16'));
    if (!row?.id) throw new Error('missing 4.16');
    const cycled = setTask(view2, row.id, nextTaskCycle(row.task ?? null, true));
    fh.markView();
    expect(fh.commitView(cycled!.doc, 'map')).toBe(true);
    const after = fh.getText();
    expect(bodySlots(after)).toEqual(bodySlots(before));
    expect(nodeLines(after).length).toBe(nodeLines(before).length);
    expect(after).toContain('  - [ ] 4.16 <r:15>');
    expect(after.split('\n').filter((l) => /^\s*-\s*$/.test(l) || /^\s*-\s+\(\+\)\s*$/.test(l)).length).toBe(1);
  });

  it('seeded random Map ops keep serialize in pre-order and mergeKeeping line counts honest', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => (i + 1) * 104729);
    for (const seed of seeds) {
      const rng = mulberry32(seed);
      const prev0 = randomOutline(rng);
      let live = parseSession(prev0);
      let prevText = prev0;
      assertPreorder(`seed ${seed} start`, live);
      let count = preorder(live.nodes).length;
      for (let step = 0; step < 12; step++) {
        const beforeCount = count;
        const beforeSlots = bodySlots(prevText);
        const { doc, kind, delta } = applyOp(live, rng);
        live = doc;
        count = preorder(live.nodes).length;
        expect({ seed, step, kind, count }).toEqual({ seed, step, kind, count: beforeCount + delta });
        const next = assertPreorder(`seed ${seed} step ${step} ${kind}`, live);
        const norm = serialize(parseSession(prevText));
        const merged = mergeKeeping(prevText, norm, next);
        expect(
          { seed, step, kind, nodes: nodeLines(merged).length },
        ).toEqual({ seed, step, kind, nodes: count });
        // Pure in-place ops (fold, task, caption edit) must not add or drop body
        // lines or move blank (non-node) lines. Reorder / insert / delete may.
        if (kind === 'fold' || kind === 'task' || kind === 'edit') {
          expect({ seed, step, kind, slots: bodySlots(merged) }).toEqual({
            seed,
            step,
            kind,
            slots: beforeSlots,
          });
          expect({ seed, step, kind, nodes: nodeLines(merged).length }).toEqual({
            seed,
            step,
            kind,
            nodes: beforeCount,
          });
        }
        // Re-parse the merged text and confirm it still matches the tree.
        {
          const mergedDoc = parseSession(merged);
          // After merge, structure (depth/title/task/authored id) matches live,
          // even when prev had typographic differences serialize would normalise.
          expect({ seed, step, kind, sig: treeSig(mergedDoc) }).toEqual({
            seed,
            step,
            kind,
            sig: treeSig(live),
          });
        }
        prevText = merged;
        live = parseSession(prevText);
      }
    }
  });
});
