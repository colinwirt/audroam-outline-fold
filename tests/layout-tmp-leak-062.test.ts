/**
 * 0.6.2: session `__tmp-` ids must never land in the saved layout block.
 * Colin: after restyling, layout filled with repeated `__tmp-3:` / `__tmp-4:`
 * `icon: ⭐` entries while `5:` kept only its old icon and could not be restyled.
 *
 * Parser note: KEY_LINE requires a leading alphanumeric, so `__tmp-N:` does not
 * re-attach on parse (orphan lines). Duplicate id keys: last-key-wins (object overwrite).
 */
import { describe, expect, it } from 'vitest';
import { parse, serialize, parseLayoutBlock, formatLayoutBlock, collectLayouts, assignPersistentId, isSessionId } from '../src/index.js';

const COLIN_LAYOUT = [
  '- Readings <id:1>',
  '  - Paper <id:3>',
  '    - collection <id:4>',
  '      - MITRE https://www.mitre.org/capabilities/cybersecurity/threat-based-defense <id:5>',
  '',
  '--- layout ---',
  'fold-:',
  'collapsedMarker: "(+)"',
  '5:',
  '  icon: ⭐',
  '__tmp-3:',
  '  icon: ⭐',
  '__tmp-4:',
  '  icon: ⭐',
  '__tmp-3:',
  '  icon: ⭐',
  '__tmp-4:',
  '  icon: ⭐',
  '__tmp-3:',
  '  icon: ⭐',
  '---',
  '',
].join('\n');

function findById(nodes: any[], id: string): any | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const hit = findById(n.children, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

describe('0.6.2 layout never serializes __tmp- ids', () => {
  it('reports: duplicate layout keys merge; later fields win (last-key-wins per field)', () => {
    const { layouts } = parseLayoutBlock([
      '5:',
      '  icon: old',
      '5:',
      '  icon: new',
      '  colour: moss',
    ].join('\n'));
    // Same key twice: later icon/colour overlay the earlier entry.
    expect(layouts['5']).toEqual({ icon: 'new', color: 'moss', colorKey: 'colour' });
  });

  it('parse drops __tmp- layout keys (they do not match KEY_LINE / must not attach)', () => {
    const d = parse(COLIN_LAYOUT);
    const mitre = findById(d.nodes, '5')!;
    expect(mitre).toBeTruthy();
    expect(mitre.icon).toBe('⭐'); // from 5:
    // Session keys must not appear in the parsed layout map
    const { layouts } = parseLayoutBlock(
      COLIN_LAYOUT.slice(COLIN_LAYOUT.indexOf('--- layout ---')),
    );
    expect(Object.keys(layouts).some((k) => k.startsWith('__tmp-'))).toBe(false);
    expect(layouts['5']?.icon).toBe('⭐');
  });

  it('FAILING: icon on a session-id node serializes under a real id, never __tmp-', () => {
    const d = parse('- A <id:1>\n- B\n', { sessionIds: true });
    const b = d.nodes[1]!;
    expect(isSessionId(b.id!)).toBe(true);
    // Mimic a write that set layout.icon without minting first (host / older path).
    b.icon = '⭐';
    b.layout = { ...(b.layout || {}), icon: '⭐' };
    const text = serialize(d);
    expect(text).not.toMatch(/__tmp-/);
    expect(text).toMatch(/\n\d+:\n {2}icon: ⭐\n/);
    expect(b.id && !isSessionId(b.id)).toBe(true);
    expect(text).toContain(`- B <id:${b.id}>`);
  });

  it('FAILING: colour / noFill on a session-id node also mint (not only width)', () => {
    const d = parse('- A\n- B\n', { sessionIds: true });
    const a = d.nodes[0]!;
    a.color = 'moss';
    a.layout = { color: 'moss', colorKey: 'colour' };
    const text = serialize(d);
    expect(text).not.toMatch(/__tmp-/);
    expect(text).toMatch(/\n\d+:\n {2}colour: moss\n/);

    const d2 = parse('- A\n', { sessionIds: true });
    const n = d2.nodes[0]!;
    n.noFill = true;
    n.layout = { noFill: true };
    const t2 = serialize(d2);
    expect(t2).not.toMatch(/__tmp-/);
    expect(t2).toMatch(/\n\d+:\n {2}fill: none\n/);
  });

  it('FAILING: collectLayouts never emits session ids even if node still has one', () => {
    const d = parse('- A\n', { sessionIds: true });
    const a = d.nodes[0]!;
    a.layout = { icon: '⭐' };
    // Deliberately do not mint.
    const layouts = collectLayouts(d.nodes);
    expect(Object.keys(layouts).some((k) => k.startsWith('__tmp-'))).toBe(false);
  });

  it('FAILING: restyle of real id 5 updates 5: and does not add __tmp- keys', () => {
    const d = parse(COLIN_LAYOUT, { sessionIds: true });
    const mitre = findById(d.nodes, '5')!;
    expect(mitre.icon).toBe('⭐');
    mitre.icon = '🌲';
    mitre.layout = { ...(mitre.layout || {}), icon: '🌲' };
    assignPersistentId(d, mitre); // real id stays 5
    const text = serialize(d);
    expect(text).not.toMatch(/__tmp-/);
    expect(text).toMatch(/\n5:\n {2}icon: 🌲\n/);
    // Round-trip: 5 still carries the new icon
    const again = parse(text);
    expect(findById(again.nodes, '5')!.icon).toBe('🌲');
  });

  it('dedupe: repeated keys merge last-field-wins so earlier icon + later colour both survive', () => {
    const { layouts } = parseLayoutBlock([
      '5:',
      '  icon: ⭐',
      '5:',
      '  colour: moss',
    ].join('\n'));
    expect(layouts['5']?.icon).toBe('⭐');
    expect(layouts['5']?.color).toBe('moss');
  });
});
