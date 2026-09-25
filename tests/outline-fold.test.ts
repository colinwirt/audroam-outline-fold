import { describe, expect, it } from 'vitest';
import {
  isCollapsed,
  parse,
  serialize,
  toggleFold,
  toHtml,
  ICONS,
} from '../src/index.js';

const SAMPLE_LINE = `<id:design> Designing updates for Markmap (+)`;

describe('parse sample line', () => {
  it('parses Colin sample with inline (+)', () => {
    const doc = parse(`- ${SAMPLE_LINE}\n`);
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0].id).toBe('design');
    expect(doc.nodes[0].title).toBe('Designing updates for Markmap');
    expect(doc.fold.mode).toBe('-');
    expect(doc.fold.ids).toContain('design');
    expect(isCollapsed(doc, 'design')).toBe(true);
  });
});

describe('fold- / fold+', () => {
  it('fold-: listed ids collapsed; others expanded', () => {
    const text = `---
fold-: design
---
- <id:design> Design
  - <id:todo-1> Todo hyphen
- <id:other> Other
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
- <id:design> Design
- <id:other> Other
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
- <id:a> A
`),
    ).toThrow(/both fold/);
  });
});

describe('hyphen ids', () => {
  it('keeps todo-1 intact (hyphen not a fold op)', () => {
    const doc = parse(`---
fold-: todo-1
---
- <id:todo-1> Wire fold
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
- <id:design> Design
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
- <id:design> Design
- <id:other> Other
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
- <id:x> X [+]
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
  it('serialize(parse(text)) preserves fold and ids', () => {
    const text = `---
fold-: design, todo-1
collapsedMarker: "(+)"
---

- <id:design> Designing updates for Markmap (+)
  - <id:todo-1> Wire fold state (+)
  - Child without id
- <id:open> Always open
`;
    const doc = parse(text);
    const out = serialize(doc);
    const doc2 = parse(out);
    expect(doc2.fold).toEqual(doc.fold);
    expect(doc2.nodes[0].id).toBe('design');
    expect(doc2.nodes[0].children?.[0].id).toBe('todo-1');
    expect(doc2.nodes[0].children?.[1].title).toBe('Child without id');
    expect(isCollapsed(doc2, 'design')).toBe(true);
    expect(isCollapsed(doc2, 'open')).toBe(false);
  });
});

describe('private / encrypted / db stubs', () => {
  it('parses flags and dbRef without implementing crypto', () => {
    const text = `---
fold-:
---
- <id:secret> <private> Payroll notes
- <id:vault> <encrypted> Client keys
- <id:conn> <db:prod-pg> Schema map
`;
    const doc = parse(text);
    expect(doc.nodes[0].flags).toContain('private');
    expect(doc.nodes[1].flags).toContain('encrypted');
    expect(doc.nodes[2].flags).toContain('db');
    expect(doc.nodes[2].dbRef).toBe('prod-pg');
  });

  it('parses system-link kind', () => {
    const doc = parse(`- <id:lnk> <kind:system-link> Related roam\n`);
    expect(doc.nodes[0].kind).toBe('system-link');
  });
});

describe('toHtml', () => {
  it('emits (+) only when collapsed and locked chrome for private', () => {
    const doc = parse(`---
fold-: secret
---
- <id:secret> <private> Payroll
- <id:open> Open node
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
