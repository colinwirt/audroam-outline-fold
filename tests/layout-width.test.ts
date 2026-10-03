import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse.js';
import { serialize } from '../src/serialize.js';
import { measurePill } from '../src/mapLabel.js';

describe('layout width in the outline text', () => {
  it('parses an integer id without putting it in the caption', () => {
    const doc = parse('- Staff roster <id:12>\n');
    expect(doc.nodes[0]?.id).toBe('12');
    expect(doc.nodes[0]?.title).toBe('Staff roster');
  });

  it('applies a position layout key without writing an id on the line', () => {
    const doc = parse(`- Alpha
  - Beta
- Gamma

--- layout ---
2:
  w: 280
---
`);
    expect(doc.nodes[0]?.id).toBeUndefined();
    expect(doc.nodes[0]?.children?.[0]?.id).toBeUndefined();
    expect(doc.nodes[0]?.children?.[0]?.layout?.w).toBe(280);
    expect(doc.nodes[0]?.children?.[0]?.title).toBe('Beta');
  });

  it('reads document keys from the layout block and writes them back there', () => {
    const doc = parse(`- Parent row <id:p1> (+)
  - Child row <id:c1>

--- layout ---
fold-: p1
collapsedMarker: "(+)"
fontSize: 18
c1:
  w: 280
---
`);
    expect(doc.fold.ids).toEqual(['p1']);
    expect(doc.frontmatter?.fontSize).toBe(18);
    expect(doc.nodes[0]?.children?.[0]?.layout?.w).toBe(280);
    expect(doc.nodes[0]?.title).toBe('Parent row');
    const text = serialize(doc);
    expect(text.startsWith('- Parent row <id:p1> (+)\n')).toBe(true);
    expect(text).not.toMatch(/^---\n/);
    expect(text).toContain('--- layout ---\nfold-: p1\ncollapsedMarker: "(+)"\nfontSize: 18\nc1:\n  w: 280\n---');
    const again = parse(text);
    expect(again.fold.ids).toEqual(['p1']);
    expect(again.frontmatter?.fontSize).toBe(18);
    expect(again.nodes[0]?.children?.[0]?.layout?.w).toBe(280);
  });

  it('lets layout document keys win over a leading frontmatter block', () => {
    const doc = parse(`---
fold-: a
fontSize: 16
---
- Alpha <id:a>
- Beta <id:b>

--- layout ---
fold-: b
fontSize: 20
---
`);
    expect(doc.fold.ids).toEqual(['b']);
    expect(doc.frontmatter?.fontSize).toBe(20);
    expect(doc.nodes[0]?.title).toBe('Alpha');
  });

  it('writes the integer id only once a width needs a persistent key', () => {
    const doc = parse('- Alpha\n  - Beta\n');
    doc.nodes[0]!.children![0]!.layout = { w: 280 };
    const text = serialize(doc);
    expect(text).toContain('- Alpha');
    expect(text).not.toMatch(/Alpha <id:/);
    expect(text).toContain('Beta <id:2>');
    expect(text).toContain('--- layout ---');
    expect(text).toContain('2:\n  w: 280');
    const again = parse(text);
    expect(again.nodes[0]?.children?.[0]?.id).toBe('2');
    expect(again.nodes[0]?.children?.[0]?.layout?.w).toBe(280);
    expect(again.nodes[0]?.children?.[0]?.title).toBe('Beta');
  });

  it('widens auto wrap so a leftover last word stays with the line above', () => {
    const label = 'Staff roster names only';
    const balanced = measurePill(label, { wrapCh: 16, maxLines: 6 });
    const forced = measurePill(label, { wrapCh: 16, maxLines: 6, widthPx: 120 });
    const last = balanced.lines[balanced.lines.length - 1] ?? '';
    expect(last.trim().split(/\s+/).filter(Boolean).length).toBeGreaterThan(1);
    expect(balanced.lines.length).toBeLessThan(forced.lines.length);
  });

  it('keeps an explicit break as its own line', () => {
    const sized = measurePill('Arrive early\nPurge', { wrapCh: 40, maxLines: 6 });
    expect(sized.lines).toEqual(['Arrive early', 'Purge']);
  });

  it('wraps a caption to the stored column width', () => {
    const wide = measurePill('Arrive 6:15 lights music low and purge the group heads');
    const narrow = measurePill('Arrive 6:15 lights music low and purge the group heads', {
      widthPx: 160,
      maxLines: 8,
    });
    expect(narrow.textW).toBe(160);
    expect(narrow.lines.length).toBeGreaterThan(wide.lines.length);
  });
});
