import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/outline-fold.css'),
  'utf8',
);

describe('outline-fold.css', () => {
  it('paints a collapsed fold circle solid gold and an expanded circle black', () => {
    const collapsed = css.slice(
      css.indexOf('.map-fold-indicator circle'),
      css.indexOf('.map-fold-indicator path'),
    );
    const expanded = css.slice(
      css.indexOf('.map-fold-indicator.is-expanded circle'),
      css.indexOf('.map-fold-indicator.is-expanded path'),
    );
    expect(collapsed).toContain('fill: var(--gold)');
    expect(expanded).toContain('fill: #000');
    expect(expanded).not.toContain('fill: none');
  });
});
