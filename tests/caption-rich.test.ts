import { describe, expect, it } from 'vitest';
import {
  captionToHtml,
  captionLinks,
  captionWithoutLinks,
  isAllowedCaptionUrl,
  parseHopTarget,
} from '../src/captionRich.js';
import { parse, toHtml } from '../src/index.js';

describe('isAllowedCaptionUrl', () => {
  it('allows https and relative; rejects dangerous schemes', () => {
    expect(isAllowedCaptionUrl('https://example.com/a.png')).toBe(true);
    expect(isAllowedCaptionUrl('../viewer/?doc=x.md')).toBe(true);
    expect(isAllowedCaptionUrl('/icons/x.png')).toBe(true);
    expect(isAllowedCaptionUrl('?doc=../x.md')).toBe(true);
    expect(isAllowedCaptionUrl('http://example.com', { allowHttp: true })).toBe(
      true,
    );
    expect(isAllowedCaptionUrl('http://example.com', { allowHttp: false })).toBe(
      false,
    );
    expect(isAllowedCaptionUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedCaptionUrl('data:text/html,x')).toBe(false);
    expect(isAllowedCaptionUrl('vbscript:msg')).toBe(false);
    expect(isAllowedCaptionUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedCaptionUrl('blob:https://x')).toBe(false);
    expect(isAllowedCaptionUrl('//evil.example/x')).toBe(false);
    expect(isAllowedCaptionUrl('https://x\\y')).toBe(false);
    expect(isAllowedCaptionUrl('https://x\ny')).toBe(false);
  });
});

describe('parseHopTarget', () => {
  it('accepts #id:nodeId only', () => {
    expect(parseHopTarget('#id:root')).toBe('root');
    expect(parseHopTarget('#id:a5-1')).toBe('a5-1');
    expect(parseHopTarget('#root')).toBe(null);
    expect(parseHopTarget('#id:')).toBe(null);
    expect(parseHopTarget('https://x')).toBe(null);
  });
});

describe('captionToHtml', () => {
  it('shows unknown tags as escaped text and never as elements', () => {
    const html = captionToHtml('<script>alert(1)</script> <svg onload=x></svg>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<svg');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;svg onload=x&gt;');
    expect(html).toContain('&lt;/svg&gt;');
  });

  it('renders allowlisted markdown image', () => {
    const html = captionToHtml('Logo ![alt text](https://example.com/i.png) end');
    expect(html).toContain(
      '<img class="of-caption-img" src="https://example.com/i.png" alt="alt text" loading="lazy" decoding="async" referrerpolicy="no-referrer" />',
    );
    expect(html).toContain('Logo ');
    expect(html).toContain(' end');
  });

  it('rejects javascript/data images as escaped markdown', () => {
    const html = captionToHtml('![x](javascript:alert(1))');
    expect(html).not.toContain('<img');
    expect(html).toContain('javascript:alert(1)');
  });

  it('renders markdown links with noopener blank target', () => {
    const html = captionToHtml('See [docs](https://example.com/a) please');
    expect(html).toContain(
      '<a href="https://example.com/a" target="_blank" rel="noopener noreferrer">docs</a>',
    );
  });

  it('renders bare https URLs as links', () => {
    const html = captionToHtml('Go https://example.com/path now');
    expect(html).toContain(
      '<a href="https://example.com/path" target="_blank" rel="noopener noreferrer">https://example.com/path</a>',
    );
  });

  it('renders in-board hops without target blank', () => {
    const html = captionToHtml('Jump [here](#id:root)');
    expect(html).toBe(
      'Jump <a href="#id:root" class="of-hop" data-hop-id="root">here</a>',
    );
    expect(html).not.toContain('target=');
  });

  it('rejects hops without id: prefix', () => {
    const html = captionToHtml('[x](#root)');
    expect(html).not.toContain('<a');
    expect(html).toContain('#root');
  });

  it('allows relative viewer query links', () => {
    const html = captionToHtml(
      'Open [map](?doc=../streetlamps/streetlamps.md)',
    );
    expect(html).toContain('href="?doc=../streetlamps/streetlamps.md"');
    expect(html).toContain('target="_blank"');
  });

  it('lists relative doc links for the map popup', () => {
    expect(captionLinks('[Open](?doc=../iso27001/iso27001.md)')).toEqual([
      { label: 'Open', href: '?doc=../iso27001/iso27001.md', hopId: null },
    ]);
  });

  it('drops markdown links from map pill text and keeps the caption', () => {
    expect(
      captionWithoutLinks('Index · this map · [Open](?doc=../demos-index/demos-index.md)'),
    ).toBe('Index · this map ·');
  });
});

describe('toHtml uses captionToHtml for titles', () => {
  it('emits img/a in title span only', () => {
    const doc = parse(
      `- Node ![i](https://example.com/a.png) and [L](https://example.com) <id:n1>\n`,
    );
    const html = toHtml(doc);
    expect(html).toContain('class="of-caption-img"');
    expect(html).toContain('of-title');
    expect(html).toContain('noopener noreferrer');
    // attributes elsewhere still escaped / no raw title attributes with HTML
    expect(html).toContain('data-id="n1"');
  });
});
