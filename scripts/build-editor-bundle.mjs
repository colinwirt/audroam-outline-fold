// 0.4.1: dist/editor.bundle.js — the text editor with CodeMirror 6 bundled in, so a
// host imports only outline-fold. Fails the build if a bare import survives.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const out = 'dist/editor.bundle.js';
const res = await build({
  metafile: true,
  entryPoints: ['src/editor/bundle.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: true,
  legalComments: 'eof',
  outfile: out,
  logLevel: 'warning',
});
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const code = readFileSync(out, 'utf8');
const ext = res.metafile.outputs[out].imports.filter((i) => i.external);
if (ext.length) throw new Error(`editor bundle has external imports: ${ext.map((i) => i.path).join(', ')}`);
const cm = code.match(/["'](?:@codemirror\/[^"']*|codemirror)["']/g);
if (cm) throw new Error(`editor bundle names CodeMirror modules: ${cm.join(', ')}`);
writeFileSync(out, `/* @audroam/outline-fold ${pkg.version} editor bundle (CodeMirror 6 included, MIT) */\n${code}`);
writeFileSync('dist/editor.bundle.d.ts', "export * from './editor/bundle.js';\n");
console.log(`${out} ${(Buffer.byteLength(code) / 1024).toFixed(1)} KiB`);
