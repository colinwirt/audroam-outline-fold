// Manual real-browser check (NOT in CI): locked sealed caption edit in the text and via the Map.
// npm run build && node scripts/manual/caption-check.mjs
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const here = fileURLToPath(new URL('.', import.meta.url));
const r = await build({ entryPoints: [here + 'caption-entry.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'error',
  plugins: [{ name: 'dist', setup(b) { b.onResolve({ filter: /\/src\/.*\.ts$/ }, (a) => ({ path: new URL(a.path.replace(/^.*\/src\//, '../../dist/').replace(/\.ts$/, '.js'), 'file://' + here).pathname })); } }] });
const css = readFileSync(here + '../../src/outline-fold.css', 'utf8');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.route('http://localhost/**', (rt) => rt.request().url().endsWith('.js')
  ? rt.fulfill({ contentType: 'text/javascript', body: r.outputFiles[0].text })
  : rt.fulfill({ contentType: 'text/html', body: `<style>${css}</style><div style="display:flex"><div id=box style="width:500px;height:300px;overflow:auto"></div><div id=map style="width:800px;height:800px"></div></div><script type=module src=/e.js></script>` }));
await p.goto('http://localhost/');
await p.waitForFunction(() => window.run);
const t0 = await p.evaluate(() => window.run());
let bad = 0;
const check = (name, ok, extra = '') => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${extra}`); };
const ct = (s) => /\n4:\n(?:  .*\n)*?  ct: (\S+)/.exec(s)[1];
const pub = (s) => (/\n4:\n(?:  .*\n)*?  pub: (.*)\n/.exec(s) || [])[1];
check('seal default caption = node title', /^- vault <enc:k1> <id:4>/m.test(t0) && pub(t0) === '"vault"', pub(t0));
check('no plaintext child in text', !/secret a/.test(t0));
const mapLabel = () => p.evaluate(() => [...document.querySelectorAll('#map .map-node')].map((n) => n.textContent).join('|'));
// 1. Text: select the caption on the locked sealed line and retype it (no key loaded).
// (A click on the sealed line asks to unlock; place the caret on the caption, then real keystrokes.)
await p.evaluate(() => { const m = T.main; m.focus(); const ln = m.state.doc.line(2); const at = ln.text.indexOf('vault'); m.dispatch({ selection: { anchor: ln.from + at, head: ln.from + at + 5 } }); });
await p.keyboard.type('Larder');
await p.waitForTimeout(400);
let t1 = await p.evaluate(() => T.text());
check('text caption edit (locked) saved as pub', pub(t1) === '"Larder"' && /^- Larder <enc:k1> <id:4>/m.test(t1), `${pub(t1)} | ${t1.split('\n')[1]}`);
const t1s = await p.evaluate(async () => (await T.fh.draftNow())?.text || 'held');
check('saved text carries pub (locked text edit)', pub(t1s) === '"Larder"', pub(t1s));
check('ct unchanged after text edit', ct(t1) === ct(t0));
const d1 = await p.evaluate(async () => { try { await T.fh.draftNow(); return T.holds.length ? T.holds.join(';') : 'ok'; } catch (e) { return String(e); } });
check('save (serialise) succeeds without the key', d1 === 'ok', d1);
check('Map shows the new caption', (await mapLabel()).includes('Larder'), await mapLabel());
// 2. Map: rename through the Map's setDoc path (as a Map edit does) while locked.
await p.evaluate(() => { const v = structuredClone(T.view()); v.nodes.find((n) => n.id === '4').title = 'Garden safe'; T.mv; T.fh.commitView(v, 'map'); T.setView(v); T.mv.paint(); });
await p.waitForTimeout(300);
const t2 = await p.evaluate(() => T.text());
console.log('after map: editor line', await p.evaluate(() => T.main.state.doc.line(2).text), '| doc line', t2.split('\n')[1]);
check('Map caption edit (locked) saved as pub', pub(t2) === '"Garden safe"' && /^- Garden safe <enc:k1> <id:4>/m.test(t2), pub(t2));
check('ct unchanged after Map edit', ct(t2) === ct(t0));
const d2 = await p.evaluate(async () => { await T.fh.draftNow(); return T.holds.length ? T.holds.join(';') : 'ok'; });
check('save succeeds after Map edit', d2 === 'ok', d2);
// 3. Unlock: still decrypts the original content.
const inner = await p.evaluate(async () => { await T.fh.sessions.open(T.fh.regionFor('4'), 'pw'); await new Promise((r) => setTimeout(r, 200)); return document.querySelector('.of-secure-zone-editor')?.textContent || ''; });
check('unlock decrypts the same children', /secret a/.test(inner), JSON.stringify(inner));
// 4. Unlocked: caption edit in the text still saves.
const lineNow = await p.evaluate(() => JSON.stringify(T.main.state.doc.toString().split('\n').slice(0, 4)) + ' DOM:' + JSON.stringify([...document.querySelectorAll('#box .cm-line, #box .of-secure-zone')].slice(0,6).map((n) => n.className + '=' + n.textContent.slice(0, 50))));
console.log('unlocked main', lineNow);
await p.evaluate(() => { const m = T.main; const ln = [...Array(m.state.doc.lines)].map((_, i) => m.state.doc.line(i + 1)).find((l) => /Garden safe/.test(l.text)); const at = ln.text.indexOf('Garden safe'); m.dispatch({ changes: { from: ln.from + at, to: ln.from + at + 11, insert: 'Safe box' }, userEvent: 'input.type' }); });
await p.waitForTimeout(300);
const d3 = await p.evaluate(async () => { const s = await T.fh.draftNow(); return s ? s.text : 'held:' + T.holds.join(';'); });
check('caption edit while unlocked saves', /^- Safe box <enc:k1> <id:4>/m.test(d3) && pub(d3) === '"Safe box"' && !/secret a/.test(d3), (pub(d3) || d3.slice(0, 120)) + ' | line ' + lineNow);
console.log(bad ? `FAIL ${bad}` : 'PASS');
await b.close();
process.exit(bad ? 1 : 0);
