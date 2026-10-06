import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parse,
  isCollapsed,
  toggleFold,
  resolveMapFocus,
  autoPackPositions,
} from '../src/index.js';

const md = readFileSync(
  join(__dirname, '../examples/aust-gov-cyber/aust-gov-cyber.md'),
  'utf8',
);

describe('resolveMapFocus (Map L→R orientation)', () => {
  const doc = parse(md);
  const packed = autoPackPositions(doc, {
    isNodeCollapsed: (id) => isCollapsed(doc, id),
  });
  const opts = {
    isNodeCollapsed: (id: string) => isCollapsed(doc, id),
    positions: packed.nodes,
  };

  it('↓/↑ move among siblings only — never enter children on Down', () => {
    // e8 expanded; next sibling of e8 is pspf (not e8-1)
    expect(resolveMapFocus(doc, 'e8', 'down', opts)).toBe('pspf');
    expect(resolveMapFocus(doc, 'e8', 'up', opts)).toBe('ism');
    expect(resolveMapFocus(doc, 'e8-1', 'down', opts)).toBe('e8-2');
    expect(resolveMapFocus(doc, 'e8-2', 'up', opts)).toBe('e8-1');
  });

  it('soft no-op on last-sibling ↓ and first-sibling ↑', () => {
    // under root: last L1 is hyg (approx) — find last sibling of e8 set
    const lastOfE8 = resolveMapFocus(doc, 'e8-1', 'end', opts);
    expect(lastOfE8).toBeTruthy();
    expect(resolveMapFocus(doc, lastOfE8!, 'down', opts)).toBeNull();
    expect(resolveMapFocus(doc, 'e8-1', 'up', opts)).toBeNull();
  });

  it('→ enters first visible child when expanded; soft no-op when collapsed', () => {
    expect(resolveMapFocus(doc, 'e8', 'right', opts)).toBe('e8-1');
    expect(resolveMapFocus(doc, 'e8-1', 'right', opts)).toBeNull(); // leaf

    const collapsed = toggleFold(doc, 'e8');
    expect(isCollapsed(collapsed, 'e8')).toBe(true);
    expect(
      resolveMapFocus(collapsed, 'e8', 'right', {
        isNodeCollapsed: (id) => isCollapsed(collapsed, id),
      }),
    ).toBeNull();
  });

  it('← goes to parent only — never implies fold', () => {
    expect(resolveMapFocus(doc, 'e8-1', 'left', opts)).toBe('e8');
    expect(resolveMapFocus(doc, 'root', 'left', opts)).toBeNull();
    // Expanded parent ← still climbs (parent of e8 is root), does not collapse
    expect(resolveMapFocus(doc, 'e8', 'left', opts)).toBe('root');
  });

  it('Home/End are first/last sibling under same parent', () => {
    expect(resolveMapFocus(doc, 'e8-5', 'home', opts)).toBe('e8-1');
    expect(resolveMapFocus(doc, 'e8-5', 'end', opts)).toBe(
      resolveMapFocus(doc, 'e8-1', 'end', opts),
    );
    // Forest / under root: siblings of e8
    expect(resolveMapFocus(doc, 'e8', 'home', opts)).toBe('ism');
  });
});
