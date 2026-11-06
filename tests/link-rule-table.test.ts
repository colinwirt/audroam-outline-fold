/** 0.6.5 (Colin: "at least be consistent"): one link rule across Outline, Map pill and globe popover. */
import { describe, expect, it } from 'vitest';
import { captionLinks, captionToHtml, captionWithoutLinks, linkText } from '../src/captionRich.js';
import { captionLinkRows } from '../src/linkPop.js';

const U = 'https://b.audroam.example.test/outline-view?id=40242&map=1&focus=3';
const E = U.replace(/&/g, '&amp;');
const small = (t: string) => `<a href="${E}" title="${E}" class="of-link-domain" target="_blank" rel="noopener noreferrer">${t}</a>`;
const plain = (t: string) => `<a href="${E}" title="${E}" target="_blank" rel="noopener noreferrer">${t}</a>`;

const cases: { caption: string; text: string; link: string; pill: string; outline: string }[] = [
  { caption: `test ${U}`, text: 'test', link: 'b.audroam.example.test', pill: 'test b.audroam.example.test', outline: `test ${small('b.audroam.example.test')}` },
  { caption: U, text: '', link: 'b.audroam.example.test', pill: 'b.audroam.example.test', outline: small('b.audroam.example.test') },
  { caption: `test [](${U})`, text: 'test', link: 'b.audroam.example.test', pill: 'test b.audroam.example.test', outline: `test ${small('b.audroam.example.test')}` },
  { caption: `test [here](${U})`, text: 'test', link: 'here', pill: 'test here', outline: `test ${plain('here')}` },
];

describe('one link rule, three surfaces', () => {
  it.each(cases)('$caption', ({ caption, link, pill, outline }) => {
    expect(captionWithoutLinks(caption)).toBe(pill); // Map pill
    expect(captionToHtml(caption)).toBe(outline); // Outline row
    const rows = captionLinkRows(captionLinks(caption)); // globe popover
    expect(rows.map((r) => r.label)).toEqual([link]);
    expect(rows[0]!.href).toBe(U);
    const l = captionLinks(caption)[0]!;
    expect(linkText(l.label, l.href)).toBe(link);
  });
});
