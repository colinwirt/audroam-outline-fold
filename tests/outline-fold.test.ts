import { describe, expect, it } from 'vitest';
import {
  isCollapsed,
  parse,
  serialize,
  toggleFold,
  toHtml,
  ICONS,
} from '../src/index.js';

const SAMPLE_LINE_LEADING = `<id:design> Designing updates for Markmap (+)`;
const SAMPLE_LINE_TRAILING = `Designing updates for Markmap <id:design> (+)`;

describe('parse sample line', () => {
  it('parses leading id with inline (+) (backward compatible)', () => {
    const doc = parse(`- ${SAMPLE_LINE_LEADING}\n`);
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0].id).toBe('design');
    expect(doc.nodes[0].title).toBe('Designing updates for Markmap');
    expect(doc.fold.mode).toBe('-');
    expect(doc.fold.ids).toContain('design');
    expect(isCollapsed(doc, 'design')).toBe(true);
  });

  it('parses trailing id with inline (+)', () => {
    const doc = parse(`- ${SAMPLE_LINE_TRAILING}\n`);
    expect(doc.nodes[0].id).toBe('design');
    expect(doc.nodes[0].title).toBe('Designing updates for Markmap');
    expect(doc.fold.ids).toContain('design');
    expect(isCollapsed(doc, 'design')).toBe(true);
  });

  it('parses trailing short id', () => {
    const doc = parse(`- Designing updates for Markmap <design> (+)\n`);
    expect(doc.nodes[0].id).toBe('design');
    expect(doc.nodes[0].title).toBe('Designing updates for Markmap');
  });

  it('parses caption with priority/vote then trailing id', () => {
    const doc = parse(`- [ ] Ship fold docs · P1 · 👍 <id:a1>\n`);
    expect(doc.nodes[0].id).toBe('a1');
    expect(doc.nodes[0].title).toBe('[ ] Ship fold docs · P1 · 👍');
  });

  it('parses trailing flag then id with (+)', () => {
    const doc = parse(`- Payroll notes <private> <id:secret> (+)\n`);
    expect(doc.nodes[0].id).toBe('secret');
    expect(doc.nodes[0].title).toBe('Payroll notes');
    expect(doc.nodes[0].flags).toContain('private');
    expect(doc.fold.ids).toContain('secret');
  });

  it('trailing id overrides leading id', () => {
    const doc = parse(`- <id:old> Title text <id:new>\n`);
    expect(doc.nodes[0].id).toBe('new');
    expect(doc.nodes[0].title).toBe('Title text');
  });
});

describe('fold- / fold+', () => {
  it('fold-: listed ids collapsed; others expanded', () => {
    const text = `---
fold-: design
---
- Designing updates <id:design>
  - Todo hyphen <id:todo-1>
- Other <id:other>
`;
    const doc = parse(text);
    expect(doc.fold.mode).toBe('-');
    expect(isCollapsed(doc, 'design')).toBe(true);
    expect(isCollapsed(doc, 'todo-1')).toBe(false);
    expect(isCollapsed(doc, 'other')).toBe(false);
  });

  it('fold+: listed ids expanded; others collapsed', () => {
    const text = `---
fold+: design
---
- Design <id:design>
- Other <id:other>
`;
    const doc = parse(text);
    expect(doc.fold.mode).toBe('+');
    expect(isCollapsed(doc, 'design')).toBe(false);
    expect(isCollapsed(doc, 'other')).toBe(true);
  });

  it('rejects both fold- and fold+', () => {
    expect(() =>
      parse(`---
fold-: a
fold+: b
---
- A <id:a>
`),
    ).toThrow(/both fold/);
  });
});

describe('hyphen ids', () => {
  it('keeps todo-1 intact (hyphen not a fold op)', () => {
    const doc = parse(`---
fold-: todo-1
---
- Wire fold <id:todo-1>
`);
    expect(doc.nodes[0].id).toBe('todo-1');
    expect(isCollapsed(doc, 'todo-1')).toBe(true);
  });
});

describe('toggleFold', () => {
  it('is pure and flips membership', () => {
    const doc = parse(`---
fold-: design
---
- Design <id:design>
`);
    const next = toggleFold(doc, 'design');
    expect(isCollapsed(doc, 'design')).toBe(true);
    expect(isCollapsed(next, 'design')).toBe(false);
    const again = toggleFold(next, 'design');
    expect(isCollapsed(again, 'design')).toBe(true);
  });

  it('toggle under fold+ flips expanded list', () => {
    const doc = parse(`---
fold+: design
---
- Design <id:design>
- Other <id:other>
`);
    expect(isCollapsed(doc, 'other')).toBe(true);
    const next = toggleFold(doc, 'other');
    expect(isCollapsed(next, 'other')).toBe(false);
    expect(next.fold.ids).toContain('other');
  });
});

describe('custom markers', () => {
  it('respects collapsedMarker in frontmatter', () => {
    const text = `---
fold-: x
collapsedMarker: "[+]"
---
- X <id:x> [+]
`;
    const doc = parse(text);
    expect(doc.frontmatter?.collapsedMarker).toBe('[+]');
    expect(doc.nodes[0].title).toBe('X');
    const out = serialize(doc);
    expect(out).toContain('collapsedMarker: "[+]"');
    expect(out).toContain('[+]');
  });
});

describe('round-trip', () => {
  it('serialize(parse(text)) puts ids at end (caption-first)', () => {
    const text = `---
fold-: design, todo-1
collapsedMarker: "(+)"
---

- Designing updates for Markmap <id:design> (+)
  - Wire fold state <id:todo-1> (+)
  - Child without id
- Always open <id:open>
`;
    const doc = parse(text);
    const out = serialize(doc);
    expect(out).toMatch(/- Designing updates for Markmap <id:design> \(\+\)/);
    expect(out).toMatch(/- Wire fold state <id:todo-1> \(\+\)/);
    expect(out).toMatch(/- Always open <id:open>/);
    expect(out).not.toMatch(/<id:design> Designing/);
    const doc2 = parse(out);
    expect(doc2.fold).toEqual(doc.fold);
    expect(doc2.nodes[0].id).toBe('design');
    expect(doc2.nodes[0].children?.[0].id).toBe('todo-1');
    expect(doc2.nodes[0].children?.[1].title).toBe('Child without id');
    expect(isCollapsed(doc2, 'design')).toBe(true);
    expect(isCollapsed(doc2, 'open')).toBe(false);
  });

  it('round-trips leading-id input to caption-first output', () => {
    const text = `---
fold-: secret
collapsedMarker: "(+)"
---
- <id:secret> <private> Payroll notes (+)
`;
    const doc = parse(text);
    const out = serialize(doc);
    expect(out).toContain('- Payroll notes <private> <id:secret> (+)');
    const doc2 = parse(out);
    expect(doc2.nodes[0].id).toBe('secret');
    expect(doc2.nodes[0].flags).toContain('private');
    expect(doc2.nodes[0].title).toBe('Payroll notes');
  });
});

describe('private / encrypted / db stubs', () => {
  it('parses flags and dbRef without implementing crypto', () => {
    const text = `---
fold-:
---
- Payroll notes <private> <id:secret>
- Client keys <encrypted> <id:vault>
- Schema map <db:prod-pg> <id:conn>
`;
    const doc = parse(text);
    expect(doc.nodes[0].flags).toContain('private');
    expect(doc.nodes[1].flags).toContain('encrypted');
    expect(doc.nodes[2].flags).toContain('db');
    expect(doc.nodes[2].dbRef).toBe('prod-pg');
  });

  it('parses system-link kind', () => {
    const doc = parse(`- Related outline <kind:system-link> <id:lnk>\n`);
    expect(doc.nodes[0].kind).toBe('system-link');
  });
});

describe('toHtml', () => {
  it('emits (+) only when collapsed and locked chrome for private', () => {
    const doc = parse(`---
fold-: secret
---
- Payroll <private> <id:secret>
- Open node <id:open>
`);
    const html = toHtml(doc);
    expect(html).toContain('(+)');
    expect(html).toContain('data-id="secret"');
    expect(html).toContain('locked');
    expect(html).toContain('Unlock (MFA)');
    expect(html).toContain('Open node');
  });
});

describe('icons', () => {
  it('exports gold pack keys', () => {
    for (const k of [
      'doc',
      'ticket',
      'globe',
      'db',
      'feature',
      'form',
      'bug',
      'risk',
      'lock',
      'encrypted',
      'mfa',
      'system-link',
    ] as const) {
      expect(ICONS[k]).toContain('<svg');
    }
  });
});
