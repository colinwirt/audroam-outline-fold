/**
 * 0.2.31 regression: only a caption line that is nothing but a link is hoisted
 * off a Map pill; a URL inside a sentence stays inline. Fiction text only.
 */
import { describe, expect, it } from 'vitest';
import { captionLinks, parse, toHtml } from '../src/index.js';
import { captionWithoutLinks, isLoneLinkLine } from '../src/captionRich.js';

const load = (text: string) => parse(text, { sessionIds: true });

describe('only a lone URL line is hoisted off a Map pill', () => {
  it('keeps a URL that is part of a sentence in the pill text', () => {
    const t = 'Slides at https://lighthouse.example.test/week3 before Friday';
    expect(captionWithoutLinks(t)).toBe(t);
    // Still reachable from the globe.
    expect(captionLinks(t).map((l) => l.href)).toEqual(['https://lighthouse.example.test/week3']);
  });

  it('keeps a markdown link label in a sentence', () => {
    expect(captionWithoutLinks('Read [the keeper log](https://lighthouse.example.test/log) first')).toBe(
      'Read the keeper log first',
    );
  });

  it('hoists a caption that is just a URL', () => {
    expect(captionWithoutLinks('https://lighthouse.example.test/week3')).toBe('');
    expect(captionWithoutLinks('  https://lighthouse.example.test/week3  ')).toBe('');
    expect(captionLinks('https://lighthouse.example.test/week3')).toHaveLength(1);
  });

  it('hoists a lone URL line and keeps the other lines', () => {
    expect(
      captionWithoutLinks('Week 3 slides\\nhttps://lighthouse.example.test/week3\\nbring a torch'),
    ).toBe('Week 3 slides\n\nbring a torch');
    expect(captionWithoutLinks('Week 3 slides\nhttps://lighthouse.example.test/week3')).toBe('Week 3 slides');
  });

  it('isLoneLinkLine', () => {
    expect(isLoneLinkLine('https://lighthouse.example.test/')).toBe(true);
    expect(isLoneLinkLine(' [log](https://lighthouse.example.test/) ')).toBe(true);
    expect(isLoneLinkLine('see https://lighthouse.example.test/')).toBe(false);
    expect(isLoneLinkLine('https://a.example.test/ https://b.example.test/')).toBe(false);
    expect(isLoneLinkLine('`https://lighthouse.example.test/`')).toBe(false);
  });

  it('the Outline view linkifies a URL in a sentence where it stands', () => {
    const html = toHtml(load('- Slides at https://lighthouse.example.test/week3 before Friday\n'));
    expect(html).toContain(
      'Slides at <a href="https://lighthouse.example.test/week3" target="_blank" rel="noopener noreferrer">https://lighthouse.example.test/week3</a> before Friday',
    );
  });
});
