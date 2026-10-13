/** 0.2.41: base Map/Outline text is never bold; secondary chrome is behind `details`. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { captionStyleRuns } from '../src/captionRich';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src/outline-fold.css'), 'utf8');
const mapSrc = readFileSync(join(root, 'src/mapView.ts'), 'utf8');

/** Every rule whose selector names label/caption text; chrome (menus, buttons, badges) excluded. */
const LABEL_SELECTOR = /\.(map-label|map-kind-letter|map-note-link|map-jump-link|of-title|of-jump|of-note-link|of-thread|of-node|of-hop)\b/;

function rules(): { sel: string; body: string }[] {
  const out: { sel: string; body: string }[] = [];
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css.replace(/\/\*[\s\S]*?\*\//g, '')))) out.push({ sel: m[1]!.trim(), body: m[2]! });
  return out;
}

describe('clean mode: no bold on base labels', () => {
  it('no label rule sets a weight above normal', () => {
    const bad = rules()
      .filter((r) => LABEL_SELECTOR.test(r.sel))
      .filter((r) => /font-weight:\s*(bold|bolder|[5-9]00)/.test(r.body))
      .map((r) => r.sel);
    expect(bad).toEqual([]);
  });

  it('the renderer writes no weight above 400 on label or kind-letter text', () => {
    const texts = mapSrc.match(/<text class="map-(label|kind-letter)[^>]*>/g) ?? [];
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).not.toMatch(/font-weight="(6|7)00"/);
    expect(mapSrc).not.toMatch(/semibold: isTaskEmphasis/);
    expect(mapSrc).not.toMatch(/\? 600 : 400/);
  });

  it("the user's own inline markup still bolds", () => {
    expect(captionStyleRuns('a <b>B</b>').find((r) => r.text === 'B')?.bold).toBe(true);
  });
});

describe('details option', () => {
  it('hides counts and key hints unless the host has of-details', () => {
    for (const cls of ['map-fold-count', 'map-level-key', 'map-level-count', 'map-width-key']) {
      expect(css).toMatch(new RegExp(`\\.${cls},?[^{]*\\{ display: none !important; \\}`));
      expect(css).toContain(`.of-details .${cls}`);
    }
  });

  it('createMapView toggles of-details from the option and the setter', () => {
    expect(mapSrc).toContain("host.classList.toggle('of-details', !!opts.details)");
    expect(mapSrc).toMatch(/function setDetails\(on: boolean\): void \{\s*host\.classList\.toggle\('of-details', !!on\);/);
  });
});
