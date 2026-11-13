// @vitest-environment happy-dom
// Map tick on rows below locked seals (v3 armor payloads, three keys). Invented fixture.
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMapView, createOutlineDoc, parse, peelTrailingSections, nextAutoId } from '../src/index.js';
import type { OutlineNode } from '../src/index.js';

/** Host-style view (as the Audroam page does it): mint a plain numeric id onto every outline
 *  line that has none, parse that, and mark the minted ids as session ids. The doc's text
 *  never carries them. */
function hostView(text: string) {
  const raw = text.replace(/\s+$/, '');
  const peeled = peelTrailingSections(raw) as { outline: string; payloads?: object; layouts?: object };
  const lines = peeled.outline.split(/\r?\n/);
  const tags = (l: string) => [...l.matchAll(/<id:([^>\s]+)>/g)].map((m) => m[1]!);
  const used = new Set<string>();
  lines.forEach((l) => tags(l).forEach((id) => used.add(id)));
  Object.keys(peeled.payloads || {}).forEach((id) => used.add(id));
  Object.keys(peeled.layouts || {}).forEach((id) => used.add(id));
  const minted = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.trim() || tags(lines[i]!).length) continue;
    const id = nextAutoId(used, '');
    minted.add(id);
    lines[i] = /\(\+\)\s*$/.test(lines[i]!) ? lines[i]!.replace(/\s*\(\+\)\s*$/, ` <id:${id}> (+)`) : lines[i]!.replace(/\s*$/, '') + ` <id:${id}>`;
  }
  const d = parse(lines.join('\n') + raw.slice(peeled.outline.length));
  const mark = (l?: OutlineNode[]) => l?.forEach((n) => { if (n.id && minted.has(n.id)) n.autoId = true; mark(n.children); });
  mark(d.nodes);
  return d;
}

const TEXT = readFileSync(new URL('./fixtures-map-tick-after-seal.txt', 'file://' + process.cwd() + '/tests/'), 'utf8');

function mount(text: string, host_ = false) {
  const viewOf = (t: string) => (host_ ? hostView(t) : parse(t, { sessionIds: true }));
  document.body.innerHTML = '';
  const doc = createOutlineDoc({ text, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 60000 });
  let view = viewOf(doc.getText());
  doc.on('change', () => { view = viewOf(doc.getText()); });
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 1200 });
  Object.defineProperty(host, 'clientHeight', { value: 900 });
  document.body.appendChild(host);
  const layout = { version: 1, nodes: {}, _source: 'auto-pack' };
  const mv = createMapView(host, {
    getDoc: () => view,
    setDoc: () => { throw new Error('a task tick must not replace the document'); },
    getLayout: () => layout as never,
    getFocusId: () => '',
    setFocusId: () => {},
    ...doc.mapOptions(),
  });
  mv.paint();
  const click = (label: string) => {
    const g = [...host.querySelectorAll('.map-node')].find((x) => (x.textContent || '').includes(label));
    if (!g) throw new Error(`no map node ${label}`);
    const box = g.querySelector('.map-task-hit');
    if (!box) throw new Error(`no task box on ${label}`);
    box.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };
  return { doc, mv, click };
}

const ROWS: [string, string, string][] = [
  ['typing within secure zone', '[-] typing', '[x] typing'],
  ['failed: scrolls to top', '[x] failed', '[ ] failed'],
  ['better, but now flashes', '[ ] better', '[-] better'],
  ['map check does not function', '[ ] map check', '[-] map check'],
  ['test at this level', '[ ] test at', '[-] test at'],
];

for (const [label, from, to] of ROWS) for (const hv of [false, true]) {
  it(`below locked seals (${hv ? 'host minted ids' : 'session ids'}): '${label}' toggles its own line in place`, () => {
    const { doc, mv, click } = mount(TEXT, hv);
    click(label);
    expect(doc.getText()).toBe(TEXT.replace(from, to));
    mv.destroy?.();
  });
}

// "View from here": the host shows one branch ({ nodes: [branch] }), so a row's place in the
// shown doc is not its place in the note.
it('View from here (session ids, as the page now mints them): a tick on the shown branch toggles its own line', () => {
  document.body.innerHTML = '';
  const doc = createOutlineDoc({ text: TEXT, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 60000 });
  const shown = () => { const d = parse(doc.getText(), { sessionIds: true }); return { ...d, nodes: [d.nodes.find((n) => n.title.includes('issues'))!] }; };
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 1200 });
  Object.defineProperty(host, 'clientHeight', { value: 900 });
  document.body.appendChild(host);
  const layout = { version: 1, nodes: {}, _source: 'auto-pack' };
  const mv = createMapView(host, {
    getDoc: shown, setDoc: () => {}, getLayout: () => layout as never,
    getFocusId: () => '', setFocusId: () => {}, ...doc.mapOptions(),
  });
  mv.paint();
  const g = [...host.querySelectorAll('.map-node')].find((x) => (x.textContent || '').includes('test at this level'))!;
  g.querySelector('.map-task-hit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(doc.getText()).toBe(TEXT.replace('[ ] test at', '[-] test at'));
  mv.destroy?.();
});
