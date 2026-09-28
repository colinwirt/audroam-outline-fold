/**
 * Shared Pages outline viewer for @audroam/outline-fold demos.
 * Expects window.OUTLINE_DEMO = {
 *   md: './file.md',
 *   ariaLabel: string,
 *   stubUnlock?: boolean   // PLACEHOLDER ct → unlock N/A (default true)
 * }
 */
import {
  parse,
  toggleFold,
  serialize,
  toHtml,
  isCollapsed,
  demoOpen,
  DEMO_PASSPHRASE,
  validateDocument,
  attachOutlineTree,
} from '../dist/index.js';

const cfg = window.OUTLINE_DEMO || {};
const stubUnlock = cfg.stubUnlock !== false;
const ariaLabel = cfg.ariaLabel || 'Outline demo';
const mdUrl = new URL(cfg.md || './demo.md', window.location.href);

const tree = document.getElementById('tree');
const foldOut = document.getElementById('foldOut');
const validationEl = document.getElementById('validation');
const loadErr = document.getElementById('loadErr');

/** @type {import('../dist/index.js').OutlineFoldDoc} */
let doc;
/** @type {Record<string, string>} */
const revealed = Object.create(null);
/** @type {{ refresh: (id?: string | null) => void }} */
const treeApi = { refresh: () => { paint(); } };

function showLoadError(msg) {
  if (!loadErr) return;
  loadErr.hidden = false;
  loadErr.textContent = msg;
}

function showValidation(source) {
  if (!validationEl) return;
  const v = validateDocument(source);
  validationEl.hidden = false;
  if (v.ok && v.issues.length === 0) {
    validationEl.className = 'ok';
    validationEl.textContent = 'validateDocument: ok — outline renders; no issues.';
    return;
  }
  validationEl.className = v.ok ? 'ok' : 'bad';
  const title = v.ok
    ? 'validateDocument: warnings (outline still renders)'
    : 'validateDocument: errors (outline still renders when parseable; gate save/share)';
  validationEl.innerHTML =
    '<strong>' +
    title +
    '</strong><ul>' +
    v.issues
      .map(
        (i) =>
          '<li><code>' +
          i.severity +
          '</code> <code>' +
          i.code +
          '</code> ' +
          i.message +
          (i.line != null ? ' · line ' + i.line : '') +
          (i.nodeId ? ' · #' + i.nodeId : '') +
          '</li>',
      )
      .join('') +
    '</ul>';
}

function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isPlaceholderSealed(sealed) {
  if (!sealed) return false;
  const ct = sealed.ciphertext;
  return typeof ct === 'string' && /^PLACEHOLDER$/i.test(ct.trim());
}

function injectReveals() {
  for (const [id, plaintext] of Object.entries(revealed)) {
    const li = tree.querySelector('.of-node[data-id="' + CSS.escape(id) + '"]');
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
      esc(plaintext);
  }
}

async function tryUnlock(id) {
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
        node.sealed.kid +
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
    }
    treeApi.refresh(id);
  } catch (err) {
    window.alert(
      err instanceof Error ? err.message : 'Decrypt failed (wrong passphrase?)',
    );
  }
}

function paint() {
  tree.innerHTML = toHtml(doc, { ariaLabel });
  if (foldOut) foldOut.textContent = serialize(doc);
  injectReveals();
}

async function main() {
  let raw;
  try {
    const res = await fetch(mdUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + mdUrl.pathname);
    raw = await res.text();
  } catch (err) {
    showLoadError(
      err instanceof Error ? err.message : 'Failed to load outline markdown',
    );
    return;
  }
  showValidation(raw);
  doc = parse(raw);
  paint();
  Object.assign(
    treeApi,
    attachOutlineTree(tree, {
      getDoc: () => doc,
      setDoc: (d) => {
        doc = d;
      },
      render: paint,
      onUnlock: (id) => {
        void tryUnlock(id);
      },
      onDecrypt: (id) => {
        void tryUnlock(id);
      },
    }),
  );
  treeApi.refresh();
}

main();
