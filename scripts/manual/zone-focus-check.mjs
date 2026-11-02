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
if (process.env.GLUE) await p.evaluate(() => { window.AUDROAM_GLUE = true; window.NO_FOLLOW = true; });
await p.waitForFunction(() => window.run);
console.log(await p.evaluate(() => window.run()));
let bad = 0;
const check = (name, ok, extra = '') => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${extra}`); };
// Colin (0.4.16, note 42191): in an unlocked zone, Tab indents once then focus leaves; one key, leaves again.
const where = () => p.evaluate(() => { const a = document.activeElement; return a?.closest('.of-secure-zone-editor') ? 'zone' : a?.closest('#box') ? 'main' : a?.closest('#map') ? 'map' : (a?.tagName || 'none'); });
const zt = () => p.evaluate(() => T.zone().state.doc.toString());
await p.locator('.of-secure-zone-editor .cm-line', { hasText: 'secret b' }).click(); await p.waitForTimeout(100);
check('click puts focus in zone', (await where()) === 'zone', await where());
await p.keyboard.press('End'); await p.keyboard.press('Enter'); await p.keyboard.type('new'); await p.waitForTimeout(300);
check('after Enter+type still in zone', (await where()) === 'zone', await where());
await p.keyboard.press('Tab'); await p.waitForTimeout(300);
check('after Tab still in zone', (await where()) === 'zone', `${await where()} | ${JSON.stringify(await zt())}`);
await p.keyboard.type('k'); await p.waitForTimeout(300);
check('after a key still in zone', (await where()) === 'zone', await where());
await p.keyboard.type('ey'); await p.waitForTimeout(1800);
check('after typing pause still in zone', (await where()) === 'zone', await where());
// What the host does after the pause (Audroam: zone dirty -> paint() -> followOutlineFocus ->
// focusLink.set(id, 'outline'); Map paint). Each must leave focus in the zone.
await p.evaluate(() => T.mv.paint()); await p.waitForTimeout(200);
check('Map repaint after pause keeps zone focus', (await where()) === 'zone', await where());
await p.evaluate(() => T.fh.focusLink.set('12', 'outline')); await p.waitForTimeout(300);
check('Follow (outline -> text) after pause keeps zone focus', (await where()) === 'zone', await where());
await p.locator('.of-secure-zone-editor .cm-line', { hasText: 'newkey' }).click(); await p.waitForTimeout(1700);
await p.evaluate(() => T.fh.focusLink.set('4', 'outline')); await p.waitForTimeout(300);
check('Follow to the zone anchor id after pause keeps zone focus', (await where()) === 'zone', await where());
await p.keyboard.type('Z'); await p.waitForTimeout(100);
check('next key lands in the zone', /newkeyZ|Znewkey/.test(await zt()), JSON.stringify(await zt()));
console.log('changes', JSON.stringify(await p.evaluate(() => window.changes)));
console.log('zone text', JSON.stringify(await zt()));
console.log(bad ? `FAIL ${bad}` : 'PASS');
await b.close();
process.exit(bad ? 1 : 0);
