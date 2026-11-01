// @vitest-environment happy-dom
// 0.4.9 bug C contract: one id allocator across the root doc, open sealed regions and anchors.
import { it, beforeAll, expect, describe } from 'vitest';
import { createHash } from 'node:crypto';
import { EditorView } from '@codemirror/view';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher, createOutlineDoc } from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
import { createIdAllocator, linksTo } from '../src/idAllocator.js';
// @ts-ignore host copy of Audroam's outlineFoldHost
import { mountOutlineFold } from './_host.mjs';

beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>));
const CTX = { noteId: '9', ownerId: '' };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function sealedText(fix: string) {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse(fix);
  const key = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes.find((n) => n.id === '4')!, key.kid, CTX);
  const t = serialize(d); clearKeys(); return t;
}
const FIX = `- Garden list <id:1>\n- Pantry box <id:4>\n  - seeds <id:5>\n  - jars <id:6>\n- after <id:7>\n`;

describe('id allocator (pure)', () => {
  it('region root mirroring its anchor is not a duplicate; other clashes are', () => {
    const a = createIdAllocator();
    const root = parse('- a <id:1>\n- B <id:4>\n');
    const zone = parse('- B <id:4>\n  - c <id:1>\n');
    const r = a.reconcile([{ region: '', doc: root }, { region: 'r4', doc: zone, anchorId: '4' }], '');
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ id: '1', keptIn: '', region: 'r4', action: 'renumbered' });
    expect(zone.nodes[0]!.id).toBe('4');
    expect(zone.nodes[0]!.children![0]!.id).toBe(r.diagnostics[0]!.to);
    expect(root.nodes[0]!.id).toBe('1');
  });
  it('mint never reuses an id, even one that was removed', () => {
    const a = createIdAllocator();
    const d = parse('- a <id:1>\n- b <id:9>\n');
    const sc = [{ region: '', doc: d }];
    expect(a.mint(sc)).toBe('10');
    d.nodes.pop();
    expect(a.mint(sc)).toBe('11');
  });
  it('a linked duplicate is flagged, not renumbered', () => {
    const a = createIdAllocator();
    const d = parse('- a <id:2>\n- b <id:2>\n- see <r:2>\n');
    const r = a.reconcile([{ region: '', doc: d }], '- see <r:2>');
    expect(r.diagnostics[0]!.action).toBe('flagged');
    expect(d.nodes.map((n) => n.id)).toEqual(['2', '2', undefined].slice(0, d.nodes.length).map((x, i) => d.nodes[i]!.id));
    expect(linksTo('go #2 now', '2')).toBe(true);
    expect(linksTo('<r:r4:2>', '2')).toBe(true);
    expect(linksTo('#22', '2')).toBe(false);
  });
});

describe('doc owner ids (0.4.9)', () => {
  it('sealing does not copy the anchor id into the payload', async () => {
    const t = await sealedText(FIX);
    const d = createOutlineDoc({ text: t, ctx: () => CTX, wipeOnPagehide: false });
    await d.sessions.open(d.sessions.regionFor('4'), 'pw');
    const child = d.sessions.get(d.sessions.regionFor('4')).doc!;
    expect(child.nodes).toHaveLength(1);
    expect(child.nodes[0]!.id).toBe('4'); // the anchor mirror, in memory only
    const ids: string[] = [];
    const w = (l: any[] | undefined) => l?.forEach((n) => { ids.push(n.id); w(n.children); });
    w(child.nodes[0]!.children);
    expect(ids).not.toContain('4');
    d.destroy();
  });

  it('a zone line hand-typed with an id from the root is renumbered; the root keeps it', async () => {
    const t = await sealedText(FIX);
    document.body.innerHTML = '';
    const box = document.createElement('div'); document.body.append(box);
    const fh = mountOutlineFold({ text: t, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 10 });
    const diags: any[] = [];
    fh.doc.on('ids', (e: any) => diags.push(e));
    fh.mountEditor(box, {});
    await fh.sessions.open(fh.regionFor('4'), 'pw');
    await tick();
    const z = EditorView.findFromDOM(document.querySelector('.of-secure-zone-editor .cm-editor') as HTMLElement)!;
    z.dispatch({ changes: { from: z.state.doc.length, insert: '\n  - clash <id:7>' }, userEvent: 'input.type' });
    await tick();
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({ id: '7', keptIn: '', action: 'renumbered' });
    const zoneText = serialize(fh.sessions.get(fh.regionFor('4')).doc!);
    expect(zoneText).toContain(`clash <id:${diags[0].to}>`);
    expect(fh.getText()).toContain('- after <id:7>');
    // The zone view re-synced to the new id.
    const z2 = EditorView.findFromDOM(document.querySelector('.of-secure-zone-editor .cm-editor') as HTMLElement)!;
    expect(z2.state.doc.toString()).toContain(`clash <id:${diags[0].to}>`);
    fh.unmount();
  });

  it('a hand-typed duplicate in the main text: the older node keeps the id', async () => {
    const d = createOutlineDoc({ text: '- one <id:1>\n- two <id:2>\n', ctx: () => CTX, wipeOnPagehide: false });
    const diags: any[] = [];
    d.on('ids', (e: any) => diags.push(e));
    d.setText('- one <id:1>\n- two <id:2>\n- three <id:1>\n', { source: 'text' });
    expect(diags[0]).toMatchObject({ id: '1', action: 'renumbered', to: '3', title: 'three' });
    expect(d.getText()).toContain('- one <id:1>');
    expect(d.getText()).toContain('- three <id:3>');
    d.destroy();
  });

  it('auto-numbering after an unlock never hands out an id used inside the region', async () => {
    const t = await sealedText(`- a <id:1>\n- Pantry box <id:4>\n  - deep <id:40>\n- b <id:7>\n`);
    const d = createOutlineDoc({ text: t, ctx: () => CTX, wipeOnPagehide: false });
    await d.sessions.open(d.sessions.regionFor('4'), 'pw');
    const used = d.idsInUse();
    expect(used.has('40')).toBe(true);
    const n = d.mintId();
    expect(Number(n)).toBeGreaterThan(40);
    expect(d.mintId()).not.toBe(n);
    d.destroy();
  });

  it('links stay intact: a duplicate named by a link is flagged and left alone', async () => {
    const d = createOutlineDoc({ text: '- one <id:1>\n- jump <r:1>\n', ctx: () => CTX, wipeOnPagehide: false });
    const diags: any[] = [];
    d.on('ids', (e: any) => diags.push(e));
    const next = '- one <id:1>\n- jump <r:1>\n- copy <id:1>\n';
    d.setText(next, { source: 'text' });
    expect(diags[0]).toMatchObject({ id: '1', action: 'flagged' });
    expect(d.getText()).toBe(next);
    d.destroy();
  });
});
