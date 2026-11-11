/**
 * Shared unlock helper for the Pages demos. Real outline-fold seals only:
 * the keyring in the outline is unwrapped with the reader's own passphrase
 * (typed or filled by the browser / password manager), then the branch opens
 * in a memory-only viewer. There is no demo crypto and no shared password.
 */
import {
  cleanCopy,
  clearKeys,
  openSealedBranch,
  promptPassphrase,
  unlockKey,
  unlockKeyring,
  isCollapsed,
  toggleFold,
  SEAL_ALG,
  SEAL_ALG_V1,
  SEAL_ALG_V3,
} from '../../dist/index.js';

/** @param {import('../../dist/index.js').OutlineNode[]} nodes @param {string} id */
export function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** @param {import('../../dist/index.js').OutlineNode[]} nodes */
export function listSealed(nodes, out = []) {
  for (const n of nodes) {
    if (n.sealed) out.push(n);
    if (n.children?.length) listSealed(n.children, out);
  }
  return out;
}

const REAL_ALGS = new Set([SEAL_ALG_V3, SEAL_ALG, SEAL_ALG_V1]);

/**
 * Unlock the key with the passphrase and read one sealed branch as text.
 * Throws SealError on a wrong passphrase. Plaintext stays in memory.
 * @param {import('../../dist/index.js').OutlineFoldDoc} doc
 * @param {string} id
 * @param {string} pass
 * @returns {Promise<string>}
 */
export async function openWithPassphrase(doc, id, pass) {
  const node = findNode(doc.nodes, id);
  const kid = node?.sealed?.kid;
  if (kid) await unlockKey(doc, kid, pass);
  else await unlockKeyring(doc, pass);
  const viewer = await openSealedBranch(doc, id);
  try {
    return cleanCopy(viewer.doc).trimEnd();
  } finally {
    viewer.close();
  }
}

/**
 * Ask for the passphrase on the inline unlock card (always empty, so the
 * browser or password manager can fill it) and open one sealed node.
 * @param {object} args
 * @param {() => import('../../dist/index.js').OutlineFoldDoc} args.getDoc
 * @param {(d: import('../../dist/index.js').OutlineFoldDoc) => void} args.setDoc
 * @param {string} args.id
 * @param {Record<string, string>} args.revealed
 * @param {() => void} args.refresh
 */
export async function tryUnlock({ getDoc, setDoc, id, revealed, refresh }) {
  const node = findNode(getDoc().nodes, id);
  if (!node?.sealed) return;
  if (node.sealed.uri && !node.sealed.ciphertext) {
    window.alert('Stored remotely: ' + node.sealed.uri);
    return;
  }
  if (!REAL_ALGS.has(node.sealed.alg ?? SEAL_ALG_V3)) {
    window.alert('This row is not an outline-fold seal, so this viewer cannot open it.');
    return;
  }
  const anchorEl = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
  await promptPassphrase({
    kid: node.sealed.kid ?? null,
    anchorEl,
    backoffMs: (n) => Math.min(30_000, 1000 * 2 ** (n - 1)),
    attempt: async (pass) => {
      try { revealed[id] = await openWithPassphrase(getDoc(), id, pass); } catch { return false; }
      let doc = getDoc();
      if (isCollapsed(doc, id)) doc = toggleFold(doc, id);
      setDoc(doc);
      refresh();
      return true;
    },
  });
}

/**
 * Lock everything again: close viewers, drop every key from memory, and forget
 * revealed text. Call on idle, sign-out, or page hide.
 * @param {Record<string, string>} revealed
 */
export function lockAll(revealed) {
  clearKeys();
  for (const k of Object.keys(revealed)) delete revealed[k];
}

export function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Inject session-reveal panels under unlocked nodes. */
export function injectReveals(host, revealed) {
  for (const [id, plaintext] of Object.entries(revealed)) {
    const li = host.querySelector('.of-node[data-id="' + CSS.escape(id) + '"]');
    if (!li) continue;
    const locked = li.querySelector(':scope > .of-locked-chrome');
    if (locked) locked.remove();
    let panel = li.querySelector(':scope > .of-reveal');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'of-reveal';
      panel.setAttribute('role', 'region');
      panel.setAttribute('aria-label', 'Unlocked');
      const row = li.querySelector(':scope > .of-row');
      if (row) row.insertAdjacentElement('afterend', panel);
      else li.prepend(panel);
    }
    panel.textContent = plaintext;
  }
}
