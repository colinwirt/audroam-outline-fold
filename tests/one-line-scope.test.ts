/** 0.2.42: 1 line siblings / 1 line: all at this level are state on every pill in scope. */
import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse.js';
import {
  W_AUTO_SINGLE_LINE,
  WIDTH_MENU_KEYS,
  isOneLineScopeKind,
  levelScope,
  oneLineEntry,
  widthMenuKeyItem,
  widthPickAnnouncement,
} from '../src/mapFit.js';
import * as pkg from '../src/index.js';

describe('oneLineEntry for a scope pick', () => {
  it('a short pill (already one line at Auto) still gets the single-line state', () => {
    expect(oneLineEntry({ natural: 80, auto: 200, cap: 900 })).toEqual({ w: null, wAuto: null, capped: false });
    const e = oneLineEntry({ natural: 80, auto: 200, cap: 900 }, { always: true });
    expect(e.wAuto).toBe(W_AUTO_SINGLE_LINE);
    expect(e.w).toBeGreaterThan(0);
  });
  it('siblings and level are scope kinds; line is not', () => {
    expect(isOneLineScopeKind('siblings')).toBe(true);
    expect(isOneLineScopeKind('level')).toBe(true);
    expect(isOneLineScopeKind('line')).toBe(false);
  });
});

describe('levelScope: same depth across the whole outline', () => {
  const doc = parse(['- R <id:r>', '  - A <id:a>', '    - A1 <id:a1>', '    - A2 <id:a2>', '  - B <id:b>', '    - B1 <id:b1>', '      - B1x <id:b1x>', '- S <id:s>', '  - C <id:c>', '    - C1 <id:c1>', ''].join('\n'));
  const ids = (list: { id?: string }[]) => list.map((n) => n.id);
  const find = (id: string) => {
    let hit: any = null;
    const walk = (l: any[]) => l.forEach((n) => { if (n.id === id) hit = n; if (n.children) walk(n.children); });
    walk(doc.nodes);
    return hit;
  };
  it('cousins under other parents and other roots, pressed first', () => {
    expect(ids(levelScope(find('a2'), doc.nodes))).toEqual(['a2', 'a1', 'b1', 'c1']);
    expect(ids(levelScope(find('b'), doc.nodes))).toEqual(['b', 'a', 'c']);
    expect(ids(levelScope(find('r'), doc.nodes))).toEqual(['r', 's']);
    expect(ids(levelScope(find('b1x'), doc.nodes))).toEqual(['b1x']);
  });
  it('a node not in the outline is its own scope', () => {
    const lone = { id: 'z' };
    expect(levelScope(lone as any, doc.nodes)).toEqual([lone]);
  });
});

describe('menu wiring', () => {
  it('label, key and announcement', () => {
    expect(WIDTH_MENU_KEYS.level).toBe('v');
    expect(widthMenuKeyItem('v')).toBe('level');
    expect(widthPickAnnouncement('level', { title: 'A1', count: 4 })).toBe('A1 and 3 other pills at this level on 1 line.');
    expect(pkg.levelScope).toBe(levelScope);
  });
});
