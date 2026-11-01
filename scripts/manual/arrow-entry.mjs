// Manual browser repro entry (not CI). Invented fixture; test passphrase only.
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher } from '../../src/index.ts';
import { setArgon2Provider } from '../../src/sealedBranch.ts';
import { mountOutlineFold } from '../../tests/_host.mjs';
import { EditorView } from '@codemirror/view';
setArgon2Provider(async (pw, salt) => {
  const b = new Uint8Array([...new TextEncoder().encode(pw), ...salt]);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', b));
});
const CTX = { noteId: '9', ownerId: '' };
const FIX = `- top <id:1>\n- vault <id:4>\n  - [x] secret a\n  - secret b\n- outer <id:20>\n  - [ ] sub <id:21>\n  - 2 <id:22>\n    - 3 <id:23>\n    - 4 <id:24>\n      - 50 <id:25>\n  - 5 <id:26>\n  - 6 <id:27>\n`;
window.run = async () => {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse(FIX);
  const k = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes.find((n) => n.id === '4'), k.kid, CTX);
  const text = serialize(d); clearKeys();
  const box = document.getElementById('box');
  const fh = mountOutlineFold({ text, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 600000, debounceMs: 10 });
  fh.mountEditor(box, {});
  await fh.sessions.open(fh.regionFor('4'), 'pw');
  await new Promise((r) => setTimeout(r, 300));
  const main = EditorView.findFromDOM(box.querySelector('.cm-editor'));
  const zone = () => EditorView.findFromDOM(document.querySelector('.of-secure-zone-editor .cm-editor'));
  window.T = { main, zone };
  const w = document.querySelector('.of-secure-zone');
  const blk = main.viewState.lineBlockAt(main.state.doc.lineAt(main.state.doc.toString().indexOf('<enc:')).from);
  const cs = getComputedStyle(w);
  return { zoneDomHeight: w.getBoundingClientRect().height, marginTop: cs.marginTop, marginBottom: cs.marginBottom, heightMapBlock: blk.height, zoneDoc: JSON.stringify(zone().state.doc.toString()) };
};
