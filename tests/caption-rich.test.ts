import { describe, expect, it } from 'vitest';
import {
  captionToHtml,
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
  it('escapes raw HTML and never emits inline SVG from caption', () => {
    const html = captionToHtml('<script>alert(1)</script> <svg onload=x></svg>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<svg');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;svg');
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
