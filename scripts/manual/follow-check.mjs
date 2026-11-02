// Manual real-browser check (NOT in CI): Map clicks move the editor (Follow in text) and
// checkbox clicks toggle in the Map, the editor and an unlocked zone.
// npm run build && node scripts/manual/follow-check.mjs
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const here = fileURLToPath(new URL('.', import.meta.url));
const r = await build({ entryPoints: [here + 'follow-entry.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'error',
  plugins: [{ name: 'dist', setup(b) { b.onResolve({ filter: /\/src\/.*\.ts$/ }, (a) => ({ path: new URL(a.path.replace(/^.*\/src\//, '../../dist/').replace(/\.ts$/, '.js'), 'file://' + here).pathname })); } }] });
const css = readFileSync(here + '../../src/outline-fold.css', 'utf8');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.route('http://localhost/**', (rt) => rt.request().url().endsWith('.js')
  ? rt.fulfill({ contentType: 'text/javascript', body: r.outputFiles[0].text })
  : rt.fulfill({ contentType: 'text/html', body: `<style>${css}</style><div style="display:flex"><div id=box style="width:500px;height:120px;overflow:auto"></div><div id=map style="width:800px;height:800px"></div></div><script type=module src=/e.js></script>` }));
await p.goto('http://localhost/');
await p.waitForFunction(() => window.run);
console.log(await p.evaluate(() => window.run()));
let bad = 0;
const check = (name, ok, extra = '') => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${extra}`); };
const caret = () => p.evaluate(() => T.main.state.doc.lineAt(T.main.state.selection.main.head).text);
const clickNode = async (txt) => { const el = p.locator('.map-node', { hasText: txt }).first(); await el.locator('.map-label, text').first().click({ force: true }); await p.waitForTimeout(150); };
// 1. Follow: Map -> editor
await p.locator('#box .cm-line').first().click(); await p.keyboard.type('x'); await p.keyboard.press('Backspace');
await p.waitForTimeout(1700);
await clickNode('far task'); check('Map click moves editor caret', /far task/.test(await caret()), await caret());
await clickNode('row 12'); check('second Map click moves editor caret', /row 12/.test(await caret()), await caret());
await p.locator('#box .cm-line', { hasText: 'row 15' }).click(); await p.keyboard.type('y');
await clickNode('row 17'); check('paused while typing', /row 15/.test(await caret()), await caret());
await p.waitForTimeout(1700);
await clickNode('row 18'); check('resumes after typing pause', /row 18/.test(await caret()), await caret());
// 2. Checkboxes
const t0 = await p.evaluate(() => T.text());
await p.locator('.map-node', { hasText: 'top task' }).first().locator('.map-task-hit').click({ force: true }); await p.waitForTimeout(150);
check('Map task box toggles text', (await p.evaluate(() => T.text())).split('\n')[0] !== t0.split('\n')[0], (await p.evaluate(() => T.text())).split('\n')[0]);
const before = await p.evaluate(() => T.text().match(/.*far task.*/)[0]);
await p.locator('#box .cm-content > .cm-line', { hasText: 'far task' }).locator('.of-zone-task').click(); await p.waitForTimeout(150);
const after = await p.evaluate(() => T.text().match(/.*far task.*/)[0]);
check('editor ☐ click toggles', before !== after, `${before} -> ${after}`);
await p.locator('.of-secure-zone-editor .of-zone-task').first().click(); await p.waitForTimeout(150);
check('zone ☐ click toggles', await p.evaluate(() => /\[[x-]\] secret a/.test(T.zone().state.doc.toString())), await p.evaluate(() => T.zone().state.doc.toString()));
const rz = p.locator('.map-region-node', { hasText: 'secret a' }).first();
const zb = await p.evaluate(() => T.zone().state.doc.toString());
await rz.locator('.map-task-hit').click({ force: true }); await p.waitForTimeout(150);
check('Map zone-row task box toggles', zb !== await p.evaluate(() => T.zone().state.doc.toString()), await p.evaluate(() => T.zone().state.doc.toString()));
// 3. fold still works
const nf = await p.locator('.map-node').count();
await p.locator('.map-node', { hasText: 'vault' }).first().locator('.map-fold-hit').click({ force: true }).catch(() => {});
await p.waitForTimeout(400);
console.log('fold: map nodes', nf, '->', await p.locator('.map-node, .map-region-node').count());
console.log(bad ? `FAIL ${bad}` : 'PASS');
await b.close();
process.exit(bad ? 1 : 0);
