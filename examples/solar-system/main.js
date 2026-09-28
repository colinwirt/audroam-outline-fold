/**
 * Solar System Outline | Map demo.
 * Shared core only: parseDoc → createOutlineView + createMapView + layoutSidecar.
 * Package: attachOutlineTree / toggleFold / setExpandLevel (via shared).
 */
import { loadDoc } from '../_shared/parseDoc.js';
import { createOutlineView } from '../_shared/outlineView.js';
import { createMapView } from '../_shared/mapView.js';
import { resolveLayout } from '../_shared/layoutSidecar.js';
import { findNode } from '../_shared/unlockStub.js';

const MD_URL = new URL('./solar-system.md', import.meta.url);
const SIBLING_LAYOUT_URL = new URL('./solar-system.layout.json', import.meta.url);

const outlineHost = document.getElementById('outlineHost');
const mapHost = document.getElementById('mapHost');
const panel = document.getElementById('panel');
const btnOutline = document.getElementById('btnOutline');
const btnMap = document.getElementById('btnMap');
const mapTools = document.getElementById('mapTools');
const loadErr = document.getElementById('loadErr');
const btnZoomIn = document.getElementById('btnZoomIn');
const btnZoomOut = document.getElementById('btnZoomOut');
const btnResetView = document.getElementById('btnResetView');

/** @type {import('../../dist/index.js').OutlineFoldDoc} */
let doc;
/** @type {object} */
let layout;
let mode = 'outline';
let focusId = 'root';
/** @type {ReturnType<typeof createOutlineView> | null} */
let outline = null;
/** @type {ReturnType<typeof createMapView> | null} */
let map = null;

function showError(msg) {
  loadErr.hidden = false;
  loadErr.textContent = msg;
}

function paint() {
  if (mode === 'outline') {
    outlineHost.hidden = false;
    mapHost.hidden = true;
    mapTools.hidden = true;
    panel.classList.remove('map-mode');
    panel.dataset.mode = 'outline';
    outline?.refresh(focusId);
  } else {
    outlineHost.hidden = true;
    mapHost.hidden = false;
    mapTools.hidden = false;
    panel.classList.add('map-mode');
    panel.dataset.mode = 'map';
    map?.paint();
  }
}

function setMode(next) {
  mode = next;
  btnOutline.setAttribute('aria-pressed', mode === 'outline' ? 'true' : 'false');
  btnMap.setAttribute('aria-pressed', mode === 'map' ? 'true' : 'false');
  paint();
}

btnOutline.addEventListener('click', () => setMode('outline'));
btnMap.addEventListener('click', () => setMode('map'));

btnZoomIn.addEventListener('click', () => {
  const r = mapHost.getBoundingClientRect();
  map?.zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2);
});
btnZoomOut.addEventListener('click', () => {
  const r = mapHost.getBoundingClientRect();
  map?.zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.2);
});
btnResetView.addEventListener('click', () => map?.resetCam());

async function boot() {
  let loaded;
  try {
    loaded = await loadDoc(MD_URL, { validate: true });
  } catch (err) {
    showError(
      'Could not load solar-system.md — open via a static server (Pages / npx serve), not file://. ' +
        (err instanceof Error ? err.message : String(err)),
    );
    return;
  }

  doc = loaded.doc;
  layout = await resolveLayout(loaded.raw, MD_URL, SIBLING_LAYOUT_URL);

  if (!findNode(doc.nodes, 'root') && doc.nodes[0]?.id) {
    focusId = doc.nodes[0].id;
  }

  outline = createOutlineView(outlineHost, {
    getDoc: () => doc,
    setDoc: (d) => {
      doc = d;
    },
    ariaLabel: 'Solar System outline',
    lockedChrome: false,
    markCues: true,
    // No unlock / decrypt — solar is chrome-free.
  });

  map = createMapView(mapHost, {
    getDoc: () => doc,
    setDoc: (d) => {
      doc = d;
    },
    getLayout: () => layout,
    getFocusId: () => focusId,
    setFocusId: (id) => {
      focusId = id;
    },
    onChange: () => paint(),
    isActive: () => mode === 'map',
    ariaLabel:
      'Solar System mind map, left to right. Pan and zoom enabled.',
  });
  map.ensurePositions();
  map.bindGestures();
  map.bindKeyboard({ panel, modeButton: btnMap });

  outlineHost.addEventListener('click', (e) => {
    const li = e.target.closest?.('[role="treeitem"]');
    if (li?.getAttribute('data-id')) focusId = li.getAttribute('data-id');
  });

  setMode('outline');
}

boot();
