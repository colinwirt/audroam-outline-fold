import { describe, expect, it } from 'vitest';
import {
  normalizeCaptionBreaks,
  captionVisibleText,
  captionStyleRuns,
  parseTinyHtmlRuns,
  captionToHtml,
  wrapLines,
  measurePill,
  displayCaption,
  toHtml,
  parse,
} from '../src/index.js';

describe('normalizeCaptionBreaks', () => {
  it('turns LF / CR / CRLF into line breaks', () => {
    expect(normalizeCaptionBreaks('a\nb')).toBe('a\nb');
    expect(normalizeCaptionBreaks('a\rb')).toBe('a\nb');
    expect(normalizeCaptionBreaks('a\r\nb')).toBe('a\nb');
  });

  it('turns <br>, <br/>, <nr> into line breaks (any case)', () => {
    expect(normalizeCaptionBreaks('a<br>b')).toBe('a\nb');
    expect(normalizeCaptionBreaks('a<br/>b')).toBe('a\nb');
    expect(normalizeCaptionBreaks('a<br />b')).toBe('a\nb');
    expect(normalizeCaptionBreaks('a<BR>b')).toBe('a\nb');
    expect(normalizeCaptionBreaks('a<nr>b')).toBe('a\nb');
    expect(normalizeCaptionBreaks('a<NR/>b')).toBe('a\nb');
  });

  it('collapses 3+ newlines to one blank line', () => {
    expect(normalizeCaptionBreaks('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('turns literal backslash-n / backslash-r escapes into line breaks', () => {
    // What a line-oriented markdown textarea stores when the user types \n
    expect(normalizeCaptionBreaks('a\\nb')).toBe('a\nb');
    expect(normalizeCaptionBreaks('a\\rb')).toBe('a\nb');
    expect(normalizeCaptionBreaks('a\\r\\nb')).toBe('a\nb');
  });
});

describe('tiny HTML allowlist', () => {
  it('parses bold/italic/strong/em without attributes', () => {
    const runs = parseTinyHtmlRuns('x <b>bold</b> y <i>it</i> z');
    expect(captionVisibleText('x <b>bold</b> y <i>it</i> z')).toBe(
      'x bold y it z',
    );
    expect(runs.some((r) => r.text === 'bold' && r.bold)).toBe(true);
    expect(runs.some((r) => r.text === 'it' && r.italic)).toBe(true);
    const strong = captionStyleRuns('<strong>S</strong><em>E</em>');
    expect(strong.find((r) => r.text === 'S')?.bold).toBe(true);
    expect(strong.find((r) => r.text === 'E')?.italic).toBe(true);
  });

  it('shows attributed allowlisted tags as literal text, not elements', () => {
    expect(captionVisibleText('<b onclick=evil>hi</b>')).toBe(
      '<b onclick=evil>hi',
    );
    const html = captionToHtml('<b onclick=evil>hi</b>');
    expect(html).toBe('&lt;b onclick=evil&gt;hi');
    expect(html).not.toContain('<b');
  });

  it('shows unknown tags as literal text in outline HTML and map runs', () => {
    const html = captionToHtml('<script>alert(1)</script> <img src=x onerror=y>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=y&gt;');
    const doc = parse(`- See <script>no</script> <b>ok</b> <id:n1>\n`);
    const outline = toHtml(doc);
    expect(outline).toContain('&lt;script&gt;no&lt;/script&gt;');
    expect(outline).toContain('<b>ok</b>');
    expect(outline).not.toMatch(/<script[\s>]/);
    const runs = captionStyleRuns('<div>x</div>');
    expect(runs.map((r) => r.text).join('')).toBe('<div>x</div>');
  });

  it('renders backticks and code tags as mono', () => {
    const html = captionToHtml('run `npm test` and <code>id</code>');
    expect(html).toContain('<code class="of-code">npm test</code>');
    expect(html).toContain('<code class="of-code">id</code>');
    const runs = captionStyleRuns('`npm test`');
    expect(runs.some((r) => r.code && r.text === 'npm test')).toBe(true);
    expect(captionVisibleText('use `id`')).toBe('use id');
  });

  it('emits <b>/<i> and <br> in Outline captionToHtml', () => {
    const html = captionToHtml('Hello<br/>World <b>bold</b> <i>it</i>');
    expect(html).toContain('<br>');
    expect(html).toContain('<b>bold</b>');
    expect(html).toContain('<i>it</i>');
  });

  it('keeps markdown links; HTML does not replace link grammar', () => {
    const html = captionToHtml('See [docs](https://example.com/a) and <b>x</b>');
    expect(html).toContain(
      '<a href="https://example.com/a" target="_blank" rel="noopener noreferrer">docs</a>',
    );
    expect(html).toContain('<b>x</b>');
  });
});

describe('wrap/measure use visible chars after normalize', () => {
  it('wrapLines splits on br/nr/newlines', () => {
    const { lines } = wrapLines('one<br>two<nr>three', 32, 30);
    expect(lines).toEqual(['one', 'two', 'three']);
  });

  it('wrapLines + captionToHtml split on literal \\n (react-live textarea)', () => {
    const { lines } = wrapLines('Line1\\nLine2', 32, 30);
    expect(lines).toEqual(['Line1', 'Line2']);
    const html = captionToHtml('Hello\\nWorld');
    expect(html).toBe('Hello<br>World');
  });

  it('parse → displayCaption → wrapLines multi-line from literal \\n in md', () => {
    const doc = parse(`- Hello\\nWorld <id:n1>\n`);
    const title = doc.nodes[0]!.title;
    expect(title).toBe('Hello\\nWorld');
    const { lines } = wrapLines(displayCaption(title), 32, 30);
    expect(lines).toEqual(['Hello', 'World']);
  });

  it('measure ignores markup length for wrap width', () => {
    const plain = measurePill('abcdefghij', { wrapCh: 8 });
    const rich = measurePill('<b>abcdefghij</b>', { wrapCh: 8 });
    expect(rich.lines.map((l) => l.replace(/…$/, ''))).toEqual(
      plain.lines.map((l) => l.replace(/…$/, '')),
    );
    expect(rich.richLines[0]!.some((r) => r.bold)).toBe(true);
  });
});

describe('toHtml shares normalize', () => {
  it('renders br + bold in outline title', () => {
    const doc = parse(`- Line1<br/>Line2 <b>B</b> <id:n1>\n`);
    const html = toHtml(doc);
    expect(html).toContain('<br>');
    expect(html).toContain('<b>B</b>');
  });
});
