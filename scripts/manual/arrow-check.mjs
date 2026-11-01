// Manual real-browser check of ↑/↓ around an open secure zone (NOT in CI).
// node scripts/manual/arrow-check.mjs
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const r = await build({ entryPoints: [here + 'arrow-entry.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'error',
  // Run against the built dist (npm run build first): every src/*.ts import resolves to dist/*.js.
  plugins: [{ name: 'dist', setup(b) { b.onResolve({ filter: /\/src\/.*\.ts$/ }, (a) => ({ path: new URL(a.path.replace(/^.*\/src\//, '../../dist/').replace(/\.ts$/, '.js'), 'file://' + here).pathname })); } }] });
const js = r.outputFiles[0].text;
const css = (await import('node:fs')).readFileSync(here + '../../src/outline-fold.css', 'utf8');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
p.on('pageerror', (e) => console.log('pageerror', e.message));
// localhost is a secure context (Web Crypto)
await p.route('http://localhost/**', (rt) => rt.request().url().endsWith('.js')
  ? rt.fulfill({ contentType: 'text/javascript', body: js })
  : rt.fulfill({ contentType: 'text/html', body: `<style>${css}</style><div id=box style="width:700px"></div><script type=module src=/e.js></script>` }));
await p.goto('http://localhost/');
await p.waitForFunction(() => window.run);
console.log(JSON.stringify(await p.evaluate(() => window.run())));
const where = () => p.evaluate(() => {
  const z = T.zone(); const inZone = z.hasFocus;
  const v = inZone ? z : T.main; const l = v.state.doc.lineAt(v.state.selection.main.head);
  return (inZone ? 'ZONE ' : 'MAIN ') + l.number + ': ' + l.text.replace(/ <id:\w+>/, '');
});
let bad = 0;
const lines = await p.evaluate(() => T.main.state.doc.toString().split('\n'));
for (const dir of ['ArrowUp', 'ArrowDown']) {
  for (let n = 1; n <= lines.length; n++) {
    if (!lines[n - 1].trim() || /^--- /.test(lines[n - 1]) || /<enc:/.test(lines[n - 1])) continue;
    if (lines.slice(0, n - 1).some((t) => /^--- /.test(t))) break;
    const from = await p.evaluate((n) => { T.main.focus(); const l = T.main.state.doc.line(n); T.main.dispatch({ selection: { anchor: l.from } }); return n; }, n);
    const before = await where();
    await p.keyboard.press(dir); await p.waitForTimeout(40);
    const after = await where();
    const exp = await p.evaluate(([n, up]) => { // expected: adjacent visible doc line, or zone edge
      const d = T.main.state.doc; const m = n + (up ? -1 : 1);
      if (m < 1 || m > d.lines) return 'MAIN ' + n + ': ' + d.line(n).text.replace(/ <id:\w+>/, '');
      if (/<enc:/.test(d.line(m).text)) { const z = T.zone().state.doc; const zl = up ? z.lines : 1; return 'ZONE ' + zl + ': ' + z.line(zl).text.replace(/ <id:\w+>/, ''); }
      return 'MAIN ' + m + ': ' + d.line(m).text.replace(/ <id:\w+>/, '');
    }, [n, dir === 'ArrowUp']);
    const ok = after.startsWith(exp.split(':')[0] + ':') ? after === exp : after.startsWith(exp);
    if (!ok) bad++;
    console.log(`${dir.padEnd(9)} ${before.padEnd(28)} -> ${after.padEnd(28)} ${ok ? 'ok' : 'WRONG (want ' + exp + ')'}`);
  }
}
// zone edges back to main
for (const [dir, at] of [['ArrowUp', 'first'], ['ArrowDown', 'last']]) {
  await p.evaluate((at) => { const z = T.zone(); z.focus(); z.dispatch({ selection: { anchor: at === 'first' ? 0 : z.state.doc.line(z.state.doc.lines).from } }); }, at);
  const before = await where(); await p.keyboard.press(dir); await p.waitForTimeout(40);
  console.log(`${dir.padEnd(9)} ${before.padEnd(28)} -> ${await where()}`);
}
// zone grows (typing): the outer height map must follow (ResizeObserver -> requestMeasure)
await p.evaluate(() => { const z = T.zone(); z.dispatch({ changes: { from: z.state.doc.length, insert: '\n  - grown 1\n  - grown 2\n  - grown 3' } }); });
await p.waitForTimeout(200);
await p.evaluate(() => { T.main.focus(); T.main.dispatch({ selection: { anchor: T.main.state.doc.line(5).from } }); });
await p.keyboard.press('ArrowUp'); await p.waitForTimeout(40);
const g = await where(); const gok = g.startsWith('MAIN 4:'); if (!gok) bad++;
console.log(`after zone grew: ArrowUp from MAIN 5 -> ${g} ${gok ? 'ok' : 'WRONG'}`);
console.log(bad ? `FAIL ${bad} wrong moves` : 'PASS all moves');
await b.close();
process.exit(bad ? 1 : 0);
