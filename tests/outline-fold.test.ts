import { describe, expect, it } from 'vitest';
import {
  isCollapsed,
  parse,
  serialize,
  toggleFold,
  setExpandLevel,
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
    expect(doc.nodes[0].title).toBe('Ship fold docs · P1 · 👍');
    expect(doc.nodes[0].task).toBe('open');
  });

  it('treats [], [-], and ballot-box glyphs as task markers', () => {
    const empty = parse('- [] Land it <id:empty>\n');
    expect(empty.nodes[0].task).toBe('open');
    expect(empty.nodes[0].title).toBe('Land it');
    expect(serialize(empty)).toContain('[ ] Land it');

    const pending = parse('- [-] Waiting on review <id:wait>\n');
    expect(pending.nodes[0].task).toBe('pending');
    expect(pending.nodes[0].title).toBe('Waiting on review');

    const dash = parse('- [\u2013] Waiting <id:dash>\n');
    expect(dash.nodes[0].task).toBe('pending');
    expect(dash.nodes[0].title).toBe('Waiting');

    const box = parse('- \u2610 Copilot wrote this <id:box>\n');
    expect(box.nodes[0].task).toBe('open');
    expect(box.nodes[0].title).toBe('Copilot wrote this');
    expect(serialize(box)).toContain('[ ] Copilot wrote this');

    const checked = parse('- \u2611 Already done <id:checked>\n');
    expect(checked.nodes[0].task).toBe('done');
    expect(checked.nodes[0].title).toBe('Already done');
    expect(serialize(checked)).toContain('[x] Already done');

    const mid = parse('- See [] and \u2610 later <id:mid>\n');
    expect(mid.nodes[0].task).toBeUndefined();
    expect(mid.nodes[0].title).toBe('See [] and \u2610 later');
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
  it('emits chevron fold chrome + locked chrome for private; reserves leaf fold slot', () => {
    const doc = parse(`---
fold-: secret
---
- Payroll <private> <id:secret>
  - Nested note <id:secret-child>
- Open node <id:open>
`);
    const html = toHtml(doc);
    // Visual fold is chevron SVG, not grammar "(+)" text
    expect(html).not.toMatch(/of-fold[^>]*>\(\+\)</);
    expect(html).toContain('class="of-chevron"');
    expect(html).toContain('data-id="secret"');
    expect(html).toContain('data-testid="of-fold-secret"');
    expect(html).toContain('of-fold-leaf'); // leaf / open node reserves column
    expect(html).toContain('locked');
    expect(html).toContain('Unlock (MFA)');
    expect(html).toContain('Open node');
    expect(html).toContain('role="tree"');
    // collapsed kids stay in DOM
    expect(html).toContain('data-id="secret-child"');
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

describe('setExpandLevel', () => {
  const TREE = `---
fold-:
---
- Root <id:root>
  - Child <id:child>
    - Grand <id:grand>
      - Leaf under grand <id:leaf>
  - Sibling <id:sib>
- Other root <id:other>
  - Other child <id:ochild>
`;

  it('level 0 / 1 collapses all foldable (top level only)', () => {
    const doc = parse(TREE);
    // Make grand foldable
    const withGrandKids = parse(`---
fold-:
---
- Root <id:root>
  - Child <id:child>
    - Grand <id:grand>
      - Deep <id:deep>
  - Sibling <id:sib>
- Other root <id:other>
  - Other child <id:ochild>
`);
    for (const level of [0, 1] as const) {
      const next = setExpandLevel(withGrandKids, level);
      expect(isCollapsed(next, 'root')).toBe(true);
      expect(isCollapsed(next, 'child')).toBe(true);
      expect(isCollapsed(next, 'grand')).toBe(true);
      expect(isCollapsed(next, 'other')).toBe(true);
      // leaves / non-foldable not required in ids
      expect(next.fold.mode).toBe('-');
    }
  });

  it('level 2 expands roots, collapses deeper foldable', () => {
    const doc = parse(`---
fold-:
---
- Root <id:root>
  - Child <id:child>
    - Grand <id:grand>
      - Deep <id:deep>
  - Sibling <id:sib>
- Other root <id:other>
  - Other child <id:ochild>
`);
    const next = setExpandLevel(doc, 2);
    expect(isCollapsed(next, 'root')).toBe(false); // level 1
    expect(isCollapsed(next, 'other')).toBe(false);
    expect(isCollapsed(next, 'child')).toBe(true); // level 2 foldable
    expect(isCollapsed(next, 'grand')).toBe(true); // level 3
  });

  it('level 3 expands through level 2', () => {
    const doc = parse(`---
fold-:
---
- Root <id:root>
  - Child <id:child>
    - Grand <id:grand>
      - Deep <id:deep>
`);
    const next = setExpandLevel(doc, 3);
    expect(isCollapsed(next, 'root')).toBe(false);
    expect(isCollapsed(next, 'child')).toBe(false);
    expect(isCollapsed(next, 'grand')).toBe(true);
  });

  it('* / all expands every foldable node', () => {
    const doc = parse(`---
fold-: root, child, grand
---
- Root <id:root>
  - Child <id:child>
    - Grand <id:grand>
      - Deep <id:deep>
`);
    for (const level of ['*', 'all'] as const) {
      const next = setExpandLevel(doc, level);
      expect(isCollapsed(next, 'root')).toBe(false);
      expect(isCollapsed(next, 'child')).toBe(false);
      expect(isCollapsed(next, 'grand')).toBe(false);
      expect(next.fold.ids).toEqual([]);
    }
  });

  it('works under fold+ (ids = expanded list)', () => {
    const doc = parse(`---
fold+:
---
- Root <id:root>
  - Child <id:child>
    - Grand <id:grand>
      - Deep <id:deep>
`);
    expect(isCollapsed(doc, 'root')).toBe(true);
    const next = setExpandLevel(doc, 2);
    expect(next.fold.mode).toBe('+');
    expect(isCollapsed(next, 'root')).toBe(false);
    expect(next.fold.ids).toContain('root');
    expect(isCollapsed(next, 'child')).toBe(true);
    expect(next.fold.ids).not.toContain('child');
    const all = setExpandLevel(doc, '*');
    expect(isCollapsed(all, 'root')).toBe(false);
    expect(isCollapsed(all, 'child')).toBe(false);
    expect(isCollapsed(all, 'grand')).toBe(false);
  });

  it('is pure and syncs frontmatter foldIds', () => {
    const doc = parse(`---
fold-: root
---
- Root <id:root>
  - Child <id:child>
`);
    const next = setExpandLevel(doc, '*');
    expect(isCollapsed(doc, 'root')).toBe(true);
    expect(isCollapsed(next, 'root')).toBe(false);
    expect(next.frontmatter?.foldIds).toEqual([]);
  });


  it('under: digit 1 expands the selected node (shows its children)', () => {
    const doc = parse(`---
fold-:
---
- Root <id:root>
  - Child <id:child>
    - Grand <id:grand>
      - Deep <id:deep>
  - Sibling <id:sib>
- Other root <id:other>
  - Other child <id:ochild>
`);
    // Select child: digit 1 → expand child, collapse grand; leave root/other alone
    const collapsed = setExpandLevel(doc, 1); // absolute: everything collapsed first
    expect(isCollapsed(collapsed, 'root')).toBe(true);
    const next = setExpandLevel(collapsed, 1, { under: 'child' });
    expect(isCollapsed(next, 'child')).toBe(false);
    expect(isCollapsed(next, 'grand')).toBe(true);
    // Outside subtree unchanged
    expect(isCollapsed(next, 'root')).toBe(true);
    expect(isCollapsed(next, 'other')).toBe(true);
  });

  it('under: digit 2 shows grandchildren; digit 0 collapses subtree', () => {
    const doc = parse(`---
fold-:
---
- Root <id:root>
  - Child <id:child>
    - Grand <id:grand>
      - Deep <id:deep>
`);
    const at2 = setExpandLevel(doc, 2, { under: 'root' });
    expect(isCollapsed(at2, 'root')).toBe(false);
    expect(isCollapsed(at2, 'child')).toBe(false);
    expect(isCollapsed(at2, 'grand')).toBe(true);

    const at0 = setExpandLevel(at2, 0, { under: 'root' });
    expect(isCollapsed(at0, 'root')).toBe(true);
    expect(isCollapsed(at0, 'child')).toBe(true);
    expect(isCollapsed(at0, 'grand')).toBe(true);
  });

  it('under: * expands only the selected subtree', () => {
    const doc = parse(`---
fold-: root, child, grand, other
---
- Root <id:root>
  - Child <id:child>
    - Grand <id:grand>
      - Deep <id:deep>
- Other root <id:other>
  - Other child <id:ochild>
`);
    expect(isCollapsed(doc, 'root')).toBe(true);
    expect(isCollapsed(doc, 'other')).toBe(true);
    const next = setExpandLevel(doc, '*', { under: 'root' });
    expect(isCollapsed(next, 'root')).toBe(false);
    expect(isCollapsed(next, 'child')).toBe(false);
    expect(isCollapsed(next, 'grand')).toBe(false);
    // Sibling forest root unchanged
    expect(isCollapsed(next, 'other')).toBe(true);
  });

  it('under: unknown id is a no-op', () => {
    const doc = parse(`---
fold-: root
---
- Root <id:root>
  - Child <id:child>
`);
    const next = setExpandLevel(doc, 1, { under: 'missing' });
    expect(isCollapsed(next, 'root')).toBe(true);
    expect(next.fold.ids).toEqual(doc.fold.ids);
  });

  it('under: works under fold+', () => {
    const doc = parse(`---
fold+:
---
- Root <id:root>
  - Child <id:child>
    - Grand <id:grand>
      - Deep <id:deep>
`);
    const next = setExpandLevel(doc, 1, { under: 'root' });
    expect(next.fold.mode).toBe('+');
    expect(isCollapsed(next, 'root')).toBe(false);
    expect(next.fold.ids).toContain('root');
    expect(isCollapsed(next, 'child')).toBe(true);
    expect(next.fold.ids).not.toContain('child');
  });

  it('rejects invalid level', () => {
    const doc = parse(`- Root <id:root>\n  - Child <id:c>\n`);
    expect(() => setExpandLevel(doc, 10)).toThrow(/0–9/);
    expect(() => setExpandLevel(doc, 'x')).toThrow(/0–9/);
  });
});

describe('<t: pnid> note links', () => {
  it('keeps several note links off the caption and writes them back before the id', () => {
    const text = `- Parent row <t: 101> <t:102> <id:aud-ov-1>\n  - Child row <id:aud-ov-2> <t: 202>\n`;
    const doc = parse(text);
    expect(doc.nodes[0].title).toBe('Parent row');
    expect(doc.nodes[0].noteLinks).toEqual(['101', '102']);
    expect(doc.nodes[0].id).toBe('aud-ov-1');
    expect(doc.nodes[0].children?.[0].title).toBe('Child row');
    expect(doc.nodes[0].children?.[0].noteLinks).toEqual(['202']);
    const out = serialize(doc);
    expect(out).toContain('- Parent row <t: 101> <t: 102> <id:aud-ov-1>');
    expect(out).toContain('- Child row <t: 202> <id:aud-ov-2>');
    const html = toHtml(doc);
    expect(html).toContain('data-note-link="101"');
    expect(html).toContain('>t:102<');
    expect(html).not.toContain('&lt;t:');
    const again = parse(out);
    expect(again.nodes[0].noteLinks).toEqual(['101', '102']);
    expect(again.nodes[0].title).toBe('Parent row');
  });

  it('still round-trips <thread:…> separately from <t:>', () => {
    const doc = parse('- Work <thread:pnid:9> <t: 9> <id:w>\n');
    expect(doc.nodes[0].thread).toBe('pnid:9');
    expect(doc.nodes[0].noteLinks).toEqual(['9']);
    expect(doc.nodes[0].title).toBe('Work');
    expect(serialize(doc)).toContain('<thread:pnid:9> <t: 9> <id:w>');
  });
});
