/**
 * 0.2.31 regression: angle-bracket text and inline code stay literal through
 * parse, serialize and render. Fiction text only.
 */
import { describe, expect, it } from 'vitest';
import { captionToHtml, captionLinks, parse, serialize, toHtml, toggleFold, toggleTask } from '../src/index.js';
import { captionWithoutLinks } from '../src/captionRich.js';

const load = (text: string) => parse(text, { sessionIds: true });

/** parse → serialize must give back the line as typed (no id, no lost text). */
function roundTrip(line: string): string {
  return serialize(load(`${line}\n`));
}

describe('a bare <word> is text, not a tag', () => {
  const lines = [
    '- Week 3 lab: the <script> tag runs in the page',
    '- Week 3 lab: inject <script>',
    '- <script> is the oldest payload in the lab sheet',
    '- A line that ends with <br>',
    '- Tilly wrote <em> and <code> on the whiteboard',
  ];

  for (const line of lines) {
    it(`keeps "${line}" whole through parse and serialize`, () => {
      const doc = load(`${line}\n`);
      const node = doc.nodes[0]!;
      expect(node.title).toBe(line.slice(2));
      expect(node.autoId).toBe(true); // only a session id, never written
      expect(roundTrip(line)).toBe(`${line}\n`);
      expect(serialize(doc)).not.toContain('<id:');
    });
  }

  it('parses <script> as text even without session ids', () => {
    const doc = parse('- inject <script> here\n');
    expect(doc.nodes[0]!.id).toBeUndefined();
    expect(doc.nodes[0]!.title).toBe('inject <script> here');
  });

  it('never lets <script> replace a real <id:…>', () => {
    const doc = load('- Week 3 lab: inject <script> <id:lab3>\n');
    expect(doc.nodes[0]!.id).toBe('lab3');
    expect(doc.nodes[0]!.autoId).toBeUndefined();
    expect(doc.nodes[0]!.title).toBe('Week 3 lab: inject <script>');
    expect(serialize(doc)).toBe('- Week 3 lab: inject <script> <id:lab3>\n');
  });

  it('a session id minted after <script> stays the id (outline-view mints <id:N> at line end)', () => {
    const doc = parse('- Week 3 lab: inject <script> <id:9>\n');
    expect(doc.nodes[0]!.id).toBe('9');
    expect(doc.nodes[0]!.title).toBe('Week 3 lab: inject <script>');
  });

  it('outline-view chain: a minted <id:N> at line end keeps a leading or trailing <script>', () => {
    // outline-view (Diff.mintIds) appends <id:N> to every id-less line before parse and
    // takes it off again after serialize. 0.2.30 read the <script> as the id, so the
    // save wrote `- inject <id:script>`, or dropped a leading <script> from the text.
    for (const line of ['- <script> is the oldest payload', '- inject <script>']) {
      const doc = parse(`${line} <id:9>\n`);
      expect(doc.nodes[0]!.id).toBe('9');
      expect(doc.nodes[0]!.title).toBe(line.slice(2));
      expect(serialize(doc)).toBe(`${line} <id:9>\n`);
    }
  });

  it('a fold or a tick does not add an id because of <script>', () => {
    const text = '- [ ] Read the <script> chapter\n  - inline handlers\n';
    let doc = load(text);
    const id = doc.nodes[0]!.id!;
    doc = toggleTask(doc, id).doc;
    doc = toggleFold(doc, id);
    doc = toggleFold(doc, id);
    const out = serialize(doc);
    expect(out).toBe('- [-] Read the <script> chapter\n  - inline handlers\n');
    expect(out).not.toContain('<id:');
  });

  it('still reads the known tags', () => {
    const doc = parse('- Alarm notes <private> <kind:doc> <t: 12> <id:alarm> (+)\n');
    const n = doc.nodes[0]!;
    expect(n.id).toBe('alarm');
    expect(n.flags).toEqual(['private']);
    expect(n.kind).toBe('doc');
    expect(n.noteLinks).toEqual(['12']);
    expect(n.title).toBe('Alarm notes');
  });

  it('still peels a typed suffix after a known tag (<id:n>3)', () => {
    const doc = parse('- Draft <id:n1>3\n');
    expect(doc.nodes[0]!.id).toBe('n1');
    expect(doc.nodes[0]!.title).toBe('Draft 3');
  });

  it('renders <script> escaped as text, never as an element and never dropped', () => {
    const html = toHtml(load('- Week 3 lab: the <script>alert(1)</script> demo\n'));
    expect(html).toContain('Week 3 lab: the &lt;script&gt;alert(1)&lt;/script&gt; demo');
    expect(html).not.toMatch(/<script/i);
  });
});

describe('inline code (backticks) is always literal', () => {
  const lines = [
    '- Week 3 lab: inject `<script>`',
    '- Week 3 lab: the `<script>` tag runs in the page',
    '- `<script>` first, then the cookie grab',
    '- Tag syntax looks like `<id:7>` and `<t: 12>`',
    '- Fold marker as code: `(+)`',
    '- Private in code `<private>` is not a flag',
  ];

  for (const line of lines) {
    it(`keeps "${line}" whole through parse and serialize`, () => {
      const doc = load(`${line}\n`);
      const node = doc.nodes[0]!;
      expect(node.title).toBe(line.slice(2));
      expect(node.autoId).toBe(true);
      expect(node.flags).toBeUndefined();
      expect(node.noteLinks).toBeUndefined();
      expect(doc.fold.ids).toEqual([]);
      expect(roundTrip(line)).toBe(`${line}\n`);
    });
  }

  it('still reads a real tag after a code span', () => {
    const doc = load('- Payload `<script>` <id:xss1>\n');
    expect(doc.nodes[0]!.id).toBe('xss1');
    expect(doc.nodes[0]!.title).toBe('Payload `<script>`');
    expect(serialize(doc)).toBe('- Payload `<script>` <id:xss1>\n');
  });

  it('renders backtick <script> as escaped code', () => {
    const html = toHtml(load('- inject `<script>` here\n'));
    expect(html).toContain('<code class="of-code">&lt;script&gt;</code>');
    expect(html).not.toMatch(/<script/i);
  });

  it('does not linkify a URL inside backticks', () => {
    const html = captionToHtml('try `https://lab.example.test/?q=<script>` in the box');
    expect(html).not.toContain('<a ');
    expect(html).toContain('<code class="of-code">https://lab.example.test/?q=&lt;script&gt;</code>');
    expect(captionLinks('try `https://lab.example.test/` in the box')).toEqual([]);
    expect(captionWithoutLinks('try `https://lab.example.test/` in the box')).toBe(
      'try `https://lab.example.test/` in the box',
    );
  });
});
