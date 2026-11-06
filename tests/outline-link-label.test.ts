/** 0.6.5 (Colin, 6 Nov 2026): the same link rules in the Outline (tree) view. */
import { describe, expect, it } from 'vitest';
import { captionToHtml } from '../src/captionRich.js';

const U = 'https://b.audroam.example.test/outline-view?id=40242&map=1&focus=3';
const E = U.replace(/&/g, '&amp;');
const A = (label: string) => `<a href="${E}" title="${E}" target="_blank" rel="noopener noreferrer">${label}</a>`;
const D = `<a href="${E}" title="${E}" class="of-link-domain" target="_blank" rel="noopener noreferrer">b.audroam.example.test</a>`;

describe('Outline caption links', () => {
  it('text before a bare URL stays plain; the URL is a small domain link after it', () => {
    expect(captionToHtml(`test ${U}`)).toBe(`test ${D}`);
  });
  it('a bare URL alone renders as its domain', () => {
    expect(captionToHtml(U)).toBe(D);
  });
  it('empty [](url) takes preceding text, else the domain; never invisible', () => {
    expect(captionToHtml(`test [](${U})`)).toBe(`test ${D}`);
    expect(captionToHtml(`[](${U})`)).toBe(D);
  });
  it('a labelled markdown link is unchanged apart from the title', () => {
    expect(captionToHtml(`see [docs](${U})`)).toBe(`see ${A('docs')}`);
  });
  it('test [here](url): plain text, then the label as the link (Map shows "test here" + globe)', () => {
    expect(captionToHtml(`test [here](${U})`)).toBe(`test ${A('here')}`);
  });
  it('a backticked URL stays literal code, no link', () => {
    const h = captionToHtml('`' + U + '`');
    expect(h).not.toContain('<a ');
    expect(h).toContain('https://b.audroam.example.test/outline-view');
  });
});
