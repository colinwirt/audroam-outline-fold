// 0.4.1: the editor bundle carries CodeMirror inside; a host never imports it.
import { describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { trailerCut } from '../src/editor/textEditor.js';

describe('editor bundle', () => {
  it('bundles CodeMirror: no external, bare or codemirror imports left', async () => {
    const res = await build({
      entryPoints: ['src/editor/bundle.ts'], bundle: true, format: 'esm', write: false, metafile: true, outfile: 'out.js', logLevel: 'silent',
    });
    const code = res.outputFiles[0]!.text;
    const out = Object.values(res.metafile!.outputs)[0]!;
    expect(out.imports.filter((i) => i.external)).toEqual([]);
    expect(code).not.toMatch(/^\s*(?:import|export)\b[^;\n]*\bfrom\s*["'](?![./])/m);
    expect(code).not.toMatch(/\bimport\s*\(\s*["'](?![./])/);
    expect(code).not.toMatch(/["'](?:@codemirror\/[^"']*|codemirror)["']/);
    expect(Object.keys(res.metafile!.inputs).some((p) => p.includes('@codemirror/view'))).toBe(true);
    expect(code).toMatch(/export\s*\{[^}]*mountTextEditor/);
  }, 30_000);

  it('the build script and package export ship dist/editor.bundle.js', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts.build).toContain('build-editor-bundle.mjs');
    expect(pkg.exports['./editor.bundle'].import).toBe('./dist/editor.bundle.js');
  });

  it('trailerCut stops edits at the first trailing fence', () => {
    const t = '- A\n- B\n--- payloads ---\nxyz';
    expect(trailerCut(t)).toBe(7);
    expect(trailerCut('- A')).toBe(3);
  });
});
