// Manual browser check entry (not CI): a LOCKED sealed node's caption (public label) edited in the
// text and through the Map's setDoc path saves with no key; ct unchanged; unlock still decrypts.
import { parse, serialize, createKey, sealBranch, clearKeys, setSealCipher, createMapView } from '../../src/index.ts';
import { setArgon2Provider } from '../../src/sealedBranch.ts';
import { mountOutlineFold } from '../../tests/_host.mjs';
import { EditorView } from '@codemirror/view';
setArgon2Provider(async (pw, salt) => new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([...new TextEncoder().encode(pw), ...salt]))));
const CTX = { noteId: '9', ownerId: '' };
window.run = async () => {
  clearKeys(); setSealCipher('a256gcm');
  const d = parse('- [ ] top task <id:1>\n- vault <id:4>\n  - secret a <id:5>\n- after <id:7>\n');
  const k = await createKey(d, 'pw', { kid: 'k1' });
  await sealBranch(d, d.nodes.find((n) => n.id === '4'), k.kid, CTX); // default caption = title
  const text = serialize(d); clearKeys();
  const holds = [];
  const fh = mountOutlineFold({ text, ctx: () => CTX, wipeOnPagehide: false, autoLockMs: 600000, debounceMs: 10, onHold: (e) => holds.push(String(e)) });
  fh.mountEditor(document.getElementById('box'), {});
  let view = parse(fh.getText()); fh.markView();
  fh.doc.on('change', (e) => { if (e.source !== 'map') { view = parse(fh.getText()); fh.markView(); mv.paint(); } });
  const mv = createMapView(document.getElementById('map'), {
    getDoc: () => view, setDoc: (n) => { view = n; fh.commitView(n, 'map'); },
    getLayout: () => (window.L ||= { version: 1, nodes: {}, _source: 'auto-pack' }), getFocusId: () => '', setFocusId: () => {},
    ...fh.mapOptions(), isActive: () => true, onChange: () => mv.paint(),
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 200));
  const main = EditorView.findFromDOM(document.querySelector('#box .cm-editor'));
  window.T = { fh, mv, main, holds, text: () => fh.getText(), view: () => view, setView: (v) => { view = v; }, parse };
  return text;
};
