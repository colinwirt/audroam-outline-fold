// Manual browser repro entry (not CI): Map focus -> editor caret (Follow in text), checkbox clicks.
// Invented fixture; test passphrase only. Glue mirrors a host: Map setFocusId -> focusLink.set(id, 'map').
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher, createMapView } from '../../src/index.ts';
import { setArgon2Provider } from '../../src/sealedBranch.ts';
import { mountOutlineFold } from '../../tests/_host.mjs';
import { EditorView } from '@codemirror/view';
setArgon2Provider(async (pw, salt) => new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([...new TextEncoder().encode(pw), ...salt]))));
const CTX = { noteId: '9', ownerId: '' };
const rows = Array.from({ length: 10 }, (_, i) => `- row ${i + 10} <id:${i + 10}>`).join('\n');
const FIX = `- [ ] top task <id:1>\n- vault <id:4>\n  - [ ] secret a <id:5>\n  - secret b <id:6>\n${rows}\n- [ ] far task <id:90>\n`;
window.run = async () => {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse(FIX);
  const k = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes.find((n) => n.id === '4'), k.kid, CTX);
  const text = serialize(d); clearKeys();
  const fh = mountOutlineFold({ text, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 600000, debounceMs: 10 });
  fh.mountEditor(document.getElementById('box'), { followInText: () => true });
  await fh.sessions.open(fh.regionFor('4'), 'pw');
  let view = parse(fh.getText()); fh.markView();
  fh.doc.on('change', (e) => { if (e.source !== 'map') { view = parse(fh.getText()); fh.markView(); mv.paint(); } });
  let focus = '';
  const mv = createMapView(document.getElementById('map'), {
    getDoc: () => view, setDoc: (n) => { view = n; fh.commitView(n, 'map'); },
    getLayout: () => (window.L ||= { version: 1, nodes: {}, _source: 'auto-pack' }), getFocusId: () => focus,
    setFocusId: (id) => { if (id && id !== focus) { focus = id; fh.focusLink.set(String(id), 'map'); } else focus = id || ''; },
    ...fh.mapOptions(), isActive: () => true, onChange: () => mv.paint(),
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 300));
  const main = EditorView.findFromDOM(document.querySelector('#box .cm-editor'));
  const zone = () => EditorView.findFromDOM(document.querySelector('.of-secure-zone-editor .cm-editor'));
  window.T = { main, zone, fh, mv, text: () => fh.getText() };
  return 'ok';
};
