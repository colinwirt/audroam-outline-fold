// @vitest-environment happy-dom
// 0.4.8 contract: createOutlineDoc is the one owner of the note text, the root doc and the
// seal sessions; the host adapter (tests/_host.mjs = Audroam outlineFoldHost.mjs) only does
// save-needed → serialise → PUT → saved/failed. No <textarea>. Invented fixtures only.
import { it, beforeAll, expect, describe } from 'vitest';
import { createHash } from 'node:crypto';
import { EditorView } from '@codemirror/view';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher, createSealSessions, toggleTask, toggleFold, createOutlineDoc, SealedStateError } from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
// @ts-ignore host copy of Audroam's outlineFoldHost (imports rewritten to src)
import { mountOutlineFold } from './_host.mjs';

beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>));
const FIX = `- Garden list <id:1>\n- Sealed branch <id:4>\n  - seeds <id:5>\n    - [ ] tomato <id:6>\n- after <id:7>\n`;
const CTX = { noteId: '9', ownerId: '' };
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const cts = (t: string) => [...t.matchAll(/^\s+(?:auto-)?ct\s*:\s*(\S+)/gm)].map((m) => m[1]);
const ctOf = (t: string) => (t.match(/^\s+ct\s*:\s*(\S+)/m) || [])[1];
const autoCtOf = (t: string) => (t.match(/^\s+auto-ct\s*:\s*(\S+)/m) || [])[1];

async function sealed(fix = FIX) {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse(fix);
  const key = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes.find((n) => n.id === '4')!, key.kid, CTX);
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
function mount(txt: string, extra: Record<string, unknown> = {}) {
  document.body.innerHTML = '';
  const box = document.createElement('div'); document.body.append(box);
  const needed: { rev: number; reason: string }[] = [];
  const changes: { source: string }[] = [];
  const drafts: string[] = [];
  const fh = mountOutlineFold({ text: txt, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 10, onChange: (e: { source: string }) => changes.push(e), onDraft: (t: string) => drafts.push(t), ...extra });
  fh.doc.on('save-needed', (e: { rev: number; reason: string }) => needed.push(e));
  const h = fh.mountEditor(box, {});
  const main = () => EditorView.findFromDOM(box.querySelector('.cm-editor') as HTMLElement)!;
  return { fh, h, box, needed, changes, drafts, main };
}
function zoneView(): EditorView {
  const v = EditorView.findFromDOM(document.querySelector('.of-secure-zone-editor .cm-editor') as HTMLElement);
  if (!v) throw new Error('no zone view');
  return v;
}
const typeAtEnd = (v: EditorView, s: string) => v.dispatch({ changes: { from: v.state.doc.length, insert: s }, userEvent: 'input.type' });
const typeAt = (v: EditorView, at: number, s: string) => v.dispatch({ changes: { from: at, insert: s }, userEvent: 'input.type' });

describe('outline doc owner (0.4.8)', () => {
  it('typing → one save-needed → serialise equals the text → saved → clean', async () => {
    const { fh, needed, main } = mount('- one <id:1>\n- two <id:2>\n');
    typeAt(main(), 5, 'a'); typeAt(main(), 6, 'b'); typeAt(main(), 7, 'c');
    expect(fh.getText()).toBe('- oneabc <id:1>\n- two <id:2>\n');
    expect(fh.status().dirty).toBe(true);
    await tick(40);
    expect(needed.length).toBe(1);
    expect(needed[0]!.reason).toBe('text');
    const snap = await fh.serialise();
    expect(snap.text).toBe(fh.getText());
    expect(snap.rev).toBe(needed[0]!.rev);
    fh.doc.saved(snap.rev);
    expect(fh.status().dirty).toBe(false);
    fh.unmount();
  });

  it('a zone edit with the caret in Text → new ct in the text, no plaintext, reload decrypts', async () => {
    const txt = await sealed();
    const { fh, needed, main, drafts } = mount(txt);
    await fh.sessions.open(fh.regionFor('4'), 'pw');
    await tick();
    main().focus();
    typeAtEnd(zoneView(), '\n  - basil (typed)');
    await tick(60);
    expect(needed.some((n) => n.reason === 'zone')).toBe(true);
    // save-needed → the adapter serialised into the draft store: auto-ct, never plaintext
    const last = drafts[drafts.length - 1]!;
    expect(last).toBe(fh.getText());
    expect(autoCtOf(last)).toBeTruthy();
    expect(ctOf(last)).toBe(ctOf(txt)); // the confirmed slot is untouched by an autosave
    expect(last).not.toContain('basil');
    expect(await reopen(last)).toContain('basil (typed)');
    fh.unmount();
  });

  it('failed(rev) keeps the doc dirty, keeps the auto-ct, and retries', async () => {
    const txt = await sealed();
    const { fh, needed } = mount(txt);
    await fh.sessions.open(fh.regionFor('4'), 'pw');
    await tick();
    typeAtEnd(zoneView(), '\n  - pea');
    const put = async () => ({ ok: false, status: 500, json: async () => ({ Message: 'down' }) });
    const r = await fh.saveNow({ url: '/x', bearer: 't', base: txt, fetch: put });
    expect(r.ok).toBe(false);
    const auto = autoCtOf(fh.getText());
    expect(auto).toBeTruthy();
    expect(fh.status().dirty).toBe(true);
    expect(fh.status().error).toBeTruthy();
    await tick(40);
    expect(needed.some((n) => n.reason === 'retry')).toBe(true);
    expect(autoCtOf(fh.getText())).toBe(auto);
    const ok = async () => ({ ok: true, status: 200, json: async () => ({ Result: 'OK' }) });
    const r2 = await fh.saveNow({ url: '/x', bearer: 't', base: txt, fetch: ok });
    expect(r2.ok).toBe(true);
    expect(r2.text).toContain(auto);
    expect(fh.status().dirty).toBe(false);
    expect(await reopen(r2.text)).toContain('pea');
    fh.unmount();
  });

  it('a zone Save & re-seal is confirmed only after saved(rev); failure leaves it unconfirmed', async () => {
    const txt = await sealed();
    const { fh } = mount(txt);
    const region = fh.regionFor('4');
    await fh.sessions.open(region, 'pw');
    await tick();
    typeAtEnd(zoneView(), '\n  - leek');
    (document.querySelector('.of-sz-save') as HTMLButtonElement).click();
    await tick(40);
    expect(fh.status().regions.find((r: { region: string }) => r.region === region).state).toBe('pending');
    const snap = await fh.serialise();
    fh.doc.failed(snap.rev, new Error('offline'));
    expect(fh.status().regions.find((r: { region: string }) => r.region === region).state).toBe('pending');
    expect(fh.status().dirty).toBe(true);
    fh.doc.saved(snap.rev);
    expect(fh.status().regions.find((r: { region: string }) => r.region === region).state).toBe('confirmed');
    expect(ctOf(snap.text)).not.toBe(ctOf(txt));
    fh.unmount();
  });

  it('an edit between serialise and an old ack stays dirty', async () => {
    const { fh, main } = mount('- one <id:1>\n');
    typeAt(main(), 5, 'a');
    const snap = await fh.serialise();
    typeAt(main(), 6, 'b');
    fh.doc.saved(snap.rev);
    expect(fh.status().dirty).toBe(true);
    const again = await fh.serialise();
    expect(again.text).toContain('oneab');
    fh.doc.saved(again.rev);
    expect(fh.status().dirty).toBe(false);
    fh.unmount();
  });

  it('a Map tick / fold → save-needed (map), note tags kept', async () => {
    const txt = '- [ ] call Bob <t:12> #home <id:1>\n  - details <id:2>\n- after <id:3>\n';
    const keepNoteTags = (prev: string, next: string) => (/<t:\d/.test(prev) ? next.replace(/<t: (\d+)>/g, '<t:$1>') : next);
    const { fh, needed, changes } = mount(txt, { keep: { keepNoteTags } });
    const ticked = toggleTask(parse(fh.getText()), '1').doc;
    expect(fh.commitView(ticked, 'map')).toBe(true);
    expect(fh.commitView(toggleFold(ticked, '1'), 'map')).toBe(true);
    await tick(40);
    expect(needed.length).toBe(1);
    expect(needed[0]!.reason).toBe('map');
    expect(changes.every((c) => c.source === 'map')).toBe(true);
    expect(fh.getText()).toContain('<t:12>');
    expect(fh.getText()).toContain('#home');
    expect(fh.getText()).not.toContain('[ ] call');
    expect(document.querySelector('.cm-content')!.textContent).toContain('<t:12>');
    fh.unmount();
  });

  it('idle lock while dirty → re-seal → save-needed (seal), and the text decrypts', async () => {
    const txt = await sealed();
    const { fh, needed } = mount(txt, { autoLockMs: 60 });
    const region = fh.regionFor('4');
    await fh.sessions.open(region, 'pw');
    await tick();
    typeAtEnd(zoneView(), '\n  - chard');
    await tick(200);
    expect(fh.sessions.get(region).locked).toBe(true);
    expect(needed.some((n) => n.reason === 'seal')).toBe(true);
    expect(fh.getText()).not.toContain('chard');
    expect(await reopen(fh.getText())).toContain('chard');
    fh.unmount();
  });

  it('a Follow caret move (reveal / selection) causes no doc change', async () => {
    const { fh, needed, changes, main } = mount('- one <id:1>\n- two <id:2>\n');
    const rev = fh.doc.rev;
    fh.reveal(14, 17, false);
    main().dispatch({ selection: { anchor: 3 } });
    await tick(40);
    expect(fh.doc.rev).toBe(rev);
    expect(changes.length).toBe(0);
    expect(needed.length).toBe(0);
    expect(fh.caret()).toBe(3);
    fh.unmount();
  });

  it('fresh IVs per save: the same plaintext re-sealed twice gives two different cts', async () => {
    const txt = await sealed();
    const { fh } = mount(txt);
    const region = fh.regionFor('4');
    await fh.sessions.open(region, 'pw');
    await tick();
    const z = zoneView();
    const orig = z.state.doc.toString();
    typeAtEnd(z, '\n  - x');
    await fh.saveRegion(region);
    const ct1 = ctOf(fh.getText());
    z.dispatch({ changes: { from: 0, to: z.state.doc.length, insert: orig + '\n  - y' } });
    await fh.saveRegion(region);
    z.dispatch({ changes: { from: 0, to: z.state.doc.length, insert: orig + '\n  - x' } });
    await fh.saveRegion(region);
    const ct3 = ctOf(fh.getText());
    expect(ct1).toBeTruthy();
    expect(ct3).not.toBe(ct1);
    const all = cts(fh.getText());
    expect(new Set(all).size).toBe(all.length);
    fh.unmount();
  });

  it('no <textarea> is mounted (editor, zone open)', async () => {
    const txt = await sealed();
    const { fh } = mount(txt);
    await fh.sessions.open(fh.regionFor('4'), 'pw');
    await tick();
    expect(document.querySelector('.of-secure-zone-editor')).not.toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
    fh.unmount();
  });

  it('serialise throws SealedStateError when an open zone cannot be re-sealed (zone broken)', async () => {
    const txt = await sealed();
    const held: unknown[] = [];
    const { fh } = mount(txt, { onHold: (e: unknown) => held.push(e) });
    const region = fh.regionFor('4');
    await fh.sessions.open(region, 'pw');
    await tick();
    typeAtEnd(zoneView(), '\n  - z');
    fh.doc.setZoneProbe(() => [region]);
    await expect(fh.serialise()).rejects.toBeInstanceOf(SealedStateError);
    const r = await fh.saveNow({ url: '/x', bearer: 't', base: txt, fetch: async () => { throw new Error('must not PUT'); } });
    expect(r.held).toBeInstanceOf(SealedStateError);
    await tick(40);
    expect(held.length).toBeGreaterThan(0);
    fh.unmount();
  });

  it('setText(load) is a clean baseline; a headless doc works without an editor', async () => {
    const d = createOutlineDoc({ text: '- a <id:1>\n', debounceMs: 1, wipeOnPagehide: false });
    d.setText('- a b <id:1>\n', { source: 'text' });
    expect(d.status().dirty).toBe(true);
    d.setText('- server <id:1>\n', { source: 'load' });
    expect(d.status().dirty).toBe(false);
    expect(d.root().nodes[0]!.title).toContain('server');
    d.destroy();
  });
  it('Remove seal: the plaintext branch reaches the text through the doc (source seal) and asks for a save', async () => {
    const txt = await sealed();
    const { fh, needed, changes } = mount(txt);
    await fh.sessions.open(fh.regionFor('4'), 'pw');
    await tick();
    expect(await fh.removeSeal('4', 'pw')).toBe(true);
    expect(changes.at(-1)!.source).toBe('seal');
    expect(fh.getText()).toMatch(/tomato/);
    expect(fh.getText()).not.toMatch(/ct\s*:/);
    await tick(40);
    expect(needed.at(-1)!.reason).toBe('seal');
    fh.unmount();
  });
});
