// @vitest-environment happy-dom
/**
 * Colin, 7 Nov 2026 (t2552u): `setup https://…/outline-view?id=40242&map=1&focus=3` on the Map
 * must show "setup" plus the globe; the Outline shows "setup" plus the domain link.
 * The `?`, `&` and `=` in the query must not break the URL or drop the globe.
 */
import { describe, expect, it } from 'vitest';
import { captionLinks, createMapView, createOutlineDoc, parse, toHtml } from '../src/index.js';
import { captionWithoutLinks } from '../src/captionRich.js';

const URL = 'https://b.audroam.com/outline-view?id=40242&map=1&focus=3';
const LINE = `setup ${URL}`;
const TEXT = `- HashiCorp
  - SSO domains
  - candorcx.ai
    - ${LINE}
    - First, copy the following TXT and verify it within your DNS.
`;

function paintMap(text: string, extra: Record<string, unknown> = {}) {
  document.body.innerHTML = '';
  const doc = createOutlineDoc({ text, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 60000 });
  const view = parse(doc.getText(), { sessionIds: true });
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 800 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  document.body.appendChild(host);
  const layout = { version: 1, nodes: {}, _source: 'auto-pack' };
  const mv = createMapView(host, {
    getDoc: () => view,
    setDoc: () => {},
    getLayout: () => layout,
    getFocusId: () => '',
    setFocusId: () => {},
    ...doc.mapOptions(),
    ...extra,
  } as never);
  mv.paint();
  const setup = [...host.querySelectorAll('.map-node')].find((g) => (g.textContent || '').trim().startsWith('setup'));
  return { host, setup: setup as Element | undefined };
}

describe('trailing URL with a query string (t2552u)', () => {
  it('the whole URL, query included, is one link; the pill keeps "setup"', () => {
    expect(captionWithoutLinks(LINE)).toBe('setup');
    expect(captionLinks(LINE).map((l) => l.href)).toEqual([URL]);
    expect(captionLinks(LINE)[0]!.label).toBe('b.audroam.com');
  });

  it('the Outline shows "setup" plus the domain link with the full URL on hover', () => {
    const html = toHtml(parse(`- ${LINE}\n`, { sessionIds: true }));
    expect(html).toContain(
      'setup <a href="https://b.audroam.com/outline-view?id=40242&amp;map=1&amp;focus=3" title="https://b.audroam.com/outline-view?id=40242&amp;map=1&amp;focus=3" class="of-link-domain"',
    );
    expect(html).toContain('>b.audroam.com</a>');
  });

  it('the Map pill shows "setup" and its globe', () => {
    const { setup } = paintMap(TEXT);
    expect(setup).toBeTruthy();
    expect(setup!.querySelectorAll('.map-link-hit')).toHaveLength(1);
    expect(setup!.querySelector('title')?.textContent).toContain('setup');
  });

  it('keeps the globe with the /outline-view host options on (icons, clouds, colours, details)', () => {
    const { setup } = paintMap(TEXT, {
      nodeIcons: true,
      showNodeIcons: true,
      nodeClouds: true,
      nodeColours: true,
      details: true,
      noteUri: '/view/pnid/{id}',
    });
    expect(setup!.querySelectorAll('.map-link-hit')).toHaveLength(1);
  });

  it('keeps the globe with an <id:N> after the URL', () => {
    const { setup } = paintMap(TEXT.replace(URL, `${URL} <id:7>`));
    expect(setup!.querySelectorAll('.map-link-hit')).toHaveLength(1);
  });
});
