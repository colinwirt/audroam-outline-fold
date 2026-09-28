/**
 * Shared unlock/decrypt helper for Pages demos.
 * PLACEHOLDER ciphertext → stub unlock N/A (no invented secrets).
 */
import {
  demoOpen,
  DEMO_PASSPHRASE,
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

export function isPlaceholderSealed(sealed) {
  if (!sealed) return false;
  const ct = sealed.ciphertext;
  return typeof ct === 'string' && /^PLACEHOLDER$/i.test(ct.trim());
}

/**
 * @param {object} args
 * @param {() => import('../../dist/index.js').OutlineFoldDoc} args.getDoc
 * @param {(d: import('../../dist/index.js').OutlineFoldDoc) => void} args.setDoc
 * @param {string} args.id
 * @param {Record<string, string>} args.revealed
 * @param {() => void} args.refresh
 * @param {boolean} [args.stubUnlock=true]
 */
export async function tryUnlock({
  getDoc,
  setDoc,
  id,
  revealed,
  refresh,
  stubUnlock = true,
}) {
  let doc = getDoc();
  const node = findNode(doc.nodes, id);
  if (!node?.sealed) {
    window.alert(
      'No sealed payload on “' + id + '”. Host MFA/crypto is out of this package.',
    );
    return;
  }
  if (stubUnlock && isPlaceholderSealed(node.sealed)) {
    window.alert(
      [
        'Stub unlock N/A',
        '',
        'This Pages demo ships with ct: PLACEHOLDER (not real ciphertext).',
        'Host replaces via npm run demo:seal when plaintexts are ready.',
        '',
        'kid: ' + (node.sealed.kid || '(none)'),
        'id: ' + id,
      ].join('\n'),
    );
    return;
  }
  if (node.sealed.uri && !node.sealed.ciphertext) {
    window.alert(
      'Remote sealed blob (kid=' +
        (node.sealed.kid || '') +
        ').\nURI: ' +
        node.sealed.uri +
        '\n\nDemo does not fetch — host would fetch after key release.',
    );
    return;
  }
  const source = window.prompt(
    [
      'Key source for demo:',
      '1 = browser session (sample passphrase)',
      '2 = paste from password manager',
      '3 = pageant / OS agent (stub)',
      '4 = server after MFA (stub → sample key)',
      '',
      'Enter 1–4:',
    ].join('\n'),
    '1',
  );
  if (source == null) return;
  let pass = null;
  switch (source.trim()) {
    case '1':
      pass = window.prompt(
        'Session passphrase (cafe sample: northside-demo)',
        DEMO_PASSPHRASE,
      );
      break;
    case '2':
      pass = window.prompt(
        'Paste passphrase from password manager (demo field):',
        '',
      );
      break;
    case '3':
      window.alert(
        'Pageant / OS agent is not wired in this browser demo. Use 1 or 2.',
      );
      return;
    case '4':
      window.alert(
        'Stub: MFA OK → host would release DEK. Demo falls through to sample passphrase.',
      );
      pass = DEMO_PASSPHRASE;
      break;
    default:
      window.alert('Unknown key source — use 1–4.');
      return;
  }
  if (pass == null) return;
  try {
    const plaintext = await demoOpen(node.sealed, pass);
    revealed[id] = plaintext;
    if (isCollapsed(doc, id)) {
      doc = toggleFold(doc, id);
      setDoc(doc);
    }
    refresh();
  } catch (err) {
    window.alert(
      err instanceof Error ? err.message : 'Decrypt failed (wrong passphrase?)',
    );
  }
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
      panel.setAttribute('aria-label', 'Session reveal');
      const row = li.querySelector(':scope > .of-row');
      if (row) row.insertAdjacentElement('afterend', panel);
      else li.prepend(panel);
    }
    panel.innerHTML =
      '<span class="of-reveal-label">Session reveal (demo) · not written to editor</span>' +
      escHtml(plaintext);
  }
}
