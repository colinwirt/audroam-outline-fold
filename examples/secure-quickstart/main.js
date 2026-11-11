/**
 * Secure quick start: the simplest supported path, with real exports only.
 * createKey (Argon2id-wrapped keyring) -> sealBranch (of-seal-v3) -> serialize
 * -> clearKeys -> unlockKey (empty, autofill-friendly card) -> openSealedBranch.
 * No demo crypto, no shared password, nothing written to storage.
 */
import {
  parse,
  serialize,
  portableCopy,
  cleanCopy,
  createKey,
  sealBranch,
  clearKeys,
  unlockKey,
  openSealedBranch,
  mountCreateKeyPrompt,
  promptPassphrase,
  SealError,
} from '../../dist/index.js';

const $ = (id) => document.getElementById(id);
const src = $('src');
const status = $('status');
const btn = { create: $('btnCreate'), seal: $('btnSeal'), lock: $('btnLock'), unlock: $('btnUnlock'), reset: $('btnReset') };
const out = { portable: $('portable'), clean: $('clean'), opened: $('opened') };
const VAULT = 'vault';

/** @type {import('../../dist/index.js').OutlineFoldDoc | null} */
let doc = null;
/** @type {string | null} */
let kid = null;
/** Text a host would store. */
let saved = '';

function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = n.children && findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

function show(el, text) {
  el.textContent = text;
  el.hidden = !text;
}

function stage(name) {
  btn.create.disabled = name !== 'start';
  btn.seal.disabled = name !== 'keyed';
  btn.lock.disabled = name !== 'sealed';
  btn.unlock.disabled = name !== 'locked';
  src.readOnly = name !== 'start';
}

function reset() {
  clearKeys();
  doc = null;
  kid = null;
  saved = '';
  for (const el of Object.values(out)) show(el, '');
  $('createSlot').replaceChildren();
  $('unlockSlot').replaceChildren();
  status.textContent = '';
  stage('start');
}

btn.create.addEventListener('click', () => {
  doc = parse(src.value);
  if (!findNode(doc.nodes, VAULT)) {
    status.textContent = 'Keep a line with <id:vault> to seal.';
    return;
  }
  btn.create.disabled = true;
  const h = mountCreateKeyPrompt({
    container: $('createSlot'),
    inline: true,
    account: 'outline-fold quick start',
    create: async (pass) => {
      const entry = await createKey(doc, pass);
      kid = entry.kid;
    },
    onClose: (created) => {
      if (created) {
        const kdf = doc.keyring.find((k) => k.kid === kid)?.kdf ?? '';
        status.textContent = `Key ${kid} created. Keyring header: ${kdf.split('$').slice(0, 4).join('$')}$…`;
        stage('keyed');
      } else {
        stage('start');
      }
    },
  });
  void h.done;
});

btn.seal.addEventListener('click', async () => {
  btn.seal.disabled = true;
  try {
    await sealBranch(doc, findNode(doc.nodes, VAULT), kid);
    saved = serialize(doc);
    show(out.portable, portableCopy(doc));
    show(out.clean, cleanCopy(doc));
    status.textContent = 'Sealed. The branch text is now ciphertext; the keyring holds the wrapped key.';
    stage('sealed');
  } catch (err) {
    status.textContent = 'Could not seal: ' + (err instanceof Error ? err.message : String(err));
    stage('keyed');
  }
});

btn.lock.addEventListener('click', () => {
  clearKeys();
  doc = parse(saved);
  show(out.opened, '');
  status.textContent = 'Locked. Keys are gone from memory; only the saved text is left.';
  stage('locked');
});

btn.unlock.addEventListener('click', async () => {
  btn.unlock.disabled = true;
  const ok = await promptPassphrase({
    kid,
    container: $('unlockSlot'),
    inline: true,
    backoffMs: (n) => Math.min(30_000, 1000 * 2 ** (n - 1)),
    attempt: async (pass) => {
      try {
        await unlockKey(doc, kid, pass);
      } catch (err) {
        if (err instanceof SealError) return false;
        throw err;
      }
      const viewer = await openSealedBranch(doc, VAULT);
      try {
        show(out.opened, cleanCopy(viewer.doc));
      } finally {
        viewer.close();
      }
      return true;
    },
  });
  if (ok) {
    status.textContent = 'Unlocked in memory. The saved text did not change.';
    stage('unlocked');
  } else {
    stage('locked');
  }
});

btn.reset.addEventListener('click', reset);
window.addEventListener('pagehide', () => clearKeys());
reset();
