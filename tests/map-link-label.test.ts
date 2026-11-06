/**
 * 0.6.5 (Colin, 6 Nov 2026): a link-only node is never an empty Map pill.
 * Bare URL -> its domain; text before a URL -> the label; `URL` in backticks -> literal code.
 */
import { describe, expect, it } from 'vitest';
import { captionLinks } from '../src/index.js';
import { captionWithoutLinks, shortUrlLabel } from '../src/captionRich.js';

const URL = 'https://b.audroam.example.test/outline-view?id=40242&map=1&focus=3';

describe('Map pill label for links', () => {
  it('a bare URL shows just its domain, link behind the globe', () => {
    expect(captionWithoutLinks(URL)).toBe('b.audroam.example.test');
    expect(captionLinks(URL).map((l) => l.href)).toEqual([URL]);
  });
  it('text before a URL is the label; the URL is not printed', () => {
    expect(captionWithoutLinks(`test ${URL}`)).toBe('test');
    expect(captionLinks(`test ${URL}`).map((l) => l.href)).toEqual([URL]);
  });
  it('a URL in backticks is literal code, not a link', () => {
    expect(captionWithoutLinks('`' + URL + '`')).toBe('`' + URL + '`');
    expect(captionLinks('`' + URL + '`')).toEqual([]);
  });
  it('a bare URL mid-sentence shows its domain', () => {
    expect(captionWithoutLinks(`see ${URL} today`)).toBe('see b.audroam.example.test today');
  });
  it('a lone [label](url) shows its label', () => {
    expect(captionWithoutLinks('[Teamversa](https://teamversa.example.test/)')).toBe('Teamversa');
  });
  it('shortUrlLabel drops www, path, query, port, userinfo', () => {
    expect(shortUrlLabel('https://www.example.test/a/b?q=1')).toBe('example.test');
    expect(shortUrlLabel('http://u@host.example.test:8080/x')).toBe('host.example.test');
  });
});

describe('empty [](url) label (0.6.5)', () => {
  const U = 'https://b.audroam.example.test/outline-view?id=40242&map=1&focus=3';
  it('pill: text before an empty [](url) is the label; alone it shows the domain', () => {
    expect(captionWithoutLinks(`test [](${U})`)).toBe('test');
    expect(captionWithoutLinks(`[](${U})`)).toBe('b.audroam.example.test');
    expect(captionWithoutLinks(`[  ](${U})`)).toBe('b.audroam.example.test');
  });
  it('captionLinks never gives a blank label', () => {
    expect(captionLinks(`test [](${U})`)[0]!.label).toBe('b.audroam.example.test/outline-view');
    expect(captionLinks(`[ ](#id:abc)`)[0]!.label).toBe('#id:abc');
  });
  it('globe popover rows never have a blank label', async () => {
    const { captionLinkRows } = await import('../src/linkPop.js');
    const rows = captionLinkRows([{ label: '', href: U, hopId: null }]);
    expect(rows[0]!.label).toBe('b.audroam.example.test/outline-view');
  });
});
