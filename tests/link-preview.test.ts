// @vitest-environment happy-dom
/** 0.6.5 (Colin, 6 Nov 2026): "preview the link before navigating out". */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { attachOutlineTree, parse, toHtml } from '../src/index.js';
import { renderLinkPreview } from '../src/linkPop.js';

const U = 'https://b.audroam.example.test/outline-view?id=40242&map=1&focus=3';
const mapSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/mapView.ts'), 'utf8');

describe('link preview', () => {
  it('preview shows label, domain, full URL, Open (↗) and Copy', () => {
    const v = renderLinkPreview({ label: 'here', href: U });
    expect(v.el.querySelector('.map-link-preview-label')!.textContent).toBe('here');
    expect(v.el.querySelector('.map-link-preview-domain')!.textContent).toBe('b.audroam.example.test');
    expect(v.el.querySelector('.map-link-preview-url')!.textContent).toBe(U);
    expect(v.open.getAttribute('href')).toBe(U);
    expect(v.open.target).toBe('_blank');
    expect(v.open.rel).toContain('noopener');
    expect(v.open.textContent).toContain('↗');
    expect(v.copy.textContent).toMatch(/Copy/);
  });
  it('internal link says "Opens in Audroam"', () => {
    const v = renderLinkPreview({ label: 'x', href: 'https://app.example.test/a', base: 'https://app.example.test/outline-view' });
    expect(v.el.textContent).toContain('Opens in Audroam');
    expect(renderLinkPreview({ label: 'x', href: U }).el.textContent).not.toContain('Opens in Audroam');
  });
  it('Outline: clicking a caption link does not navigate; it opens the preview', () => {
    const doc = parse(`- test ${U}\n`, { sessionIds: true });
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.innerHTML = toHtml(doc);
    const h = attachOutlineTree(root, { getDoc: () => doc, setDoc: () => {}, render: () => { root.innerHTML = toHtml(doc); } });
    const a = root.querySelector('.of-title a[href]') as HTMLAnchorElement;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const pv = document.querySelector('.map-link-preview');
    expect(pv).not.toBeNull();
    expect(pv!.querySelector('a.map-link-preview-open')!.getAttribute('href')).toBe(U);
    h.detach?.();
  });
  it('Map: Enter on a row does not follow natively; only the preview Open does', () => {
    expect(mapSrc).not.toMatch(/e\.key === 'Enter' && it\?\.hasAttribute\('href'\)\) return;/);
    expect(mapSrc).toMatch(/e\.key === 'Enter' && it\?\.classList\.contains\('map-link-preview-open'\)\) return;/);
  });
  it('Map: a popover row with an href opens the preview instead of navigating', () => {
    const click = mapSrc.slice(mapSrc.indexOf('function openLinkPop'), mapSrc.indexOf('function openLinkPop') + 3000);
    expect(click).toMatch(/if \(row\.href && row\.newTab\) \{\s*\n\s*\/\/[^\n]*\n\s*ev\.preventDefault\(\);\s*\n\s*showLinkPreview\(/);
  });
});

describe('stacked domain / path hint (Colin, 6 Nov 2026)', () => {
  it('popover row: domain line, then path line, never the path alone', async () => {
    const { captionLinkRows, renderLinkPopRows } = await import('../src/linkPop.js');
    const { captionLinks } = await import('../src/captionRich.js');
    const rows = captionLinkRows(captionLinks(`test [here](${U})`), 'https://b.audroam.example.test/outline-view?id=1');
    expect(rows[0]).toMatchObject({ label: 'here', domain: 'b.audroam.example.test', path: 'outline-view' });
    const [a] = renderLinkPopRows(rows, { fine: true }).items;
    const where = a!.querySelector('.map-link-where')!;
    expect([...where.children].map((c) => [c.className, c.textContent])).toEqual([
      ['map-link-domain', 'b.audroam.example.test'],
      ['map-link-path', 'outline-view'],
    ]);
  });
  it('preview: domain line with the path under it', () => {
    const v = renderLinkPreview({ label: 'here', href: U });
    expect(v.el.querySelector('.map-link-preview-domain')!.textContent).toBe('b.audroam.example.test');
    expect(v.el.querySelector('.map-link-preview-path')!.textContent).toBe('outline-view');
  });
  it('CSS: domain and path lines are >= 13px in the AA hint colour', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/outline-fold.css'), 'utf8');
    for (const sel of ['.map-link-domain', '.map-link-path', '.map-link-preview-domain', '.map-link-preview-path', '.map-link-preview-url']) {
      const i = css.indexOf(sel);
      expect(i, sel).toBeGreaterThan(-1);
    }
    expect(css).toMatch(/\.map-link-where,[\s\S]*?font-size: 13px;[\s\S]*?color: var\(--map-link-where\)/);
  });
});
