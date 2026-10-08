import { describe, expect, it } from 'vitest';
import {
  hasSavedFold,
  isCollapsed,
  parse,
  seedColdStartFold,
  seedDefaultFold,
  serialize,
  setExpandLevel,
  toggleFold,
} from '../src/index.js';
import type { OutlineFoldDoc, OutlineNode } from '../src/types.js';

// Fold to level L11/L12/L15 P1 (level-1 first view) and L16 (a level resets the
// subtree). Design UX 2026-10-06, amended 2026-10-08. Fiction only.

const PLAIN = `- Harbour log <id:root>
  - Monday <id:mon>
    - Tide tables <id:tide>
      - High water <id:hw>
        - Spring tide <id:sp>
      - Low water <id:lw>
    - Lamp check <id:lamp>
  - Tuesday <id:tue>
    - Storm shutters <id:storm>
      - North window <id:north>
  - Notes <id:notes>
`;

const NO_IDS = `- Harbour log
  - Monday
    - Tide tables
      - High water
  - Tuesday
    - Storm shutters
`;

function shown(doc: OutlineFoldDoc): string[] {
  const out: string[] = [];
  const walk = (nodes: OutlineNode[]) => {
    for (const n of nodes) {
      out.push(n.title);
      if (n.children?.length && !(n.id && isCollapsed(doc, n.id))) walk(n.children);
    }
  };
  walk(doc.nodes);
  return out;
}

describe('hasSavedFold', () => {
  it('is false for a body with no markers and no fold list', () => {
    expect(hasSavedFold(parse(PLAIN))).toBe(false);
    expect(hasSavedFold(parse(NO_IDS, { sessionIds: true }))).toBe(false);
  });

  it('is true for a (+) marker, with or without an id on that line', () => {
    expect(hasSavedFold(parse(PLAIN.replace('Tuesday <id:tue>', 'Tuesday <id:tue> (+)')))).toBe(true);
    expect(hasSavedFold(parse(NO_IDS.replace('- Tuesday', '- Tuesday (+)'), { sessionIds: true }))).toBe(true);
  });

  it('is true for a fold- or fold+ id list, and for fold+ mode', () => {
    expect(hasSavedFold(parse('---\nfold-: tue\n---\n' + PLAIN))).toBe(true);
    expect(hasSavedFold(parse('---\nfold+: mon\n---\n' + PLAIN))).toBe(true);
    expect(hasSavedFold(parse('---\nfold+:\n---\n' + PLAIN))).toBe(true);
  });

  it('treats an empty fold- line as no saved state (it parses like none)', () => {
    expect(hasSavedFold(parse('---\nfold-:\n---\n' + PLAIN))).toBe(false);
  });
});

describe('seedDefaultFold (L11 default: level 1)', () => {
  it('opens each root and its children, nothing deeper', () => {
    const seeded = seedDefaultFold(parse(PLAIN));
    expect(shown(seeded)).toEqual(['Harbour log', 'Monday', 'Tuesday', 'Notes']);
    expect([...seeded.fold.ids].sort()).toEqual(['hw', 'mon', 'storm', 'tide', 'tue'].sort());
    expect(seeded).toEqual(setExpandLevel(parse(PLAIN), 2));
  });

  it('level 1 with several roots applies under each root', () => {
    const forest = PLAIN + '- Garden <id:g>\n  - Beds <id:beds>\n    - Mint <id:mint>\n';
    expect(shown(seedDefaultFold(parse(forest)))).toEqual([
      'Harbour log', 'Monday', 'Tuesday', 'Notes', 'Garden', 'Beds',
    ]);
  });

  it('works on an outline without ids when parsed with session ids', () => {
    const doc = parse(NO_IDS, { sessionIds: true });
    expect(shown(seedDefaultFold(doc))).toEqual(['Harbour log', 'Monday', 'Tuesday']);
  });

  it('leaves a doc with saved fold state untouched (same object)', () => {
    for (const text of [
      PLAIN.replace('Tuesday <id:tue>', 'Tuesday <id:tue> (+)'),
      '---\nfold+: mon\n---\n' + PLAIN,
    ]) {
      const doc = parse(text);
      expect(seedDefaultFold(doc)).toBe(doc);
    }
  });

  it('keeps the older lock rule and all-expanded as alternatives', () => {
    const doc = parse(PLAIN);
    expect(seedDefaultFold(doc, { rule: 'cold-start' })).toEqual(seedColdStartFold(doc));
    expect(seedDefaultFold(doc, { rule: 'cold-start', maxHeight: 3 })).toEqual(seedColdStartFold(doc, { maxHeight: 3 }));
    expect(seedDefaultFold(doc, { rule: 'all' })).toBe(doc);
  });

  it('does not change the input doc', () => {
    const doc = parse(PLAIN);
    const before = JSON.stringify(doc);
    seedDefaultFold(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('serializes the seed as (+) markers, so a host must treat it as view state', () => {
    // The host compares the serialized doc with the stored body. The seed adds
    // (+) markers; see the host note in docs (not a saved change by itself).
    const out = serialize(seedDefaultFold(parse(PLAIN)));
    expect(out).toContain('Monday <id:mon> (+)');
    expect(out).not.toContain('Harbour log <id:root> (+)');
  });
});

describe('L16: picking a level resets the whole subtree', () => {
  it('after 1 on a node with a remembered 3-deep expansion, + on a child shows only its children', () => {
    let doc = parse(PLAIN); // everything open: a remembered deep expansion
    expect(shown(doc)).toContain('Spring tide');
    doc = setExpandLevel(doc, 1, { under: 'mon' });
    expect(shown(doc)).toEqual(['Harbour log', 'Monday', 'Tide tables', 'Lamp check', 'Tuesday', 'Storm shutters', 'North window', 'Notes']);
    doc = toggleFold(doc, 'tide');
    expect(shown(doc)).toEqual([
      'Harbour log', 'Monday', 'Tide tables', 'High water', 'Low water', 'Lamp check',
      'Tuesday', 'Storm shutters', 'North window', 'Notes',
    ]);
    // High water stays folded: its old open state was cleared, not hidden.
    expect(isCollapsed(doc, 'hw')).toBe(true);
  });

  it('Fold (0) folds the node and every node below it', () => {
    const doc = setExpandLevel(parse(PLAIN), 0, { under: 'mon' });
    for (const id of ['mon', 'tide', 'hw']) expect(isCollapsed(doc, id)).toBe(true);
    // Outside the subtree is untouched.
    expect(isCollapsed(doc, 'tue')).toBe(false);
    const reopened = toggleFold(doc, 'mon');
    expect(shown(reopened)).toContain('Tide tables');
    expect(shown(reopened)).not.toContain('High water');
  });

  it('2 opens two levels and folds everything at depth 2 and below', () => {
    const doc = setExpandLevel(parse(PLAIN), 2, { under: 'root' });
    expect(isCollapsed(doc, 'root')).toBe(false);
    expect(isCollapsed(doc, 'mon')).toBe(false);
    for (const id of ['tide', 'hw', 'storm']) expect(isCollapsed(doc, id)).toBe(true);
  });

  it('All opens every node below', () => {
    const folded = setExpandLevel(parse(PLAIN), 0, { under: 'root' });
    const all = setExpandLevel(folded, '*', { under: 'root' });
    for (const id of ['root', 'mon', 'tide', 'hw', 'tue', 'storm']) expect(isCollapsed(all, id)).toBe(false);
  });

  it('the same rule holds with no selection (whole doc) and under fold+', () => {
    const doc = setExpandLevel(parse(PLAIN), 2);
    expect(isCollapsed(toggleFold(doc, 'tide'), 'hw')).toBe(true);
    const plus = setExpandLevel(parse('---\nfold+: root, mon, tide, hw\n---\n' + PLAIN), 1, { under: 'mon' });
    expect(plus.fold.mode).toBe('+');
    expect(isCollapsed(plus, 'mon')).toBe(false);
    expect(isCollapsed(plus, 'tide')).toBe(true);
    expect(isCollapsed(toggleFold(plus, 'tide'), 'hw')).toBe(true);
  });
});
