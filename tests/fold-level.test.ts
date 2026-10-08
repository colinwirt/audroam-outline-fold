import { describe, expect, it } from 'vitest';
import {
  currentFoldLevel,
  foldChangeCount,
  foldLevelAnnouncement,
  foldLevelNeedsConfirm,
  foldLevelPicker,
  foldLevelSkipsAnimation,
  parse,
  setExpandLevel,
  toggleFold,
  wholeMapAnnouncement,
  LEVEL_ALL_CONFIRM_NODES,
  LEVEL_NO_FLIP_CHANGES,
} from '../src/index.js';

// Fold-to-level picker model (Design UX 2026-10-06, L3, L13, L14, L16). Fiction only.

const LOG = `- Harbour log <id:root>
  - Monday <id:mon>
    - Tide tables <id:tide>
      - High water <id:hw>
      - Low water <id:lw>
    - Lamp check <id:lamp>
  - Tuesday <id:tue>
    - Storm shutters <id:storm>
  - Notes <id:notes>
`;

const byKey = (p: NonNullable<ReturnType<typeof foldLevelPicker>>) =>
  Object.fromEntries(p.items.map((i) => [String(i.key), i]));

describe('foldLevelPicker items (L3)', () => {
  it('lists Fold, 1, 2, 3, All with their key hints', () => {
    const p = foldLevelPicker(parse(LOG), 'root')!;
    expect(p.items.map((i) => i.label)).toEqual(['Fold', '1', '2', '3', 'All']);
    expect(p.items.map((i) => i.hint)).toEqual(['0', '1', '2', '3', '*']);
    expect(p.total).toBe(8);
    expect(p.height).toBe(3);
  });

  it('counts what each level shows and hides, below the pressed node', () => {
    const k = byKey(foldLevelPicker(parse(LOG), 'root')!);
    expect([k['0'].shown, k['0'].hidden]).toEqual([0, 8]);
    expect([k['1'].shown, k['1'].hidden]).toEqual([3, 5]);
    expect([k['2'].shown, k['2'].hidden]).toEqual([6, 2]);
    expect([k['3'].shown, k['3'].hidden]).toEqual([8, 0]);
    expect([k['*'].shown, k['*'].hidden]).toEqual([8, 0]);
  });

  it('marks a level equal to the subtree height as same as All, deeper ones disabled', () => {
    const k = byKey(foldLevelPicker(parse(LOG), 'mon')!); // Monday: 2 levels below
    expect(k['1'].disabled).toBe(false);
    expect(k['2'].sameAsAll).toBe(true);
    expect(k['2'].disabled).toBe(false);
    expect(k['3'].disabled).toBe(true);
    expect(k['0'].disabled || k['*'].disabled).toBe(false);
  });

  it('returns null for a leaf or a missing id', () => {
    expect(foldLevelPicker(parse(LOG), 'notes')).toBeNull();
    expect(foldLevelPicker(parse(LOG), 'nope')).toBeNull();
  });

  it('each item matches setExpandLevel(doc, n, { under }) (the 0 1 2 3 * keys)', () => {
    const doc = parse(LOG);
    for (const it of foldLevelPicker(doc, 'root')!.items) {
      const applied = setExpandLevel(doc, it.key, { under: 'root' });
      expect(foldLevelPicker(applied, 'root')!.items.find((i) => i.checked)!.shown).toBe(it.shown);
    }
  });
});

describe('current level (L2)', () => {
  it('marks All on a fully open subtree, not the equal numbered level', () => {
    expect(currentFoldLevel(parse(LOG), 'root')).toBe('*');
    expect(currentFoldLevel(parse(LOG), 'mon')).toBe('*');
  });

  it('marks the level just applied, from either handle state', () => {
    const doc = parse(LOG);
    expect(currentFoldLevel(setExpandLevel(doc, 1, { under: 'root' }), 'root')).toBe(1);
    expect(currentFoldLevel(setExpandLevel(doc, 0, { under: 'root' }), 'root')).toBe(0);
    expect(currentFoldLevel(setExpandLevel(doc, 2, { under: 'root' }), 'root')).toBe(2);
  });

  it('marks nothing when the subtree matches no level', () => {
    const mixed = toggleFold(setExpandLevel(parse(LOG), 1, { under: 'root' }), 'mon');
    expect(currentFoldLevel(mixed, 'root')).toBeNull();
    expect(foldLevelPicker(mixed, 'root')!.items.some((i) => i.checked)).toBe(false);
  });

  it('ignores remembered states hidden under a fold (only what shows counts)', () => {
    // Root folded; Monday stays open underneath. Still reads as Fold.
    const doc = toggleFold(parse(LOG), 'root');
    expect(currentFoldLevel(doc, 'root')).toBe(0);
  });
});

describe('guard rails (L14)', () => {
  it('asks before All only above the node limit', () => {
    const small = foldLevelPicker(parse(LOG), 'root')!;
    expect(foldLevelNeedsConfirm(small, '*')).toBe(false);
    const lines = ['- Archive <id:a>'];
    for (let i = 0; i <= LEVEL_ALL_CONFIRM_NODES; i++) lines.push(`  - Entry ${i} <id:e${i}>`);
    const big = foldLevelPicker(parse(lines.join('\n') + '\n'), 'a')!;
    expect(big.total).toBe(LEVEL_ALL_CONFIRM_NODES + 1);
    expect(foldLevelNeedsConfirm(big, '*')).toBe(true);
    expect(foldLevelNeedsConfirm(big, 1)).toBe(false);
  });

  it('counts fold changes and skips the animation above the limit', () => {
    const doc = parse(LOG);
    const folded = setExpandLevel(doc, 0, { under: 'root' });
    expect(foldChangeCount(doc, folded)).toBe(4); // root, mon, tide, tue
    expect(foldLevelSkipsAnimation(doc, folded)).toBe(false);
    const lines = ['- Shelf <id:s>'];
    for (let i = 0; i <= LEVEL_NO_FLIP_CHANGES; i++) lines.push(`  - Box ${i} <id:b${i}>`, `    - Item <id:i${i}>`);
    const big = parse(lines.join('\n') + '\n');
    expect(foldLevelSkipsAnimation(big, setExpandLevel(big, 1, { under: 's' }))).toBe(true);
  });
});

describe('live text (L13)', () => {
  it('says the level and how many items are hidden', () => {
    const doc = parse(LOG);
    const p = foldLevelPicker(doc, 'root')!;
    expect(foldLevelAnnouncement(p, 1)).toBe('Harbour log folded to level 1. 5 items hidden.');
    expect(foldLevelAnnouncement(p, 0)).toBe('Harbour log folded. 8 items hidden.');
    expect(foldLevelAnnouncement(p, '*')).toBe('Harbour log open to all levels. 8 shown.');
    const q = foldLevelPicker(doc, 'tide')!;
    expect(foldLevelAnnouncement(q, 0)).toBe('Tide tables folded. 2 items hidden.');
  });

  it('says the whole-map level and the shown count', () => {
    const doc = setExpandLevel(parse(LOG), 2);
    expect(wholeMapAnnouncement(doc, 2)).toBe('Whole map at level 2. 4 of 9 shown.');
  });
});
