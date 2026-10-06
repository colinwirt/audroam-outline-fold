import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/outline-fold.css'),
  'utf8',
);

describe('outline-fold.css', () => {
  it('paints a collapsed fold circle solid gold and an expanded circle see-through (0.2.31)', () => {
    const collapsed = css.slice(
      css.indexOf('.map-fold-indicator circle'),
      css.indexOf('.map-fold-indicator path'),
    );
    const expanded = css.slice(
      css.indexOf('.map-fold-indicator.is-expanded circle'),
      css.indexOf('.map-fold-indicator.is-expanded path'),
    );
    expect(collapsed).toContain('fill: var(--gold)');
    expect(expanded).toContain('fill: none');
    expect(expanded).not.toContain('#000');
  });

  it('marks map controls and the resize popover touch-action: manipulation (0.2.30)', () => {
    const start = css.indexOf('.of-map-controls,');
    expect(start).toBeGreaterThan(-1);
    const rule = css.slice(start, css.indexOf('}', start));
    for (const sel of [
      '.of-map-controls,',
      '.of-map-controls button',
      '.map-width-pop button',
    ]) {
      expect(rule).toContain(sel);
    }
    expect(rule).toContain('touch-action: manipulation');
  });
});
