// @vitest-environment happy-dom
// 0.5.28 (Colin): Cloud / Icon / Colour on a node inside an UNLOCKED secure zone. The style
// goes inline into the zone child (sealed body), never into the plaintext layout block.
// Invented fixture only.
import { it, beforeAll, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { parse, serialize, createMapView, createKey, sealBranch, clearKeys, setSealCipher, createSealSessions, scopeId } from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
// @ts-ignore host copy of Audroam's outlineFoldHost (imports rewritten to src)
import { mountOutlineFold } from './_host.mjs';

beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>));
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

async function mountMap(locked = false) {
  document.body.innerHTML = '';
  const doc = parse(`- Test sealing <id:3>\n`);
  const sub = parse(`- header <id:3>\n  - seems good <id:6>\n  - record <id:7>\n`);
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 800 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
  const styled: string[] = [];
  const mv: any = (createMapView as any)(host, {
    getDoc: () => doc, setDoc: () => {}, getLayout: () => layout,
    getFocusId: () => '3', setFocusId: () => {},
    getRegionHosts: () => [{ id: 's:3', kind: 'sealed', anchor: '3', doc: locked ? undefined : sub, folded: false, kid: 'k1' }],
    onRegionStyle: (id: string) => styled.push(id),
    nodeIcons: true, nodeColours: true,
  });
  mv.paint();
  await tick();
  return { host, mv, doc, sub, layout, styled };
}
const zone = (host: HTMLElement, s: string) =>
  [...host.querySelectorAll('.map-region-node')].find((g) => (g.textContent || '').includes(s))!;

it('setNodeCloud / setNodeIcon / setNodeColour on a scoped id style the zone child inline', async () => {
  const { host, mv, doc, sub, layout, styled } = await mountMap();
  const id = scopeId('s:3', '6');
  mv.setNodeCloud(id, 'default');
  mv.setNodeIcon(id, 'star');
  mv.setNodeColour(id, 'ember');
  const n = sub.nodes[0]!.children![0]!;
  expect(n.cloud).toBe('default');
  expect(n.icon).toBe('star');
  expect(n.color).toBe('ember');
  expect(n.layout).toBeUndefined(); // never the layout block
  expect(styled.length).toBe(3);
  expect(styled.every((s) => s === id)).toBe(true);
  // Inline tags in the zone body; nothing in the main doc or its layout.
  const body = serialize(sub);
  expect(body).toMatch(/seems good.*<color:ember>|<color:ember>.*seems good/);
  expect(body).toContain('<cloud>');
  expect(body).not.toMatch(/^---[\s\S]*"6"[\s\S]*ember/m);
  expect(JSON.stringify(layout)).not.toMatch(/ember|star|"s:3:6"|"6"/);
  expect(serialize(doc)).not.toMatch(/ember|star|seems/);
  // Drawn: colour class on the body, glyph in the caption, a user cloud inside the zone.
  const g = zone(host, 'seems good');
  expect(g.classList.contains('has-colour')).toBe(true);
  expect(g.classList.contains('colour-ember')).toBe(true);
  expect(host.querySelector(`[data-cloud-root="${id}"], .map-cloud`)).not.toBeNull();
  mv.destroy?.();
});

it('setNodeFont on a scoped id writes <font:code> on the zone line, not the layout block', async () => {
  const { mv, doc, sub, styled } = await mountMap();
  const id = scopeId('s:3', '6');
  mv.setNodeFont(id, 'code');
  const n = sub.nodes[0]!.children![0]!;
  expect(n.font).toBe('code');
  expect(n.layout?.font).toBeUndefined();
  expect(serialize(sub)).toMatch(/seems good <font:code>/);
  expect(serialize(doc)).not.toMatch(/font:\s*code/);
  expect(styled).toEqual([id]);
  mv.setNodeFont(id, 'auto');
  expect(sub.nodes[0]!.children![0]!.font).toBe('auto');
  expect(serialize(sub)).toMatch(/seems good <font:auto>/);
  expect(serialize(doc)).not.toMatch(/font:\s*auto/);
  mv.destroy?.();
});

it('a locked zone ignores the setters (no write, no host call)', async () => {
  const { mv, sub, styled } = await mountMap(true);
  const id = scopeId('s:3', '6');
  mv.setNodeCloud(id, 'default');
  mv.setNodeIcon(id, 'star');
  mv.setNodeColour(id, 'ember');
  expect(serialize(sub)).not.toMatch(/cloud|ember|star/);
  expect(styled).toEqual([]);
  mv.destroy?.();
});

it('the icon picker opens for a zone node', async () => {
  const { mv } = await mountMap();
  expect(mv.openIconPicker(scopeId('s:3', '6'))).toBe(true);
  mv.destroy?.();
});

// Full host path: mapOptions().onRegionStyle marks the session dirty; Save & re-seal keeps inline tags.
const FIX = `- Garden list <id:1>\n- Sealed branch <id:4>\n  - seeds <id:5>\n    - tomato <id:6>\n- after <id:7>\n`;
const CTX = { noteId: '9', ownerId: '' };
async function sealed() {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse(FIX);
  const key = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes[1]!, key.kid, CTX);
  const txt = serialize(d); clearKeys();
  return txt;
}
async function reopen(text: string): Promise<string> {
  clearKeys();
  const d = parse(text);
  const s = createSealSessions({ getDoc: () => d, ctx: CTX, autoLockMs: 60000, backoffMs: () => 0, wipeOnPagehide: false });
  await s.open(s.regionFor('4'), 'pw');
  const out = serialize(s.get(s.regionFor('4')).doc!);
  s.destroy();
  return out;
}

it('onRegionStyle marks the zone dirty; re-seal keeps <color>, <cloud> and the icon; plaintext has none', async () => {
  const txt = await sealed();
  document.body.innerHTML = '';
  const fh = mountOutlineFold({ text: txt, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000 });
  const region = fh.regionFor('4');
  await fh.sessions.open(region, 'pw');
  await tick();
  const n = fh.regionNode(scopeId(region, '6'))!;
  n.color = 'ember'; n.cloud = 'default'; n.icon = 'star';
  const opts = fh.mapOptions(() => {}, () => {});
  opts.onRegionStyle(scopeId(region, '6'));
  expect(fh.sessions.get(region).dirty).toBe(true);
  await fh.serialise();
  await tick(40);
  const outer = fh.getText() as string;
  expect(outer).not.toMatch(/ember|star|tomato|"6"/);
  const back = await reopen(outer);
  expect(back).toContain('<color:ember>');
  expect(back).toContain('<cloud>');
  expect(back).toMatch(/:star:|star/);
});

// Width-leak probe (report only; behaviour unchanged): a zone width write stays in the child.
it('REPORT: a zone node width is written on the child, not the plaintext layout block', async () => {
  const txt = await sealed();
  document.body.innerHTML = '';
  const fh = mountOutlineFold({ text: txt, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000 });
  const region = fh.regionFor('4');
  await fh.sessions.open(region, 'pw');
  await tick();
  fh.mapOptions(() => {}, () => {}).onRegionWidth(scopeId(region, '6'), 233);
  await fh.serialise();
  await tick(40);
  const outer = fh.getText() as string;
  expect(outer).not.toContain('233');
  expect(await reopen(outer)).toContain('233');
});
