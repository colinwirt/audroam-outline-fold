import { describe, expect, it } from 'vitest';
import {
  parse,
  serialize,
  toggleFold,
  toggleTask,
  setExpandLevel,
  toHtml,
  noteLinkHref,
  ICONS,
} from '../src/index.js';
import type { OutlineFoldDoc, OutlineNode } from '../src/index.js';

function byWritten(doc: OutlineFoldDoc, id: string): OutlineNode {
  let hit: OutlineNode | undefined;
  const walk = (nodes: OutlineNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.writtenId === id) hit = n;
      walk(n.children);
    }
  };
  walk(doc.nodes);
  if (!hit) throw new Error(`missing ${id}`);
  return hit;
}

function folded(doc: OutlineFoldDoc, id: string): boolean {
  return byWritten(doc, id).collapsed === true;
}

const SAMPLE_LINE_LEADING = `<id:design> Designing updates for Markmap (+)`;
const SAMPLE_LINE_TRAILING = `Designing updates for Markmap <id:design> (+)`;

describe('parse sample line', () => {
  it('parses leading id with inline (+) (backward compatible)', () => {
    const doc = parse(`- ${SAMPLE_LINE_LEADING}\n`);
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0].writtenId).toBe('design');
    expect(doc.nodes[0].title).toBe('Designing updates for Markmap');
    expect(doc.nodes[0].collapsed).toBe(false);
  });

  it('parses trailing id with inline (+)', () => {
    const doc = parse(`- ${SAMPLE_LINE_TRAILING}\n`);
    expect(doc.nodes[0].writtenId).toBe('design');
    expect(doc.nodes[0].title).toBe('Designing updates for Markmap');
    expect(doc.nodes[0].collapsed).toBe(false);
  });

  // 0.2.31: the short `<design>` id form is removed. Ids are `<id:N>` only; a bare
  // `<word>` that is not a known tag is caption text at the start, middle or end.
  describe('a bare <word> is literal text (short id form removed)', () => {
    const words = ['<design>', '<script>', '<br>'];
    const shapes = [
      (w: string) => `- ${w} Designing updates for Markmap`,
      (w: string) => `- Designing ${w} updates for Markmap`,
      (w: string) => `- Designing updates for Markmap ${w}`,
      (w: string) => `- Designing updates for Markmap ${w} (+)\n  - child`,
      (w: string) => `- [ ] Designing updates ${w} <id:7>`,
    ];
    for (const w of words) {
      for (const shape of shapes) {
        const text = `${shape(w)}\n`;
        it(`keeps ${JSON.stringify(text)}`, () => {
          for (const doc of [parse(text), parse(text, { sessionIds: true })]) {
            const n = doc.nodes[0];
            expect(n.title).toContain(w);
            expect(n.writtenId == null || n.writtenId === '7').toBe(true);
            expect(serialize(doc)).toBe(text);
          }
        });
      }
    }

    it('reads <design> as text, not id "design"', () => {
      const doc = parse(`- Designing updates for Markmap <design> (+)\n`);
      expect(doc.nodes[0].writtenId).toBeNull();
      expect(doc.nodes[0].title).toBe('Designing updates for Markmap <design>');
    });

    it('has no shortIds parse option', () => {
      const doc = parse(`- Designing updates <design>\n`, { shortIds: true } as never);
      expect(doc.nodes[0].writtenId).toBeNull();
      expect(doc.nodes[0].title).toBe('Designing updates <design>');
    });
  });

  it('parses caption with priority/vote then trailing id', () => {
    const doc = parse(`- [ ] Ship fold docs · P1 · 👍 <id:a1>\n`);
    expect(doc.nodes[0].writtenId).toBe('a1');
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

    const pendingHtml = toHtml(pending);
    expect(pendingHtml).toContain('of-task-pending');
    expect(pendingHtml).toContain('aria-checked="mixed"');
    expect(pendingHtml).toContain('M8 12h8');

    const mid = parse('- See [] and \u2610 later <id:mid>\n');
    expect(mid.nodes[0].task).toBeUndefined();
    expect(mid.nodes[0].title).toBe('See [] and \u2610 later');
  });

  it('parses trailing flag then id with (+)', () => {
    const doc = parse(`- Payroll notes <private> <id:secret> (+)\n`);
    expect(doc.nodes[0].writtenId).toBe('secret');
    expect(doc.nodes[0].title).toBe('Payroll notes');
    expect(doc.nodes[0].flags).toContain('private');
    expect(doc.nodes[0].collapsed).toBe(false);
  });

  it('trailing id overrides leading id', () => {
    const doc = parse(`- <id:old> Title text <id:new>\n`);
    expect(doc.nodes[0].writtenId).toBe('new');
    expect(doc.nodes[0].title).toBe('Title text');
  });

  it('keeps a trailing id when a character is typed after the tag', () => {
    const doc = parse('- Remodel the courtyard <id:courtyard>3\n');
    expect(doc.nodes[0].writtenId).toBe('courtyard');
    expect(doc.nodes[0].title).toBe('Remodel the courtyard 3');
    expect(doc.nodes[0].collapsed).toBe(false);
  });

  it('keeps the id and inline (+) when a character is typed after the marker', () => {
    const doc = parse('- Order notes <private> <id:sup-private> (+)3\n');
    expect(doc.nodes[0].writtenId).toBe('sup-private');
    expect(doc.nodes[0].title).toBe('Order notes 3');
    expect(doc.nodes[0].flags).toContain('private');
    expect(doc.nodes[0].collapsed).toBe(false);
  });
});

describe('fold lists are not state', () => {
  it('a fold-: line does not collapse a node', () => {
    const doc = parse(`---
fold-: design
---
- Designing updates <id:design>
  - Todo hyphen <id:todo-1>
- Other <id:other>
  - x
`);
    expect(folded(doc, 'design')).toBe(false);
    expect(folded(doc, 'todo-1')).toBe(false);
    expect(folded(doc, 'other')).toBe(false);
    expect(serialize(doc)).not.toContain('fold-:');
  });

  it('a fold+: line does not collapse unlisted nodes', () => {
    const doc = parse(`---
fold+: design
---
- Design <id:design>
  - a
- Other <id:other>
  - b
`);
    expect(folded(doc, 'design')).toBe(false);
    expect(folded(doc, 'other')).toBe(false);
    expect(serialize(doc)).not.toContain('fold+:');
  });

  it('parses both fold- and fold+ lines and applies neither', () => {
    const doc = parse(`---
fold-: a
fold+: b
---
- A <id:a>
  - x
- B <id:b>
  - y
`);
    expect(folded(doc, 'a')).toBe(false);
    expect(folded(doc, 'b')).toBe(false);
  });
});

describe('hyphen ids', () => {
  it('keeps todo-1 intact (hyphen not a fold op)', () => {
    const doc = parse(`---
fold-: todo-1
---
- Wire fold <id:todo-1>
  - child
`);
    expect(doc.nodes[0].writtenId).toBe('todo-1');
    expect(folded(doc, 'todo-1')).toBe(false);
  });
});

describe('toggleFold', () => {
  it('is pure and flips collapsed on the node', () => {
    const doc = parse(`- Design <id:design> (+)
  - note
`);
    const key = byWritten(doc, 'design').sessionKey;
    expect(folded(doc, 'design')).toBe(true);
    const next = toggleFold(doc, key);
    expect(folded(doc, 'design')).toBe(true);
    expect(folded(next, 'design')).toBe(false);
    const again = toggleFold(next, byWritten(next, 'design').sessionKey);
    expect(folded(again, 'design')).toBe(true);
  });

  it('flips a node that has children and no written id', () => {
    const doc = parse(`- Design <id:design>
  - a
- Other
  - b
`);
    expect(folded(doc, 'design')).toBe(false);
    const other = doc.nodes[1]!;
    expect(other.writtenId).toBeNull();
    const next = toggleFold(doc, other.sessionKey);
    expect(next.nodes[1]!.collapsed).toBe(true);
    expect(serialize(next)).toContain('- Other (+)');
  });
});

describe('custom markers', () => {
  it('respects collapsedMarker in frontmatter', () => {
    const text = `---
fold-: x
collapsedMarker: "[+]"
---
- X <id:x> [+]
  - y
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
    - Subtask
  - Child without id
- Always open <id:open>
`;
    const doc = parse(text);
    const out = serialize(doc);
    expect(out).toMatch(/- Designing updates for Markmap <id:design> \(\+\)/);
    expect(out).toMatch(/- Wire fold state <id:todo-1> \(\+\)/);
    expect(out).toMatch(/- Always open <id:open>/);
    expect(out).not.toMatch(/<id:design> Designing/);
    // Output should not contain fold-: since we have inline (+) markers (Item 1)
    expect(out).not.toContain('fold-:');
    // Output should not contain default collapsedMarker (Item 1)
    expect(out).not.toContain('collapsedMarker:');
    const doc2 = parse(out);
    expect(folded(doc2, 'design')).toBe(true);
    expect(folded(doc2, 'todo-1')).toBe(true);
    expect(doc2.nodes[0].writtenId).toBe('design');
    expect(doc2.nodes[0].children?.[0].writtenId).toBe('todo-1');
    expect(doc2.nodes[0].children?.[1].title).toBe('Child without id');
    expect(folded(doc2, 'design')).toBe(true);
    expect(folded(doc2, 'open')).toBe(false);
  });

  it('round-trips leading-id input to caption-first output', () => {
    const text = `---
fold-: secret
collapsedMarker: "(+)"
---
- <id:secret> <private> Payroll notes (+)
  - Details
`;
    const doc = parse(text);
    const out = serialize(doc);
    expect(out).toContain('- Payroll notes <private> <id:secret> (+)');
    const doc2 = parse(out);
    expect(doc2.nodes[0].writtenId).toBe('secret');
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
      expect(folded(next, 'root')).toBe(true);
      expect(folded(next, 'child')).toBe(true);
      expect(folded(next, 'grand')).toBe(true);
      expect(folded(next, 'other')).toBe(true);
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
    expect(folded(next, 'root')).toBe(false); // level 1
    expect(folded(next, 'other')).toBe(false);
    expect(folded(next, 'child')).toBe(true); // level 2 foldable
    expect(folded(next, 'grand')).toBe(true); // level 3
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
    expect(folded(next, 'root')).toBe(false);
    expect(folded(next, 'child')).toBe(false);
    expect(folded(next, 'grand')).toBe(true);
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
      expect(folded(next, 'root')).toBe(false);
      expect(folded(next, 'child')).toBe(false);
      expect(folded(next, 'grand')).toBe(false);
    }
  });

  it('level 2 collapses from depth, and a fold+: line changes nothing', () => {
    const doc = parse(`---
fold+:
---
- Root <id:root>
  - Child <id:child>
    - Grand <id:grand>
      - Deep <id:deep>
`);
    expect(folded(doc, 'root')).toBe(false);
    const next = setExpandLevel(doc, 2);
    expect(folded(next, 'root')).toBe(false);
    expect(folded(next, 'child')).toBe(true);
    const all = setExpandLevel(doc, '*');
    expect(folded(all, 'root')).toBe(false);
    expect(folded(all, 'child')).toBe(false);
    expect(folded(all, 'grand')).toBe(false);
  });

  it('is pure and does not write a fold list', () => {
    const doc = parse(`- Root <id:root> (+)
  - Child <id:child>
`);
    const next = setExpandLevel(doc, '*');
    expect(folded(doc, 'root')).toBe(true);
    expect(folded(next, 'root')).toBe(false);
    expect(next.frontmatter?.foldIds).toBeUndefined();
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
    expect(folded(collapsed, 'root')).toBe(true);
    const next = setExpandLevel(collapsed, 1, { under: byWritten(collapsed, 'child').sessionKey });
    expect(folded(next, 'child')).toBe(false);
    expect(folded(next, 'grand')).toBe(true);
    // Outside subtree unchanged
    expect(folded(next, 'root')).toBe(true);
    expect(folded(next, 'other')).toBe(true);
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
    const at2 = setExpandLevel(doc, 2, { under: byWritten(doc, 'root').sessionKey });
    expect(folded(at2, 'root')).toBe(false);
    expect(folded(at2, 'child')).toBe(false);
    expect(folded(at2, 'grand')).toBe(true);

    const at0 = setExpandLevel(at2, 0, { under: byWritten(at2, 'root').sessionKey });
    expect(folded(at0, 'root')).toBe(true);
    expect(folded(at0, 'child')).toBe(true);
    expect(folded(at0, 'grand')).toBe(true);
  });

  it('under: * expands only the selected subtree', () => {
    const doc = parse(`- Root <id:root> (+)
  - Child <id:child> (+)
    - Grand <id:grand> (+)
      - Deep <id:deep>
- Other root <id:other> (+)
  - Other child <id:ochild>
`);
    expect(folded(doc, 'root')).toBe(true);
    expect(folded(doc, 'other')).toBe(true);
    const next = setExpandLevel(doc, '*', { under: byWritten(doc, 'root').sessionKey });
    expect(folded(next, 'root')).toBe(false);
    expect(folded(next, 'child')).toBe(false);
    expect(folded(next, 'grand')).toBe(false);
    // Sibling forest root unchanged
    expect(folded(next, 'other')).toBe(true);
  });

  it('under: unknown id is a no-op', () => {
    const doc = parse(`- Root <id:root> (+)
  - Child <id:child>
`);
    const next = setExpandLevel(doc, 1, { under: 'missing' as never });
    expect(folded(next, 'root')).toBe(true);
    expect(folded(doc, 'root')).toBe(true);
  });

  it('under: digit 1 collapses the subtree below the selected node', () => {
    const doc = parse(`- Root <id:root>
  - Child <id:child>
    - Grand <id:grand>
      - Deep <id:deep>
`);
    const next = setExpandLevel(doc, 1, { under: byWritten(doc, 'root').sessionKey });
    expect(folded(next, 'root')).toBe(false);
    expect(folded(next, 'child')).toBe(true);
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
    expect(doc.nodes[0].writtenId).toBe('aud-ov-1');
    expect(doc.nodes[0].children?.[0].title).toBe('Child row');
    expect(doc.nodes[0].children?.[0].noteLinks).toEqual(['202']);
    const out = serialize(doc);
    expect(out).toContain('- Parent row <t: 101> <t:102> <id:aud-ov-1>');
    expect(out).toContain('- Child row <t: 202> <id:aud-ov-2>');
    const html = toHtml(doc);
    expect(html).toContain('data-note-link="101"');
    expect(html).toContain('>#102<');
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

  it('opens a layout noteUri in a new tab', () => {
    const pattern = 'https://b.audroam.com/view/pnid/{id}';
    const doc = parse(`- Seed swap list <t:1001> <id:root>

--- layout ---
noteUri: ${pattern}
---
`);
    expect(doc.frontmatter?.noteUri).toBe(pattern);
    expect(noteLinkHref(pattern, '1001')).toBe(
      'https://b.audroam.com/view/pnid/1001',
    );
    expect(noteLinkHref('javascript:alert({id})', '1')).toBeNull();
    expect(noteLinkHref('/view/pnid/{id}', '1001')).toBe('/view/pnid/1001');
    const html = toHtml(doc);
    expect(html).toContain(
      'href="https://b.audroam.com/view/pnid/1001" target="_blank" rel="noopener noreferrer"',
    );
    const fallback = toHtml(parse('- Row <t:9> <id:r>\n'), {
      noteUri: '/view/pnid/{id}',
    });
    expect(fallback).toContain('href="/view/pnid/9"');
    const out = serialize(doc);
    expect(out).toContain(`noteUri: ${pattern}`);
    expect(parse(out).frontmatter?.noteUri).toBe(pattern);
  });
});

describe('<t:N> / legacy <t: N> spelling round-trip', () => {
  // Two-link note shape: one tag with a space, one without, folds in inline markers (no fold-: in layout per Item 1).
  // Per Item 1: empty layout block (only defaults) is omitted from serialize output.
  const BODY = [
    '- 12 Mar - Agenda <id:1>',
    '  - [x] Minutes? <id:2>',
    '- Seed Swap <id:3>',
    '  - [-] Tomato growers <t: 1002> <id:4>',
    '  - Bean count <id:5>',
    '- Watering <id:9> (+)',
    '  - Rain barrel <id:12>',
    '- Spring Show Rose Pruning <t:1003> <id:13> (+)',
    '  - Trellis <id:15>',
    '',
  ].join('\n');

  const firstLine = (doc: Parameters<typeof serialize>[0]) =>
    serialize(doc).split('\n')[0];

  const flip = (text: string) =>
    text
      .replace('<t: 1002>', '\u0000')
      .replace('<t:1003>', '<t: 1003>')
      .replace('\u0000', '<t:1002>');

  for (const [name, body] of [
    ['as written', BODY],
    ['opposite spellings', flip(BODY)],
  ] as const) {
    it(`parse + serialize is byte-identical (${name})`, () => {
      expect(serialize(parse(body))).toBe(body);
      expect(serialize(parse(serialize(parse(body))))).toBe(body);
    });

    it(`a fold toggle only changes the fold marker and layout (${name})`, () => {
      const doc = parse(body);
      const foldedText = serialize(toggleFold(doc, byWritten(doc, '3').sessionKey));
      expect(foldedText).toBe(
        body.replace('- Seed Swap <id:3>', '- Seed Swap <id:3> (+)'),
      );
      const again = parse(foldedText);
      const back = serialize(toggleFold(again, byWritten(again, '3').sessionKey));
      expect(back).toBe(body);
    });

    it(`a checkbox tick only changes the task marker (${name})`, () => {
      const doc = parse(body);
      const result = toggleTask(doc, byWritten(doc, '4').sessionKey);
      expect(result?.to).toBe('done');
      const ticked = serialize(result!.doc);
      const line = body.split('\n')[3];
      expect(ticked).toBe(body.replace(line, line.replace('[-]', '[x]')));
    });
  }

  it('keeps <t:N> and <t: N> on the node as noteLinks, with the spelling beside them', () => {
    const doc = parse('- Row <t: 1> <t:2> <id:r>\n');
    expect(doc.nodes[0].noteLinks).toEqual(['1', '2']);
    expect(doc.nodes[0].noteLinkTags).toEqual({ 1: '<t: 1>' });
    expect(doc.nodes[0].title).toBe('Row');
  });

  it('keeps leading, mid-caption and odd spellings', () => {
    expect(firstLine(parse('- Row <t:5> <id:a>\n'))).toBe('- Row <t:5> <id:a>');
    expect(firstLine(parse('- Row <T:5 > <id:a>\n'))).toBe('- Row <T:5 > <id:a>');
    expect(firstLine(parse('- Row <t:  5> <id:a>\n'))).toBe('- Row <t:  5> <id:a>');
    // Leading and mid-caption tags stay where they were typed (0.2.34).
    expect(firstLine(parse('- <t:5> Row <id:a>\n'))).toBe('- <t:5> Row <id:a>');
    expect(firstLine(parse('- Row <t:5> more <id:a>\n'))).toBe('- Row <t:5> more <id:a>');
    // A repeated id keeps one tag, the first occurrence.
    expect(firstLine(parse('- <t:9> plain <t: 9> <id:a>\n'))).toBe('- <t:9> plain <id:a>');
    expect(firstLine(parse('- plain <t:9> <t: 9> <id:a>\n'))).toBe('- plain <t:9> <id:a>');
  });

  it('writes <t:N> for a link the host adds, and ignores a spelling that names another id', () => {
    const doc = parse('- Row <t: 5> <id:a>\n');
    doc.nodes[0].noteLinks!.push('6');
    expect(firstLine(doc)).toBe('- Row <t: 5> <t:6> <id:a>');
    doc.nodes[0].noteLinkTags = { 5: '<t:7>', 6: 'not a tag' };
    expect(firstLine(doc)).toBe('- Row <t:5> <t:6> <id:a>');
  });
});
