// @vitest-environment happy-dom
/**
 * 0.6.0 Map stroke baseline (MSB-1…MSB-8, Colin, 5 Nov 2026).
 * Three tokens only: line 1.4, emphasis 2, focus 2.5. No borderSnap.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse, createMapView } from '../src/index.js';

const css = readFileSync(join(__dirname, '../src/outline-fold.css'), 'utf8');
const rootBlock = css.match(/:root \{([\s\S]*?)\n\}/)![1]!;
const tok = (n: string) => rootBlock.match(new RegExp(`--${n}:\\s*([^;]+);`))?.[1]?.trim();
const rule = (sel: string) =>
  css.match(new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')} \\{([^}]*)\\}`))?.[2] ?? '';

async function paint(text: string) {
  const doc = parse(text);
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 1000 });
  Object.defineProperty(host, 'clientHeight', { value: 800 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
  let cur = doc;
  let focus = doc.nodes[0]!.id!;
  const mv: any = (createMapView as any)(host, {
    getDoc: () => cur,
    setDoc: (d: any) => {
      cur = d;
    },
    getLayout: () => layout,
    getFocusId: () => focus,
    setFocusId: (id: string) => {
      focus = id;
    },
    nodeColours: true,
    nodeIcons: true,
    nodeMenu: true,
    nodeClouds: true,
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 20));
  return {
    host,
    node: (id: string) => host.querySelector(`.map-node[data-id="${id}"]`) as Element,
    cloud: (id: string) => host.querySelector(`.map-cloud[data-cloud="${id}"] path`) as Element,
  };
}

describe('MSB-1 three stroke tokens', () => {
  it('exposes line 1.4, emphasis 2, focus 2.5 as CSS vars', () => {
    expect(tok('map-stroke-line')).toBe('1.4');
    expect(tok('map-stroke-emphasis')).toBe('2');
    expect(tok('map-stroke-focus')).toBe('2.5');
  });
});

describe('MSB-2 no borderSnap', () => {
  it('removes borderSnap.ts and its exports', async () => {
    expect(existsSync(join(__dirname, '../src/borderSnap.ts'))).toBe(false);
    const mod = await import('../src/index.js');
    for (const k of ['borderVars', 'borderDevicePx', 'borderStrokeW', 'snapEdge', 'BORDER_W', 'BORDER_W_STRONG']) {
      expect(mod, k).not.toHaveProperty(k);
    }
    expect(css).not.toMatch(/--map-border-w/);
    expect(css).not.toMatch(/borderSnap/);
  });
});

describe('MSB-3/4 token roles', () => {
  it('line covers connectors, default pills, clouds, code chips, menus', () => {
    expect(css).toMatch(/\.map-edge,\s*\.map-fold-stem\s*\{[^}]*stroke-width:\s*var\(--map-stroke-line\)/);
    expect(rule('.map-pill')).toMatch(/stroke-width:\s*var\(--map-stroke-line\)/);
    expect(rule('.map-code-bg')).toMatch(/stroke-width:\s*var\(--map-stroke-line\)/);
    expect(css).toMatch(/\.map-cloud(?:\s+path)?[^{]*\{[^}]*stroke-width:\s*var\(--map-stroke-line\)/);
    expect(css).toMatch(/border:\s*var\(--map-stroke-line\)\s+solid\s+var\(--map-menu-stroke\)/);
  });
  it('emphasis is only for coloured nodes; focus only for the blue selection ring', () => {
    expect(rule('.map-node.has-colour .map-pill')).toMatch(/stroke-width:\s*var\(--map-stroke-emphasis\)/);
    const focus = css.match(
      /\.map-node\.is-focused \.map-pill,\s*\.map-node:focus-visible \.map-pill \{([^}]*)\}/,
    )![1]!;
    expect(focus).toMatch(/stroke-width:\s*var\(--map-stroke-focus\)/);
    expect(css).toMatch(
      /\.map-node\.has-colour\.is-focused \.map-colour-ring[\s\S]*?stroke-width:\s*var\(--map-stroke-focus\)/,
    );
    // Coloured focused pill keeps emphasis, not focus width.
    expect(css).toMatch(
      /\.map-node\.has-colour\.is-focused \.map-pill[\s\S]*?stroke-width:\s*var\(--map-stroke-emphasis\)/,
    );
  });
});

describe('MSB-5 never a hairline', () => {
  it('no Map stroke-width literal below 1.4 (fold handles, icons, width grip excluded)', () => {
    // Strip fold-handle / grip / icon / halo / casing blocks that are intentionally left alone.
    const scrubbed = css
      .replace(/\.map-fold-indicator[\s\S]*?(?=\n\.map-|\n\/\*|$)/g, '')
      .replace(/\.map-fold-halo[\s\S]*?(?=\n\.map-|\n\/\*|$)/g, '')
      .replace(/\.map-fold-count[\s\S]*?(?=\n\.map-|\n\/\*|$)/g, '')
      .replace(/\.map-edge-casing[\s\S]*?(?=\n\.map-|\n\/\*|$)/g, '')
      .replace(/\.map-width-grip[\s\S]*?(?=\n\.map-|\n\/\*|$)/g, '')
      .replace(/\.map-level-ring[\s\S]*?(?=\n\.map-|\n\/\*|$)/g, '');
    const lows = [...scrubbed.matchAll(/stroke-width:\s*([0-9.]+)/g)]
      .map((m) => Number(m[1]))
      .filter((n) => Number.isFinite(n) && n > 0 && n < 1.4);
    expect(lows, `sub-1.4 strokes: ${lows}`).toEqual([]);
    // Token floor
    expect(Number(tok('map-stroke-line'))).toBeGreaterThanOrEqual(1.4);
  });
});

describe('MSB-6 check state never changes node styling', () => {
  it('task classes do not override pill stroke-width, label weight or muted fill', () => {
    expect(css).not.toMatch(/\.map-node\.task-open[^{]*\.map-pill/);
    expect(css).not.toMatch(/\.map-node\.task-pending[^{]*\.map-pill/);
    expect(css).not.toMatch(/\.map-node\.task-done[^{]*\.map-pill/);
    expect(css).not.toMatch(/\.map-node\.task-done \.map-label \{[^}]*map-node-muted/);
    expect(css).not.toMatch(/\.map-node\.task-open \.map-label \{[^}]*font-weight:\s*[5-9]/);
  });
});

describe('MSB-7 cloud outline is line in a muted tint', () => {
  it('cloud path uses line width and a muted stroke', async () => {
    expect(css).toMatch(/\.map-cloud\s+path\s*\{[^}]*stroke-width:\s*var\(--map-stroke-line\)/);
    const src = readFileSync(join(__dirname, '../src/mapRegion.ts'), 'utf8');
    expect(src).toMatch(/stroke-opacity/);
    const g = await paint(
      '- Trip <cloud:pine> <id:trip>\n  - A <id:a>\n- Ideas <cloud:ember> <id:ideas>\n  - B <id:b>\n',
    );
    const p = g.cloud('trip');
    expect(p.getAttribute('stroke-width') === null || p.getAttribute('stroke-width') === 'var(--map-stroke-line)' || Number(p.getAttribute('stroke-width')) >= 1.4).toBe(true);
    expect(Number(p.getAttribute('stroke-opacity') || '1')).toBeLessThan(1);
    expect(Number(p.getAttribute('stroke-opacity') || '1')).toBeGreaterThan(0.3);
  });
});

describe('MSB-8 wireframe fill is map background', () => {
  it('default --map-node-bg equals --map-bg, never transparent', () => {
    expect(tok('map-node-bg')).toBe('var(--map-bg)');
    expect(tok('map-node-bg')).not.toBe('transparent');
    expect(rule('.map-pill')).toMatch(/fill:\s*var\(--map-node-bg\)/);
  });
  it('a node inside a cloud still fills with map-bg unless Fill is on', async () => {
    const g = await paint(
      '- Cloud <cloud:pine> <id:c>\n  - Inside <id:in>\n  - Filled <color:ember:fill> <id:fi>\n',
    );
    expect(g.node('in').className).not.toMatch(/colour-fill/);
    expect(g.node('fi').className).toMatch(/colour-fill/);
    // Computed fill comes from CSS var chain; assert class + token contract.
    expect(tok('map-node-bg')).toBe('var(--map-bg)');
  });
});
