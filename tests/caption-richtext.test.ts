import { describe, expect, it } from 'vitest';
import {
  normalizeCaptionBreaks,
  captionVisibleText,
  captionStyleRuns,
  parseTinyHtmlRuns,
  captionToHtml,
  wrapLines,
  measurePill,
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

  it('strips tags with attributes; keeps inner text', () => {
    expect(captionVisibleText('<b onclick=evil>hi</b>')).toBe('hi');
    const html = captionToHtml('<b onclick=evil>hi</b>');
    expect(html).toBe('hi');
    expect(html).not.toContain('onclick');
  });

  it('strips unknown/malicious tags; keeps inner text safe', () => {
    const html = captionToHtml('<script>alert(1)</script> <img src=x onerror=y>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('alert(1)');
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
