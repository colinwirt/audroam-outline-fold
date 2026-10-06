/**
 * @deprecated Prefer examples/viewer/?doc=… (shared Outline | Map shell).
 * Kept briefly for any lingering deep links; new work uses viewer/main.js.
 */
import { loadDoc } from './_shared/parseDoc.js';
import { createOutlineView } from './_shared/outlineView.js';
import { tryUnlock, loadDemoPassword } from './_shared/unlock.js';

const cfg = window.OUTLINE_DEMO || {};
const demoPasswordReady = loadDemoPassword();
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

function showLoadError(msg) {
  if (!loadErr) return;
  loadErr.hidden = false;
  loadErr.textContent = msg;
}

function showValidation(v) {
  if (!validationEl || !v) return;
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

async function main() {
  let loaded;
  try {
    loaded = await loadDoc(mdUrl);
  } catch (err) {
    showLoadError(
      err instanceof Error ? err.message : 'Failed to load outline markdown',
    );
    return;
  }
  doc = loaded.doc;
  showValidation(loaded.validation);

  const view = createOutlineView(tree, {
    getDoc: () => doc,
    setDoc: (d) => {
      doc = d;
    },
    ariaLabel,
    lockedChrome: true,
    revealed,
    serializeTarget: foldOut,
    onUnlock: async (id) => {
      void tryUnlock({
        getDoc: () => doc,
        setDoc: (d) => {
          doc = d;
        },
        id,
        revealed,
        refresh: () => view.refresh(id),
        demoPassword: await demoPasswordReady,
      });
    },
    onDecrypt: async (id) => {
      void tryUnlock({
        getDoc: () => doc,
        setDoc: (d) => {
          doc = d;
        },
        id,
        revealed,
        refresh: () => view.refresh(id),
        demoPassword: await demoPasswordReady,
      });
    },
  });

  view.refresh();
}

main();
