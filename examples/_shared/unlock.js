/**
 * Shared unlock helper for the Pages demos (demo crypto only).
 */
import {
  demoOpen,
  isCollapsed,
  toggleFold,
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

/**
 * Demo values provider: the one demo password for the example outlines.
 * Lives in examples/demo-values.json, never in the outline text.
 * Resolves to null when the file is missing.
 * @returns {Promise<string | null>}
 */
export async function loadDemoPassword() {
  try {
    const res = await fetch(new URL('../demo-values.json', import.meta.url));
    if (!res.ok) return null;
    const values = await res.json();
    return typeof values?.password === 'string' && values.password
      ? values.password
      : null;
  } catch {
    return null;
  }
}

/** @param {import('../../dist/index.js').OutlineNode[]} nodes */
export function listSealed(nodes, out = []) {
  for (const n of nodes) {
    if (n.sealed) out.push(n);
    if (n.children?.length) listSealed(n.children, out);
  }
  return out;
}

/**
 * Ask for the password (prefilled with the demo password when there is one)
 * and open one sealed node.
 * @param {object} args
 * @param {() => import('../../dist/index.js').OutlineFoldDoc} args.getDoc
 * @param {(d: import('../../dist/index.js').OutlineFoldDoc) => void} args.setDoc
 * @param {string} args.id
 * @param {Record<string, string>} args.revealed
 * @param {() => void} args.refresh
 * @param {string | null} [args.demoPassword]
 */
export async function tryUnlock({
  getDoc,
  setDoc,
  id,
  revealed,
  refresh,
  demoPassword = null,
}) {
  const node = findNode(getDoc().nodes, id);
  if (!node?.sealed) return;
  if (node.sealed.uri && !node.sealed.ciphertext) {
    window.alert('Stored remotely: ' + node.sealed.uri);
    return;
  }
  const pass = window.prompt('Password', demoPassword ?? '');
  if (pass == null) return;
  await openAll({ getDoc, setDoc, ids: [id], revealed, refresh, password: pass });
}

/**
 * Open the given sealed nodes with one password. Unfolds each opened node.
 * @param {object} args
 * @param {() => import('../../dist/index.js').OutlineFoldDoc} args.getDoc
 * @param {(d: import('../../dist/index.js').OutlineFoldDoc) => void} args.setDoc
 * @param {string[]} args.ids
 * @param {Record<string, string>} args.revealed
 * @param {() => void} args.refresh
 * @param {string} args.password
 */
export async function openAll({ getDoc, setDoc, ids, revealed, refresh, password }) {
  let doc = getDoc();
  let failed = 0;
  for (const id of ids) {
    const node = findNode(doc.nodes, id);
    if (!node?.sealed?.ciphertext) continue;
    try {
      revealed[id] = await demoOpen(node.sealed, password);
      if (isCollapsed(doc, id)) doc = toggleFold(doc, id);
    } catch {
      failed++;
    }
  }
  setDoc(doc);
  refresh();
  if (failed) window.alert('Wrong password');
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
