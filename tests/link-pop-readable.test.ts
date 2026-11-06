/** 0.6.5 (Colin, 6 Nov 2026): globe popover rows are easier to read. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { captionLinkRows, linkUrlLine, renderLinkPopRows, shortenMiddle } from '../src/linkPop.js';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/outline-fold.css'), 'utf8');
const rule = (sel: string) => {
  const i = css.indexOf(`\n${sel} {`);
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
};
const U = 'https://b.audroam.example.test/outline-view?id=40242&map=1&focus=3';

type El = { tagName: string; className: string; children: El[]; attrs: Record<string, string>; dataset: Record<string, string>; textContent: string; href?: string; title?: string; target?: string; rel?: string; tabIndex?: number; classList: { add: (c: string) => void }; setAttribute: (k: string, v: string) => void; appendChild: (c: El) => El };
function fakeDoc<T>(fn: () => T): T {
  const make = (tagName: string): El => {
    const el: El = { tagName, className: '', children: [], attrs: {}, dataset: {}, textContent: '', classList: { add: (c) => (el.className += ` ${c}`) }, setAttribute: (k, v) => (el.attrs[k] = v), appendChild: (c) => (el.children.push(c), c) };
    return el;
  };
  const g = globalThis as { document?: unknown };
  const prev = g.document;
  g.document = { createElement: make };
  try { return fn(); } finally { g.document = prev; }
}

describe('link popover readability', () => {
  it('shortenMiddle keeps both ends', () => {
    expect(shortenMiddle('short', 40)).toBe('short');
    const s = shortenMiddle('a'.repeat(30) + 'b'.repeat(30), 21);
    expect(s).toHaveLength(21);
    expect(s.startsWith('aaaa') && s.endsWith('bbbb') && s.includes('…')).toBe(true);
  });
  it('linkUrlLine: domain + path, no query wall', () => {
    expect(linkUrlLine(U)).toBe('b.audroam.example.test/outline-view');
    expect(linkUrlLine('https://www.example.test/')).toBe('example.test');
    expect(linkUrlLine('https://example.test/' + 'x'.repeat(80)).length).toBeLessThanOrEqual(40);
  });
  it('bare URL row: main line is the domain, second line domain+path', () => {
    const [r] = captionLinkRows([{ label: U, href: U, hopId: null }]);
    expect(r!.label).toBe('b.audroam.example.test');
    expect(r!.where).toBe('b.audroam.example.test/outline-view');
  });
  it('labelled row: label, then domain+path', () => {
    const [r] = captionLinkRows([{ label: 'test', href: U, hopId: null }]);
    expect(r!.label).toBe('test');
    expect(r!.where).toBe('b.audroam.example.test/outline-view');
  });
  it('row DOM: two-line text block then ↗; full URL in title and aria-label', () => {
    const rows = captionLinkRows([{ label: 'test', href: U, hopId: null }]);
    const [a] = fakeDoc(() => renderLinkPopRows(rows, { fine: true }).items) as unknown as El[];
    expect(a!.children.map((c) => c.className)).toEqual(['map-link-text', 'map-link-ext']);
    expect(a!.children[0]!.children.map((c) => c.className)).toEqual(['map-link-label', 'map-link-where']);
    expect(a!.title).toBe(U);
    expect(a!.attrs['aria-label']).toContain(U);
  });
  it('CSS: one-line ellipsis label, >=13px AA second line, tap target kept', () => {
    expect(rule('.map-link-label')).toMatch(/white-space: nowrap/);
    expect(rule('.map-link-label')).toMatch(/text-overflow: ellipsis/);
    expect(rule('.map-link-where')).toMatch(/font-size: 13px/);
    expect(rule('.map-link-where')).toMatch(/color: var\(--map-link-where\)/);
    expect(css).toMatch(/--map-link-where: #b4c2cf/);
    expect(rule('.map-link-item')).toMatch(/min-height: 32px/);
  });
});
