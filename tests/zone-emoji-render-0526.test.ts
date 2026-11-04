// @vitest-environment happy-dom
import { it, describe, beforeAll, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { EditorView } from '@codemirror/view';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher, createMapView, captionToHtml, captionStyleRuns } from '../src/index.js';
import * as pkg from '../src/index.js';
import * as editorPkg from '../src/editor/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
import { loadEmojiData, displayShortcodes } from '../src/emoji/icons.js';
// @ts-ignore
import { mountOutlineFold } from './_host.mjs';

// 0.5.26 (Colin, 5 Nov): a stored `:locked:` shows as 🔒 in the zone text and Map/Outline;
// unknown codes, clipart names and code spans stay text. The text itself is never rewritten.
beforeAll(async () => {
  setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>);
  await loadEmojiData();
});
const CTX = { noteId: '9', ownerId: '' };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('0.5.26 stored :code: renders as its emoji', () => {
  it('displayShortcodes: known codes only, not in code spans, not mid-word', () => {
    expect(displayShortcodes(':locked: encryption at rest')).toBe('🔒 encryption at rest');
    expect(displayShortcodes('a :nopeish_code: b')).toBe('a :nopeish_code: b');
    expect(displayShortcodes('run `:locked:` here')).toBe('run `:locked:` here');
    expect(displayShortcodes('x:locked:y')).toBe('x:locked:y');
    expect(displayShortcodes('(:locked:)')).toBe('(🔒)');
  });
  it('Map runs and Outline HTML show the emoji', () => {
    expect(captionStyleRuns(':locked: encryption at rest').map((r) => r.text).join('')).toBe('🔒 encryption at rest');
    expect(captionToHtml(':locked: encryption at rest')).toContain('🔒 encryption at rest');
    expect(captionToHtml('`:locked:`')).toContain(':locked:');
  });
  it('Map node label shows 🔒; the stored title keeps :locked:', async () => {
    const doc = parse('- :locked: encryption at rest <id:a>\n');
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 1000 });
    Object.defineProperty(host, 'clientHeight', { value: 800 });
    document.body.appendChild(host);
    const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
    let cur = doc; let focus = 'a';
    const mv: any = (createMapView as any)(host, { getDoc: () => cur, setDoc: (d: any) => { cur = d; }, getLayout: () => layout, getFocusId: () => focus, setFocusId: (id: string) => { focus = id; }, nodeIcons: true });
    mv.paint(); await tick();
    expect(host.querySelector('.map-node[data-id="a"] .map-label')!.textContent).toContain('🔒 encryption at rest');
    expect(serialize(doc)).toContain(':locked: encryption at rest');
  });
  it('decrypted zone text shows 🔒 while the zone doc keeps :locked:', async () => {
    clearKeys(); setSealCipher('a256gcm');
    const d = parse('- top <id:1>\n- Vault <id:4>\n  - :locked: encryption at rest <id:5>\n- after <id:8>\n');
    const k = await createKey(d, 'pw', { kid: 'k1' }); await sealBranch(d, d.nodes[1]!, k.kid, CTX);
    const txt = serialize(d); clearKeys();
    document.body.innerHTML = ''; const box = document.createElement('div'); document.body.append(box);
    const fh = mountOutlineFold({ text: txt, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000 }); const h = fh.mountEditor(box, {});
    await fh.sessions.open(fh.regionFor('4'), 'pw'); await tick();
    const zoneEl = document.querySelector('.of-secure-zone-editor .cm-editor') as HTMLElement;
    const zone = EditorView.findFromDOM(zoneEl)!;
    expect(zone.state.doc.toString()).toContain(':locked: encryption at rest');
    expect(zoneEl.querySelector('.cm-content')!.textContent).toContain('🔒 encryption at rest');
    expect(zoneEl.querySelector('.cm-content')!.textContent).not.toContain(':locked:');
    h.destroy();
  });
  it('the packages export the typeahead hooks for a host Map node editor', () => {
    expect(typeof (pkg as any).attachIconTypeahead).toBe('function');
    expect(typeof (editorPkg as any).iconTypeahead).toBe('function');
    expect(typeof (pkg as any).displayShortcodes).toBe('function');
  });
});
