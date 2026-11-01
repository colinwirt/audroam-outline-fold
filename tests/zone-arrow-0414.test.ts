// @vitest-environment happy-dom
// 0.4.14 (Colin): ↑ below an open zone jumped to the top of the doc. Root cause: vertical
// margins on the zone block widget (CM's height map excludes margins). Real-browser check:
// scripts/manual/arrow-check.mjs (not in CI). Invented fixtures only.
import { it, expect, describe, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { EditorView } from '@codemirror/view';
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher } from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';
import { zoneShowRoot } from '../src/editor/index.js';
// @ts-ignore host copy of Audroam's outlineFoldHost
import { mountOutlineFold } from './_host.mjs';

beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>));
const CTX = { noteId: '9', ownerId: '' };
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const FIX = `- top <id:1>\n- vault <id:4>\n  - [x] secret a\n- outer <id:20>\n  - [ ] sub <id:21>\n  - 2 <id:22>\n`;

describe('0.4.14 zone block widget and vertical motion', () => {
  it('zoneShowRoot drops blank lines above the root row', () => {
    expect(zoneShowRoot('\n  \n- vault <id:4>\n  - a', '4')).toBe('- vault\n  - a');
    expect(zoneShowRoot('- vault <id:4>\n\n  - a', '4')).toBe('- vault\n\n  - a');
  });

  it('the zone widget has no vertical margin rule and re-measures the outer editor once mounted', async () => {
    clearKeys(); setSealCipher('a256gcm');
    const d = parse(FIX);
    const k = await createKey(d, 'pw', { kid: 'k1' });
    await sealBranch(d, d.nodes.find((n) => n.id === '4')!, k.kid, CTX);
    const text = serialize(d); clearKeys();
    document.body.innerHTML = '';
    const box = document.createElement('div'); document.body.append(box);
    const fh = mountOutlineFold({ text, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 60000, debounceMs: 10 });
    fh.mountEditor(box, {});
    const main = EditorView.findFromDOM(box.querySelector('.cm-editor') as HTMLElement)!;
    let measured = 0;
    const orig = main.requestMeasure.bind(main);
    main.requestMeasure = ((r?: Parameters<EditorView['requestMeasure']>[0]) => { measured++; return orig(r); }) as EditorView['requestMeasure'];
    await fh.sessions.open(fh.regionFor('4'), 'pw');
    await tick();
    expect(document.querySelector('.cm-content > .of-secure-zone')).not.toBeNull();
    expect(measured).toBeGreaterThan(0);
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    const rule = /\.cm-content\s*>\s*\.of-secure-zone\s*\{([^}]*)\}/.exec(css);
    expect(rule?.[1]).toMatch(/margin-top:\s*0/);
    expect(rule?.[1]).toMatch(/margin-bottom:\s*0/);
    // The zone's own margin is horizontal only.
    expect(css).toMatch(/\.of-secure-zone\s*\{[^}]*margin:\s*0 0 0 1\.5em/);
  });
});
